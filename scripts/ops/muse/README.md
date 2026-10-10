# M10.4 — Muse browser bridge pilot

Upstream pinned to `6c00e8cf1bf2fb6718740e0c20d3578fb4c47286`:
<https://github.com/duclm1x1/Muse-Chat-MCP> (MIT).
This directory contains Langoo deployment files and a patch, not account data.

## Layout on langoo-vps

- `/opt/langoo/services/muse-bridge/upstream`: pinned upstream + patch.
- `/opt/langoo/services/muse-bridge`: host, access guard, tests, smoke fixture.
- `/opt/langoo/storage/muse/profile`: dedicated Chrome profile, mode 0700.
- `/opt/langoo/storage/muse/api.key`: internal bearer credential, mode 0600.
- `/opt/langoo/storage/muse/login`: temporary VNC credentials, mode 0700.
- `/opt/langoo/storage/muse/*.json`: synthetic smoke artifacts only.

Run all services as `langoo`. Google Chrome, Xvfb, x11vnc, noVNC and websockify
are installed on the VPS. Use Chrome sandbox defaults; do not use `--no-sandbox`.
Install the `.service` files under `/etc/systemd/system`, then daemon-reload.
Run dependency installation in upstream with `npm ci --ignore-scripts --no-audit
--no-fund` after copying `upstream-package-lock.json` as `package-lock.json`.
Apply `upstream-context.patch` only to the pinned checkout; first run
`git apply --check`. Do not restore files from other Langoo worktrees.

## API contract for the pilot

- Loopback only: `http://127.0.0.1:8787/v1`.
- Exact bearer key required for `/health`, `/v1/models`, `/v1/chat/completions`.
- Alias `muse-browser`: actual upstream model is whatever the Muse UI uses;
  the alias does not select or certify Muse Spark 1.3.
- One completion at a time; parallel generation gets 429 + Retry-After: 3.
- Each request starts an empty side chat. `/thread/new` is a draft; UUID appears
  after the first send. Main chat/populated draft is rejected before sending.
- Caller text history is supplied as reference context in the fresh thread.
- Latest user images only, PNG/JPEG/WebP data URIs, max 3 × 2 MiB decoded.
  Local paths, remote URLs, top-level files and file content parts are rejected.
  Langoo M10.3 additionally validates image signatures/canonical base64.
- Body max 9 MiB. Browser default completion timeout is 240 seconds; the live
  smoke explicitly uses 60 seconds. Browser UI can add navigation/upload delay.
- No native usage is returned; callers must mark local estimates as estimated.
  `max_tokens`/`temperature` are not enforced by the browser. Do not claim API
  parity, token caps, precise quota accounting or load capacity from this pilot.
- Incomplete/error/approval replies fail; failed streams abort transport.
- Account-history/media endpoints are denied. Browser-origin calls are denied.
- Images are forwarded using buffers; no input image file is written by this
  code path. Muse/browser retention is outside this guarantee.

## Tests and live smoke

```sh
MUSE_UPSTREAM_DIR=/path/to/patched/upstream node --test \
  scripts/ops/muse/muse-access.test.mjs scripts/ops/muse/muse-shim.test.mjs
```

On the VPS, change cwd to `/opt/langoo/services/muse-bridge` before running as
`langoo` (do not inherit root's inaccessible cwd). `muse-smoke.mjs --allow-live`
requires `MUSE_API_KEY_FILE` and `MUSE_SMOKE_OUTPUT`. It checks login first, then
uses eight synthetic fixture calls: text, JA→VI, bank sense JSON, caller history,
normal/streaming OCR, two fresh-thread isolation requests. It writes no secrets.
Do not count HTTP role-only SSE chunks as the first content delta.

## Login and rollback

Start `muse-browser`, `muse-bridge`; temporary login additionally needs
`muse-login-web` (requires VNC + display). Forward local 6087 to VPS loopback 6087
over SSH; open `/vnc.html`, supply the temporary VNC password privately and log
in directly in Chrome. Never copy Meta credentials/cookies into repo/chat.
After login stop `muse-login-web` and `muse-login-vnc`; Chrome keeps its own profile.
Do not enable temporary login services at boot.

Stop `muse-bridge`, `muse-browser`, `muse-display` to stop this pilot. Provider env
in `/opt/langoo/app/.env` is unchanged by the sidecar deployment. Production
switch needs separate authenticated Langoo smoke and session/latency gates.
