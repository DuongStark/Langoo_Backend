# Vận hành VPS — Langoo API + PostgreSQL

> M12 ngày13/11/2026: code `4df8655` đã deploy; proxy Cloudflare client IP và
> HSTS86400 đã áp, validate/reload/live smoke PASS. Xem [runbook và rollback M12](m12-feedback-sync-2026-11-13/README.md)
> trước khi thay proxy; giữ cấu hình riêng của các host study.


> Tài liệu cho **mọi phiên LLM/dev tiếp nhận dự án**. Cập nhật: 2026-10-27 (M12 — domain `api.langoo.org`, CORS allowlist).
> IP VPS: **163.223.210.135** · Domain API: **https://api.langoo.org** (domain cũ `langoo-api.pixpress.art` đã bỏ DNS)
> ⚠️ Bí mật (mật khẩu DB, key, `.env`) **KHÔNG** nằm trong repo — xem mục 8.

## 1. Tổng quan

- VPS **Ubuntu 22.04.1 LTS** — 1 vCPU, 2GB RAM (+ swap 2GB `/swapfile`), đĩa 30GB (đo 06/10: dùng ~19GB, còn ~9,6GB).
- Thành phần & phiên bản: **PostgreSQL 16.15** (PGDG) · **Node.js v22.23.3** · **PM2 7.0.4** · **Caddy 2.11.4** (binary tĩnh) · **ufw**.
- Sơ đồ luồng:

```
Internet
  └─ Cloudflare DNS: api.langoo.org (bản ghi A, mây CAM – proxied)
       └─ Caddy :80/:443 (Let's Encrypt qua HTTP-01, tự gia hạn)
            └─ Node/PM2 "langoo-api" — 127.0.0.1:3000 (ufw chặn từ ngoài)
                 └─ PostgreSQL 16 — 127.0.0.1:5432
```

- **Xác minh 06/10:** API đang dùng **DB thật `127.0.0.1:5432/langoo` trên VPS**, thay trạng thái cloud demo ghi trước đây. `.env` được đọc có hai DB URL local, PM2 không có override URL; health/search/senses đã đối chiếu runtime và DB.
- **Live check 26/10/2026:** SSH alias `langoo-vps` từ máy này truy cập được. App HEAD `7efeacd` khớp `origin/main`; PM2 online; API/DB health OK, timezone UTC, DB latency 32 ms. DB size 4.721 MB. Counts: 1.052.582 lexeme / 1.480.432 sense / 120.875 concept / 625.124 mappings / 1.046.182 serve pairs. Xem [DOCS1 live status](../reviews/docs1-project-status-2026-10-26.md) để có breakdown, data source và gate.
- Backup gần nhất 25/10 09:30; có 5 bản. Disk 75% (còn 7,1 GB), RAM khả dụng 837 MiB. PM2 restart counter 188, unstable restarts 0; cần rà nguyên nhân.
- VPS checkout có 36 file `.bak-*` untracked và entry symlink `node_modules` bị xóa; không có modified tracked source. Giữ nguyên, chưa dọn.
- Migration ledger thiếu `043_vi_suggest_index.sql`, dù function `public.f_unaccent(text)`, index `translation_assertion_vi_prefix` và extension `unaccent` tồn tại. Reconcile qua migration runner rồi kiểm tra ledger/index; không chạy SQL ad hoc.
- **Dictionary runtime có sửa chưa commit:** HEAD checkout `7b13b90`; khảo sát 12:15 UTC có 3 file dictionary modified và dist chứa cùng logic. Preflight 13:10 UTC ghi nhận **5 file modified**, thêm controller/kanji repository cho stroke SVG ngoài scope DB4-D0. HEAD không đủ mô tả code đang chạy; xem [khảo sát DB4-D0](../reviews/db4-d0-vps-duplicates-2026-10-06.md) và [patch mới cả dictionary](../reviews/db4-d0-vps-dictionary-runtime-2026-10-06.patch). Deploy reset có thể mất các sửa trực tiếp; review/reconcile patch mới trước lần deploy tiếp theo. Lượt DB4-D0 không sửa runtime.
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
- Kích thước DB đo 06/10: **6.653.303.831 bytes** (~6,65GB thập phân). Staging `wikt_entry`/`wn_synset`/`jmdict_entry` vẫn rỗng theo COUNT; full ranked gloss còn trong core.
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

- **M10.1 cập nhật 27/10:** Space Bunny trả 502 trước stream; theo lựa chọn chủ dự án, chat tạm dùng Groq model `qwen/qwen3.8-27b`. Quiz dùng cấu hình provider riêng không đổi. Backup cấu hình trước chuyển ở `/opt/langoo/storage/ops/m10.1-provider-before-groq-20261027-*.env` (private, chứa secret); không commit. Adapter Groq đã thử stream chữ/ảnh giả lập thành công, người dùng xác nhận chat chữ trong app. [Report sự cố](../reviews/m10.1-chat-provider-fallback-2026-10-27.md).
- Code: `/opt/langoo/app` (clone từ GitHub; mỗi deploy `git fetch` + `git reset --hard origin/main`). Sau deploy phải xác minh HEAD/source/dist và working tree; **06/10 dictionary có sửa trực tiếp chưa commit**, không coi runtime luôn bằng `origin/main`.
- User chạy: `langoo`; PM2 app `langoo-api` (chế độ fork, `--max-memory-restart 600M`); auto-start sau reboot qua systemd **`pm2-langoo.service`** (enabled).
- `.env`: `/opt/langoo/app/.env` (owner `langoo`; quyền đo ngày 27/10 là `664`, cần rà để siết về `600`):
  - **Hiện trỏ DB thật VPS** (`DATABASE_URL`/`DIRECT_URL`: `127.0.0.1:5432/langoo`), xác minh 06/10. Không xuất URL chứa mật khẩu trong report.
  - `/opt/langoo/app/.env.localdb.bak` là bản cấu hình DB thật lưu trước đó; không cần chuyển env để đọc DB thật trong trạng thái hiện tại. Kiểm lại target trước thao tác ops.
  - Các nhóm biến: `NODE_ENV=production`, `LOG_LEVEL=info`, `JWT_ACCESS_SECRET` (mới sinh), `GOOGLE_OAUTH_CLIENT_IDS`, `CORS_ORIGINS`, `RATE_LIMIT_ENABLED=true`, `SCHEDULER_ENABLED=true`, `STORAGE_PROVIDER=local`, `STORAGE_DIR=/opt/langoo/storage`, `AI_*`… **M12 (27/10):** `.env` VPS đã đổi `CORS_ORIGINS=http://localhost:*,https://langoo.org,https://www.langoo.org` (bản trước `*` lưu private tại `/opt/langoo/storage/ops/m12-cors-before-20261027.env`) và `pm2 restart`; log khởi động ghi `CORS: cho phép http://localhost:[^/]+, https://langoo.org, https://www.langoo.org`.
  - **AI production (05/10)**: `AI_PROVIDER=openai`, `AI_BASE_URL=https://api.groq.com/openai/v1`, `AI_CHAT_MODEL=openai/gpt-oss-120b`, key Groq (free tier: 30 RPM / 1.000 req/ngày / 8K TPM). Đo thực tế: **~0,6–2,2s/câu** (nhanh hơn hẳn Zen free), streaming hoạt động.
  - Phương án dự phòng đã thử:
    - **Zen** (`https://opencode.ai/zen/v1`, model `space-bunny-free`): model suy luận, chậm 6–22s, có lúc trả rỗng; các model free khác bị **403** ("free tier chỉ dùng trong OpenCode"), model trả phí **402** (hết balance). ⚠️ Không dùng `/zen/go/v1` (cần header `x-opencode-session` → 400/503).
    - **Gemini** (`https://generativelanguage.googleapis.com/v1beta/openai/`): OpenAI-compatible, có free tier — chưa dùng.
  - Sửa `.env` xong phải `sudo -u langoo -H pm2 restart langoo-api` (dotenv đọc lúc khởi động).
  - **M10.1 (05/10)**: thêm `AI_CHAT_TIMEOUT_MS=60000` (thay hardcode 30s — hết 503 khi model chậm vừa phải) và `AI_CHAT_REASONING_EFFORT=low` (model suy luận trả lời nhanh hơn); endpoint streaming `POST /v1/chat/sessions/:id/messages/stream` (SSE: `start`/`delta`/`done`/`error`) — chi tiết [`docs/api/chat.md`](../api/chat.md).
- Logs: `sudo -u langoo -H pm2 logs langoo-api` hoặc `/opt/langoo/.pm2/logs/langoo-api-{out,error}.log`.
- Ảnh feedback lưu tại `/opt/langoo/storage` (không nằm trong repo).

## 6. Caddy & HTTPS

- Binary `/usr/local/bin/caddy` + systemd `caddy.service` (không dùng repo apt — key Cloudsmith lỗi GPG).
- `/etc/caddy/Caddyfile` (cập nhật 27/10 — có cả domain mới):
  ```
  langoo-api.pixpress.art {
      encode gzip
      reverse_proxy 127.0.0.1:3000
  }

  api.langoo.org {
      encode gzip
      reverse_proxy 127.0.0.1:3000
  }
  ```
- Let's Encrypt tự xin/gia hạn. `api.langoo.org` đang **proxy qua Cloudflare** nên ACME dùng HTTP-01 (Cloudflare chuyển tiếp `/.well-known/acme-challenge`); **TLS-ALPN không dùng được** khi đang proxied. Chứng chỉ đầu tiên đã lấy 27/10 10:10 UTC.
- Reload sau khi sửa: `systemctl reload caddy`. Thêm domain mới **phải** thêm site block: thiếu block thì Caddy không có cert cho SNI đó và Cloudflare trả **525 (SSL handshake failed)** dù origin vẫn khoẻ.
- **ufw đang bật** (từ 05/10): chỉ mở `22/tcp`, `80/tcp`, `443/tcp`; port 3000 đã bị chặn từ ngoài. Thêm port mới phải `ufw allow`.
- Bản sửa M12 ngày 05/10 cấu hình Express `trust proxy=loopback` qua `configureHttpProxy()` để rate limit dùng IP client do Caddy chuyển tiếp. Peer ngoài loopback không được tin header `X-Forwarded-For`. Phù hợp upstream `127.0.0.1:3000`. ⚠️ **Từ 27/10 domain API đi qua Cloudflare proxy**: peer của Caddy là IP Cloudflare nên app thấy IP Cloudflare, rate limit sẽ gộp theo edge Cloudflare thay vì từng người dùng. Muốn đúng IP người dùng phải đọc `CF-Connecting-IP` (chỉ tin khi request đến từ dải IP Cloudflare) — chưa làm, ghi thành gate.
- Bản sửa này đã kiểm chứng local, **chưa deploy VPS** trong phiên sửa M12. Không thêm migration/env mới; sau khi deploy cần build/restart API theo quy trình mục 7 và kiểm tra `/v1/health` trả `db_timezone=UTC`. Xem [recheck M12](../reviews/m12-recheck-2026-10-05.md).

## 7. Auto-deploy & migration

### M4.2 / DB4-D0.2 — release 06/10

Migration038 đã áp VPS; commits04112dc/d861390 đã CI deploy. Phiên DeepSeek
sau đó deploy subsense lên code chưa commit trên VPS. User cho tạm dừng tích hợp,
sau khi có handoff46ec612 thì triển khai M4.3.

### M4.3 — Nhóm nghĩa Wiktextract và bảo toàn sense

- Migration039 append gloss_en_is_hierarchy vào view; chạy trước publish main.
- Backup runtime DeepSeek + patch + schema/count snapshot tại
  `/opt/langoo/storage/db4/releases/m43-20261006` (private, ngoài working tree).
  Backup DB đầy đủ M4.2 vẫn ở sibling `m42-20261006`; M4.3 chỉ đổi view.
- Có `view=flat` cho FE cũ; grouped cần group_heading + render sub_senses.
- Không áp lại wordfreq. DB3-W1 khóa rollback thiếu journal per-row.
- Rollback code runtime trước từ archive; giữ cột039 (tương thích038), build/reload
  một phiên. Không rollback DB dump hoặc git clean toàn working tree.
- Kết quả CI/deploy/smoke và commit cuối ghi tại
  [report M4.3](../reviews/m4-3-subsense-integration-2026-10-06.md).

## 8. Bí mật & các DB liên quan

| Nơi | Chứa gì | Ghi chú |
| --- | --- | --- |
| `~/.langoo-vps.env` (máy chủ dự án) | `VPS_DB_URL=postgresql://langoo:<pass>@163.223.210.135:5432/langoo`, host/user | Không commit |
| `/opt/langoo/app/.env` (VPS) | URL DB đang dùng, JWT secret, Google IDs, CORS, AI… | chmod 600, user `langoo` |
| `/opt/langoo/app/.env.localdb.bak` | Bản cấu hình **DB thật VPS** lưu trước đó | chmod 600; `.env` hiện cũng đọc DB thật |
| **Prisma cloud (demo)** | DB demo, không phải target API VPS tại lần kiểm 06/10 | Không kiểm lại cloud trong audit này; lịch sử migration 05/10 ở PROGRESS |
| **PG nhúng local** (máy chủ dự án) | `127.0.0.1:55432`, DB `langoo` (full data) + `langoo_test` | Bật bằng `data-Langoo/scripts/pgdev.sh start`; `.env` repo trỏ `langoo_test` — muốn thao tác DB full phải override `DATABASE_URL/DIRECT_URL`. ⚠️ Phiên khác có thể chạy PG tạm chiếm port 55432 (vd `/tmp/langoo-m11-pg`): kiểm tra `ps aux \| grep postgres`, nếu vậy start PG thật ở port khác `pg_ctl -D ~/.local/share/langoo/pgdata -o '-p 55433' start` |

- `psql` trên máy chủ dự án thiếu SSL nên **không nối được Prisma cloud**; dùng `psql` trên VPS để thao tác cloud (VPS nối cloud tốt).

## 9. Runbook nhanh

```bash
# Health
curl -s https://api.langoo.org/v1/health

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
| 27/10 | `https://api.langoo.org` trả **525** dù API/DB khoẻ | Domain mới đi qua Cloudflare proxy nhưng `/etc/caddy/Caddyfile` chỉ có block cũ → Caddy không có cert cho SNI mới, handshake fail. Thêm block `api.langoo.org` + `caddy validate` + `systemctl reload caddy`; cert HTTP-01 lấy 10:10 UTC. Bài học: đổi domain phải thêm site block ở Caddy **trước khi** bật proxy; TLS-ALPN không dùng được khi proxied |
| — | PG nhúng local tự tắt sau reboot máy | `bash data-Langoo/scripts/pgdev.sh start` trước khi làm việc |

## 11. Việc nên làm tiếp (bảo mật / vận hành)

- CORS: **đã áp 27/10** — `.env` VPS `CORS_ORIGINS=http://localhost:*,https://langoo.org,https://www.langoo.org`, PM2 restart, đo header thật qua `api.langoo.org` (3 origin trên được phản chiếu, origin lạ không có `Access-Control-Allow-Origin`). Nếu web chuyển sang domain khác phải thêm vào allowlist.
- Cloudflare: kiểm SSL/TLS mode đang **Full (strict)** để không hạ bảo mật; nếu cần chặn truy cập trực tiếp IP origin thì thêm rule/firewall cho 443.
- Rate limit/M12 sau khi qua Cloudflare: app thấy IP Cloudflare (xem mục 6) — cần đọc `CF-Connecting-IP` có kiểm tra dải IP Cloudflare nếu muốn giới hạn theo người dùng.
- Cân nhắc `PermitRootLogin prohibit-password` (hiện tại chỉ dùng key nhưng chưa rà `sshd_config`).
- Theo dõi dung lượng: dump giữ 5 bản (~3GB) + ảnh feedback trong `/opt/langoo/storage`.
- Khi **go-live DB thật** (DB5): đổi 2 dòng `.env` + `pm2 restart`, bootstrap admin riêng cho DB thật, cân nhắc thêm `pg_hba`/SSL nếu mở DB ra ngoài (hiện không cần).
- Search còn điểm yếu đã biết: pattern **1 ký tự** vẫn quét bảng (~7s) — xử lý ở tầng service/UI sau nếu cần.

## 12. Liên kết

- Kế hoạch & kết quả: [`docs/plans/db1-schema-cleanup.md`](../plans/db1-schema-cleanup.md), [`docs/plans/db2-search-infra.md`](../plans/db2-search-infra.md).
- Tổng quan dự án: [`PROGRESS.md`](../../PROGRESS.md), [`CONTEXT-DU-AN.md`](../../CONTEXT-DU-AN.md), [`CSDL-THAM-CHIEU.md`](../../CSDL-THAM-CHIEU.md).


### M4.3 / DB3-B2.1 — kết quả cuối 06/10

Từng dừng deploy lúc 21:35 để bảo toàn scripts DB3-B đang được sửa trên VPS:
CI 37480050307 canceled, Deploy 37480283546 skipped. Sau khi chủ dự án xác nhận
phiên đó hoàn thành, tích hợp và sửa DB3-B2.1 trong commit `f700658`.

CI 37481567514 / Deploy 37481886745 success. VPS runtime `f700658`, PM2 online,
038/039 đã áp; 46 live checks pass. Runtime tracked code clean, hai file .bak cũ được
 giữ. Backup cuối `runtime-final-code.tgz`/patch gồm cả ba script DB3-B.
[Report](../reviews/m4-3-subsense-integration-2026-10-06.md) ghi số liệu và checks.
FE cần render con hoặc dùng `view=flat`; DB3-W1 rollback thiếu journal vẫn bị khóa.


### 2026-10-20 — M4.2 / M4.3 — Search index và liên kết Anh–Nhật

- VPS release **48b8507**, ghép main local với origin/main4cd6472 để giữ các tính năng mới; CI39357848414 và Deploy39358021757 success, PM2 reload/health200/DBUTC.
- Migration mới **044_dictionary_short_search_indexes.sql** (đổi tên bản042 local vì042 đã thuộc M14), áp transaction với role langoo. Támindexvalid/owner langoo và ANALYZE xong. Không reset data/mapping.043 ownership/journal của phiên khác không đổi.
- Backup runtime/schema/response trước phát hành: `/opt/langoo/storage/db4/releases/m43-links-20261020`. Rollback runtime archive và PM2 reload nếu cần; index bổ sung giữ tương thích code cũ, không restore toàn DB.
- Links0–3 từ khác nhãn, exact/live/curated/VI và cùng query policy search;32 HTTPS smoke pass. 以下 135465 chỉ còn following, agony 261514 còn苦痛/重苦. Không cần deployFE để nhận danh sáchBE mới, nhưng cần invalidatecache/không cộng dồn nhiều sense.
- [Report deploy](../reviews/m4.3-searchable-links-deploy-2026-10-20.md) và artifacts kèm theo ghi latency/gate còn lại. Source/migration hash VPS trùng release; không lấy sốSQL14,825 ms làm latency browser.

### M14.3 — Public media URL (2026-11-01, code local)

`MEDIA_BASE_URL` mặc định `https://media.langoo.org`, HTTPS không credentials/query/fragment.
Dùng để dựng URL response, không phải credential R2 và không upload ảnh trong API request.
Cần migrations 045/046 hiện có trước chạy API ảnh. Không có migration mới trong M14.3.
Hạng mục mới commit local chưa có nghĩa production đã deploy; không sửa ENV private để giả lập release.

### M12.1 — Privacy rollout (03/11/2026)

Đọc [runbook privacy](m12.1-privacy-rollout-2026-11-03.md) trước deploy.
Migration 047 phải có trước runtime mới; không chạy kèm migration 043 đang chờ.
Cờ `PRIVACY_AI_CONSENT_REQUIRED` mặc định false đến khi FE triển khai và QA;
rút consent đã lưu vẫn chặn external AI. Không reset DB khi rollout.
