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

- ✅ CSDL đã xong: 92 bảng + 4 view (schema `public/staging/core/app/serve`), có dữ liệu mẫu.
- ⬜ Backend: chưa bắt đầu — milestone đầu tiên là **M0 (bootstrap + DB ops)** theo `PROMPT-BACKEND.md`.

## Quy tắc vàng

1. Ghi dữ liệu chỉ vào schema `app`; `core` / `serve` / `staging` / `public` là **read-only** với API.
2. Thay đổi schema = file migration mới (026+); không sửa file migration đã chạy.
3. Không commit `.env`, token, connection string.
4. DB ops (migrate / reset test / push) chạy bằng script Node của repo — không phụ thuộc psql/Python.
