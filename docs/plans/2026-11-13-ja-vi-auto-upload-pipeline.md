# JA/VI image pipeline — VM → R2 → VPS DB (auto)

Status: **live** since 2026-11-13 (chunk 03 onward). Replaces the local PC bridge.

## Goal

Every generated JA sense image must reach R2 and `core.sense_media` without a human or a
local PC in the loop, while keeping production DB credentials off the Muse VM.

## Flow

```text
Muse VM (driver.py, 16 workers)
  → 512/<sense_id>.webp
  → vm_upload_worker.py (4 workers)
       • upload image to R2  illustrations/vocab-square-512-webp75-muse-pilot-2026-11-12/<sha256>.webp
       • verify public URL (200, image/webp, exact sha256/bytes)
       • write pilot-manifests/<sense_id>.json
  → VPS langoo-manifest-watcher.service (node, 60s loop)
       • list pilot-manifests/ incrementally, full sweep every 30 min
       • skip unknown sense ids, bind idempotently
       • insert core.media_asset + core.sense_media (source vocab-muse-pilot-2026-11-12)
```

No DB credential on the VM. No R2 credential on the VPS watcher from the app path
(reuses `/run/langoo-m142/r2.env`, the existing bucket-scoped token).

## Components

| Component | Location |
| --- | --- |
| VM uploader | `~/workspace/langoo-pilot/vm_upload_worker.py` (source: `muse-native/r2-upload-bundle/vm_upload_worker.py`) |
| VM credentials | `~/.config/langoo-upload/env` (chmod 600), venv `~/.venv-upload` |
| VM queue | `~/workspace/langoo-pilot/queue_ja_vi.sh` (Muse task `langoo-ja-vi-queue`, every 10 min) |
| VPS watcher | `/opt/langoo/bin/manifest_watcher.mjs` |
| VPS service | `/etc/systemd/system/langoo-manifest-watcher.service` (log `/var/log/langoo-manifest-watcher.log`) |
| VPS state | `/opt/langoo/state/manifest-watcher.json` (`last_key`, `swept_at`, `sweep.cursor`) |
| VPS one-off binder | `/opt/langoo/bin/bind_jsonl.mjs` (`MANIFEST=... SOURCE=...`) |

## Invariants

- `progress.status` is owned by `driver.py`. The uploader **never** changes it; upload state
  lives in extra columns (`r2_key`, `url`, `uploaded_at`, `upload_error`, `upload_attempts`).
  Changing `status` would make the driver skip/regenerate wrongly.
- Binding is idempotent: `media_asset.object_key` unique, `sense_media(sense_id, asset_id)` unique.
- Object keys are content-addressed (`sha256`), so re-uploads are no-ops.
- If a manifest already exists for a sense, the uploader reuses it instead of re-uploading.

## Ops

```bash
# VPS watcher
systemctl status langoo-manifest-watcher
tail -f /var/log/langoo-manifest-watcher.log
node /opt/langoo/bin/manifest_watcher.mjs --once        # manual drain

# VM upload state
python vm_upload_worker.py --counts
python vm_upload_worker.py --once --limit 100 --workers 4
python vm_upload_worker.py --prune                      # delete 512/ + raw/ for uploaded rows only
```

## Known limits

- Manifest keys are sense ids, so upload order is not monotonic. Incremental listing misses
  lower ids until the 30-minute full sweep; expect up to ~2h DB lag at 300k+ manifests.
- A manifest written but not yet bound is retried forever (cheap: one DB lookup per page).
- VM replacements kill the uploader; `queue_ja_vi.sh` restarts it on the next 10-minute tick.
  `~/.venv-upload`, `~/.config` and `~/workspace` persist across replacements.

## Current numbers (2026-11-13 ~11:40 +07)

- `core.sense_media`: 68,819 (source `vocab-muse-pilot-2026-11-12`: 59,680)
- Chunk 01: 29,846 uploaded + bound, local copies deleted
- Chunk 02: done on VM (940 new, 28,903 skipped, 157 failed)
- Chunk 03: generating
- Remaining JA/VI plan: 11 chunks × 30k (chunk 11 = 28,498)
