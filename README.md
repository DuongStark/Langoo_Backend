# Langoo — Backend

Repo backend của **Langoo** (NestJS + PostgreSQL) — API cho ứng dụng học ngoại ngữ Anh–Nhật
dành cho người Việt, lấy từ điển đa ngữ làm lõi.

## Bắt đầu đọc ở đâu

| File                                       | Nội dung                                                                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| [`CONTEXT-DU-AN.md`](CONTEXT-DU-AN.md)     | **Đọc đầu tiên** — ngữ cảnh toàn dự án: sản phẩm, kiến trúc, CSDL theo tầng, quy ước, luồng nghiệp vụ, lộ trình |
| [`PROMPT-BACKEND.md`](PROMPT-BACKEND.md)   | Quy trình làm việc + prompt để dán vào agent (làm từng milestone, dừng chờ review)                              |
| [`CSDL-THAM-CHIEU.md`](CSDL-THAM-CHIEU.md) | Tham chiếu CSDL đầy đủ (bảng/cột/FK/index) — sinh tự động                                                       |
| `db/migrations/`                           | Nguồn sự thật schema, hiện 001–027; migration mới tiếp tục từ **028**                                           |
| `db/exports/langoo-min-full-inserts.sql`   | Dump DB mẫu (~15 MB khi restore) để dựng `langoo_test` chạy e2e                                                 |
| `.env.example`                             | Mẫu biến môi trường (copy thành `.env`, **không commit**)                                                       |

## Trạng thái

- ✅ CSDL đã xong: 92 bảng + 4 view (schema `public/staging/core/app/serve`), có dữ liệu mẫu (local + cloud Prisma Postgres).
- ✅ **M0 — Bootstrap & DB ops** đã xong (chờ review): NestJS 11 strict, health check có kiểm tra DB, format lỗi `{code,message,details?}`, logging pino, công cụ DB bằng Node (`db:migrate`, `db:test:reset`, `db:push`), CI GitHub Actions. Xem [`PROGRESS.md`](PROGRESS.md).
- ✅ **M1 — Data layer** đã xong (chờ review): `prisma/schema.prisma` map 32 bảng schema `app` (Prisma 7 + adapter-pg), `PrismaService`, repository mẫu `serve.sense_card` + unit/e2e test. Xem [`PROGRESS.md`](PROGRESS.md).
- ✅ **M2 — Auth** đã xong (chờ review); **M2.1** đã vá các lỗi sau review: refresh rotation chống race, validate TTL/device và settings mặc định; ví dụ curl tại [`docs/api/auth.md`](docs/api/auth.md).
- ✅ **M3 — Profile & settings** đã xong (chờ review); **M3.1** đã vá race default/active profile, profile đầu tiên, DTO biên và timezone; ví dụ curl tại [`docs/api/profiles-settings.md`](docs/api/profiles-settings.md).
- ✅ **M4 — Dictionary (đọc)** đã hoàn tất cả phần chính và hardening M4.1: nối lexeme→senses, loại links trùng, chặn input biên, cursor search và romaji — xem nhật ký trong [`PROGRESS.md`](PROGRESS.md). Ví dụ curl: [`docs/api/dictionary.md`](docs/api/dictionary.md).
- ✅ **M5 — Collections** đã xong (chờ review); **M5.1** đã vá theo review (cổng curated, validation biên, phân trang, chống race) — xem nhật ký trong [`PROGRESS.md`](PROGRESS.md). Ví dụ curl tại [`docs/api/collections.md`](docs/api/collections.md).
- ✅ **M6.1 — SRS fixes** đã triển khai theo [kế hoạch 14 phát hiện + ENV-01](docs/plans/m6.1-srs-fixes.md): migration `027`, queue/cursor/cap/learn-ahead, transaction lock + receipt idempotency, scheduler/DST và metadata nguồn nghĩa. Local đã nghiệm thu build/lint/unit/e2e; **migration 026/027 đã apply cloud (2026-09-27)**.
- ✅ **M7 — Review modes & sessions** dùng chung `ReviewEngine`; review session kiểm tra lại eligibility/quota lúc trả lời, practice chỉ miễn due/cap.
- ✅ **M8 — Gamification** đã xong: XP theo `xp_rule` + daily cap, streak/level/thành tích trong cùng transaction; `GET /me/stats`, `GET /me/achievements`, `POST /me/achievements/seen` — ví dụ curl tại [`docs/api/gamification.md`](docs/api/gamification.md).
- 🗺️ Lộ trình mở rộng: **M13 — Admin, Curation & Feedback** (thống kê vận hành + duyệt nội dung + hộp thư feedback text/ảnh) đã được thêm vào kế hoạch sau M12 — xem [`PROGRESS.md`](PROGRESS.md).

## Deploy lên Render

Repo có sẵn [`render.yaml`](render.yaml) (Blueprint):

1. Render Dashboard → **New → Blueprint** → chọn repo này (branch `main`).
2. Điền biến bí mật khi Render hỏi (hoặc sửa sau trong **Environment**):
   - `DATABASE_URL` — pooled (runtime) · `DIRECT_URL` — direct (migration/DDL)
   - `JWT_ACCESS_SECRET` — ≥32 ký tự ngẫu nhiên (xem `.env.example`)
   - `CORS_ORIGINS` — tuỳ chọn: origin FE cách nhau dấu phẩy (bỏ trống = tắt CORS)
3. Sau deploy: kiểm tra `GET https://<service>.onrender.com/v1/health` và Swagger `/docs`.

Ghi chú:

- Build `npm ci --include=dev && npm run build` (build cần devDependencies như `@nestjs/cli`, `prisma`); start `npm run start:prod`; Render tự cấp `PORT` (app đọc từ env); health check `/v1/health`.
- **Migration không tự chạy trên Render**: mỗi khi có migration mới, chạy `npm run db:migrate` từ máy local (dùng `DIRECT_URL` cloud) trước khi deploy — 026/027 đã apply ngày 2026-09-27. Nếu gói Render hỗ trợ `preDeployCommand`, có thể bật dòng gợi ý trong `render.yaml`.
- Free tier "ngủ" sau ~15 phút không traffic → request đầu tiên chậm (cold start); nâng plan nếu cần luôn thức.

## Quy tắc vàng

1. Ghi dữ liệu chỉ vào schema `app`; `core` / `serve` / `staging` / `public` là **read-only** với API.
2. Thay đổi schema = file migration mới (026+); không sửa file migration đã chạy.
3. Không commit `.env`, token, connection string.
4. DB ops (migrate / reset test / push) chạy bằng script Node của repo — không phụ thuộc psql/Python.
