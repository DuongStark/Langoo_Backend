"""PC pilot: translate Langoo 20-sense batches via the native Muse gateway."""
from __future__ import annotations

import argparse
import json
import os
import queue
import re
import sys
import threading
import time
import traceback
import uuid
from pathlib import Path

TRANSPORT = Path(r"C:\Users\PC\Desktop\muse-native")
COOKIE_FILE = Path(os.environ.get("MUSE_COOKIE_FILE", str(TRANSPORT / "cookies.json")))
JOB = Path(r"C:\Users\PC\Desktop\Langoo-Gemini\job\ja-vi-20261108-pc16gb")
sys.path.insert(0, str(TRANSPORT))

from muse import Gateway, load_cookies  # noqa: E402

LOCK = threading.Lock()


def log(message: str) -> None:
    with LOCK:
        print(time.strftime("%H:%M:%S"), message, flush=True)


class ObservedGateway(Gateway):
    def __init__(self, *args, **kwargs):
        self.generation_status = None
        self.generation_stream = None
        super().__init__(*args, **kwargs)

    def _read_frame(self):
        frame = super()._read_frame()
        try:
            if frame.stream_id == self.generation_stream:
                kind = frame.WhichOneof("kind")
                if kind == "response":
                    self.generation_status = int(frame.response.status)
                elif kind == "reset":
                    self.generation_status = -1
        except Exception:
            pass
        return frame


def extract_sid(value):
    if not isinstance(value, dict):
        raise ValueError("session response not dict")
    for candidate in (value, value.get("session"), value.get("result")):
        if isinstance(candidate, dict):
            sid = candidate.get("session_id") or candidate.get("id")
            if isinstance(sid, str) and re.fullmatch(r"[0-9a-fA-F-]{36}", sid):
                return sid
    raise ValueError("no session uuid")


def strip_noise(text: str) -> str:
    text = text.strip()
    text = re.sub(r"<thought>.*?</thought>", "", text, flags=re.S).strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1] if "\n" in text else text
        text = text.rsplit("```", 1)[0].strip()
    return text


def normalize_items(value, expected_ids):
    rows = value.get("items") if isinstance(value, dict) else None
    if isinstance(rows, dict):
        rows = [rows]
    if not isinstance(rows, list):
        return None
    out = {}
    for row in rows:
        if not isinstance(row, dict):
            return None
        rid = str(row.get("id"))
        vi = row.get("vi")
        if not isinstance(vi, str) or not vi.strip():
            return None
        if rid in out and out[rid] != vi.strip():
            return None
        out[rid] = vi.strip()
    if set(out) != set(expected_ids):
        return None
    return out


def parse_reply(text: str, expected_ids):
    text = strip_noise(text)
    decoder = json.JSONDecoder()
    starts = [m.start() for m in re.finditer(r'\{\s*"items"\s*:', text)]
    for start in reversed(starts):
        try:
            value, _end = decoder.raw_decode(text[start:])
        except Exception:
            continue
        items = normalize_items(value, expected_ids)
        if items is not None:
            return items, "json-block"
    pairs = re.findall(r'\{\s*"id"\s*:\s*"(\d+)"\s*,\s*"vi"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}', text, re.S)
    if pairs:
        out = {}
        for rid, vi in pairs:
            value = json.loads(f'"{vi}"')
            if rid in out and out[rid] != value:
                return None, "conflict"
            out[rid] = value
        if set(out) == set(expected_ids):
            return out, "regex"
    return None, "unparseable"


def source_batches(limit: int, forced_keys):
    manifest = json.loads((JOB / "manifest.json").read_text(encoding="utf-8"))
    incoming_dir = JOB / "incoming"
    incoming = {p.stem for p in incoming_dir.glob("*.json")} if incoming_dir.exists() else set()
    selected = []
    for key in forced_keys:
        selected.append(json.loads((JOB / "batches" / f"{key}.json").read_text(encoding="utf-8")))
    if len(selected) < limit:
        for entry in manifest["batches"]:
            key = entry["key"]
            if key in incoming or any(batch["key"] == key for batch in selected):
                continue
            selected.append(json.loads((JOB / "batches" / f"{key}.json").read_text(encoding="utf-8")))
            if len(selected) >= limit:
                break
    return selected


class Worker:
    def __init__(self, wid, out_dir, timeout):
        self.wid = wid
        self.out_dir = out_dir
        self.timeout = timeout
        self.gateway = None

    def ensure_gateway(self):
        if self.gateway is not None:
            return
        self.gateway = ObservedGateway(load_cookies(str(COOKIE_FILE)))
        log(f"w{self.wid}: gateway connected")

    def drop_gateway(self):
        if self.gateway is not None:
            try:
                self.gateway.close()
            except Exception:
                pass
            self.gateway = None

    def attempt(self, batch):
        self.ensure_gateway()
        expected = [str(item["id"]) for item in batch["items"]]
        response = self.gateway.call_json(
            "session.start",
            body={"method": "/api/session/start", "params": {
                "origin": "fresh", "lifecycle": "persistent",
                "title": f"Langoo sense PC pilot ({len(expected)})",
            }},
            timeout=25,
        )
        sid = extract_sid(response)
        history = self.gateway.call_json("chat.history", body={"session_id": sid, "limit": 1}, timeout=20)
        if history.get("chat_events"):
            raise ValueError("side-chat not empty")
        self.gateway.generation_status = None
        self.gateway.generation_stream = self.gateway._open(
            "chat.stream",
            body={"session_id": sid, "items": [{"type": "text", "text": batch["prompt"]}],
                  "node_id": str(uuid.uuid4()), "capabilities": {}},
        )
        deadline = time.monotonic() + self.timeout
        primary = None
        fallback = None
        stable = 0
        while time.monotonic() < deadline:
            history = self.gateway.call_json("chat.history", body={"session_id": sid, "limit": 10}, timeout=20)
            for event in history.get("chat_events") or []:
                payload = event.get("payload") or {}
                if not isinstance(payload, dict) or event.get("event_name") != "message.assistant":
                    continue
                text = payload.get("display_text") or payload.get("content") or event.get("text")
                if isinstance(text, str) and text.strip():
                    if payload.get("reply_to_message_id") or event.get("reply_to_message_id"):
                        fallback = text
                    else:
                        primary = text
            for candidate, flag in ((primary, "primary"), (fallback, "fallback")):
                if candidate is None or self.gateway.generation_status is None:
                    continue
                items, how = parse_reply(candidate, expected)
                if items is None and flag == "fallback":
                    stable = 0
                    continue
                if items is not None:
                    if flag == "primary":
                        return items, how, candidate
                    stable += 1
                    if stable >= 2:
                        return items, how, candidate
            time.sleep(1.5)
        raise TimeoutError("no valid reply in window")

    def run(self, work):
        while True:
            try:
                batch = work.get_nowait()
            except queue.Empty:
                return
            key = batch["key"][:12]
            for attempt in (1, 2):
                started = time.monotonic()
                try:
                    items, how, raw = self.attempt(batch)
                except Exception as error:  # noqa: BLE001
                    self.drop_gateway()
                    log(f"w{self.wid} {key} attempt{attempt} FAIL {type(error).__name__}")
                    if attempt == 2:
                        break
                    continue
                elapsed = round(time.monotonic() - started, 2)
                ordered = [{"id": item["id"], "vi": items[str(item["id"])]} for item in batch["items"]]
                record = {"batchKey": batch["key"], "elapsedSeconds": elapsed, "parse": how,
                          "items": ordered, "raw": raw}
                (self.out_dir / f"{batch['key'][:12]}.json").write_text(
                    json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
                log(f"w{self.wid} {key} ok 20 | {elapsed}s | {how}")
                break


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--limit", type=int, default=8)
    parser.add_argument("--timeout", type=int, default=240)
    parser.add_argument("--keys", default="")
    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    forced = [key for key in args.keys.split(",") if key]
    batches = source_batches(args.limit, forced)

    work = queue.Queue()
    for batch in batches:
        work.put(batch)
    started = time.monotonic()
    threads = [threading.Thread(target=Worker(i, out_dir, args.timeout).run, args=(work,), daemon=True)
               for i in range(args.workers)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    log(f"done {len(batches)} batches in {time.monotonic() - started:.1f}s")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        traceback.print_exc()
        raise
