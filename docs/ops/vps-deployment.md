# Vận hành VPS — Langoo API + PostgreSQL

> Tài liệu cho **mọi phiên LLM/dev tiếp nhận dự án**. Cập nhật: 2026-10-05.
> IP VPS: **163.223.210.135** · Domain API: **https://langoo-api.pixpress.art**
> ⚠️ Bí mật (mật khẩu DB, key, `.env`) **KHÔNG** nằm trong repo — xem mục 8.

## 1. Tổng quan

- VPS **Ubuntu 22.04.1 LTS** — 1 vCPU, 2GB RAM (+ swap 2GB `/swapfile`), đĩa 30GB (đang dùng ~16GB, còn ~13GB).
- Thành phần & phiên bản: **PostgreSQL 16.15** (PGDG) · **Node.js v22.23.3** · **PM2 7.0.4** · **Caddy 2.11.4** (binary tĩnh) · **ufw**.
- Sơ đồ luồng:

```
Internet
  └─ Cloudflare DNS: langoo-api.pixpress.art (bản ghi A, mây XÁM – DNS only)
       └─ Caddy :80/:443 (Let's Encrypt, tự gia hạn)
            └─ Node/PM2 "langoo-api" — 127.0.0.1:3000 (ufw chặn từ ngoài)
                 └─ PostgreSQL 16 — 127.0.0.1:5432
```

- API hiện kết nối **DB Prisma cloud (demo)**; **DB thật** (6,3GB, dữ liệu từ điển đầy đủ) nằm cùng VPS.
- User hệ thống: `root` (sudo), `langoo` (chạy app, sở hữu code + object DB), `postgres` (superuser DB), `caddy`.

## 2. Truy cập SSH

- `ssh root@163.223.210.135` — không cần mật khẩu (key cá nhân chủ dự án đã nạp).
- Alias trên máy chủ dự án: `ssh langoo-vps` (dùng key `~/.ssh/langoo_vps_ed25519`).
- `/root/.ssh/authorized_keys` chứa các khoá: key cá nhân chủ dự án, key phiên làm việc, key deploy.
- User `langoo` có **deploy key GitHub chỉ-đọc** tại `/opt/langoo/.ssh/github` (dùng cho `git fetch` repo `DuongStark/Langoo`).

## 3. PostgreSQL 16 (DB thật)

- Role `langoo`, database `langoo`; **chỉ nghe `127.0.0.1:5432`** — không mở ra internet.
- `timezone = UTC`; tuning tại `/etc/postgresql/16/main/conf.d/zz-langoo.conf`:
  `shared_buffers=512MB`, `max_connections=40`, `effective_cache_size=1200MB`, `work_mem=16MB`, `log_min_duration_statement=1000`…
- **Ownership**: các schema `public/core/app/serve/staging` đều thuộc role `langoo` (staging được chuyển chủ ngày DB1) → **mọi migration phải chạy bằng `langoo`** (đừng tạo object bằng `postgres` rồi migrate bằng `langoo` — sẽ lỗi `must be owner`).
- Dữ liệu: khôi phục từ dump local `public+core+app+serve` (577MB nén); schema `staging` tạo rỗng + data 2 bảng `import_batch` (16 dòng) và `jlpt_entry` (7,9k) để thoả FK `core.* → staging`.
- Kích thước DB sau DB2: **~6,3GB** (core ~6,1GB + index tìm kiếm thêm ~200MB).
- Search (DB2): `pg_trgm` + `unaccent` + 4 GIN trigram (033) và hàm `core.bigrams` + 4 GIN bigram (035). **Repository search dùng `core.bigrams`** — xoá hàm này sẽ làm API search 500.

## 4. Backup & restore

- Script: `/usr/local/bin/langoo-backup.sh` → `pg_dump -Fc langoo` vào `/var/backups/langoo/langoo-<ngày>-<giờ>.dump`, **giữ 5 bản mới nhất**.
- Cron: `/etc/cron.d/langoo-backup` — dòng `30 2 * * * root /usr/local/bin/langoo-backup.sh >> /var/log/langoo-backup.log 2>&1`
  (⚠️ 05/10 đã vá lỗi **thiếu cột `user`** — trước đó cron không chạy; log: `/var/log/langoo-backup.log`).
- Chạy tay: `ssh langoo-vps /usr/local/bin/langoo-backup.sh`
- Restore khi cần (⚠️ phá dữ liệu hiện tại):
  ```bash
  ssh langoo-vps
  sudo -u postgres pg_restore -d langoo --clean --if-exists /var/backups/langoo/<file>.dump
  ```
- Bản dump local trước DB1 vẫn giữ tại `/media/duongstark/Du lieu/langoo-core.dump` (máy chủ dự án).

## 5. Ứng dụng API (Node + PM2)

- Code: `/opt/langoo/app` (clone từ GitHub; mỗi deploy `git fetch` + `git reset --hard origin/main` — **VPS luôn chạy đúng `origin/main`**).
- User chạy: `langoo`; PM2 app `langoo-api` (chế độ fork, `--max-memory-restart 600M`); auto-start sau reboot qua systemd **`pm2-langoo.service`** (enabled).
- `.env`: `/opt/langoo/app/.env` (chmod 600, user `langoo`):
  - Hiện trỏ **Prisma cloud** (`DATABASE_URL`/`DIRECT_URL`) theo file env chủ dự án (02/10).
  - Bản trỏ **DB thật VPS** giữ tại `/opt/langoo/app/.env.localdb.bak` — đổi 2 dòng `DATABASE_URL`/`DIRECT_URL` sang `postgresql://langoo:<pass>@127.0.0.1:5432/langoo` rồi `pm2 restart` là về DB thật.
  - Các nhóm biến: `NODE_ENV=production`, `LOG_LEVEL=info`, `JWT_ACCESS_SECRET` (mới sinh), `GOOGLE_OAUTH_CLIENT_IDS`, `CORS_ORIGINS=*`, `RATE_LIMIT_ENABLED=true`, `SCHEDULER_ENABLED=true`, `STORAGE_PROVIDER=local`, `STORAGE_DIR=/opt/langoo/storage`, `AI_*`…
  - **AI production (05/10)**: `AI_PROVIDER=openai`, `AI_BASE_URL=https://opencode.ai/zen/v1`, `AI_CHAT_MODEL=space-bunny-free`, key OpenCode (Zen/Go dùng chung key).
    ⚠️ **Không dùng `https://opencode.ai/zen/go/v1`**: endpoint Go bắt buộc header `x-opencode-session` (client coding-agent) — app chưa gửi nên nhận 400 `MissingSessionID` → API trả 503. Endpoint Zen (`/zen/v1`) không cần header.
    Sửa `.env` xong phải `sudo -u langoo -H pm2 restart langoo-api` (dotenv đọc lúc khởi động).
- Logs: `sudo -u langoo -H pm2 logs langoo-api` hoặc `/opt/langoo/.pm2/logs/langoo-api-{out,error}.log`.
- Ảnh feedback lưu tại `/opt/langoo/storage` (không nằm trong repo).

## 6. Caddy & HTTPS

- Binary `/usr/local/bin/caddy` + systemd `caddy.service` (không dùng repo apt — key Cloudsmith lỗi GPG).
- `/etc/caddy/Caddyfile`:
  ```
  langoo-api.pixpress.art {
      encode gzip
      reverse_proxy 127.0.0.1:3000
  }
  ```
- Let's Encrypt tự xin/gia hạn (DNS mây xám nên ACME HTTP-01 chạy trực tiếp, không qua Cloudflare).
- Reload sau khi sửa: `systemctl reload caddy`.
- **ufw đang bật** (từ 05/10): chỉ mở `22/tcp`, `80/tcp`, `443/tcp`; port 3000 đã bị chặn từ ngoài. Thêm port mới phải `ufw allow`.

## 7. Auto-deploy & migration

- Workflow `.github/workflows/deploy.yml`: chạy khi **CI xanh trên `main`** (`workflow_run`) → SSH vào VPS → `sudo -u langoo -H /opt/langoo/deploy.sh`.
- `/opt/langoo/deploy.sh`: `git fetch` + `git reset --hard origin/main` → `npm ci --include=dev` → `npm run build` → `pm2 reload langoo-api` → health check `/v1/health` (fail thì job đỏ).
- Secrets GitHub: `VPS_HOST` = IP, `VPS_USER` = `root`, `VPS_SSH_KEY` = key riêng chỉ dùng để deploy.
- **Quy tắc vàng: DB migration chạy THỦ CÔNG TRƯỚC khi push** (bài học sự cố 30/9: code lên trước migration làm API 500).
- Chạy migration trên VPS (mật khẩu ở `~/.langoo-vps.env` máy chủ dự án):
  ```bash
  ssh langoo-vps
  sudo -u langoo -H env \
    DATABASE_URL='postgresql://langoo:<PASS>@127.0.0.1:5432/langoo' \
    DIRECT_URL='postgresql://langoo:<PASS>@127.0.0.1:5432/langoo' \
    bash -c 'cd /opt/langoo/app && npx tsx scripts/db/migrate.ts'
  ```
  - **Không dùng IP công khai** trong URL (PG chỉ nghe localhost → `ECONNREFUSED`).
  - **Không pipe qua `tail`** — pipeline che mất lỗi/exit code (đã từng bỏ sót lỗi `must be owner`).
  - Chờ **deploy xong** mới chạy (deploy đang `npm ci` có thể làm `tsx: not found`).
- Trạng thái migration: file trong `db/migrations/` — **001–037, số 028 để trống** (dành đợt B xác thực email). VPS đã áp tới **035** (031/032 = DB1; 033/035 = DB2); 034/036/037 (M7/M8/M10) đã áp DB test local, **chưa apply cloud/VPS** — áp trước khi deploy code tương ứng.

## 8. Bí mật & các DB liên quan

| Nơi | Chứa gì | Ghi chú |
| --- | --- | --- |
| `~/.langoo-vps.env` (máy chủ dự án) | `VPS_DB_URL=postgresql://langoo:<pass>@163.223.210.135:5432/langoo`, host/user | Không commit |
| `/opt/langoo/app/.env` (VPS) | URL DB đang dùng, JWT secret, Google IDs, CORS, AI… | chmod 600, user `langoo` |
| `/opt/langoo/app/.env.localdb.bak` | Bản trỏ **DB thật VPS** (để quay về) | chmod 600 |
| **Prisma cloud (demo)** | DB mà **API live đang dùng**; migration đã áp: 001–030 + **035** (hàm `core.bigrams` bắt buộc có) | 036/037 chưa áp |
| **PG nhúng local** (máy chủ dự án) | `127.0.0.1:55432`, DB `langoo` (full data) + `langoo_test` | Bật bằng `data-Langoo/scripts/pgdev.sh start`; `.env` repo trỏ `langoo_test` — muốn thao tác DB full phải override `DATABASE_URL/DIRECT_URL`. ⚠️ Phiên khác có thể chạy PG tạm chiếm port 55432 (vd `/tmp/langoo-m11-pg`): kiểm tra `ps aux \| grep postgres`, nếu vậy start PG thật ở port khác `pg_ctl -D ~/.local/share/langoo/pgdata -o '-p 55433' start` |

- `psql` trên máy chủ dự án thiếu SSL nên **không nối được Prisma cloud**; dùng `psql` trên VPS để thao tác cloud (VPS nối cloud tốt).

## 9. Runbook nhanh

```bash
# Health
curl -s https://langoo-api.pixpress.art/v1/health

# Logs API (100 dòng cuối)
ssh langoo-vps 'sudo -u langoo -H pm2 logs langoo-api --lines 100 --nostream'

# Restart API
ssh langoo-vps 'sudo -u langoo -H pm2 restart langoo-api'

# Deploy tay (bỏ qua chờ CI)
ssh langoo-vps 'sudo -u langoo -H /opt/langoo/deploy.sh'

# Backup tay
ssh langoo-vps /usr/local/bin/langoo-backup.sh

# Tài nguyên
ssh langoo-vps 'free -m; df -h /; sudo -u langoo -H pm2 list'

# Cấp quyền admin (trên DB mà API đang dùng)
#   UPDATE app.users SET role='admin' WHERE lower(email)='...';

# Firewall
ssh langoo-vps 'ufw status verbose'
```

## 10. Sự cố đã gặp & bài học

| Ngày | Sự cố | Xử lý / bài học |
| --- | --- | --- |
| 01/10 | `pg_restore` xong nhưng 22 FK `core→staging` không tạo được | Bổ sung schema `staging` + data 2 bảng nhỏ rồi chạy lại FK |
| 01/10 | `VPS_DB_URL` dùng IP công khai → `ECONNREFUSED` | Thao tác trên VPS luôn dùng `127.0.0.1` |
| 01/10 | `must be owner of table wn_example` khi migrate | Chuyển chủ schema `staging` → `langoo` (một role thống nhất) |
| 02/10 | `must be owner of function bigrams` (hàm tạo bằng `postgres` lúc thử nghiệm) | Chuyển chủ function + index → `langoo` rồi migrate lại |
| 02/10 | Deploy chạy song song → `tsx: not found`, benchmark nhiễu | Chờ deploy xong mới chạy thao tác nặng |
| 02/10 | Lỗi migrate bị `tail` che mất | Không pipe `db:migrate` qua `tail` |
| 05/10 | **Cron backup chưa từng chạy** — file cron.d thiếu cột `user` | Đã vá + chạy tay `langoo-2026-10-05-0746.dump` |
| 05/10 | **Port 3000 lộ ra internet** (`HTTP 200` từ ngoài, không qua TLS) | Bật `ufw` chỉ mở 22/80/443; xác minh lại 3000 đã kín |
| — | PG nhúng local tự tắt sau reboot máy | `bash data-Langoo/scripts/pgdev.sh start` trước khi làm việc |

## 11. Việc nên làm tiếp (bảo mật / vận hành)

- Siết `CORS_ORIGINS` về đúng domain FE khi FE ổn định (đang `*`).
- Cân nhắc `PermitRootLogin prohibit-password` (hiện tại chỉ dùng key nhưng chưa rà `sshd_config`).
- Theo dõi dung lượng: dump giữ 5 bản (~3GB) + ảnh feedback trong `/opt/langoo/storage`.
- Khi **go-live DB thật** (DB5): đổi 2 dòng `.env` + `pm2 restart`, bootstrap admin riêng cho DB thật, cân nhắc thêm `pg_hba`/SSL nếu mở DB ra ngoài (hiện không cần).
- Search còn điểm yếu đã biết: pattern **1 ký tự** vẫn quét bảng (~7s) — xử lý ở tầng service/UI sau nếu cần.

## 12. Liên kết

- Kế hoạch & kết quả: [`docs/plans/db1-schema-cleanup.md`](../plans/db1-schema-cleanup.md), [`docs/plans/db2-search-infra.md`](../plans/db2-search-infra.md).
- Tổng quan dự án: [`PROGRESS.md`](../../PROGRESS.md), [`CONTEXT-DU-AN.md`](../../CONTEXT-DU-AN.md), [`CSDL-THAM-CHIEU.md`](../../CSDL-THAM-CHIEU.md).
