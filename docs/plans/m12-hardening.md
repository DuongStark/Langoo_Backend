# Kế hoạch M12 — Hardening

> Trạng thái: **đã triển khai local (chờ review)**. Ngày: 2026-09-30.
> Chốt với chủ dự án: rate limit bằng `@nestjs/throttler`, scheduler tự viết (không dep),
> pool env, health `db_timezone`, regenerate CSDL doc, retention chat 180 ngày.

## 1. Phạm vi

| Nhóm | Nội dung |
| --- | --- |
| A. Rate limit | `@nestjs/throttler` global 120/phút/IP; `login` 10/phút; `register` 5/giờ; `oauth/google*` 10/phút; `refresh` 30/phút. Lỗi map `429 RATE_LIMITED` trong exception filter. `RATE_LIMIT_ENABLED=false` để tắt (e2e tự đặt false) |
| B. Scheduler | Tick mỗi 60s, advisory lock `pg_try_advisory_xact_lock` trong transaction từng job; `SCHEDULER_ENABLED` (off ở NODE_ENV=test). Jobs: **dọn `search_history`** (giữ 50/user, 03:00 UTC), **partition `review_log`** (thứ Hai 04:00 UTC, trước 2 tháng), **retention chat** (180 ngày, 03:30 UTC, `CHAT_RETENTION_DAYS=0` để tắt) |
| C. DB/cloud | Pool `pg` cấu hình được (`DB_POOL_MAX` 10 / `DB_POOL_IDLE_TIMEOUT_MS` 30s / `DB_POOL_CONNECTION_TIMEOUT_MS` 10s) dùng chung PrismaPg + health pool; cảnh báo lúc boot nếu session TimeZone ≠ UTC; `db_timezone` trong `/v1/health`; docs `sslmode=verify-full` |
| D. API/Test | Swagger: `@ApiTooManyRequestsResponse` cho endpoint auth bị giới hạn; `test/journey.e2e-spec.ts` chạy xuyên suốt; audit blacklist (không ghi core/serve/public/staging, không `SELECT *`) |
| E. Docs | Regenerate `CSDL-THAM-CHIEU.md` (apply 026/027/029 vào DB full **local**), PROGRESS/README/.env.example |

## 2. Quyết định đã chốt

- **D1** — `@nestjs/throttler` (storage in-memory; 1 instance Render free; đa instance sẽ chuyển shared store sau).
- **D2** — Scheduler tự viết `setInterval` + advisory lock (không thêm dependency).
- **D3** — Pool mặc định 10 / 30s / 10s, override bằng env.
- **D4** — Health thêm `db_timezone` + boot warn khi lệch UTC (backlog ENV-01).
- **D5** — CSDL doc: apply migration vào DB full local rồi regenerate bằng script data repo (không đụng cloud).
- **D6** — Retention chat 180 ngày, xoá cứng (cascade tin nhắn), tắt được bằng env.

## 3. Ghi chú

- Rate limit in-memory: nhiều instance sẽ nhân quota lên theo số instance — chấp nhận ở giai đoạn 1 instance; khi scale chuyển `ThrottlerStorage` sang Redis/DB.
- Scheduler lưu `lastRun` trong RAM: restart giữa kỳ sẽ chạy lại job ở kỳ kế tiếp (không chạy dồn) — job đều idempotent (DELETE theo điều kiện, ensure partition).
- Job lỗi được bỏ qua tới kỳ kế tiếp (log warn), không retry dồn dập.
- `pg_trgm`/`unaccent` vẫn để backlog (chờ khi lên dữ liệu thật).
