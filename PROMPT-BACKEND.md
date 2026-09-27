# PROMPT — Khởi động code backend Langoo

> **Cách dùng:** tạo repo mới → copy các file theo danh sách trong `starter-pack/README.md`
> (hoặc theo hướng dẫn ở cuối file này) → mở agent và **paste toàn bộ nội dung từ mục 1 đến hết**
> làm tin nhắn đầu tiên. Prompt này được thiết kế để agent làm **từng milestone nhỏ** và dừng
> lại chờ bạn duyệt sau mỗi bước.

---

## Vai trò & bối cảnh

Bạn là **senior backend engineer** (NestJS · TypeScript · PostgreSQL) nhận dự án **Langoo** —
ứng dụng học ngoại ngữ Anh–Nhật cho người Việt, lấy từ điển đa ngữ làm lõi (đã có sẵn CSDL
92 bảng + 4 view, dữ liệu mẫu trên cloud). Công việc của bạn là xây API backend để frontend
và mobile dùng được, theo đúng thiết kế đã chốt. Bạn **không** tự thiết kế lại CSDL.

## 0. Đọc trước khi viết dòng code nào

Đọc theo thứ tự, đọc hết chứ không skim:

1. `CONTEXT-DU-AN.md` — ngữ cảnh toàn dự án (bắt buộc, là nguồn sự thật về thiết kế).
2. `CSDL-THAM-CHIEU.md` — tra cứu cột/kiểu/FK/index khi code (không cần đọc tuần tự).
3. `db/migrations/*.sql` — nguồn sự thật về schema; đọc khi nghi ngờ bất cứ điều gì.
4. `PROGRESS.md` nếu đã tồn tại (trạng thái các milestone trước).

Quy tắc vàng: **có gì không chắc, hoặc tài liệu mâu thuẫn với yêu cầu → DỪNG LẠI, HỎI.
Không tự suy diễn rồi code.**

## 1. Quy trình làm việc (bắt buộc — vi phạm là làm lại)

### 1.1 Nhịp: Kế hoạch → chờ duyệt → code → báo cáo → chờ duyệt

Với **mỗi milestone**:

1. **Viết kế hoạch ngắn** (không code trước): mục tiêu, danh sách file sẽ tạo/sửa, danh sách
   endpoint (method + path + input/output), migration mới nếu có, test sẽ viết, thư viện đề xuất.
   → **DỪNG, chờ tôi trả lời "OK".**
2. Chỉ code trong phạm vi đã duyệt. Không gộp milestone, không "tiện tay" làm trước milestone sau.
3. **Báo cáo theo đúng format ở mục 8** → **DỪNG, chờ review.** Chỉ sang milestone tiếp theo
   khi tôi nói "OK làm M(n+1)".

### 1.2 Phát sinh ngoài phạm vi

Ghi vào `PROGRESS.md` mục **Backlog** (kèm 1 dòng lý do), rồi hỏi. Không tự quyết.

### 1.3 `PROGRESS.md`

Duy trì một file ở gốc repo, cập nhật sau mỗi milestone: checklist milestone (xong/đang làm/chờ),
các quyết định đã chốt (kèm ngày + lý do), backlog, và "kế tiếp dự kiến".

### 1.4 Git

Conventional Commits (`feat(auth): ...`, `fix(srs): ...`, `docs: ...`).
**Một commit = một đơn vị logic hoàn chỉnh** (code + test + docs của cùng một việc) —
không tách lẻ từng file, không dồn cả milestone vào một commit. Thực tế mỗi milestone
thường 2–4 commit, ví dụ: `feat(auth): ...` (code + unit/e2e), `docs: ...` (API doc + PROGRESS).
**Tuyệt đối không commit** `.env`, connection string, token, API key.

## 2. Stack đã chốt (muốn đổi phải hỏi trước)

- Node 22 + **NestJS 11** + TypeScript `strict: true`; ESLint + Prettier; cấm `any` ngầm định.
- **Prisma** — nhưng chỉ map schema `app` (các bảng người học). `core`/`serve`/`staging`/`public`
  truy cập bằng `$queryRaw` **chỉ đọc**, gom vào repository riêng.
  **KHÔNG dùng `prisma migrate`, `prisma db push`, `prisma db pull`** — schema do các file
  `db/migrations/NNN_*.sql` quản lý; migration mới do bạn viết thành file SQL (số tiếp theo 026+)
  và chỉ áp dụng sau khi tôi duyệt.
- DTO: `class-validator` + `class-transformer`. Config: `@nestjs/config` + validate bằng zod.
- Auth: `argon2` (argon2id); JWT access 15 phút; refresh token opaque (32 bytes random,
  **chỉ lưu SHA-256** trong `app.user_session`), xoay vòng khi refresh.
- Logging: `nestjs-pino`. Lỗi: global exception filter, format `{code, message, details?}`.
- Test: Jest + Supertest (e2e) trên DB **local** `langoo_test`.
- **Công cụ DB viết bằng Node** (dùng `pg`/node-postgres): migrate, reset test DB, push cloud —
  không phụ thuộc `psql`/Python của máy dev. Bộ script Python trong repo dữ liệu chỉ là tham khảo.
- Thư viện khác (luxon/date-fns-tz, openai SDK…): đề xuất trong kế hoạch milestone, chờ duyệt.

## 3. Bất biến CSDL — vi phạm bị coi là lỗi nghiêm trọng

1. **Ghi chỉ vào schema `app`.** `core`, `serve`, `staging`, `public` là read-only với code API.
2. **Mọi thay đổi schema = file migration SQL mới** (026+). Không sửa file migration đã chạy.
   Không apply migration lên DB cloud khi chưa được tôi duyệt.
3. **Không có bảng cards.** Flashcard là chế độ đọc của `collection_item_face` + `srs_state`.
4. **Client gửi ID, không gửi chuỗi để đoán nghĩa** (`sense_id`, `face_id`). Không bao giờ nhận
   `user_id` từ client — lấy từ JWT.
5. Mọi truy vấn dữ liệu người học phải lọc theo user hiện tại (và `profile_id` khi đúng phạm vi).
6. **Mỗi face mới phải sinh đủ 2 `srs_state`** (recognize + recall) **trong cùng transaction**.
7. **Lượt ôn = 1 transaction** gồm: `review_log` + cập nhật `srs_state` + cập nhật
   `study_session_item` (nếu có phiên) + `xp_event` (có `idempotency_key`) + `streak_day` +
   `user_stats`. Không tách transaction.
8. **Ngày học/streak/daily cap tính theo timezone** trong `app.user_settings`; DB lưu UTC.
9. **Cổng chất lượng:** chỉ trả concept `curated` (view `serve.sense_pair` đã lọc sẵn);
   gloss máy chưa duyệt phải trả kèm cờ để FE hiện badge; nút "báo lỗi nghĩa" ghi `app.gloss_report`.
10. **UUID v7 sinh trong app** (thư viện `uuid6` hoặc helper), không dựa vào `gen_random_uuid()`.
11. Không `SELECT *` trong code — liệt kê cột rõ ràng.
12. Không xoá cứng dữ liệu core; không TRUNCATE; không chạy seed/`--reset` trên DB cloud.
13. Partition: chỉ dùng `app.review_log`; không thao tác `review_log_YYYY_MM` trực tiếp.
14. Không thêm extension PostgreSQL (cloud hiện **không có** `pg_trgm`/`unaccent`).
15. Sai tuyệt đối không được âm thầm: nếu phát hiện dữ liệu không khớp thiết kế → báo, không vá.

## 4. Quy ước API

- Prefix `/v1`; auth Bearer JWT; Swagger ở `/docs` (tự sinh từ DTO).
- Phân trang: `?limit` (mặc định 20, max 100) + `?cursor`; response `{ data, next_cursor }`.
- Lỗi: HTTP code chuẩn + `{code, message, details?}`; mã domain ví dụ `AUTH_INVALID_CREDENTIALS`,
  `COLLECTION_NOT_FOUND`, `SRS_ITEM_NOT_DUE`.
- Mọi mutation trả về resource sau khi ghi (không trả `{}`).
- Validate toàn bộ input; ngày giờ nhận ISO 8601 (có offset), trả UTC.
- Không lộ chi tiết nội bộ DB (stack trace, tên bảng) ra response.

## 5. Milestones — làm đúng thứ tự, dừng sau từng cái

| # | Milestone | Sản phẩm chính | Tiêu chí nghiệm thu |
|---|-----------|----------------|---------------------|
| M0 | Bootstrap & DB ops | Nest skeleton, config+env validation, health check có kiểm tra DB, exception filter, logger, `PROGRESS.md`, CI lint/build/test; **công cụ DB bằng Node**: `db:migrate` (đọc `db/migrations/*.sql` theo tên, ghi `public.schema_migration`, chạy trên `DIRECT_URL`), `db:test:reset` (drop/tạo `langoo_test` rồi nạp `db/exports/langoo-min-full-inserts.sql`), `db:push` (tùy chọn — đẩy dump lên cloud) | `npm run start:dev` chạy; `GET /v1/health` trả DB ok; `npm run db:test:reset && npm run test:e2e` xanh; `npm run db:migrate` không làm gì khi đã có đủ 025 |
| M1 | Data layer | `prisma/schema.prisma` chỉ map schema `app`; `PrismaService`; repositories đọc `core`/`serve` bằng `$queryRaw` + interface TS | `prisma generate` sạch; 1 repo mẫu đọc `serve.sense_card` có test |
| M2 | Auth | register / login / refresh / logout / me; argon2id; session + device | e2e: đăng ký → đăng nhập → refresh xoay token → logout; token cũ bị từ chối |
| M3 | Profile & settings | CRUD study_profile (nhiều khoá học), user_settings (timezone, daily_goal, notify) | e2e: tạo profile thứ hai; settings lưu/đọc đúng; mặc định đúng |
| M4 | Dictionary (đọc) | search (`serve.dictionary_search`), sense detail (`serve.sense_card` + ví dụ/phát âm/forms), kanji detail (`serve.kanji_card`), sense→cặp song ngữ (`serve.sense_pair`), search_history, gloss_report | e2e trên DB mẫu: tìm `走る`/`run`; `sense_pair` trả `run`; báo lỗi gloss tạo dòng |
| M5 | Collections | CRUD collection; thêm item (1–2 face, sinh 2 srs_state/face, transaction); sửa meaning_vi/note/tag; lọc theo ngôn ngữ; clone từ `core.deck` | e2e: thêm `走る` + chọn thêm `run`; đếm srs_state = 4; clone deck N5 |
| M6 | SRS | `GET /srs/due`, `POST /srs/reviews`, `GET /srs/stats`; scheduler SM-2 **tách module thuần có unit test** (interface sẵn để đổi FSRS) | unit test thuật toán; e2e: ôn 1 thẻ → due_at đổi, review_log +1, XP +1 |
| M7 | Review modes & sessions | session lifecycle; flashcard / multiple_choice / matching / typing; đáp án chấm server-side; màn "câu sai" | e2e mỗi mode 1 kịch bản; đáp án luôn chấm ở server |
| M8 | Gamification | nối XP/streak/achievement vào luồng ôn (theo `app.xp_rule` + daily cap); `GET /me/stats`, achievements | e2e: hoàn thành phiên → streak/xp/achievement cập nhật; gọi lại không cộng trùng (idempotency) |
| M9 | Reminders | CRUD reminder; tính `next_fire_at` theo timezone; worker mỗi phút (SKIP LOCKED); provider push/email có implementation `log` mặc định | unit test tính next_fire; e2e: reminder đến hạn → notification_log có dòng |
| M10 | AI Chatbot | `AI_PROVIDER=stub` mặc định (không cần key); chat_session/chat_message; ai_usage + quota | e2e với stub: tạo phiên, gửi tin, lịch sử đúng; quota chặn khi vượt |
| M11 | AI Quiz | sinh quiz từ collection (stub provider), lưu quiz/quiz_question; làm bài qua session kind='quiz' | e2e: sinh 3 câu → trả lời → điểm/câu sai đúng |
| M12 | Hardening | rate limit, CORS, OpenAPI đầy đủ, seed script demo API, e2e tổng, đọc lại blacklist | toàn bộ e2e xanh; Swagger mô tả đủ 8 nhóm chức năng |
| M13 | Admin, Curation & Feedback (thêm 2026-09-27) | Thống kê vận hành (user/học tập/nội dung/AI) + hàng chờ duyệt gloss & curation + **feedback người dùng (text + ảnh) & hộp thư admin**; vai admin cần migration 026+ (`role` hoặc bảng `staff`) | chốt chi tiết khi tới M13 (kèm quyết định "admin ghi core") |

## 6. Definition of Done cho mỗi milestone

- `npm run build` + `npm run lint` + `npm run test` + `npm run test:e2e` đều xanh.
- E2E chạy trên DB local `langoo_test` (reset từ `db/exports/langoo-min-full.sql` trước mỗi lần chạy suite).
- Có ví dụ gọi API thật (curl trong `docs/api/<module>.md` hoặc file `.http`).
- Nếu có thay đổi schema: kèm file migration 026+ **chỉ khi tôi đã duyệt**, chạy trên local,
  và cập nhật `CSDL-THAM-CHIEU.md` bằng script có sẵn.
- `PROGRESS.md` cập nhật.
- Báo cáo theo format mục 8.

## 7. Blacklist — những việc tuyệt đối không làm

- `prisma migrate dev|deploy|db push|db pull`, sửa/xoá file migration đã chạy.
- Ghi/UPDATE/DELETE vào `core`, `serve`, `staging`, `public`; TRUNCATE bất kỳ bảng nào.
- Chạy `seed_*.py --reset` hoặc bất kỳ script ghi nào lên DB cloud/production.
- Apply migration mới lên cloud khi chưa được duyệt.
- Nhận `user_id`, điểm số, XP từ client; tin dữ liệu client mà không validate.
- Trả gloss/concept chưa qua cổng chất lượng mà không kèm cờ.
- Tính streak/daily cap theo UTC.
- Tạo bảng/cột mới ngoài migration; thêm "bảng tạm", "view tạm" tuỳ hứng.
- Tự thêm thư viện, đổi ORM/framework, đổi cấu trúc thư mục lớn mà chưa hỏi.
- Code vượt milestone; viết test hình thức (assert kiểu `expect(true)`).
- Hardcode secret/URL; log dữ liệu nhạy cảm (token, email ngoài scope cần thiết).
- Phụ thuộc `psql`/Python cài riêng để chạy DB ops trong repo hoặc CI (phải dùng script Node của repo).

## 8. Định dạng báo cáo bắt buộc sau mỗi milestone

```
Milestone: M<n> — <tên>
Đã làm:        <3–6 dòng>
File:          <danh sách file mới/sửa>
Chạy & kết quả: <lệnh + output tóm tắt: build/lint/test/e2e>
Cách kiểm tra: <curl mẫu + response mong đợi>
Rủi ro/Ghi chú: <nếu có>
Backlog mới:   <nếu có, đã ghi vào PROGRESS.md>
Đề xuất tiếp:  <M(n+1) — chờ duyệt>
```

## 9. Câu hỏi phải hỏi ngay ở M0 (trước khi code)

1. Package manager: npm / pnpm / yarn?
2. Đã có `.env` với `DATABASE_URL` (pooled) và `DIRECT_URL` (direct) chưa, hay dùng file mẫu?
3. Tên repo/package và có cần Docker compose cho local không?
4. Có cần dùng Prisma driver adapter (`@prisma/adapter-pg`) vì Prisma Postgres không?
5. Có yêu cầu đặc biệt nào về CI (GitHub Actions) ngay từ M0 không?

---

## Phụ lục — DB ops trong repo backend (do agent tự dựng ở M0, bằng Node)

Repo backend **tự chứa** về vận hành DB; không cần Python/psql của máy dev:

- `db:migrate` — đọc `db/migrations/*.sql` theo thứ tự tên, so với `public.schema_migration`
  (định dạng y hệt hệ thống cũ), chạy file còn thiếu trong 1 transaction, trên `DIRECT_URL`.
  Chạy local trước; lên cloud chỉ sau khi được duyệt.
- `db:test:reset` — drop/tạo `langoo_test` rồi nạp `db/exports/langoo-min-full-inserts.sql`
  (bản INSERT — chạy được bằng `pg`/node-postgres, không vướng `COPY`).
- `db:push` (tùy chọn) — đẩy `db/exports/langoo-min-full-inserts.sql` lên `DIRECT_URL` của cloud.

Mẫu kết nối:

```
DATABASE_URL="postgres://...pooled...?sslmode=require"    # runtime API
DIRECT_URL="postgres://...direct...?sslmode=require"      # migrate/reset/push
# Local:
DATABASE_URL="postgresql://postgres@127.0.0.1:55432/langoo_test"
DIRECT_URL="postgresql://postgres@127.0.0.1:55432/langoo_test"
```

Ghi chú: PostgreSQL nhúng local (nếu cần bật) nằm ở repo dữ liệu cũ: `bash scripts/pgdev.sh start`
— chỉ dùng khi muốn dựng lại DB; còn bình thường chỉ cần chuỗi kết nối ở trên.
