# PROGRESS — Langoo Backend

> Cập nhật lần cuối: 2026-09-27 (đã ghi nhận M2.1–M4.1; M5 hoàn thành, chờ review)
> Quy trình: **kế hoạch → chờ duyệt → code → báo cáo → chờ review** (PROMPT-BACKEND.md §1).

## Checklist milestone

| # | Milestone | Trạng thái |
|---|-----------|-----------|
| M0 | Bootstrap & DB ops | ✅ hoàn thành (chờ review) |
| M1 | Data layer (Prisma schema `app` + repository `core`/`serve`) | ✅ hoàn thành (chờ review) |
| M2 | Auth (register/login/refresh/logout/me) | ✅ hoàn thành (chờ review) |
| M2.1 | Auth fixes sau review | ✅ hoàn thành |
| M3 | Profile & settings | ✅ hoàn thành (chờ review) |
| M3.1 | Profile & settings fixes sau review | ✅ hoàn thành |
| M4 | Dictionary (đọc) | ✅ hoàn tất M4.1: nối lexeme→sense, cursor, romaji và hardening input |
| M5 | Collections | ✅ hoàn thành (chờ review) |
| M6 | SRS | ⬜ chờ |
| M7 | Review modes & sessions | ⬜ chờ |
| M8 | Gamification | ⬜ chờ |
| M9 | Reminders | ⬜ chờ |
| M10 | AI Chatbot | ⬜ chờ |
| M11 | AI Quiz | ⬜ chờ |
| M12 | Hardening | ⬜ chờ |
| M13 | Admin & Curation (thống kê vận hành + duyệt nội dung) | ⬜ chờ (thêm 2026-09-27) |

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
| 2026-09-27 | M2.1: register tạo kèm `user_settings` mặc định; user cũ thiếu row: `GET` trả mặc định, `PATCH` upsert | Mọi user mới luôn có settings — M6 (timezone) không phải fallback khắp nơi |
| 2026-09-27 | Quy tắc xoá profile: không xoá default khi còn hồ sơ khác (409), không xoá hồ sơ duy nhất (409) | Tránh xoá cascade mất collection/SRS do nhầm |
| 2026-09-27 | M3.1: mutation profile/settings khóa dòng `app.users` trong transaction; profile đầu tiên luôn default; settings legacy giữ active profile; DTO chặn null, tên rỗng, UUID sai và timezone numeric offset | Giữ bất biến một default/user và tránh race làm mất active profile hoặc trả lỗi DB 500 |
| 2026-09-27 | Validate id ngôn ngữ bằng đọc `public.language` qua `$queryRaw` (không hardcode, không map Prisma public) | Đúng bất biến: Prisma chỉ map `app`; ngôn ngữ thêm mới không cần sửa code |
| 2026-09-27 | `GET /v1/profiles` không phân trang | Mỗi user có vài hồ sơ cố định; pagination chỉ đặt ở tài nguyên lớn (M5+) |
| 2026-09-27 | `JwtModule` đặt `global: true` trong AuthModule | Module khác (users, srs…) chỉ cần import AuthModule để dùng `JwtAuthGuard` |
| 2026-09-27 | Dictionary **đọc công khai**; `search` dùng `OptionalJwtAuthGuard` — có Bearer hợp lệ thì ghi lịch sử, token bẩn vẫn 401; history/gloss-report yêu cầu Bearer | Chủ dự án chốt; tra từ trước khi đăng nhập vẫn dùng được |
| 2026-09-27 | `LanguageRepository` chuyển từ `src/users` sang `src/db/repositories` + DbModule (global) cung cấp | Dùng chung users/dictionary/settings; đúng bất biến chỉ đọc `public.language` |
| 2026-09-27 | Search dùng `ILIKE` escape wildcard, rank exact → prefix → frequency; chưa có `pg_trgm/unaccent` | PostgreSQL nhúng thiếu extension (CONTEXT §13); production bổ sung index sau |
| 2026-09-27 | `pronunciations`/`forms` trả theo **lexeme** của sense; `examples` đọc `core.example.sense_id` (không dùng `example_sense` vì chưa chạy mapping) | Đúng dữ liệu hiện có; khi chạy `run_mapping.py` có thể mở rộng |
| 2026-09-27 | `search_history` chỉ đọc 50 dòng gần nhất; job dọn định kỳ chưa làm | Để M12 (hardening) — đã ghi backlog |
| 2026-09-27 | M2.1 (chủ dự án thêm, đã review + test 2026-09-27): validate `JWT_ACCESS_TTL` lúc khởi động (fail-fast); xoay refresh token chống race bằng `updateMany` có điều kiện (chỉ 1 request thắng, còn lại 401); `device` phải là object | Tránh double-rotation khi 2 request dùng cùng token; cấu hình sai lộ ngay khi boot |
| 2026-09-27 | `DELETE /collections/:id` = **archive mềm** (`archived_at`), không xoá cứng | Giữ nguyên `srs_state`/`review_log` — tránh mất dữ liệu học do nhầm |
| 2026-09-27 | Item 1–2 face; server tự suy ngôn ngữ từ `core.sense→lexeme`; mặt phụ phải khác ngôn ngữ; `position = max+1`; `item_count` do service giữ trong transaction (DB không có trigger) | Bất biến §5.9 + §1.3 (client không gửi chuỗi/ngôn ngữ để đoán nghĩa) |
| 2026-09-27 | Clone deck dùng `createMany` + uuid v7 sinh trước + transaction timeout 30s; nghĩa từ gloss vi→en→lemma với `meaning_source` `machine` khi gloss máy chưa duyệt | Deck thật có thể vài trăm–nghìn item; tránh timeout 5s mặc định của Prisma |
| 2026-09-27 | Cursor keyset `(position, id)` base64url ở `src/common/pagination/cursor.ts` | Dùng lại cho M6+ (due list, history…), không offset |
| 2026-09-27 | Tag user-scoped `/v1/tags`; `PATCH item.tag_ids` thay thế toàn bộ (gửi `[]` để bỏ hết) | Đơn giản, tránh nhiều endpoint gắn/gỡ lẻ tẻ |
| 2026-09-27 | M2.1: refresh rotation cập nhật nguyên tử có điều kiện; `device` phải là object; `JWT_ACCESS_TTL` dùng parser chung và validate lúc khởi động | Chặn reuse token đồng thời, trả 400 cho input sai kiểu, và tránh ghi DB rồi mới lỗi vì cấu hình TTL |
| 2026-09-27 | M3.1: mutation profile/settings khoá dòng `app.users` (`FOR UPDATE`) trong transaction; hồ sơ đầu tiên luôn default; upsert giữ active profile cho user cũ; DTO chặn null/rỗng/UUID sai/timezone offset | Giữ bất biến 1 default/user và chống race |
| 2026-09-27 | **Rút kinh nghiệm sau review M4**: từ M6 trở đi, trước khi báo cáo milestone phải tự chạy "checklist kiểm biên" (xem Backlog) trên **mọi endpoint mới** | Review độc lập phát hiện 7 lỗi lớp input-biên/thiếu luồng/trùng lặp mà e2e cũ không phủ |
| 2026-09-27 | Bổ sung **M13 — Admin & Curation** vào lộ trình (sau M12), **trọng tâm là thống kê vận hành**; vai admin sẽ cần migration 026+ (`app.users.role` hoặc bảng `app.staff`); nếu cho admin ghi `core` (curate gloss/concept) phải ghi rõ ngoại lệ + audit, quyết định khi làm M13 | Chủ dự án yêu cầu: cần thống kê mới nắm được tình hình; hiện API không có vai admin và curation đang làm bằng script |

## Nhật ký sửa lỗi theo milestone

### M2.1 — Auth fixes sau review

- `JWT_ACCESS_SECRET` phải có tối thiểu 32 ký tự; `JWT_ACCESS_TTL` được parse và kiểm tra ngay lúc khởi động để cấu hình sai fail-fast.
- Refresh token được xoay bằng cập nhật nguyên tử có điều kiện (`updateMany`); khi hai request dùng cùng token đồng thời, chỉ một request thành công, request còn lại nhận `401`.
- DTO `device` chỉ nhận object hợp lệ; đăng ký user mới tạo `user_settings` mặc định, còn user cũ thiếu row được `GET` fallback và `PATCH` upsert.
- Đã kiểm chứng bằng unit/e2e luồng register → login → refresh → logout và các ca input sai. Commit liên quan: `c47ccbf`, `6b7a2d5`, `a0f4ab1`.

### M3.1 — Profile & settings fixes sau review

- Mutation profile/settings khóa dòng `app.users` bằng `FOR UPDATE` trong transaction để không mất default hoặc active profile khi request chạy đồng thời.
- Profile đầu tiên luôn là default dù client gửi `is_default: false`; không cho xóa profile default khi còn profile khác hoặc xóa profile duy nhất.
- Settings legacy vẫn giữ `active_profile_id`; DTO chặn `null`, chuỗi rỗng, UUID sai và timezone dạng numeric offset trước khi chạm DB.
- Đã kiểm chứng tạo nhiều profile, đổi default, xóa profile, đọc/upsert settings và các ca race/input biên. Commit liên quan: `b640e65`, `1f46d71`.

### M4.1 — Dictionary review fixes

- Bổ sung đường nối `search.lexeme_id` → `GET /v1/lexemes/:id/senses` → `sense_id` đúng; loại bỏ links song ngữ trùng.
- Chặn query/target chỉ có khoảng trắng, bigint ID vượt biên và cursor sai; search dùng keyset cursor ổn định, tối đa 100 dòng/trang.
- Bổ sung romaji → kana và tìm `romanization` khi có dữ liệu; cập nhật regression unit/e2e và tài liệu API.
- Đã kiểm chứng build, lint, 112 unit test và 62 e2e test. Commit: `411e65f`.

## Backlog

- Cân nhắc ghi rõ `sslmode=verify-full` (hoặc `uselibpqcompat=true`) cho URL cloud để hết cảnh báo của `pg` 8.16+ — hiện `sslmode=require` đang được xử lý như `verify-full` (an toàn, chỉ ồn log).
- CI GitHub Actions đã cấu hình nhưng **chưa chạy** (repo chưa push) — kiểm chứng ở lần push tới.
- `npm audit`: 4 lỗ `high` nằm trong `mysql2@3.15.3` + `deepmerge-ts` — dependency **của Prisma CLI (dev)**, không thuộc runtime API; theo dõi khi Prisma phát hành bản vá (KHÔNG chạy `npm audit fix --force` vì sẽ kéo về Prisma 6).
- Prisma 7 dùng connection pool của `pg` (không còn pool mặc định của Prisma) — cấu hình `max`/`connectionTimeoutMillis` cho `PrismaPg` khi vào giai đoạn tải thật (M12 hardening).
- Rate limit cho `/auth/login` + `/auth/register` (chống brute force) — theo kế hoạch M12, chưa làm ở M2.
- `user_settings.notify` (jsonb) chưa chốt cấu trúc khoá — chốt cùng M9 (reminders).
- Job dọn `search_history` còn 50 dòng/user (CONTEXT §6.4) — làm ở M12 (cron).
- Production: bổ sung `pg_trgm` + `unaccent` để tra không dấu/giống âm (CONTEXT §13).

### M4.1 — vá theo review độc lập (đã hoàn tất 2026-09-27)

Đã kiểm chứng trên code + `langoo_test` + server thật (2026-09-27):

1. **[P1]** Thiếu đường nối search→nghĩa: search trả `lexeme_id`, không có endpoint lấy sense theo lexeme. `q=eat` → `lexeme_id:"4"` nhưng `/senses/4` là nghĩa của *run*. → cần `GET /v1/lexemes/:id/senses` (đọc `serve.sense_card`).
2. **[P2]** `/senses/:id/links` trả **trùng** (`run#2` hai lần): view có cả 2 chiều, repo `UNION ALL` 2 chiều. → sửa còn 1 nhánh + e2e assert count/unique.
3. **[P2]** `q` toàn khoảng trắng: ẩn danh `200` (20 dòng); có token **500** do `search_history_raw_query_check`. → trim ở DTO + service.
4. **[P2]** `target_id` toàn khoảng trắng ở gloss-report → vi phạm `gloss_report_target_id_check` → **500**. → trim + validate.
5. **[P2]** ID vượt `bigint` (`/senses/9223372036854775808`) → **500**. → chặn biên `≤ 9223372036854775807n`; đồng thời thêm validate UUID cho các route id uuid (collections/items/tags — cùng lớp lỗi).
6. **[P2]** Search chưa phân trang theo §4 (`cursor` → 400, `next_cursor` luôn null, quá 50 dòng không duyệt tiếp). → thêm cursor.
7. **[P3/romaji]** `q=hashiru` → 0 kết quả (CONTEXT §1.2 yêu cầu tra romaji); demo `core.lexeme.romanization = NULL`. → đã thêm chuyển romaji sang kana và nhánh khớp `romanization` khi dữ liệu có giá trị.

Đã sửa: search trả cursor keyset có khóa ổn định và giới hạn 100; thêm `GET /v1/lexemes/:id/senses`; loại bỏ cặp sense_pair trùng; trim/chặn query, target_id và bigint id; romaji được chuyển sang kana bằng `wanakana` 5.3.1 và tìm thêm cột romanization khi có dữ liệu. Không thay đổi schema core/serve.

**Checklist kiểm biên cho các milestone sau (bắt buộc trước khi báo cáo):**
- Input: rỗng/khoảng trắng sau trim; số vượt biên (`bigint`), UUID rác, ký tự LIKE `% _ \`.
- Kết quả: không trùng lặp (đặc biệt khi join/UNION nhiều nguồn); tổng số khớp với DB mẫu.
- Phân trang: `limit` + `cursor` theo §4; trang cuối `next_cursor = null`.
- Luồng FE end-to-end: search → chọn nghĩa → lưu; mọi màn hình có API đủ dữ liệu.
- Lỗi biên phải trả 4xx có mã domain, **không bao giờ 500** vì dữ liệu client.

## Kế tiếp dự kiến

- **M6 — SRS:** `GET /srs/due`, `POST /srs/reviews`, `GET /srs/stats`; scheduler SM-2 tách module thuần có unit test (interface sẵn để đổi FSRS).

## M13 — phạm vi dự kiến (chốt chi tiết khi tới M13)

Trọng tâm: **thống kê vận hành chỉ-đọc** (tổng hợp từ `app.*`, `core.*`, `serve.*`, `ai_usage`):

- **Người dùng**: đăng ký mới theo ngày/tuần, user theo `status`, tỉ lệ quay lại (`last_login_at`).
- **Học tập**: lượt ôn/ngày, XP, phân bố streak, số collection/item, quiz đã làm, backlog SRS đến hạn.
- **Nội dung**: hàng chờ `gloss_report` (open / theo `issue` / theo `target_kind`), tiến độ concept `draft→curated`, tỉ lệ gloss máy vs đã duyệt, độ phủ `serve.sense_pair`.
- **AI**: `ai_usage` (request/token/chi phí theo ngày, theo feature), số lần chạm quota.

Kèm (nếu bạn duyệt khi làm M13): duyệt gloss (`reviewed_by`), xử lý `gloss_report`, khoá/mở user, quản lý deck.

Yêu cầu kiến trúc: migration 026+ thêm vai admin + JWT claim + `AdminGuard`; route `/v1/admin/*`; mọi thao tác ghi `core` (nếu có) phải là ngoại lệ được duyệt và có audit.
