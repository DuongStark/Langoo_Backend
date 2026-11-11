#!/usr/bin/env python3
"""Langoo Muse pilot driver.

One CLI invocation produces one image (verified on the Muse VM).  This driver
runs a bounded worker pool, compresses each image to 512x512 WebP q75, and
checkpoints every sense in SQLite so a killed/restarted VM resumes without
regenerating completed images.

No R2/DB credentials are used here.  Upload is a separate stage.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

STYLE_TEXT = {
    "photo_natural": "A quick unedited photograph taken on an ordinary mid-range phone in normal photo mode. Use believable everyday surroundings and available light, natural colors, modest contrast and saturation, slightly soft fine detail. Use a simple, incidental composition with ordinary materials, believable scale and a useful but uncluttered background. Avoid glossy plastic surfaces, excessive symmetry, decorative props, perfect showroom staging, teal-orange grading, glowing edges and hyper-detailed textures. Prefer the object, food, place or visible result alone. Include a person only when the exact dictionary meaning cannot be communicated clearly without one; never add people for atmosphere, scale or decoration. When human action is essential, show only the minimum necessary body area, preferably a natural hand or partial figure, with no posed face, eye contact or staged smile. Do not crop away information needed to distinguish the meaning. No commercial polish, cinematic lighting, HDR, beauty retouching, exaggerated reactions, artificial background blur, captions, labels, logos, watermarks, or collage. Do not deliberately add blur, dirt, aging, or noise. The exact meaning must remain easy to recognize at thumbnail size.",
    "photo_window": "candid photo in soft window light, natural depth of field, everyday interior with ordinary objects; no studio staging or stock look",
    "photo_documentary": "candid documentary or street-style photo, available light, unposed everyday moment, natural colors and modest detail; no commercial polish",
    "photo_studio": "clean simple still-life photo on a neutral seamless background, soft diffused light, believable ordinary object; no glossy product-ad look or heavy retouching",
    "photo_film": "35mm analog film photo, natural grain, muted natural colors, available light, simple everyday scene; no cinematic grading or digital gloss",
    "cartoon": "clean 2D cartoon illustration, flat solid colors, simple rounded shapes, bold clean outlines, minimal shading; no corporate vector look, no gradients or gloss",
    "handdrawn": "hand-drawn pencil and ink sketch on plain paper, visible line work, light hatching, simple background; no digital gloss",
    "watercolor": "soft watercolor illustration on textured paper, gentle color washes, loose edges, simple background; no heavy digital effects",
    "flatvector": "flat vector illustration, geometric shapes, limited palette, clean minimal background; no gradients, gloss or corporate icon look",
    "comic": "simple comic-book panel, bold ink lines, flat color, light halftone; no speech bubbles",
    "clay": "soft matte 3D clay or toy render, rounded shapes, simple plain background; no glossy plastic",
    "minimal": "minimal black line art on off-white background, one clear subject, simple shapes, no shading",
    "ink": "loose ink-wash illustration, expressive brush lines, limited muted colors, textured paper, simple background; no digital gloss",
    "pastel": "soft pastel or chalk illustration, gentle pigment texture, muted colors, simple background; no glossy digital look",
}
STYLES = list(STYLE_TEXT)
CAMERAS = [
    "eye-level medium shot", "top-down flat lay", "close-up detail",
    "wide environmental shot", "three-quarter angle", "low-angle shot", "overhead view",
]
LIGHTS = [
    "soft overcast daylight", "warm indoor lamplight", "window light",
    "neutral diffused light", "golden-hour light", "cool morning light", "soft shadowless light",
]
GLOBAL = "Square 1:1 512x512. One clear subject per image, exact everyday meaning, simple uncluttered background, recognizable at thumbnail size. No text, labels, logos, watermarks or collage. No stock/cinematic/HDR/beauty-retouch look."


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def prompt_for(item: dict, ordinal: int) -> tuple[str, str]:
    style = STYLES[(ordinal - 1) % len(STYLES)]
    camera = CAMERAS[(ordinal * 3) % len(CAMERAS)]
    light = LIGHTS[(ordinal * 5) % len(LIGHTS)]
    lemma = item.get("lemma") or ""
    reading = item.get("reading") or ""
    pos = item.get("pos") or "unknown"
    gloss = item.get("en_gloss") or item.get("gloss") or item.get("definition") or ""
    reading_pos = f"{reading}, {pos}" if reading else pos
    prompt = (
        "Generate exactly 1 separate square 1:1 512x512 image for the numbered vocabulary item below. "
        "Do not make variations or a collage. Keep the same order. No text, labels, logos or watermarks. "
        "Illustrate the exact meaning, not just the word. The gloss is the exact sense; do not choose another common meaning. "
        f"Use a different everyday situation and follow the camera and lighting; Style: {STYLE_TEXT[style]}. {GLOBAL}\n\n"
        f"1. JA | {lemma} ({reading_pos}) | {gloss} | camera: {camera} | light: {light}\n\n"
        "Return the 1 image."
    )
    return prompt, style


class Store:
    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.Lock()
        path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(path), check_same_thread=False, timeout=30)
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA busy_timeout=30000")
        self.conn.execute(
            """CREATE TABLE IF NOT EXISTS progress (
                sense_id TEXT PRIMARY KEY,
                phase TEXT NOT NULL,
                status TEXT NOT NULL,
                raw_path TEXT,
                final_path TEXT,
                sha256 TEXT,
                attempts INTEGER NOT NULL DEFAULT 0,
                error TEXT,
                updated_at TEXT NOT NULL
            )"""
        )
        self.conn.commit()

    def get(self, sid: str):
        with self.lock:
            return self.conn.execute(
                "SELECT status, raw_path, final_path, sha256, attempts FROM progress WHERE sense_id=?",
                (sid,),
            ).fetchone()

    def update(self, sid: str, phase: str, status: str, raw_path="", final_path="", digest="", error="", inc=False):
        with self.lock:
            old = self.conn.execute("SELECT attempts FROM progress WHERE sense_id=?", (sid,)).fetchone()
            attempts = (old[0] if old else 0) + (1 if inc else 0)
            self.conn.execute(
                """INSERT INTO progress(sense_id,phase,status,raw_path,final_path,sha256,attempts,error,updated_at)
                   VALUES(?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(sense_id) DO UPDATE SET
                     phase=excluded.phase,status=excluded.status,raw_path=excluded.raw_path,
                     final_path=excluded.final_path,sha256=excluded.sha256,
                     attempts=excluded.attempts,error=excluded.error,updated_at=excluded.updated_at""",
                (sid, phase, status, raw_path, final_path, digest, attempts, error, utcnow()),
            )
            self.conn.commit()

    def close(self):
        with self.lock:
            self.conn.close()


def find_output(raw_dir: Path, stdout: str, started: float) -> Path:
    try:
        value = json.loads(stdout.strip())
        paths = value.get("media_paths") if isinstance(value, dict) else None
        if isinstance(paths, list) and paths:
            p = Path(str(paths[0])).expanduser()
            if p.exists():
                return p
    except Exception:
        pass
    files = [p for p in raw_dir.glob("*.webp") if p.stat().st_mtime >= started - 2]
    if not files:
        files = list(raw_dir.glob("*.webp"))
    if not files:
        raise RuntimeError("CLI produced no .webp")
    return max(files, key=lambda p: p.stat().st_mtime)


def run_one(item: dict, ordinal: int, args, store: Store, summary: dict):
    sid = str(item["sense_id"])
    phase = item.get("phase") or args.phase
    row = store.get(sid)
    raw_dir = args.workdir / "raw" / sid
    final_path = args.workdir / "512" / f"{sid}.webp"
    raw_dir.mkdir(parents=True, exist_ok=True)
    final_path.parent.mkdir(parents=True, exist_ok=True)

    if row and row[0] == "compressed" and row[2] and Path(row[2]).exists():
        summary["skipped"] += 1
        return {"sense_id": sid, "status": "skipped"}

    last_error = ""
    for attempt in range(1, args.retries + 1):
        try:
            raw_path = None
            if row and row[1] and Path(row[1]).exists():
                raw_path = Path(row[1])
            if raw_path is None:
                prompt, style = prompt_for(item, ordinal)
                started = time.time()
                cmd = [
                    args.cli,
                    "--media-subagent-output-type", "image",
                    "--conversation-json", json.dumps([{"text": prompt}], ensure_ascii=False),
                    "--output-dir", str(raw_dir),
                    "--image-output-format", "webp",
                    "--orientation", "square",
                    "--timeout-secs", str(args.timeout),
                ]
                proc = subprocess.run(
                    cmd, capture_output=True, text=True, timeout=args.timeout + 60
                )
                if proc.returncode != 0:
                    raise RuntimeError(f"CLI exit {proc.returncode}: {(proc.stderr or proc.stdout)[-500:]}")
                raw_path = find_output(raw_dir, proc.stdout, started)
                store.update(sid, phase, "generated", raw_path=str(raw_path), inc=True)
                summary["generated"] += 1
            if not raw_path.exists():
                raise RuntimeError(f"raw missing: {raw_path}")
            cmd = [
                args.ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                "-i", str(raw_path),
                "-vf", "scale=512:512:force_original_aspect_ratio=increase,crop=512:512",
                "-c:v", "libwebp", "-quality", "75", "-compression_level", "6",
                str(final_path),
            ]
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
            if proc.returncode != 0 or not final_path.exists():
                raise RuntimeError(f"ffmpeg exit {proc.returncode}: {(proc.stderr or '')[-500:]}")
            digest = sha256(final_path)
            store.update(sid, phase, "compressed", raw_path=str(raw_path), final_path=str(final_path), digest=digest)
            summary["compressed"] += 1
            return {"sense_id": sid, "status": "compressed", "file": str(final_path), "sha256": digest}
        except Exception as exc:  # noqa: BLE001
            last_error = f"{type(exc).__name__}: {exc}"
            if attempt < args.retries:
                time.sleep(min(30, 2 ** attempt))
    store.update(sid, phase, "failed", error=last_error[:1000])
    summary["failed"] += 1
    return {"sense_id": sid, "status": "failed", "error": last_error}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--items", required=True)
    parser.add_argument("--phase", default="all", choices=["all", "smoke", "main"])
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--workdir", default=str(Path.home() / "workspace" / "langoo-pilot"))
    parser.add_argument("--cli", default="/opt/hatch/bin/media-generation")
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument("--retries", type=int, default=2)
    args = parser.parse_args()
    args.workdir = Path(args.workdir).expanduser()
    items = json.loads(Path(args.items).read_text(encoding="utf-8"))
    if args.phase != "all":
        items = [x for x in items if (x.get("phase") or args.phase) == args.phase]
    items.sort(key=lambda x: int(x.get("run_order") or 0))
    store = Store(args.workdir / "progress.sqlite3")
    summary = {"selected": len(items), "generated": 0, "compressed": 0, "skipped": 0, "failed": 0}
    print(f"START phase={args.phase} selected={len(items)} workers={args.workers} workdir={args.workdir}", flush=True)
    try:
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = {
                pool.submit(run_one, item, index + 1, args, store, summary): item
                for index, item in enumerate(items)
            }
            for future in as_completed(futures):
                item = futures[future]
                try:
                    result = future.result()
                    print("DONE", result.get("sense_id"), result.get("status"), result.get("file", ""), flush=True)
                except Exception as exc:  # noqa: BLE001
                    summary["failed"] += 1
                    print("FATAL", item.get("sense_id"), type(exc).__name__, str(exc)[:500], flush=True)
                    traceback.print_exc()
    finally:
        store.close()
    summary["finished_at"] = utcnow()
    print("SUMMARY", json.dumps(summary, ensure_ascii=False), flush=True)
    return 0 if summary["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
