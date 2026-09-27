# Langoo — Backend

Repo backend của **Langoo** (NestJS + PostgreSQL) — API cho ứng dụng học ngoại ngữ Anh–Nhật
dành cho người Việt, lấy từ điển đa ngữ làm lõi.

## Bắt đầu đọc ở đâu

| File | Nội dung |
|------|----------|
| [`CONTEXT-DU-AN.md`](CONTEXT-DU-AN.md) | **Đọc đầu tiên** — ngữ cảnh toàn dự án: sản phẩm, kiến trúc, CSDL theo tầng, quy ước, luồng nghiệp vụ, lộ trình |
| [`PROMPT-BACKEND.md`](PROMPT-BACKEND.md) | Quy trình làm việc + prompt để dán vào agent (làm từng milestone, dừng chờ review) |
| [`CSDL-THAM-CHIEU.md`](CSDL-THAM-CHIEU.md) | Tham chiếu CSDL đầy đủ (bảng/cột/FK/index) — sinh tự động |
| `db/migrations/` | Nguồn sự thật schema, hiện 001–025; migration mới bắt đầu từ **026** |
| `db/exports/langoo-min-full-inserts.sql` | Dump DB mẫu (~15 MB khi restore) để dựng `langoo_test` chạy e2e |
| `.env.example` | Mẫu biến môi trường (copy thành `.env`, **không commit**) |

## Trạng thái

- ✅ CSDL đã xong: 92 bảng + 4 view (schema `public/staging/core/app/serve`), có dữ liệu mẫu (local + cloud Prisma Postgres).
- ✅ **M0 — Bootstrap & DB ops** đã xong (chờ review): NestJS 11 strict, health check có kiểm tra DB, format lỗi `{code,message,details?}`, logging pino, công cụ DB bằng Node (`db:migrate`, `db:test:reset`, `db:push`), CI GitHub Actions. Xem [`PROGRESS.md`](PROGRESS.md).
- ✅ **M1 — Data layer** đã xong (chờ review): `prisma/schema.prisma` map 32 bảng schema `app` (Prisma 7 + adapter-pg), `PrismaService`, repository mẫu `serve.sense_card` + unit/e2e test. Xem [`PROGRESS.md`](PROGRESS.md).
- ✅ **M2 — Auth** đã xong (chờ review): register / login / refresh (xoay vòng token) / logout / me; argon2id; refresh token chỉ lưu SHA-256; ví dụ curl tại [`docs/api/auth.md`](docs/api/auth.md).
- ✅ **M3 — Profile & settings** đã xong (chờ review): CRUD hồ sơ học (default tự động, chống xoá nhầm), cài đặt timezone/daily_goal/notify; ví dụ curl tại [`docs/api/profiles-settings.md`](docs/api/profiles-settings.md).
- ✅ **M4 — Dictionary (đọc)** đã hoàn tất cả phần chính và hardening M4.1: nối lexeme→senses, loại links trùng, chặn input biên, cursor search và romaji — xem nhật ký trong [`PROGRESS.md`](PROGRESS.md). Ví dụ curl: [`docs/api/dictionary.md`](docs/api/dictionary.md).
- ✅ **M5 — Collections** đã xong (chờ review): CRUD bộ sưu tập (archive mềm), thêm từ 1–2 face sinh 2 `srs_state`/face trong transaction, tag, lọc theo ngôn ngữ, clone deck hệ thống; ví dụ curl tại [`docs/api/collections.md`](docs/api/collections.md).
- ⬜ Backend đang chờ duyệt **M6 — SRS**.
- 🗺️ Lộ trình mở rộng: **M13 — Admin & Curation** (trọng tâm thống kê vận hành + duyệt nội dung) đã được thêm vào kế hoạch sau M12 — xem [`PROGRESS.md`](PROGRESS.md).

## Quy tắc vàng

1. Ghi dữ liệu chỉ vào schema `app`; `core` / `serve` / `staging` / `public` là **read-only** với API.
2. Thay đổi schema = file migration mới (026+); không sửa file migration đã chạy.
3. Không commit `.env`, token, connection string.
4. DB ops (migrate / reset test / push) chạy bằng script Node của repo — không phụ thuộc psql/Python.
