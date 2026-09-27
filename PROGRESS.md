# PROGRESS — Langoo Backend

> Cập nhật lần cuối: 2026-09-27 (M3 — hoàn thành, chờ review)
> Quy trình: **kế hoạch → chờ duyệt → code → báo cáo → chờ review** (PROMPT-BACKEND.md §1).

## Checklist milestone

| # | Milestone | Trạng thái |
|---|-----------|-----------|
| M0 | Bootstrap & DB ops | ✅ hoàn thành (chờ review) |
| M1 | Data layer (Prisma schema `app` + repository `core`/`serve`) | ✅ hoàn thành (chờ review) |
| M2 | Auth (register/login/refresh/logout/me) | ✅ hoàn thành (chờ review) |
| M3 | Profile & settings | ✅ hoàn thành (chờ review) |
| M4 | Dictionary (đọc) | ⬜ chờ |
| M5 | Collections | ⬜ chờ |
| M6 | SRS | ⬜ chờ |
| M7 | Review modes & sessions | ⬜ chờ |
| M8 | Gamification | ⬜ chờ |
| M9 | Reminders | ⬜ chờ |
| M10 | AI Chatbot | ⬜ chờ |
| M11 | AI Quiz | ⬜ chờ |
| M12 | Hardening | ⬜ chờ |

## Quyết định đã chốt

| Ngày | Quyết định | Lý do |
|------|-----------|-------|
| 2026-09-26 | Package manager: **npm** | Tiêu chí nghiệm thu ghi `npm run ...`; máy đã có npm 11.11.0 |
| 2026-09-26 | `DATABASE_URL`/`DIRECT_URL` trỏ **cloud Prisma Postgres** ngay | Chủ dự án chọn; local chỉ dùng cho test |
| 2026-09-26 | Test DB local qua `TEST_DATABASE_URL`/`TEST_DIRECT_URL`; fallback `DATABASE_URL`/`DIRECT_URL` khi tên DB kết thúc `_test` | E2E bắt buộc chạy DB local `langoo_test`; tách hẳn khỏi cloud để an toàn |
| 2026-09-26 | Tên package `langoo-backend`; **không** Docker compose | Máy đã có PostgreSQL 17 service (cổng 5432) |
| 2026-09-26 | Prisma dùng **connector mặc định**, chưa dùng `@prisma/adapter-pg` (chốt chính thức ở M1) | Đơn giản, Prisma hỗ trợ Prisma Postgres sẵn |
| 2026-09-26 | CI GitHub Actions, Node 22; `engines >=22 <25`; `.nvmrc` = 22 | Máy dev Node 24 chạy được; CI bám đúng prompt |
| 2026-09-26 | Health check M0 dùng `pg` Pool trực tiếp (chưa Prisma) | Prisma thuộc M1; M0 chỉ cần kiểm tra kết nối |
| 2026-09-26 | `db:test:reset` chỉ chạy với DB tên kết thúc `_test`, từ chối `NODE_ENV=production` | Bất biến #12: không bao giờ reset dữ liệu cloud |
| 2026-09-26 | Cloud Prisma Postgres đã có sẵn đủ schema 001–025 + dữ liệu demo; `db:migrate` no-op (kiểm chứng bằng truy vấn chỉ-đọc `schema_migration`) | Chủ dự án xác nhận; không cần provision cloud ở M0 |
| 2026-09-26 | Tạo role local `langoo` (LOGIN + CREATEDB, mật khẩu ngẫu nhiên chỉ lưu trong `.env`) cho DB test | Không đổi mật khẩu `postgres`; dump không có `OWNER TO`/`GRANT` nên restore bằng role thường OK |
| 2026-09-26 | `pg_hba.conf` tạm chuyển `trust` cho 2 dòng localhost ~5 giây để tạo role, sau đó khôi phục nguyên trạng | Chủ dự án đồng ý; có backup + reload, không restart |
| 2026-09-26 | `DATABASE_URL` = `DIRECT_URL` (cùng 1 chuỗi pooled Prisma cấp) | Prisma console chỉ cấp 1 URL; đủ dùng cho M0. Khi cần DDL nặng (M1+) sẽ xem lại direct URL riêng nếu có |
| 2026-09-26 | Health check cloud đo được `db_latency_ms` ~464ms (pooled, châu Á → Prisma vùng mặc định) | Ghi nhận; theo dõi khi tối ưu tầng đọc |
| 2026-09-26 | Dùng **Prisma 7.10.0** (pin `^7.10.0`, không dùng `8.0.0-rc` đang là tag `latest`) + **`@prisma/adapter-pg`** — thay đổi so với chốt M0 (thời Prisma 6) | Prisma 7 bắt buộc driver adapter (bỏ Rust engine); dự án giữ CJS nhờ `moduleFormat = "cjs"` |
| 2026-09-26 | Generated client ở `src/generated/prisma` — gitignore + ignore ESLint/Prettier; sinh qua `postinstall` và `npm run prisma:generate` | Prisma 7 bắt buộc `output`; `npm ci` tự sinh client, CI có bước generate tường minh |
| 2026-09-26 | Schema Prisma chỉ map 32 bảng `app`; uuid **không** khai default (buộc service sinh uuid v7); CHECK constraint/partial index ghi chú, không map | Bất biến #3/#10; Prisma không được dùng để sinh DDL |
| 2026-09-26 | Repository mẫu `SenseCardRepository` đọc `serve.sense_card` bằng `$queryRaw`; e2e chỉ đọc trên `langoo_test` | Tiêu chí M1; M1 chưa có endpoint nên e2e không đi qua HTTP |
| 2026-09-26 | `@nestjs/jwt` dùng **v11.0.2** (không dùng v12 như kế hoạch) và `uuid` dùng **v11.1.1** (không dùng v14) | v12/v14 là ESM-only, không hợp dự án CJS + Jest; v11 vẫn đủ API cần (jwt sign/verify, uuid v7) |
| 2026-09-26 | `JWT_ACCESS_SECRET` bắt buộc ≥32 ký tự; tôi sinh ngẫu nhiên 96 hex vào `.env` (không commit), CI dùng secret riêng | Chủ dự án đồng ý; secret cũ 11 ký tự không đủ an toàn |
| 2026-09-26 | Access token 15 phút **không tra DB mỗi request**; logout thu hồi session → refresh token chết ngay, access token cũ hết hạn tự nhiên | Chủ dự án chốt; đổi sang "tra session mỗi request" nếu cần thu hồi tức thì |
| 2026-09-26 | Register chỉ tạo `users` + `user_identity` (+ `device` nếu client gửi) + session | `user_settings`/`study_profile` thuộc M3 (đúng phạm vi milestone) |
| 2026-09-26 | Quy ước commit (§1.4 PROMPT-BACKEND.md): 1 commit = 1 đơn vị logic hoàn chỉnh (code + test + docs của cùng một việc), mỗi milestone ~2–4 commit — không tách lẻ từng file, không dồn cả milestone | Chủ dự án yêu cầu cân bằng (M0–M2 commit hơi lẻ) |
| 2026-09-27 | Register tạo kèm `user_settings` mặc định (sửa nhỏ M2); user cũ thiếu row: `GET` trả mặc định, `PATCH` upsert | Mọi user mới luôn có settings — M6 (timezone) không phải fallback khắp nơi |
| 2026-09-27 | Quy tắc xoá profile: không xoá default khi còn hồ sơ khác (409), không xoá hồ sơ duy nhất (409) | Tránh xoá cascade mất collection/SRS do nhầm |
| 2026-09-27 | Validate id ngôn ngữ bằng đọc `public.language` qua `$queryRaw` (không hardcode, không map Prisma public) | Đúng bất biến: Prisma chỉ map `app`; ngôn ngữ thêm mới không cần sửa code |
| 2026-09-27 | `GET /v1/profiles` không phân trang | Mỗi user có vài hồ sơ cố định; pagination chỉ đặt ở tài nguyên lớn (M5+) |
| 2026-09-27 | `JwtModule` đặt `global: true` trong AuthModule | Module khác (users, srs…) chỉ cần import AuthModule để dùng `JwtAuthGuard` |

## Backlog

- Cân nhắc ghi rõ `sslmode=verify-full` (hoặc `uselibpqcompat=true`) cho URL cloud để hết cảnh báo của `pg` 8.16+ — hiện `sslmode=require` đang được xử lý như `verify-full` (an toàn, chỉ ồn log).
- CI GitHub Actions đã cấu hình nhưng **chưa chạy** (repo chưa push) — kiểm chứng ở lần push tới.
- `npm audit`: 4 lỗ `high` nằm trong `mysql2@3.15.3` + `deepmerge-ts` — dependency **của Prisma CLI (dev)**, không thuộc runtime API; theo dõi khi Prisma phát hành bản vá (KHÔNG chạy `npm audit fix --force` vì sẽ kéo về Prisma 6).
- Prisma 7 dùng connection pool của `pg` (không còn pool mặc định của Prisma) — cấu hình `max`/`connectionTimeoutMillis` cho `PrismaPg` khi vào giai đoạn tải thật (M12 hardening).
- Rate limit cho `/auth/login` + `/auth/register` (chống brute force) — theo kế hoạch M12, chưa làm ở M2.
- `user_settings.notify` (jsonb) chưa chốt cấu trúc khoá — chốt cùng M9 (reminders).

## Kế tiếp dự kiến

- **M4 — Dictionary (đọc):** search (`serve.dictionary_search`), sense detail (`serve.sense_card` + ví dụ/phát âm/forms), kanji detail (`serve.kanji_card`), sense→cặp song ngữ (`serve.sense_pair`), `search_history`, `gloss_report`.
