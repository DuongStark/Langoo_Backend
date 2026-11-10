from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from muse import Gateway, ApplicationRequest, ServiceFrame, SERVICE_IDS, load_cookies
from pilot_pc import COOKIE_FILE, ObservedGateway, extract_sid

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
FFMPEG = shutil.which("ffmpeg")
if not FFMPEG:
    raise SystemExit("FFMPEG_NOT_FOUND")


def download(gw: Gateway, path: str) -> bytes:
    sid = gw.stream
    gw.stream += 1
    req = ApplicationRequest(verb="GET", path="/media/raw/" + path, body=b"", end_body=True)
    header = req.headers.add()
    header.key = "x-request-id"
    header.value = str(uuid.uuid4())
    frame = ServiceFrame(stream_id=sid)
    frame.request.CopyFrom(req)
    gw._send_envelope(SERVICE_IDS["daemon"], frame.SerializeToString())
    status = None
    chunks = []
    for _ in range(400):
        sf = gw._read_frame()
        if sf.stream_id != sid:
            continue
        kind = sf.WhichOneof("kind")
        if kind == "response":
            status = sf.response.status
            if sf.response.body:
                chunks.append(bytes(sf.response.body))
            if sf.response.end_body:
                break
        elif kind == "body_chunk":
            chunks.append(bytes(sf.body_chunk.data))
            if sf.body_chunk.end_body:
                break
        elif kind == "reset":
            raise RuntimeError(f"media reset {sf.reset.code} {sf.reset.reason}")
    if status != 200:
        raise RuntimeError(f"media status {status}")
    return b"".join(chunks)


def compress(data: bytes) -> tuple[bytes, bool]:
    with tempfile.TemporaryDirectory() as td:
        src = Path(td) / "in.webp"
        dst = Path(td) / "out.webp"
        src.write_bytes(data)
        cmd = [FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", str(src),
               "-vf", "scale=512:512:force_original_aspect_ratio=increase,crop=512:512",
               "-c:v", "libwebp", "-quality", "75", "-compression_level", "6", "-f", "webp", str(dst)]
        proc = subprocess.run(cmd, capture_output=True, timeout=60)
        if proc.returncode == 0 and dst.exists():
            out = dst.read_bytes()
            if out[:4] == b"RIFF" and out[8:12] == b"WEBP":
                return out, True
    return data, False


def run_record(record: dict, out_root: Path) -> dict:
    started = time.monotonic()
    items = record["items"]
    expected = len(items)
    gw = ObservedGateway(load_cookies(str(COOKIE_FILE)))
    try:
        resp = gw.call_json("session.start", body={"method": "/api/session/start", "params": {
            "origin": "fresh", "lifecycle": "persistent", "title": f"Langoo {record['prompt_id']}",
        }}, timeout=30)
        sid = extract_sid(resp)
        gw.generation_status = None
        gw.generation_stream = gw._open("chat.stream", body={
            "session_id": sid, "items": [{"type": "text", "text": record["prompt"]}],
            "node_id": str(uuid.uuid4()), "capabilities": {},
        })
        seen = set()
        images = {}
        deadline = time.monotonic() + 300
        while time.monotonic() < deadline:
            hist = gw.call_json("chat.history", body={"session_id": sid, "limit": 100}, timeout=30)
            for event in hist.get("chat_events") or []:
                event_key = event.get("message_id") or json.dumps(event, ensure_ascii=False, sort_keys=True)[:200]
                if event_key in seen:
                    continue
                seen.add(event_key)
                payload = event.get("payload") or {}
                data = payload.get("data") if isinstance(payload, dict) else None
                if isinstance(data, dict) and isinstance(data.get("images"), list):
                    for item in data["images"]:
                        path = item.get("path")
                        if path:
                            images[path] = item
            if len(images) >= expected:
                break
            time.sleep(2)
        saved = []
        d = out_root / record["prompt_id"]
        d.mkdir(parents=True, exist_ok=True)
        for index, (path, item) in enumerate(images.items(), 1):
            raw = download(gw, path.replace("sandbox://", ""))
            data, ok = compress(raw)
            target = d / f"{record['prompt_id']}_{index:02d}.webp"
            target.write_bytes(data)
            saved.append({
                "index": index,
                "sense_id": items[index - 1]["sense_id"] if index <= len(items) else None,
                "lemma": items[index - 1]["lemma"] if index <= len(items) else None,
                "file": target.name,
                "label": item.get("label"),
                "source_bytes": len(raw),
                "bytes": len(data),
                "compressed": ok,
            })
        result = {
            "prompt_id": record["prompt_id"],
            "style": record.get("style"),
            "elapsed_s": round(time.monotonic() - started, 1),
            "expected": expected,
            "got": len(saved),
            "items": items,
            "images": saved,
            "prompt": record["prompt"],
        }
        (d / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        return result
    finally:
        gw.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prompts", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--skip-file", default=None,
                        help="Optional text/JSONL prompt-id list; these prompts are not generated again.")
    args = parser.parse_args()
    prompt_path = Path(args.prompts)
    out_root = Path(args.out)
    out_root.mkdir(parents=True, exist_ok=True)
    records = [json.loads(line) for line in prompt_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    skip_ids = set()
    if args.skip_file:
        for line in Path(args.skip_file).read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            try:
                value = json.loads(line)
                skip_ids.add(str(value.get("prompt_id") if isinstance(value, dict) else value))
            except json.JSONDecodeError:
                skip_ids.add(line)
    if skip_ids:
        before = len(records)
        records = [r for r in records if str(r.get("prompt_id")) not in skip_ids]
        print("SKIP_FILE", len(skip_ids), "ids;", before - len(records), "records skipped", flush=True)
    results = []
    pending = []
    for record in records:
        result_path = out_root / record["prompt_id"] / "result.json"
        if result_path.exists():
            existing = json.loads(result_path.read_text(encoding="utf-8"))
            if existing.get("got") == existing.get("expected"):
                results.append(existing)
                continue
        pending.append(record)
    print("RESUME", len(results), "done,", len(pending), "pending", flush=True)
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(run_record, record, out_root): record for record in pending}
        for future in as_completed(futures):
            source = futures[future]
            try:
                record = future.result()
            except Exception as error:  # noqa: BLE001
                record = {
                    "prompt_id": source["prompt_id"],
                    "style": source.get("style"),
                    "expected": len(source["items"]),
                    "got": 0,
                    "error": f"{type(error).__name__}: {str(error)[:300]}",
                    "items": source["items"],
                    "images": [],
                    "prompt": source["prompt"],
                }
                print("FAIL", source["prompt_id"], record["error"][:180], flush=True)
                results.append(record)
                continue
            results.append(record)
            print("DONE", record["prompt_id"], record["got"], "/", record["expected"], record["elapsed_s"], flush=True)
    (out_root / "manifest.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    total = sum(r["got"] for r in results)
    bytes_ = sum(i["bytes"] for r in results for i in r["images"])
    summary = {"prompts": len(results), "expected": sum(r["expected"] for r in results), "images": total, "bytes": bytes_, "mb": round(bytes_ / 1024 / 1024, 2), "out": str(out_root)}
    (out_root / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
