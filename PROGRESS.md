# PROGRESS — Langoo Backend

> Cập nhật lần cuối: 2026-10-06 (M4.2 / DB4-D0.2 chuẩn bị deploy VPS; M7.2/M8.2 sửa follow-up review: quiz không cộng reviews_total, session một profileId + distractor theo profile; migration 034/036/037 đã áp cloud + VPS + local full (05/10, đã push); M7/M8 M7.1/M8.1 pass full local gates; DB1 dọn schema xong; backend + DB thật đã chạy trên VPS; M13 đã sửa 6 P2 + 2 P3, local pass/chưa deploy; M12 đã sửa 4 finding, local pass/chưa deploy; M11 đã sửa sau review; M9 tạm gác; M2.3 A + C backend opt-in đã triển khai, B và rollout C còn chờ)
> Quy trình: **kế hoạch → chờ duyệt → code → báo cáo → chờ review** (PROMPT-BACKEND.md §1).

## Checklist milestone

| #    | Milestone                                                                 | Trạng thái                                                                                                            |
| ---- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| M0   | Bootstrap & DB ops                                                        | ✅ hoàn thành (chờ review)                                                                                            |
| M1   | Data layer (Prisma schema `app` + repository `core`/`serve`)              | ✅ hoàn thành (chờ review)                                                                                            |
| M2   | Auth (register/login/refresh/logout/me)                                   | ✅ hoàn thành (chờ review)                                                                                            |
| M2.1 | Auth fixes sau review                                                     | ✅ hoàn thành                                                                                                         |
| M2.2 | Đăng nhập Google (OAuth2 ID token)                                        | ✅ hoàn thành (chờ review)                                                                                            |
| M2.3 | Sửa Google OAuth sau review                                               | 🛠️ A + C backend opt-in đã triển khai; B và rollout C còn chờ ([kế hoạch](docs/plans/m2.3-google-oauth-fixes.md))     |
| M3   | Profile & settings                                                        | ✅ hoàn thành (chờ review)                                                                                            |
| M3.1 | Profile & settings fixes sau review                                       | ✅ hoàn thành                                                                                                         |
| M4   | Dictionary (đọc)                                                          | ✅ hoàn tất M4.1: nối lexeme→sense, cursor, romaji và hardening input                                                 |
| M4.2 | Search một lexeme một hit và bảo toàn nghĩa đa nguồn                       | ✅ code xong local: per-lexeme matching trước cursor/LIMIT, cursor v3; cùng DB4-D0.2 projection view + EN context, 375 unit / 31 e2e pass, lint/build pass; [report](docs/reviews/db4-d0-2-m4-2-implementation-2026-10-06.md); chưa commit/push/deploy, migration 038 chưa áp VPS |
| M5   | Collections                                                               | ✅ hoàn thành cùng M5.1                                                                                               |
| M5.1 | Collections fixes sau review                                              | ✅ hoàn thành                                                                                                         |
| M6   | SRS                                                                       | ✅ hoàn tất sau M6.1; audit lại 30/30 ca pass ([báo cáo](docs/reviews/m6-recheck-2026-09-29.md))                      |
| M6.1 | SRS fixes sau review                                                      | ✅ đã sửa 14 phát hiện + ENV-01; audit 30/30 pass; **cloud đã có 026/027**                                            |
| M7   | Review modes & sessions                                                   | ✅ M7.1 + M7.2 đã sửa (profile xuyên suốt, distractor theo profile); build/lint/unit/e2e local pass; migration 034 đã áp cloud+VPS+local (05/10) ([kế hoạch](docs/plans/m7-m8-fixes.md), [recheck](docs/reviews/m7-m8-recheck-2026-10-02.md)) |
| M8   | Gamification                                                              | ✅ M8.1 + M8.2 đã sửa (achievement quiz cùng transaction; `reviews_total`/`reviews_1000` chỉ tính SRS, migration 036); migration 034/036 đã áp cloud+VPS+local (05/10) ([kế hoạch](docs/plans/m7-m8-fixes.md), [recheck](docs/reviews/m7-m8-recheck-2026-10-02.md)) |
| M9   | Reminders                                                                 | ⏸️ tạm gác (chủ dự án chốt 2026-09-29; bảng `app.reminder`/`notification_log` giữ nguyên)                             |
| M10  | AI Chatbot                                                                | ✅ đã sửa 6 finding sau review; chuẩn bị OpenCode Zen free; migration 037 đã áp cloud+VPS+local (05/10); AI production chạy Groq `openai/gpt-oss-120b` (từ 05/10, ~1-2s/câu); [recheck](docs/reviews/m10-recheck-2026-10-03.md) |
| M11  | AI Quiz                                                                   | ✅ đã sửa sau review 2026-10-05: 6 lỗi P2 + nguồn SRS; [recheck](docs/reviews/m11-recheck-2026-10-05.md) |
| M12  | Hardening                                                                 | ✅ đã sửa 1 P1 + 3 P2 sau review 2026-10-05; kiểm chứng local pass, chưa deploy VPS; [recheck](docs/reviews/m12-recheck-2026-10-05.md) |
| M13  | Admin, Curation & Feedback (thống kê + duyệt nội dung + hộp thư feedback) | ✅ đã sửa 6 P2 + 2 P3 sau review 2026-10-05; local pass, chưa deploy VPS; [recheck](docs/reviews/m13-recheck-2026-10-05.md) |

## Lộ trình DB (chốt 2026-10-01 — "thiết kế nốt cái DB")

| # | Phase | Nội dung | Trạng thái |
| --- | --- | --- | --- |
| DB1 | Dọn schema & chốt nguồn sự thật | PK staging còn thiếu; metadata curation (`concept.reviewed_by/at`, `candidate.decision_run_id` + index); COMMENT ngữ nghĩa; regenerate CSDL doc; sửa tài liệu sai số | ✅ đã triển khai ([kế hoạch](docs/plans/db1-schema-cleanup.md)) |
| DB2 | Hạ tầng tìm kiếm | `pg_trgm` + 4 GIN trigram (033); `core.bigrams` + 4 GIN bigram (035); query 3 nhánh UNION dùng index; benchmark VPS `走る` 7,7s → 0,11s | ✅ đã triển khai ([kế hoạch](docs/plans/db2-search-infra.md)) |
| DB3 | Seed dữ liệu nền | `radical` 214; KanjiVG → `media_asset`/`kanji_media`; deck hệ thống; gloss tiếng Việt cấp sense/concept; chốt chính sách JLPT; audit `/credits` | 📋 |
| DB4 | Hoàn tất mapping sense↔concept | Candidate generator + chấm điểm + LLM 2 lượt + audit + promote/rollback theo `mapping_run`; dọn tồn translations/relations/Tatoeba/OMW; view coverage | 📋 chặng dài — cần chốt ngân sách LLM |
| DB5 | Curation + serve + go-live DB thật | Quy trình duyệt concept/gloss; refresh `serve.sense_pair`; giao M14 (admin ghi `core`); chuyển API VPS về DB thật | 📋 |

## Quyết định đã chốt

### 2026-10-06 — M4.2 / DB4-D0.2 — Chuẩn bị deploy lên VPS

- Chủ dự án đã yêu cầu deploy. Release worktree riêng loại code quiz/DB4-D1 chưa commit.
- DB4-D0.1 bảo toàn sửa runtime VPS: admin user list, public sources và KanjiVG stroke.
- Full gates release riêng: 343 unit / 204 E2E, lint và build pass. Sửa formatting
  gloss-translate.ts ở base để CI pass, không đổi logic.
- Backup code/dist + DB mới tại storage ngoài release; dump ~610MB, TOC đọc được.
- Migration 038 chạy trước publish; không backfill/delete core data, chưa sửa FE.
- [Report release](docs/reviews/m4-2-db4-d0-2-deploy-2026-10-06.md) ghi preflight/rollback;
  chuẩn bị commit/push/deploy, chưa báo live thành công trước smoke.

### 2026-10-06 — DB4-D0 — Rà soát bản ghi từ điển trùng

Đã khảo sát mẫu EN/JA trên DB full local `55433/langoo` bằng query read-only và đọc
search/importer: có search face lemma/kanji lặp cùng lexeme, lexeme đa nguồn,
pipeline foundation ghi gloss cha vào definition và những trường hợp cùng gloss
nhưng khác reading/etymology. [Báo cáo và phương pháp đề xuất](docs/reviews/db4-d0-dictionary-duplicates-2026-10-06.md).
Ưu tiên sửa definition projection + search/group display bằng SQL/rule, giữ IDs/provenance;
AI dành cho cặp còn mơ hồ. Khảo sát local không sửa runtime/DB; D0 tổng thể chưa hoàn tất.

**Bổ sung khảo sát VPS cùng ngày:** SSH `langoo-vps`, 16 metric read-only (hai snapshot thống kê và một snapshot
cross-check tổng); DB thật có 2.375.240 lexeme / 2.917.954 sense. View search có 218.794 cặp
JA lặp face cùng ID; 55.997 sense Wiktextract cần xét projection đầu/cuối; 199.101
nhóm EN WordNet cùng key/concept/definition đa nguồn. Không coi counts ứng viên là
số ID được xóa. 8 anonymous HTTP GET đều 200; live đã có **3 file dictionary hotfix
chưa commit trên VPS**, nên mẫu search không lặp nhưng list/detail/gloss_en còn lệch.
Đã lưu patch để bảo toàn; không sửa/deploy/reset runtime. API đọc DB localhost VPS,
migrations 001–037 trừ 028 đã áp; staging raw wikt/wn/jmdict rỗng, core gloss còn đủ.
[Báo cáo + số liệu/SQL](docs/reviews/db4-d0-vps-duplicates-2026-10-06.md),
[plan sửa](docs/plans/db4-dictionary-deduplication.md): **DB4-D0.1** bảo toàn/tích hợp
hotfix → **DB4-D0.2 + M4.2** projection và search → **DB4-D0.3/D0.4** membership/reuse.
Kiểm SQL/HTTP/JSON/count/link/diff; chưa chạy regression sửa app hoặc restore drill.
Artifacts/report/plan chưa commit/push; chưa triển khai sửa DB/code theo plan.

### 2026-10-06 — DB4-D0.1 / DB4-D0.2 / M4.2 — Sửa projection và search, chuẩn bị dọn trùng

Chủ dự án duyệt hướng sửa nguyên nhân rồi dọn bản trùng thật. Đã tích hợp ý tưởng
per-lexeme của hotfix VPS, thay source suppression và chọn gloss theo sense trước
bằng source projection trong view dùng chung. Migration **038** thêm function
Wiktextract guarded source/batch/rank/review + full EN context; list/detail cùng
meaning, giữ custom/JMdict/VI. Backfill CLI export/apply/resume/rollback có exact
target, full-context hash, immutable prepared journal, transaction và drift guards.
Foundation writer ngoài repo đã sửa, [patch lưu trong repo](docs/reviews/db4-d0-2-foundation-writer-2026-10-06.patch).

Dry-run VPS read-only: **55.997 eligible projection** (53.055 EN/1.869 JA/1.073 VI).
DB4-D0.3 inventory mới có shortlist **500 cặp WordNet** full-scope bằng nhau, không
thấy app FK trong mẫu; **50 cặp có examples**, 500 có sense_concept. Chưa có alias/
importer resolution + child preservation nên chưa có run DELETE; không suy 500 cặp
thành tỷ lệ/xóa toàn corpus. **0 request AI, 0 ID bị xóa; không đổi code/DB live**.

Kiểm: DB test riêng `55433/langoo_dictionary_d0_20261006_test` tới 038; **48 suite /
375 unit**, **3 suite / 31 e2e**, targeted ESLint/build pass; Python AST parse pass,
chưa chạy full source ingest. [Report](docs/reviews/db4-d0-2-m4-2-implementation-2026-10-06.md),
[dry-run summary](docs/reviews/db4-d0-2-m4-2-dryrun-2026-10-06.json),
[handoff/CLI](docs/handoff/db4-d0-2-m4-2.md). Code/test/docs **chưa commit/push/deploy**;
038 chỉ áp DB test riêng; VPS còn hotfix cũ. Preflight 13:10 UTC có thêm sửa stroke SVG,
tổng 5 file dictionary modified; [patch runtime mới](docs/reviews/db4-d0-vps-dictionary-runtime-2026-10-06.patch)
đã lưu để release không làm mất thay đổi ngoài scope. Membership/alias, physical cleanup
DB4-D0.5 và cost/reuse DB4-D0.4 chưa hoàn tất, D0 tổng thể còn source/legacy audit.

Follow-up ảnh `dog`: API live lexeme `998637` có 23 senses; ba sense đầu khác
scope nhưng `gloss_en` cùng gloss cha. SSH xác nhận 038 chưa có, HEAD vẫn `7b13b90`.
Đã bổ sung evidence/contract FE vào report/API docs: raw gloss cha/con là context,
không là hai sense riêng. Chưa sửa FE; không push/deploy hay ghi DB trong follow-up.


| Ngày       | Quyết định                                                                                                                                                                                                                                                                                                                                 | Lý do                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| 2026-09-26 | Package manager: **npm**                                                                                                                                                                                                                                                                                                                   | Tiêu chí nghiệm thu ghi `npm run ...`; máy đã có npm 11.11.0                                                         |
| 2026-09-26 | `DATABASE_URL`/`DIRECT_URL` trỏ **cloud Prisma Postgres** ngay                                                                                                                                                                                                                                                                             | Chủ dự án chọn; local chỉ dùng cho test                                                                              |
| 2026-09-26 | Test DB local qua `TEST_DATABASE_URL`/`TEST_DIRECT_URL`; chỉ dùng `DATABASE_URL` khi URL đó tự vượt kiểm tra host local + hậu tố `_test`                                                                                                                                                                                                   | E2E bắt buộc chạy DB local `langoo_test`; tách hẳn khỏi cloud để an toàn                                             |
| 2026-09-26 | Tên package `langoo-backend`; **không** Docker compose                                                                                                                                                                                                                                                                                     | Máy đã có PostgreSQL 17 service (cổng 5432)                                                                          |
| 2026-09-26 | Prisma dùng **connector mặc định**, chưa dùng `@prisma/adapter-pg` (chốt chính thức ở M1)                                                                                                                                                                                                                                                  | Đơn giản, Prisma hỗ trợ Prisma Postgres sẵn                                                                          |
| 2026-09-26 | CI GitHub Actions, Node 22; `engines >=22 <25`; `.nvmrc` = 22                                                                                                                                                                                                                                                                              | Máy dev Node 24 chạy được; CI bám đúng prompt                                                                        |
| 2026-09-26 | Health check M0 dùng `pg` Pool trực tiếp (chưa Prisma)                                                                                                                                                                                                                                                                                     | Prisma thuộc M1; M0 chỉ cần kiểm tra kết nối                                                                         |
| 2026-09-26 | `db:test:reset` chỉ chạy với DB tên kết thúc `_test`, từ chối `NODE_ENV=production`                                                                                                                                                                                                                                                        | Bất biến #12: không bao giờ reset dữ liệu cloud                                                                      |
| 2026-09-26 | Cloud Prisma Postgres đã có sẵn đủ schema 001–025 + dữ liệu demo; `db:migrate` no-op (kiểm chứng bằng truy vấn chỉ-đọc `schema_migration`)                                                                                                                                                                                                 | Chủ dự án xác nhận; không cần provision cloud ở M0                                                                   |
| 2026-09-26 | Tạo role local `langoo` (LOGIN + CREATEDB, mật khẩu ngẫu nhiên chỉ lưu trong `.env`) cho DB test                                                                                                                                                                                                                                           | Không đổi mật khẩu `postgres`; dump không có `OWNER TO`/`GRANT` nên restore bằng role thường OK                      |
| 2026-09-26 | `pg_hba.conf` tạm chuyển `trust` cho 2 dòng localhost ~5 giây để tạo role, sau đó khôi phục nguyên trạng                                                                                                                                                                                                                                   | Chủ dự án đồng ý; có backup + reload, không restart                                                                  |
| 2026-09-26 | `DATABASE_URL` = `DIRECT_URL` (cùng 1 chuỗi pooled Prisma cấp)                                                                                                                                                                                                                                                                             | Prisma console chỉ cấp 1 URL; đủ dùng cho M0. Khi cần DDL nặng (M1+) sẽ xem lại direct URL riêng nếu có              |
| 2026-09-26 | Health check cloud đo được `db_latency_ms` ~464ms (pooled, châu Á → Prisma vùng mặc định)                                                                                                                                                                                                                                                  | Ghi nhận; theo dõi khi tối ưu tầng đọc                                                                               |
| 2026-09-26 | Dùng **Prisma 7.10.0** (pin `^7.10.0`, không dùng `8.0.0-rc` đang là tag `latest`) + **`@prisma/adapter-pg`** — thay đổi so với chốt M0 (thời Prisma 6)                                                                                                                                                                                    | Prisma 7 bắt buộc driver adapter (bỏ Rust engine); dự án giữ CJS nhờ `moduleFormat = "cjs"`                          |
| 2026-09-26 | Generated client ở `src/generated/prisma` — gitignore + ignore ESLint/Prettier; sinh qua `postinstall` và `npm run prisma:generate`                                                                                                                                                                                                        | Prisma 7 bắt buộc `output`; `npm ci` tự sinh client, CI có bước generate tường minh                                  |
| 2026-09-26 | Schema Prisma chỉ map 32 bảng `app`; uuid **không** khai default (buộc service sinh uuid v7); CHECK constraint/partial index ghi chú, không map                                                                                                                                                                                            | Bất biến #3/#10; Prisma không được dùng để sinh DDL                                                                  |
| 2026-09-26 | Repository mẫu `SenseCardRepository` đọc `serve.sense_card` bằng `$queryRaw`; e2e chỉ đọc trên `langoo_test`                                                                                                                                                                                                                               | Tiêu chí M1; M1 chưa có endpoint nên e2e không đi qua HTTP                                                           |
| 2026-09-26 | `@nestjs/jwt` dùng **v11.0.2** (không dùng v12 như kế hoạch) và `uuid` dùng **v11.1.1** (không dùng v14)                                                                                                                                                                                                                                   | v12/v14 là ESM-only, không hợp dự án CJS + Jest; v11 vẫn đủ API cần (jwt sign/verify, uuid v7)                       |
| 2026-09-26 | `JWT_ACCESS_SECRET` bắt buộc ≥32 ký tự; tôi sinh ngẫu nhiên 96 hex vào `.env` (không commit), CI dùng secret riêng                                                                                                                                                                                                                         | Chủ dự án đồng ý; secret cũ 11 ký tự không đủ an toàn                                                                |
| 2026-09-26 | Access token 15 phút **không tra DB mỗi request**; logout thu hồi session → refresh token chết ngay, access token cũ hết hạn tự nhiên                                                                                                                                                                                                      | Chủ dự án chốt; đổi sang "tra session mỗi request" nếu cần thu hồi tức thì                                           |
| 2026-09-26 | Register chỉ tạo `users` + `user_identity` (+ `device` nếu client gửi) + session                                                                                                                                                                                                                                                           | `user_settings`/`study_profile` thuộc M3 (đúng phạm vi milestone)                                                    |
| 2026-09-26 | Quy ước commit (§1.4 PROMPT-BACKEND.md): 1 commit = 1 đơn vị logic hoàn chỉnh (code + test + docs của cùng một việc), mỗi milestone ~2–4 commit — không tách lẻ từng file, không dồn cả milestone                                                                                                                                          | Chủ dự án yêu cầu cân bằng (M0–M2 commit hơi lẻ)                                                                     |
| 2026-09-27 | M2.1: register tạo kèm `user_settings` mặc định; user cũ thiếu row: `GET` trả mặc định, `PATCH` upsert                                                                                                                                                                                                                                     | Mọi user mới luôn có settings — M6 (timezone) không phải fallback khắp nơi                                           |
| 2026-09-27 | Quy tắc xoá profile: không xoá default khi còn hồ sơ khác (409), không xoá hồ sơ duy nhất (409)                                                                                                                                                                                                                                            | Tránh xoá cascade mất collection/SRS do nhầm                                                                         |
| 2026-09-27 | M3.1: mutation profile/settings khóa dòng `app.users` trong transaction; profile đầu tiên luôn default; settings legacy giữ active profile; DTO chặn null, tên rỗng, UUID sai và timezone numeric offset                                                                                                                                   | Giữ bất biến một default/user và tránh race làm mất active profile hoặc trả lỗi DB 500                               |
| 2026-09-27 | Validate id ngôn ngữ bằng đọc `public.language` qua `$queryRaw` (không hardcode, không map Prisma public)                                                                                                                                                                                                                                  | Đúng bất biến: Prisma chỉ map `app`; ngôn ngữ thêm mới không cần sửa code                                            |
| 2026-09-27 | `GET /v1/profiles` không phân trang                                                                                                                                                                                                                                                                                                        | Mỗi user có vài hồ sơ cố định; pagination chỉ đặt ở tài nguyên lớn (M5+)                                             |
| 2026-09-27 | `JwtModule` đặt `global: true` trong AuthModule                                                                                                                                                                                                                                                                                            | Module khác (users, srs…) chỉ cần import AuthModule để dùng `JwtAuthGuard`                                           |
| 2026-09-27 | Dictionary **đọc công khai**; `search` dùng `OptionalJwtAuthGuard` — có Bearer hợp lệ thì ghi lịch sử, token bẩn vẫn 401; history/gloss-report yêu cầu Bearer                                                                                                                                                                              | Chủ dự án chốt; tra từ trước khi đăng nhập vẫn dùng được                                                             |
| 2026-09-27 | `LanguageRepository` chuyển từ `src/users` sang `src/db/repositories` + DbModule (global) cung cấp                                                                                                                                                                                                                                         | Dùng chung users/dictionary/settings; đúng bất biến chỉ đọc `public.language`                                        |
| 2026-09-27 | Search dùng `ILIKE` escape wildcard, rank exact → prefix → frequency; chưa có `pg_trgm/unaccent`                                                                                                                                                                                                                                           | PostgreSQL nhúng thiếu extension (CONTEXT §13); production bổ sung index sau                                         |
| 2026-09-27 | `pronunciations`/`forms` trả theo **lexeme** của sense; `examples` đọc `core.example.sense_id` (không dùng `example_sense` vì chưa chạy mapping)                                                                                                                                                                                           | Đúng dữ liệu hiện có; khi chạy `run_mapping.py` có thể mở rộng                                                       |
| 2026-09-27 | `search_history` chỉ đọc 50 dòng gần nhất; job dọn định kỳ chưa làm                                                                                                                                                                                                                                                                        | Để M12 (hardening) — đã ghi backlog                                                                                  |
| 2026-09-27 | M2.1 (chủ dự án thêm, đã review + test 2026-09-27): validate `JWT_ACCESS_TTL` lúc khởi động (fail-fast); xoay refresh token chống race bằng `updateMany` có điều kiện (chỉ 1 request thắng, còn lại 401); `device` phải là object                                                                                                          | Tránh double-rotation khi 2 request dùng cùng token; cấu hình sai lộ ngay khi boot                                   |
| 2026-09-27 | `DELETE /collections/:id` = **archive mềm** (`archived_at`), không xoá cứng                                                                                                                                                                                                                                                                | Giữ nguyên `srs_state`/`review_log` — tránh mất dữ liệu học do nhầm                                                  |
| 2026-09-27 | Item 1–2 face; server tự suy ngôn ngữ từ `core.sense→lexeme`; mặt phụ phải khác ngôn ngữ; `position = max+1`; `item_count` do service giữ trong transaction (DB không có trigger)                                                                                                                                                          | Bất biến §5.9 + §1.3 (client không gửi chuỗi/ngôn ngữ để đoán nghĩa)                                                 |
| 2026-09-27 | Clone deck dùng `createMany` + uuid v7 sinh trước + transaction timeout 30s; nghĩa từ gloss vi→en→lemma với `meaning_source` `machine` khi gloss máy chưa duyệt                                                                                                                                                                            | Deck thật có thể vài trăm–nghìn item; tránh timeout 5s mặc định của Prisma                                           |
| 2026-09-27 | Cursor keyset `(position, id)` base64url ở `src/common/pagination/cursor.ts`                                                                                                                                                                                                                                                               | Dùng lại cho M6+ (due list, history…), không offset                                                                  |
| 2026-09-27 | Tag user-scoped `/v1/tags`; `PATCH item.tag_ids` thay thế toàn bộ (gửi `[]` để bỏ hết)                                                                                                                                                                                                                                                     | Đơn giản, tránh nhiều endpoint gắn/gỡ lẻ tẻ                                                                          |
| 2026-09-27 | M2.1: refresh rotation cập nhật nguyên tử có điều kiện; `device` phải là object; `JWT_ACCESS_TTL` dùng parser chung và validate lúc khởi động                                                                                                                                                                                              | Chặn reuse token đồng thời, trả 400 cho input sai kiểu, và tránh ghi DB rồi mới lỗi vì cấu hình TTL                  |
| 2026-09-27 | M3.1: mutation profile/settings khoá dòng `app.users` (`FOR UPDATE`) trong transaction; hồ sơ đầu tiên luôn default; upsert giữ active profile cho user cũ; DTO chặn null/rỗng/UUID sai/timezone offset                                                                                                                                    | Giữ bất biến 1 default/user và chống race                                                                            |
| 2026-09-27 | **Rút kinh nghiệm sau review M4**: từ M6 trở đi, trước khi báo cáo milestone phải tự chạy "checklist kiểm biên" (xem Backlog) trên **mọi endpoint mới**                                                                                                                                                                                    | Review độc lập phát hiện 7 lỗi lớp input-biên/thiếu luồng/trùng lặp mà e2e cũ không phủ                              |
| 2026-09-27 | Bổ sung **M13 — Admin, Curation & Feedback** vào lộ trình (sau M12), **trọng tâm là thống kê vận hành**; vai admin sẽ cần migration 026+ (`app.users.role` hoặc bảng `app.staff`); nếu cho admin ghi `core` (curate gloss/concept) phải ghi rõ ngoại lệ + audit, quyết định khi làm M13                                                    | Chủ dự án yêu cầu: cần thống kê mới nắm được tình hình; hiện API không có vai admin và curation đang làm bằng script |
| 2026-09-27 | **Chính sách quyền riêng tư M13**: admin chỉ xem **số liệu tổng hợp**; không endpoint đọc nội dung collection/item/chat cá nhân; ngoại lệ duy nhất là dữ liệu user **chủ động gửi** (`gloss_report`, `feedback`); debug ca cụ thể cần user đồng ý + audit log                                                                              | Chủ dự án yêu cầu; tránh "admin soi dữ liệu riêng tư"                                                                |
| 2026-09-27 | **M6 chốt mô hình SRS = Anki verbatim** (steps `1m 10m`, Hard = TB 2 bước, Easy tốt nghiệp 4d, EF Anki ±0.15/0.20 sàn 1.3, relearning `10m` → về review 1 ngày, max interval 36.500 ngày, fuzz theo ba khoảng Anki với RNG injectable, learn-ahead 20m, thứ tự queue learning→review→new) — đặc tả đầy đủ tại [`docs/srs.md`](docs/srs.md) | Chủ dự án chốt "bê nguyên Anki" sau khi đối chiếu manual Anki                                                        |
| 2026-09-27 | Burying: **cơ chế nội bộ**, bật cho new + review siblings, hết ngày theo timezone user; **không** API unbury, không lộ số thẻ bị bury cho user                                                                                                                                                                                             | Chủ dự án chốt: user không cần biết                                                                                  |
| 2026-09-27 | Daily limits **làm ở M6** (liên quan trực tiếp SRS): `srs_new_per_day` 20, `srs_review_per_day` 200 — đề xuất lưu ở `user_settings` (chốt trong kế hoạch M6); semantics Anki: intraday learning không bị giới hạn                                                                                                                          | Chủ dự án chốt                                                                                                       |
| 2026-09-27 | API suspend/unsuspend thẻ để **M7** (queue M6 vẫn lọc `suspended = false`)                                                                                                                                                                                                                                                                 | Chủ dự án chốt                                                                                                       |
| 2026-09-27 | **Feedback (gộp vào M13)**: bắt buộc đăng nhập; user xem lại + thấy trạng thái (`GET /me/feedback`); ảnh lưu qua `StorageService` trừu tượng `local` (dev) / `s3` (khi có key) — giống pattern `AI_PROVIDER=stub`; tối đa 3 ảnh ≤5MB (jpeg/png/webp, kiểm magic bytes); admin xem ảnh qua route xác thực admin, không public URL           | Chủ dự án chốt qua bộ câu hỏi ngày 2026-09-27                                                                        |
| 2026-09-27 | Host API trên **Render**: blueprint `render.yaml` (build `npm ci --include=dev && npm run build`, start `npm run start:prod`, health `/v1/health`); CORS tuỳ chọn qua `CORS_ORIGINS` (trống = tắt); migration chạy tay từ local trước deploy                                                                                               | Chủ dự án muốn host; migration 026/027 đã apply cloud cùng ngày                                                      |
| 2026-09-28 | CORS API Render bật `CORS_ORIGINS=*` (mọi origin) khi chưa chốt domain FE — code hiểu `*` = phản chiếu origin của request kèm credentials; khi có FE sẽ siết về danh sách origin                                                                                                                                                           | Chủ dự án chốt 2026-09-28                                                                                            |
| 2026-09-28 | **M2.2 — OAuth2 chỉ Google**, luồng **ID token từ SDK** (`POST /v1/auth/oauth/google`): backend verify JWKS/`iss`/`aud`/`exp`/nonce rồi cấp JWT nội bộ; không làm luồng authorization-code/redirect                                                                                                                                        | Chủ dự án chốt qua bộ câu hỏi 2026-09-28                                                                             |
| 2026-09-28 | M2.2 — chính sách auto-link theo email được thay bằng yêu cầu link chủ động sau review; không gộp tài khoản chỉ vì email trùng                                                                                                                                                                                                             | Kế hoạch M2.3, đợt A                                                                                                 |
| 2026-09-28 | M2.2 — dùng thư viện chính chủ `google-auth-library` ^11 để verify ID token (cache/xoay JWKS); chưa cấu hình `GOOGLE_OAUTH_CLIENT_IDS` thì endpoint trả `503 AUTH_OAUTH_NOT_CONFIGURED` (không fail-fast lúc boot)                                                                                                                         | Đề xuất trong [kế hoạch M2.2](docs/plans/m2.2-google-oauth.md), chủ dự án duyệt "OK"                                 |
| 2026-09-29 | Cấu hình Google OAuth thật: client ID web (GIS) đặt thẳng trong `render.yaml` (giá trị công khai) để Blueprint tái lập được; FE dùng cùng ID qua `VITE_GOOGLE_CLIENT_ID`                                                                                                                                                                   | Chủ dự án cung cấp client ID 2026-09-29; FE đã tích hợp sẵn luồng challenge + nút đăng nhập                          |
| 2026-09-29 | **M9 (Reminders) tạm gác** — không code, không migration; giữ bảng `app.reminder`/`notification_log` trong DB                                                                                                                                                                                                                              | Chủ dự án chốt 2026-09-29 (ưu tiên chatbot)                                                                          |
| 2026-09-29 | **M10 AI Chatbot**: provider `stub` mặc định (không cần key) + `openai` (OpenAI-compatible, `AI_BASE_URL` cho gateway như OpenCode Zen); `gemini` chưa triển khai → fail-fast; thiếu key/model khi chọn provider thật → app không khởi động                                                                                                | Chốt theo thiết kế đã duyệt (D1–D7)                                                                                  |
| 2026-09-29 | **M10 quota**: `AI_DAILY_REQUEST_LIMIT` mặc định 50/ngày theo **ngày địa phương user**; reserve nguyên tử (`ON CONFLICT ... WHERE count < limit`) → vượt trả 429; chi phí/token ghi `app.ai_usage`                                                                                                                                         | Nhất quán quy tắc streak/daily-cap M6.1                                                                              |
| 2026-09-29 | **M10 hành vi**: scenario whitelist `general｜vocabulary｜grammar｜conversation`; 2.000 ký tự/tin; history 20 tin; xoá phiên = archive mềm; provider lỗi → 503 và không lưu tin (quota đã gọi vẫn tính); idempotency tin nhắn để backlog                                                                                                   | Chốt theo thiết kế đã duyệt; chat không bắt buộc hồ sơ học (`profile_id` nullable)                                   |
| 2026-09-30 | **M11 AI Quiz**: nguồn từ vựng gồm mọi `srs_state` (**kể cả `new`**), ưu tiên `review → relearning → learning → new`; 3 loại câu hỏi + mixed (MC/fill_blank/matching); matching chấm all-or-nothing | Chủ dự án chốt (câu hỏi đa dạng, dùng cả từ mới) |
| 2026-09-30 | M11 provider **stub deterministic** (kể cả khi `AI_PROVIDER` là provider thật — có log cảnh báo); adapter LLM thật + AI giải thích đáp án để backlog | Tránh tốn token khi chưa cần |
| 2026-09-30 | M11 chống lạm dụng: quota **15 quiz/ngày** (`AI_QUIZ_DAILY_LIMIT`), cooldown **15s** + dedup cùng tham số (`AI_QUIZ_COOLDOWN_MS`); validate nguồn + dry-run trước khi reserve quota | Chủ dự án lo người dùng lạm dụng sinh quiz tốn token |
| 2026-09-30 | M11 XP: chỉ câu đúng cộng `quiz_correct` (+5); mọi câu vẫn cập nhật streak/user_stats qua `xpEligible` mới của GamificationService; phiên quiz trả `srs: null` | Chủ dự án chốt |
| 2026-09-30 | **M12 rate limit**: `@nestjs/throttler` (in-memory) — global 120/phút/IP; login 10/phút; register 5/giờ; oauth 10/phút; refresh 30/phút; lỗi `429 RATE_LIMITED`; e2e tự tắt bằng `RATE_LIMIT_ENABLED=false` | Chủ dự án duyệt (D1) |
| 2026-09-30 | **M12 scheduler nội bộ** (không thêm dependency): tick 60s + advisory lock từng job; dọn `search_history` còn 50/user, tạo partition `review_log` trước 2 tháng, retention chat 180 ngày | Duyệt D2/D6 |
| 2026-09-30 | **M12 pool & ENV-01**: `DB_POOL_MAX/IDLE_TIMEOUT/CONNECTION_TIMEOUT` dùng chung PrismaPg + health pool; boot cảnh báo lệch TimeZone; `/v1/health` thêm `db_timezone`; khuyến nghị `sslmode=verify-full` | Duyệt D3/D4 |
| 2026-09-30 | **M13 vai admin**: cột `users.role` + `AdminGuard` đọc DB mỗi request (thu hồi quyền hiệu lực ngay); bootstrap bằng SQL, không có endpoint tự phong | Duyệt D1 |
| 2026-09-30 | **M13 phạm vi**: KHÔNG ghi `core` (duyệt gloss/concept/deck tách M14); v1 = thống kê aggregate + feedback text/ảnh + gloss_report + khoá/mở user + audit log | Duyệt D2 |
| 2026-09-30 | **M13 storage**: `StorageService` trừu tượng — `local` thật (STORAGE_DIR, gitignore); adapter s3/R2 để backlog (chọn `s3` sẽ fail-fast) | Duyệt D3 |
| 2026-09-30 | **M13 audit**: bảng `app.admin_audit_log`, ghi cùng transaction mọi mutation admin; feedback giới hạn 10 lần/giờ/user + 3 ảnh ≤5MB (magic bytes) | Duyệt D6/D7 |
| 2026-10-03 | **M8.2 bộ đếm quiz**: quiz tính `streak_day`/`met_goal`/XP nhưng `user_stats.reviews_total` và achievement `reviews_1000` **chỉ tính lượt ôn SRS**; migration `036` rebuild `reviews_total` từ `review_log` | Chủ dự án chốt: tên "review" chỉ mô tả lượt ôn SRS |
| 2026-10-03 | **M7.2 session profile & distractor**: `collectDueRows` nhận profile đã resolve (một `profile_id` xuyên suốt); distractor lọc theo `profile_id` và ưu tiên collection trong SQL trước `LIMIT` | Sửa follow-up review M7/M8; tránh session lẫn thẻ/đáp án profile khác |
| 2026-10-05 | **JLPT nguồn chuẩn = `jlpt_link`** (KANJIDIC2 + JLPT list, có provenance `(source_level, source_row_number)`); `lexeme_level` chỉ giữ tham chiếu, không dùng để ghi đè | Chủ dự án chốt (chuẩn bị DB3) |
| 2026-10-05 | **LLM cho dữ liệu = OpenCode Zen `space-bunny-free`** (`AI_BASE_URL=https://opencode.ai/zen/v1`), chạy theo lô nhỏ + checkpoint vì hạn mức free; dùng cho dịch gloss VI/radical và về sau là DB4 | Chủ dự án chốt |
| 2026-10-05 | **AI production (chat) đổi sang Groq `openai/gpt-oss-120b`** (`https://api.groq.com/openai/v1`, free tier 30 RPM/1.000 req-ngày; đo ~0,6–2,2s/câu, streaming OK). Zen free còn `space-bunny-free` quá chậm (6–22s, có lúc rỗng); model Zen khác bị 403/402. Giữ Zen/Gemini làm dự phòng | Chủ dự án chốt sau khi đo |

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

### M5.1 — Collections fixes sau review (đã hoàn tất 2026-09-27)

- Review xác nhận 7 nhóm lỗi: ghép sai sense/concept; thiếu cổng curated/confidence; validation gây 500; tag trùng; sửa nghĩa không đổi nguồn; collections/tags chưa phân trang; xóa đồng thời gây 500.
- Đã bổ sung cổng chất lượng cho mapping, kiểm tra cặp sense/concept trước khi ghi, validation UUID/bigint/null/whitespace/position/cursor, khử tag trùng, cập nhật `meaning_source`, keyset pagination cho collections/tags và xóa có điều kiện chống race.
- Đã thêm regression unit/e2e riêng tại `src/collections/list-cursors.spec.ts` và `test/collections-m51.e2e-spec.ts`; tài liệu API và kế hoạch đã cập nhật theo hành vi thực tế.
- Kiểm chứng M5.1: build pass, TypeScript pass, full lint pass, 20 suite/151 unit test pass, lint phạm vi M5.1 pass, 17 e2e M5/M5.1 pass và full e2e 8 suite/82 test pass.
- Kế hoạch chi tiết và tiêu chí nghiệm thu: [`docs/plans/m5.1-collections-fixes.md`](docs/plans/m5.1-collections-fixes.md).

### M6 — SRS (đã hoàn tất sau M6.1, 2026-09-29)

- Scheduler **Anki verbatim** trong module thuần `src/srs/scheduler` (steps `1m 10m`, Hard = TB 2 bước, Easy 4d, EF ±0.15/0.20 sàn 1.3, relearning `10m` → 1 ngày, max 36.500 ngày, fuzz theo ba khoảng Anki, learn-ahead 20m) — đặc tả [`docs/srs.md`](docs/srs.md).
- API `GET /srs/due` (queue learning→review→new + cursor keyset `due_at,srs_id` + counts), `POST /srs/reviews` (1 transaction: `review_log` + `srs_state` + burying + XP idempotent), `GET /srs/stats`; daily limit `srs_new_per_day` 20 / `srs_review_per_day` 200 trong `user_settings`.
- Idempotency retry mạng: `client_review_id` + row lock `srs_state`; thẻ bị bury (sibling new/review) là cơ chế nội bộ, không lộ API.
- Migration `026_srs_scheduler.sql` và `027_srs_review_integrity.sql` đã chạy local và đã có trên cloud; schema cloud được xác minh chỉ đọc.
- Kiểm chứng: build/lint sạch, **151 unit** (scheduler 22 + queue/timezone/cursor 10 + toàn bộ cũ) và **82 e2e / 8 suite** trên DB reset (SRS 15 kịch bản: queue/nhãn ngôn ngữ, cursor, Good/Again/Easy, lapse, burying, idempotency, daily limit, stats, biên). Commits: `926c9f0`, `88cd98f`.
- Review độc lập tại `8b13333`: test cũ vẫn xanh nhưng thêm ca kiểm biên xác nhận 4 P1 và 10 P2. Nổi bật: ease 1.3 gây 500 do CHECK trên `real`, deadlock khi ôn sibling đồng thời, null retry làm mất lượt ôn, thiếu chặn thẻ bị ẩn, sai cap/cursor/learn-ahead và lệch semantics Anki. Chi tiết và cách tái hiện: [báo cáo M6](docs/reviews/m6-review.md).
- Các lỗi của bản review cũ đã được sửa trong M6.1; xem báo cáo kiểm tra lại để biết regression và giới hạn runtime cloud còn thuộc M12.

### M6.1 — Sửa SRS sau review (đã triển khai và audit đạt)

- Đã triển khai đủ phạm vi [kế hoạch M6.1](docs/plans/m6.1-srs-fixes.md): ease floor double precision, lock user trước SRS/session, eligibility/bury, receipt idempotency snapshot + conflict, cap theo profile/queue kind, queue không còn trần 1.000, cursor microsecond có context, learn-ahead fallback, scheduler overdue/relearning, DST và metadata nguồn nghĩa.
- Migration `027_srs_review_integrity.sql` chạy sau 026 trong `db:test:reset`; Prisma schema đã map `learning_is_interday`, log metadata và `srs_review_receipt`. Không sửa migration đã chạy.
- ENV-01: `withUtcTimezone()` áp cho Prisma/pg/scripts; bootstrap e2e kiểm tra DB local `_test`, session `TimeZone=UTC` và Date bind với literal UTC. `.env.example` và CI dùng startup option UTC; cloud chưa đổi.
- M7 dùng cùng `ReviewEngine`; review session kiểm tra lại due/ahead/quota và mọi eligibility trong transaction, practice chỉ miễn due/cap. M8 XP/streak/achievement vẫn nằm trong transaction.
- Regression hợp đồng: retry cùng payload trả snapshot nguyên vẹn, payload khác trả 409; `reviewed_at` bị từ chối; learn-ahead chỉ nhận khi queue thường cạn; sibling bury và metadata nguồn nghĩa được giữ qua due/session.
- Kiểm chứng local ngày 2026-09-29: **34 suite/250 unit test**, **12 suite/124 e2e**, audit **30/30 ca pass**, build pass; lint phần M6 pass.
- **Cloud đã apply 026 + 027 ngày 2026-09-27** (xác minh chỉ-đọc: `schema_migration` có 2 bản ghi, `ease_factor` = double precision, có `learning_is_interday`, `srs_review_receipt`, cột settings và review_log mới). Kèm chuẩn bị deploy Render: `render.yaml`, CORS `CORS_ORIGINS`, README hướng dẫn.

### M6/M6.1 — Kiểm tra lại và sửa lỗi (2026-09-29, đạt nghiệm thu local)

- [Báo cáo mới](docs/reviews/m6-recheck-2026-09-29.md) ghi cả lỗi đã tái hiện và bản sửa; báo cáo M6 gốc vẫn được giữ nguyên để truy vết.
- Đã sửa 7 vấn đề: relearning interval, cursor new, mixed learn-ahead, counts theo phase, retry legacy, UUID canonicalization và fuzz Anki.
- Đã chạy 30 ca audit trên DB local UTC: **30 pass / 0 fail**, dọn 25 user fixture; rollback cuối transaction cũng pass.
- Build pass; full unit **34 suite / 250 test**, full e2e **12 suite / 124 test** pass; `npm run lint` toàn dự án cũng pass.
- Cloud xác minh chỉ đọc có 026/027 và schema tương ứng; 8 log có key, không có key legacy thiếu receipt. Chưa kiểm thử HTTP SRS trên Render hay toàn bộ pool/reconnect M12.
- Giữ [script audit](scripts/review/m6-recheck.cjs) và [kết quả chi tiết](docs/reviews/m6-recheck-2026-09-29.json) để chạy lại trước deploy.

### M2.2 — Đăng nhập Google (OAuth2 ID token) (đã triển khai, chờ review)

- Endpoint `POST /v1/auth/oauth/google`: client gửi ID token từ Google Sign-In SDK; backend verify chữ ký JWKS + `iss`/`aud`/`exp` (thư viện chính chủ `google-auth-library`), kiểm `nonce` khi client gửi kèm, map `sub/email/email_verified/name/picture`.
- Tạo user mới (kèm `user_settings` mặc định + session + device); nếu email đã có user thì không auto-link.
- Tách helper dùng chung `src/auth/session.helpers.ts` (refresh token/device/assert active/toUserResponse) cho cả `AuthService` lẫn `GoogleOauthService`; không đổi hành vi login/register/refresh/logout cũ.
- Cấu hình `GOOGLE_OAUTH_CLIENT_IDS` (nhiều client id web/iOS/Android); trống → `503 AUTH_OAUTH_NOT_CONFIGURED`.
- Kiểm chứng local (2026-09-28, DB nhúng PG16 `langoo_test`): build/lint sạch, **26 suite/198 unit**, **11 suite/115 e2e** — 8 kịch bản OAuth mới (tạo user, login lại, auto-link, email chưa verify, token sai, nonce lệch, device sai kiểu, tài khoản khoá).

### M2.3 — Đợt A sửa Google OAuth (đã triển khai local, chờ review)

- `POST /v1/auth/oauth/google` không còn auto-link theo email; email trùng user trả `409 AUTH_OAUTH_LINK_REQUIRED` trước khi tạo identity/session/device.
- Thêm `POST /v1/auth/oauth/google/link`: yêu cầu access token của user, mật khẩu hiện tại và Google ID token cùng email; link idempotent và không tạo session mới.
- Verifier map claim `hd`, phân biệt lỗi tải khóa/provider 503 `AUTH_OAUTH_PROVIDER_UNAVAILABLE` với token invalid 401; không log token hoặc body.
- Cập nhật DTO, Swagger, API docs, README và regression unit/e2e. Đợt B (email verification/recovery) vẫn chưa triển khai.

### M2.3 — Hạ tầng C one-time nonce challenge (đã triển khai opt-in, chờ client)

- Thêm migration `029_google_oauth_challenges.sql` và model Prisma `GoogleOAuthChallenge`; challenge lưu hash nonce/binding secret, hết hạn sau 5 phút, consume có điều kiện trong cùng transaction login/link.
- Thêm `POST /v1/auth/oauth/google/challenge` cho purpose `login|link`; link bind theo user + session đang sống. Client gửi lại `challenge_id` + `binding_secret`; bật bắt buộc bằng `GOOGLE_OAUTH_REQUIRE_CHALLENGE=true` sau rollout SDK.
- Unit test challenge tạo/consume/replay/binding và login integration đã pass; migration `029` đã apply local qua `db:test:reset` (2026-09-28).
- Kiểm chứng trên Node 22.22 + PostgreSQL nhúng 16 (`langoo_test`): `npm run build`, `npm run lint`, **27 suite/213 unit**, **11 suite/116 e2e** — e2e phủ thêm ca "email trùng tài khoản khoá → 409" và "identity đã liên kết bị khoá → 403".
- Challenge không bắt client gửi lại `nonce`: khi có `challenge_id`/`binding_secret`, token nonce được đối chiếu hash với challenge trong `consume()`; nếu client vẫn gửi `nonce` thì phải khớp token.

### M2.3 — Kế hoạch sửa Google OAuth sau review (2026-09-28, còn B và rollout C)

- Kế hoạch: [m2.3-google-oauth-fixes.md](docs/plans/m2.3-google-oauth-fixes.md). A đã đổi chính sách auto-link M2.2; C đã có backend tắt mặc định; B và việc bật C còn chờ điều kiện triển khai.
- Đợt A: chặn auto-link mọi email, lỗi trùng email trả `AUTH_OAUTH_LINK_REQUIRED`; phân biệt lỗi tải khóa Google 503 với token sai 401; sửa mô tả nonce, cấu hình và regression. Không migration.
- Đợt B: xác thực email password, recovery và endpoint link có session/password/email proof; migration dự kiến 028. Đề xuất guard kiểm session để thu hồi có hiệu lực ngay; cần dịch vụ email và cập nhật client.
- Đợt C: nonce/challenge dùng một lần, có binding riêng và PostgreSQL dùng chung; backend đã sẵn sàng qua migration 029, cần SDK/client sẵn sàng trước khi bật.
- Baseline review: build/lint + 50 unit auth/config đạt; E2E chưa xác minh do DB local `127.0.0.1:55432` không hoạt động. Google client IDs local đang trống; không coi đây là chứng nhận deployment thật.
- Bổ sung 2026-09-28: DB local đã dựng lại (PostgreSQL nhúng 16, cổng 55432); migration 029 + full e2e đã chạy trên `langoo_test`.
- Tài khoản từng auto-link cần audit chỉ đọc và recovery có xác nhận; không tự unlink/xóa hoặc đánh dấu email cũ đã verified. B vẫn là tài liệu và hạ tầng email/client chưa có trong workspace.

### Data demo — sửa nghĩa sai của 走る trong seed (2026-09-28)

- Seed demo trước đây gán `走る` sense 2 = "to operate (a business)/điều hành" (để minh hoạ liên kết cấp nghĩa) — **sai với tiếng Nhật hiện đại**; nghĩa "điều hành" thuộc `経営する`, không phải `走る`.
- `seed_core_demo.py` (repo data): `走る` chỉ còn 1 nghĩa "to run"; thêm lexeme **経営する** ("to operate (a business)/điều hành"); tiếng Anh "run" dùng chung 2 nghĩa (`run-motion` ↔ 走る, `run-operate` ↔ 経営する). Sense id 1..26 giữ nguyên, lexeme từ 食べる trở đi dịch +1.
- Regenerate `db/exports/langoo-min-*`: 25 lexeme / 26 sense / 13 concept / 26 ví dụ; `db:test:reset` + full e2e xanh; cập nhật `test/dictionary.e2e-spec.ts` (eat lexeme 5), `docs/api/dictionary.md`, `CONTEXT-DU-AN.md` và README repo data.
- Cloud: đã **reset + nạp dump mới** (2026-09-28): `db:push --reset` rồi `db:migrate --upto 027` — giữ 026/027, 029 chờ rollout C. Verify trực tiếp API Render: `走る` chỉ còn "chạy", `経営する` = "điều hành" (gloss máy), cặp song ngữ đúng `走る ↔ run#1`, `経営する ↔ run#2`.
- Tooling kèm theo: `db:push --reset` (xoá 5 schema trước khi nạp) và `db:migrate --upto NNN` (rollout từng phần), commit `cef5419`.

### M10 — AI Chatbot (đã sửa sau review 2026-10-03)

- Provider trừu tượng `src/ai/providers`: `stub` mặc định (deterministic, không cần key) + `openai` (OpenAI-compatible, `AI_BASE_URL` đổi được sang gateway như OpenCode Zen `https://opencode.ai/zen/v1`); `gemini` chưa triển khai → fail-fast khi chọn; thiếu `AI_API_KEY`/`AI_CHAT_MODEL` với provider thật → app không khởi động.
- API `/v1/chat`: tạo/list/chi tiết/sửa/archive phiên (archive mềm, idempotent), lịch sử tin phân trang cursor, gửi tin (`content` ≤2.000 ký tự, `ref_sense_id` đính ngữ cảnh nghĩa từ `serve.sense_card`), `GET /v1/chat/usage`. Chat **không bắt buộc hồ sơ học** (`profile_id` nullable).
- Gửi tin: reserve quota nguyên tử trước (mặc định 50/ngày theo ngày địa phương user, vượt → `429 AI_QUOTA_EXCEEDED`), gọi provider ngoài transaction, lưu user+assistant + cập nhật `chat_session` + cộng `ai_usage` (tokens/cost) trong 1 transaction; provider lỗi → `503`, không lưu tin.
- Bản gốc dùng bảng 023; bản sửa thêm migration **037_chat_request_lease.sql** (token/expiry khóa tạm, không giữ transaction khi gọi AI). Gửi đồng thời cùng phiên trả `409 CHAT_SESSION_BUSY` trước quota; archive hủy kết quả đang chờ; kết quả quá hạn/bị thay token không được ghi. Không thêm dependency. Docs: [kế hoạch](docs/plans/m10-ai-chatbot.md) + [API chat](docs/api/chat.md).
- Đã sửa env trống, model alias, gửi đồng thời, archive race, null DTO và ngày cursor. Chuẩn bị `AI_BASE_URL=https://opencode.ai/zen/v1`, `AI_CHAT_MODEL=space-bunny-free`; đã điền key OpenCode và gọi completion thật qua Zen từ 05/10 (dùng `https://opencode.ai/zen/v1`; endpoint Go `/zen/go/v1` cần header `x-opencode-session` nên app sẽ 503 nếu dùng). Migration 037 đã áp cloud+VPS+local full. [Recheck](docs/reviews/m10-recheck-2026-10-03.md): build/lint pass, **45 suite/310 unit**, **5 suite/40 e2e liên quan**.
- Kiểm chứng local (2026-09-29, `langoo_test`): lint/build sạch, **34 suite/248 unit**, **12 suite/124 e2e** (8 kịch bản chat: phiên/tin/counter, ref sense + gloss, quota 429, archive 409, cách ly user, validation biên, usage).

### M11 — AI Quiz (đã sửa sau review 2026-10-05)

- `/v1/quizzes`: sinh quiz từ collection (MC/fill_blank/matching/mixed), lịch sử keyset, chi tiết ẩn đáp án, `start` tạo `study_session(kind='quiz')`; trả lời qua `POST /sessions/:id/answers` (thêm field `pairs` cho matching; phiên quiz trả `srs: null`).
- Generator thuần `buildQuizQuestions` (RNG injectable): difficulty quyết định số phương án MC (3/4) và K cặp matching (3/4); matching lưu `options` dạng mảng gắn `side` vì cột options buộc jsonb array (CHECK 023) — tách left/right khi start.
- Chống lạm dụng: quota riêng **15/ngày** (feature `quiz`) + cooldown **15s** + dedup cùng tham số (`reused: true`); validate nguồn và dry-run trước khi reserve → lỗi dữ liệu **không** tiêu quota.
- XP: `quiz_correct` (+5, cap 200) **chỉ khi đúng**; câu sai vẫn tính streak/activity (`xpEligible` mới ở GamificationService); replay cùng ordinal không cộng đôi.
- Kiểm chứng local 2026-09-30: lint/build sạch, **37 suite/269 unit**, **13 suite/131 e2e** (7 kịch bản quiz mới). Không migration, không dependency mới. Docs: [kế hoạch](docs/plans/m11-ai-quiz.md) + [API quizzes](docs/api/quizzes.md).
- [Review 2026-10-05](docs/reviews/m11-review-2026-10-05.md): đã sửa **6 lỗi P2** (cooldown race, dedup sai ngữ cảnh, đề đa nghĩa mơ hồ, matching index không hợp lệ, persistence kẹt generating, null DTO) và **1 điểm P3** nguồn không yêu cầu SRS. [Recheck](docs/reviews/m11-recheck-2026-10-05.md): build + ESLint file sửa pass, **45 suite/321 unit**, **2 suite/21 quiz e2e**, gồm 10 ca regression mới. Không migration/dependency mới; kiểm thử DB test local, chưa deploy VPS.

### M12 — Hardening (đã sửa sau review 2026-10-05)

- **Rate limit** (`@nestjs/throttler`): global 120/phút/IP; `register` 5/giờ; `login` 10/phút; `oauth/google*` 10/phút; `refresh` 30/phút; exception filter map `429 RATE_LIMITED`; e2e tắt bằng `RATE_LIMIT_ENABLED=false`.
- **Scheduler nội bộ** `src/common/scheduler`: tick 60s, mỗi job một transaction giữ `pg_try_advisory_xact_lock` (an toàn đa instance). Jobs: dọn `search_history` còn 50 dòng/user; `app.ensure_month_partition` trước 2 tháng; retention chat `CHAT_RETENTION_DAYS` (mặc định 180). Tắt bằng `SCHEDULER_ENABLED=false`/NODE_ENV=test.
- **Pool & ENV-01**: `DB_POOL_MAX` 10 / `DB_POOL_IDLE_TIMEOUT_MS` 30s / `DB_POOL_CONNECTION_TIMEOUT_MS` 10s dùng chung PrismaPg + pool health; boot cảnh báo nếu session TimeZone ≠ UTC; `/v1/health` trả thêm `db_timezone`; `.env.example` khuyến nghị `sslmode=verify-full`.
- **E2E tổng** `test/journey.e2e-spec.ts`: register → hồ sơ → bộ sưu tập → tra từ (ghi lịch sử) → phiên ôn (1 thẻ để tránh burying sibling) → quiz → stats/achievements.
- **Audit blacklist**: grep toàn `src` — 0 ghi vào `core/serve/public/staging`, 0 `SELECT *`.
- Kiểm chứng local 2026-09-30: lint/build sạch, **40 suite/279 unit**, **14 suite/132 e2e**. CSDL doc đã regenerate (026/027/029 vào DB full local).
- [Review 2026-10-05](docs/reviews/m12-review-2026-10-05.md): đã sửa **1 P1 + 3 P2** (IP client qua Caddy với trust proxy loopback, SQL partition đúng alias/kiểu trả về, retention giữ lease còn hạn, UTC là option cuối). [Recheck](docs/reviews/m12-recheck-2026-10-05.md): build + ESLint file sửa pass, **45 suite/327 unit**, **6 suite/48 e2e liên quan** (9 regression M12, 3 health+journey, 36 chat/SRS) pass trên DB test local. Không migration/dependency/env mới; chưa deploy VPS.

### M13 — Admin, Curation & Feedback v1 (đã sửa sau review 2026-10-05)

- Migration `030_admin_feedback.sql`: `users.role`, `feedback`, `feedback_attachment`, `admin_audit_log`.
- `AdminGuard` (JWT + đọc DB `role='admin'`/`status='active'`) cho mọi `/v1/admin/*`; user thường → `403 ADMIN_REQUIRED`; bootstrap admin bằng SQL (README).
- Thống kê aggregate-only: `GET /v1/admin/stats` (user/học tập/nội dung/AI) + `/timeseries` (signups|reviews|xp|ai_requests, ≤180 ngày, UTC); e2e kiểm tra không lộ email cá nhân.
- Feedback: multipart tối đa 3 ảnh ≤5MB (JPEG/PNG/WebP, magic bytes), lưu qua `StorageService` local (dọn tệp nếu transaction lỗi), `GET /me/feedback`; admin hàng chờ + PATCH `{status, admin_note}` + tải ảnh có guard.
- Xử lý `gloss_report` (triaged/fixed/rejected, set `resolved_at`) và khoá/mở user (không tự khoá mình/không khoá admin/không hồi sinh `deleted`), mọi mutation ghi `admin_audit_log` trong cùng transaction; `GET /v1/admin/audit-log`.
- Kiểm chứng local 2026-09-30: lint/build sạch, **45 suite/299 unit**, **16 suite/141 e2e**. Migration 030 đã apply local (test DB + DB full để regen CSDL doc); **cloud chưa apply**.
- Bootstrap **admin mock trên DB Prisma demo** (2026-10-02): tạo `admin@langoo.local` qua API register (đúng luồng thật) rồi phong quyền bằng SQL theo README; verify `GET /v1/admin/stats` trả 200. DB thật trên VPS sẽ bootstrap admin riêng khi go-live DB5 (không dùng chung tài khoản demo).
- [Review 2026-10-05](docs/reviews/m13-review-2026-10-05.md): đã sửa **6 P2 + 2 P3** (quota feedback theo user, queue giữ microsecond, row lock eligibility user, quota theo ngày địa phương, backlog SRS đủ điều kiện, cleanup partial upload, audit ghi chú trước/sau, mã lỗi multipart). [Recheck](docs/reviews/m13-recheck-2026-10-05.md): build/ESLint pass, **46 suite/340 unit**, **6 suite/48 e2e liên quan**, gồm **11 regression M13 mới**; partial write filesystem thật không còn tệp dở. Không migration/dependency/env mới; chưa deploy VPS.

### Hạ tầng — DB thật đã chuyển lên VPS (2026-10-01)

- VPS Ubuntu 22.04 (1 vCPU/2GB RAM): cài PostgreSQL 16.15, tạo role/db `langoo` (thông tin kết nối lưu ở `~/.langoo-vps.env` local — **không commit**); thêm swap 2GB, tuning theo RAM (shared_buffers 512MB, max_connections 40…), backup `pg_dump` hằng ngày 02:30 giữ 5 bản tại `/var/backups/langoo`.
- Dump local `langoo` chỉ `public+core+app+serve` (bỏ staging data, 577MB nén) → upload chia 50MB/part + verify sha256 → `pg_restore` 8m35s.
- Bổ sung schema `staging` (rỗng) + data 2 bảng nhỏ `import_batch` (16 dòng) và `jlpt_entry` (7.9k) để thoả **22 FK `core.* → staging`**; sau đó `ANALYZE` + `REFRESH serve.sense_pair`.
- Đối chiếu khớp local: lexeme 2.375.240 · sense 2.917.954 · concept 120.875 · sense_concept 577.525 · example 3.512.695 · kanji 13.108 · migrations 29 (001–027, 029, 030). Core 6.1GB (local 7.5GB do bloat chưa vacuum).
- API backend đã chuyển lên VPS: PM2 `langoo-api` (auto-start sau reboot) + Caddy reverse proxy **https://langoo-api.pixpress.art** (Let's Encrypt, tự gia hạn). DB VPS chỉ nghe `127.0.0.1:5432`, không mở ra internet.
- `.env` production tại `/opt/langoo/app/.env` (600, user `langoo`) theo file env chủ dự án: hiện trỏ **DB Prisma cloud tạm** (chốt "data thật chưa hoàn thiện"), `CORS_ORIGINS=*`, Google client ID. Bản trỏ DB thật VPS giữ ở `.env.localdb.bak` — đổi lại `DATABASE_URL`/`DIRECT_URL` là về DB thật. Override thêm: `NODE_ENV=production`, `LOG_LEVEL=info`, `STORAGE_DIR=/opt/langoo/storage`.
- Auto-deploy: push `main` → CI xanh → `.github/workflows/deploy.yml` SSH vào VPS (secrets `VPS_HOST/VPS_USER/VPS_SSH_KEY`) → `/opt/langoo/deploy.sh` (`git reset` + `npm ci` + build + `pm2 reload` + health check). Migration vẫn chạy **thủ công trước khi push**.
- **Vận hành chi tiết** (SSH, backup, migration, firewall, runbook, sự cố): [docs/ops/vps-deployment.md](docs/ops/vps-deployment.md).
- Vá vận hành 2026-10-05: cron backup thiếu cột `user` (chưa từng chạy) → đã sửa + backup tay bản `langoo-2026-10-05-0746.dump`; bật `ufw` chỉ mở 22/80/443 — port 3000 hết lộ ra internet (đã kiểm tra lại từ ngoài).
- Nợ migration 2026-10-05: **hết nợ** — 031–037 áp đủ **cloud + VPS + local full**; đã push 5 commit (M7/M8/M10 + DB docs) và auto-deploy chạy xanh. AI production chuyển từ `stub` sang OpenCode Zen `space-bunny-free`.

### DB1 — Dọn schema & chốt nguồn sự thật (đã triển khai 2026-10-01, chờ review)

- Migration `031_staging_pks.sql`: PK surrogate `id` cho `staging.wn_example`/`wn_relation` — hết bảng thiếu PK trên toàn DB. `032_curation_metadata.sql`: `concept.reviewed_by/at` + CHECK cặp; `candidate.decision_run_id` (FK `mapping_run`) + partial index rollback theo lô; COMMENT ngữ nghĩa `sense_concept.verified` (nguồn chuẩn/người duyệt), `concept.status`, `reviewed_by` (tham chiếu logic `app.users`, không FK theo bất biến core→app).
- Đã áp: **VPS** (sau backup `langoo-2026-10-01-1854.dump`; chuyển quyền schema `staging` từ `postgres` → `langoo` để một role thống nhất chạy migration), **DB full local** (override URL vì `.env` local đang trỏ `langoo_test`), **DB test** qua `db:test:reset`; **không áp cloud Prisma** (đang là DB demo).
- CI xanh `b69c78a`; `CSDL-THAM-CHIEU.md` regenerate (2.924 dòng) + đồng bộ 2 repo; CONTEXT/README cập nhật quy ước số migration (001–032, 028 để trống, số mới từ 033).

## Backlog

- **M12 — ENV-01 còn lại:** pool/boot-check đã làm ở M12 (`DB_POOL_*`, cảnh báo TimeZone, `db_timezone` trong health); còn **smoke test runtime trên cloud sau deploy** để xác nhận không drift.
- CI GitHub Actions đang chạy xanh trên mọi push (kiểm chứng 2026-09-29/30).
- `npm audit`: 4 lỗ `high` nằm trong `mysql2@3.15.3` + `deepmerge-ts` — dependency **của Prisma CLI (dev)**, không thuộc runtime API; theo dõi khi Prisma phát hành bản vá (KHÔNG chạy `npm audit fix --force` vì sẽ kéo về Prisma 6).
- `user_settings.notify` (jsonb) chưa chốt cấu trúc khoá — M9 tạm gác nên vẫn để ngỏ.
- **M10 AI — backlog:** streaming (SSE) cho trả lời dài; nén `summary` khi hội thoại dài; adapter Gemini riêng (hiện dùng gateway OpenAI-compatible); idempotency tin nhắn khi retry mạng; retention chat 6 tháng (dọn định kỳ); bảng giá token để `cost_usd` thật thay vì 0.
- **M11 AI Quiz — backlog:** adapter LLM thật cho quiz (JSON mode + prompt tuning); AI giải thích đáp án từng câu; matching cho phiên review M7; siết `question_count` theo số từ nguồn nếu cần.
- **M13 v2 — Curation (M14 dự kiến):** duyệt gloss/concept (`reviewed_by`), quản lý deck — **ghi vào schema `core`**, cần ngoại lệ blacklist + audit riêng + ma trận quyền.
- **M13 — Storage S3/R2:** adapter thật cho `StorageService` khi có key (Render disk ephemeral — production cần S3); chọn `STORAGE_PROVIDER=s3` hiện fail-fast.
- **Migration cloud 029/030**: 030 đã apply cloud Prisma (2026-09-30, khôi phục sau sự cố deploy); 029 đã có từ trước. DB thật giờ nằm trên **VPS** (xem mục hạ tầng ở trên) — khi chuyển API sang VPS thì Prisma Postgres chỉ còn là demo.
- **Thống kê nâng cao:** cohort retention, dashboard chi phí AI theo ngày — sau khi có dữ liệu thật.
- **Xác thực email + recovery cho tài khoản password** — đề xuất đưa lên đợt B của [M2.3](docs/plans/m2.3-google-oauth-fixes.md) thay vì đợi M12; cần dịch vụ email/client và migration được duyệt, chưa triển khai.
- **Nonce OAuth dùng một lần** — backend challenge đã có ở đợt C của M2.3 nhưng tắt mặc định; cần apply migration 029 và hỗ trợ SDK/client trước khi bật.
- **Apple Sign In** — bắt buộc cho iOS App Store nếu app có social login khác; dùng lại hạ tầng session tách ở M2.2.
- Unlink identity + liệt kê identity trong `GET /auth/me` (chưa cần cho MVP).
- Production: bổ sung `pg_trgm` + `unaccent` để tra không dấu/giống âm (CONTEXT §13).
- **M6/M6.1 đã đạt audit local sau khi sửa** — xem [báo cáo kiểm tra lại](docs/reviews/m6-recheck-2026-09-29.md). Migration 026/027 đã có trên cloud, xác minh chỉ đọc; kiểm thử runtime/pool thuộc M12.

### M4.1 — vá theo review độc lập (đã hoàn tất 2026-09-27)

Đã kiểm chứng trên code + `langoo_test` + server thật (2026-09-27):

1. **[P1]** Thiếu đường nối search→nghĩa: search trả `lexeme_id`, không có endpoint lấy sense theo lexeme. `q=eat` → `lexeme_id:"4"` nhưng `/senses/4` là nghĩa của _run_. → cần `GET /v1/lexemes/:id/senses` (đọc `serve.sense_card`).
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

- **M14 / DB5 (đề xuất) — Curation ghi `core`**: duyệt gloss/concept (`reviewed_by`), quản lý deck — cần chốt ngoại lệ blacklist + audit + ma trận quyền trước khi code.
- **DB3 (kế tiếp)** — seed dữ liệu nền: `radical` 214, KanjiVG, deck hệ thống, gloss tiếng Việt (ưu tiên nguồn có sẵn: 39.551 cặp Wiktionary JA–VI + Wikidata), chốt chính sách JLPT.
- **M2.3 đợt B** — xác thực email/recovery/session guard: cần chốt dịch vụ email (Brevo/Resend) + client trước khi triển khai.

## M13 — phạm vi dự kiến (chốt chi tiết khi tới M13)

**Nguyên tắc xuyên suốt:** admin chỉ xem **số liệu tổng hợp** + dữ liệu user **chủ động gửi** (gloss_report, feedback); không đọc nội dung cá nhân; debug ca cụ thể phải có user đồng ý + audit log.

Trọng tâm: **thống kê vận hành chỉ-đọc** (tổng hợp từ `app.*`, `core.*`, `serve.*`, `ai_usage`):

- **Người dùng**: đăng ký mới theo ngày/tuần, user theo `status`, tỉ lệ quay lại (`last_login_at`).
- **Học tập**: lượt ôn/ngày, XP, phân bố streak, số collection/item, quiz đã làm, backlog SRS đến hạn.
- **Nội dung**: hàng chờ `gloss_report` (open / theo `issue` / theo `target_kind`), tiến độ concept `draft→curated`, tỉ lệ gloss máy vs đã duyệt, độ phủ `serve.sense_pair`.
- **AI**: `ai_usage` (request/token/chi phí theo ngày, theo feature), số lần chạm quota.

**Feedback người dùng (gộp vào M13):**

- Bảng mới (migration 026+): `app.feedback` (id uuid v7, `user_id`, `category` bug/feature/content/other, `content`, `status` new/in_progress/resolved, `admin_note`, timestamps) + `app.feedback_attachment` (id, `feedback_id`, `storage_key`, `mime`, `size_bytes`).
- User (đăng nhập): `POST /v1/feedback` (text + tối đa 3 ảnh ≤5MB, jpeg/png/webp, kiểm magic bytes), `GET /v1/me/feedback` (xem lại + trạng thái + ghi chú admin).
- Admin: `GET /v1/admin/feedback?status=&category=`, `GET /v1/admin/feedback/:id`, `PATCH /v1/admin/feedback/:id`; xem ảnh qua route xác thực admin.
- Lưu ảnh: `StorageService` trừu tượng — `STORAGE_PROVIDER=local` (dev, thư mục `uploads/`) / `s3` (R2/S3 khi có key); đổi provider không đổi API.

Kèm (nếu bạn duyệt khi làm M13): duyệt gloss (`reviewed_by`), xử lý `gloss_report`, khoá/mở user, quản lý deck.

Yêu cầu kiến trúc: migration 026+ thêm vai admin + JWT claim + `AdminGuard`; route `/v1/admin/*`; mọi thao tác ghi `core` (nếu có) phải là ngoại lệ được duyệt và có audit.

### 2026-10-06 — M4.2 — Sửa canonical face sau smoke deploy

Commit 04112dc đã lên VPS sau CI xanh; migration 038 đã áp role langoo. Smoke live
phát hiện hashiru chọn 奔る thay lemma 走る; bổ sung canonical face rank sau literal
match, fixture variant ngắn hơn và exact variant. Cursor v3 từ chối v1/v2 để tránh
phân trang dùng face cũ. Đang kiểm/publish patch; chưa báo smoke hoàn tất.
