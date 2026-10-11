# PROGRESS — Langoo Backend

> Cập nhật lần cuối: 2026-10-11 (DB4-D2 cohort 1.000 frozen; source audit + ONNX/RRF 966 shortlist / 34 no-candidate; DB4-D4/D5 runner và D1 ACK hotfix đã commit/push `b955bfa`; bounded VPS smoke lưu đúng 1 R1 nhưng D1 invalid do Muse trả 4/5 verdict, không R2; report tổng dừng theo memory guard sau 564/966 evaluation artifact, chưa có summary; chưa shadow 1.000, apply DB hoặc deploy app; DB4-D5 audit local: 16/20 pass, 2 severe, 2 deferred/gate chưa đạt; DB4-D3 engine local, pilot 20 exact proposals/chưa apply; M4.5 JA BCCWJ/BE đã deploy VPS, còn FE/EN scope riêng; M4.5 pilot 100 EN đã chạy local, còn semantic gate/BE/FE; M4.2 / DB4-D0.2 đã deploy; M4.3/DB3-B2.1 đã deploy VPS; M7.2/M8.2 sửa follow-up review: quiz không cộng reviews_total, session một profileId + distractor theo profile; migration 034/036/037 đã áp cloud + VPS + local full (05/10, đã push); M7/M8 M7.1/M8.1 pass full local gates; DB1 dọn schema xong; backend + DB thật đã chạy trên VPS; M13 đã sửa 6 P2 + 2 P3, local pass/chưa deploy; M12 đã sửa 4 finding, local pass/chưa deploy; M11 đã sửa sau review; M9 tạm gác; M2.3 A + C backend opt-in đã triển khai, B và rollout C còn chờ; toàn bộ thay đổi local đến 10/10 đã commit/push main, xem entry DOCS1)
> Quy trình: **kế hoạch → chờ duyệt → code → báo cáo → chờ review** (PROMPT-BACKEND.md §1).
> Quy tắc agent từ 06/10/2026: [AGENTS.md](AGENTS.md). Mọi việc có mã + tên;
> mọi thay đổi code phải lưu tài liệu, kiểm tra và trạng thái Git/triển khai.

## Quy trình và tài liệu

| Mã    | Hạng mục                       | Trạng thái                                                                                     |
| ----- | ------------------------------ | ---------------------------------------------------------------------------------------------- |
| DOCS1 | Quy ước đặt mã và lưu thay đổi | ✅ đã lưu hướng dẫn agent và đồng bộ PROMPT/CONTEXT/PROGRESS ngày 06/10/2026; đã commit/push 10/10/2026 (021c07f) |

### 2026-10-06 — DOCS1 — Quy ước đặt mã và lưu thay đổi

- Chủ dự án yêu cầu mọi việc có tên/mã cụ thể; mọi thay đổi code phải lưu lại.
- Thêm `AGENTS.md`; đồng bộ `PROMPT-BACKEND.md` §1.5 và `CONTEXT-DU-AN.md` §0.
- Quy định ghi thay đổi/lý do, phạm vi, kiểm tra, gate thiếu và Git/triển khai trong repo;
  báo cáo cuối dùng cùng mã. Tài liệu có thể cập nhật trong file hiện có.
- Chuẩn hóa tên chặng hiện tại thành **DB4-D1 — Contract mapping v1**;
  `D1` trong bảng chặng DB4 là tên rút gọn khi ngữ cảnh đã rõ.
- Kiểm tra: đối chiếu các link nội bộ mới và `git diff --check`; không đổi runtime.
- Git/triển khai: chưa commit/push; không deploy.

### 2026-10-10 — DOCS1 — Ghi nhận commit/push các hạng mục đang chờ

- Theo yêu cầu chủ dự án, gom toàn bộ thay đổi local theo hạng mục và push
  `main` lượt đầu `e5d213e..8d83635`: DOCS1 `021c07f`; M6.2 `bad5633`; M10.3
  `294e385`; M11.1 `9a2d11d` (gồm phần expire quiz theo scope của M6.2);
  M10.2 `44a791d`; M10.4 `bff5175`; M10.5 `1db42a6`; M4.5 `0dba4b0` (kèm M4.5
  JA `e740ace`, `c3a0759` chờ push cùng lượt); DB4: D1 `c0aa519`, D2 `15303b6`,
  D3 `3fe3863`, D4 `7c8138f`, D5 `b0d344d` + `8d83635`; DB3 `125b0eb`.
  Entry ghi nhận này commit/push ngay sau trong cùng phiên.
- Trạng thái: code/test/docs local đã lên `main`; **chưa deploy thêm BE/FE** cho
  các hạng mục trên; gate riêng giữ nguyên (M6.2 FE/E2E, M10.4 hybrid 100,
  M10.5 apply ranking, M4.5 EN apply, DB4 semantic/apply, M11.1 model thật/UI).
  Các entry chi tiết bên dưới vẫn ghi trạng thái tại thời điểm viết.
- Kiểm tra: `npm run build` (Node 22) pass, `git diff --check` sạch trước commit.
- Git/triển khai: đã push `main`; không deploy/apply DB.

### 2026-10-11 — MERGE — Gộp nhánh `parallel/deepseek-db4` vào `main`

- Merge 44 commit của nhánh deepseek (M10.5 v2/v3 + recovery, DB3-B JA bulk,
  examples JA/EN, search guard, ví dụ Tatoeba/AI, gloss EN theo sense, ẩn ví dụ rác).
- Hòa giải 15 conflict với các luồng M4.5/M6.2/M4.3/DB4 trên main:
  - Reverse lookup theo **main**: camelCase (`viaLexemeId`, `senseHint`, `exactSense`)
    + scope hồ sơ (`StudyLanguageScopeService`).
  - Search theo main (cursor v5, `allowedLanguageIds`) + delta deepseek:
    `hits_raw` cap 5000, `SET LOCAL statement_timeout/plan_cache_mode` trong
    `$transaction`, bỏ nhánh UNION reading/romanization cho EN/VI, canonical
    MATERIALIZED (chống O(N²)), EN VI-only (`vi_rank`).
  - Giữ của deepseek: kanji components (KanjiVG), `addEnglishPreviews`, examples
    fix (`buildExampleTranslation`, câu JA đầy đủ), sense EN VI 100%, lọc ví dụ rác.
  - Scripts DB4 lấy theo main (DB4-D4/D5 tiến xa hơn).
- Kiểm tra: `npm run build`, `tsc`, jest `src/dictionary` pass sau merge.
- Git/triển khai: đã push `main` `66b7d59..5d6fc86`; chưa đổi runtime VPS trong bước này.

## Checklist milestone

| #     | Milestone                                                                 | Trạng thái                                                                                                                                                                                                                                                                                                                                                                                      |
| ----- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0    | Bootstrap & DB ops                                                        | ✅ hoàn thành (chờ review)                                                                                                                                                                                                                                                                                                                                                                      |
| M1    | Data layer (Prisma schema `app` + repository `core`/`serve`)              | ✅ hoàn thành (chờ review)                                                                                                                                                                                                                                                                                                                                                                      |
| M2    | Auth (register/login/refresh/logout/me)                                   | ✅ hoàn thành (chờ review)                                                                                                                                                                                                                                                                                                                                                                      |
| M2.1  | Auth fixes sau review                                                     | ✅ hoàn thành                                                                                                                                                                                                                                                                                                                                                                                   |
| M2.2  | Đăng nhập Google (OAuth2 ID token)                                        | ✅ hoàn thành (chờ review)                                                                                                                                                                                                                                                                                                                                                                      |
| M2.3  | Sửa Google OAuth sau review                                               | 🛠️ A + C backend opt-in đã triển khai; B và rollout C còn chờ ([kế hoạch](docs/plans/m2.3-google-oauth-fixes.md))                                                                                                                                                                                                                                                                               |
| M3    | Profile & settings                                                        | ✅ hoàn thành (chờ review)                                                                                                                                                                                                                                                                                                                                                                      |
| M3.1  | Profile & settings fixes sau review                                       | ✅ hoàn thành                                                                                                                                                                                                                                                                                                                                                                                   |
| M4    | Dictionary (đọc)                                                          | ✅ hoàn tất M4.1: nối lexeme→sense, cursor, romaji và hardening input                                                                                                                                                                                                                                                                                                                           |
| M4.2  | Search một lexeme một hit và bảo toàn nghĩa đa nguồn                      | ✅ commits04112dc/d861390 đã push/CI deploy VPS, migration038 đã áp; cursor v3/canonical face giữ trong M4.3; [report](docs/reviews/m4-2-db4-d0-2-deploy-2026-10-06.md)                                                                                                                                                                                                                         |
| M4.3  | Nhóm nghĩa Wiktextract và bảo toàn sense                                  | ✅ 9a52b68 + DB3-B2.1f700658 đã push/deploy;039 đã áp;354 unit/207 E2E/31 DB3 tests,46 live checks pass; FE render con còn chờ; [report](docs/reviews/m4-3-subsense-integration-2026-10-06.md)                                                                                                                                                                                                  |
| M4.5  | Xếp hạng nghĩa ưu tiên khi tra từ                                         | JA BCCWJ **66.041 profiles đã deploy VPS**, final 7/55 + HTTP pass; [report](docs/reviews/m4.5-ja-bccwj-deploy-2026-10-08.md). EN artifacts riêng, chưa apply trong lượt này; còn FE consume; đã commit/push 10/10 (e740ace, c3a0759, 0dba4b0)                                                                                                                                                                                  |
| M5    | Collections                                                               | ✅ hoàn thành cùng M5.1                                                                                                                                                                                                                                                                                                                                                                         |
| M5.1  | Collections fixes sau review                                              | ✅ hoàn thành                                                                                                                                                                                                                                                                                                                                                                                   |
| M6    | SRS                                                                       | ✅ hoàn tất sau M6.1; audit lại 30/30 ca pass ([báo cáo](docs/reviews/m6-recheck-2026-09-29.md))                                                                                                                                                                                                                                                                                                |
| M6.1  | SRS fixes sau review                                                      | ✅ đã sửa 14 phát hiện + ENV-01; audit 30/30 pass; **cloud đã có 026/027**                                                                                                                                                                                                                                                                                                                      |
| M7    | Review modes & sessions                                                   | ✅ M7.1 + M7.2 đã sửa (profile xuyên suốt, distractor theo profile); build/lint/unit/e2e local pass; migration 034 đã áp cloud+VPS+local (05/10) ([kế hoạch](docs/plans/m7-m8-fixes.md), [recheck](docs/reviews/m7-m8-recheck-2026-10-02.md))                                                                                                                                                   |
| M8    | Gamification                                                              | ✅ M8.1 + M8.2 đã sửa (achievement quiz cùng transaction; `reviews_total`/`reviews_1000` chỉ tính SRS, migration 036); migration 034/036 đã áp cloud+VPS+local (05/10) ([kế hoạch](docs/plans/m7-m8-fixes.md), [recheck](docs/reviews/m7-m8-recheck-2026-10-02.md))                                                                                                                             |
| M9    | Reminders                                                                 | ⏸️ tạm gác (chủ dự án chốt 2026-09-29; bảng `app.reminder`/`notification_log` giữ nguyên)                                                                                                                                                                                                                                                                                                       |
| M10   | AI Chatbot                                                                | ✅ đã sửa 6 finding sau review; chuẩn bị OpenCode Zen free; migration 037 đã áp cloud+VPS+local (05/10); AI production chạy Groq `openai/gpt-oss-120b` (từ 05/10, ~1-2s/câu); [recheck](docs/reviews/m10-recheck-2026-10-03.md)                                                                                                                                                                 |
| M11   | AI Quiz                                                                   | ✅ đã sửa sau review 2026-10-05: 6 lỗi P2 + nguồn SRS; [recheck](docs/reviews/m11-recheck-2026-10-05.md)                                                                                                                                                                                                                                                                                        |
| M10.2 | Cấu hình Qwen cho chat và quiz                                            | Chat đã áp env/reload VPS; quiz env sẵn, runtime còn stub; 20 unit pass; đã commit/push (44a791d); [report](docs/reviews/m10.2-qwen-chat-quiz-2026-10-07.md) |
| M10.3 | Chat nhận ảnh tạm thời | Code/tests/docs đã vào main 10/10 (294e385); VPS đã apply vision; FE UI còn thiếu; [plan](docs/plans/m10.3-chat-images.md), [report](docs/reviews/m10.3-chat-images-2026-10-07.md)                                                                                                                                                                                                                                                              |
| M10.4 | Triển khai thử Muse qua browser bridge                                    | Sidecar VPS đã deploy cho job DB/nền; 15 unit local/VPS + 8/8 live fixture pass; giữ Qwen chat; chưa chạy hybrid M4.5 100; đã commit/push (bff5175); [report](docs/reviews/m10.4-muse-browser-bridge-2026-10-07.md)                                                                                                                                                                                                       |
| M10.5 | Muse native gateway và automation bulk VPS                                | Đã cài runner/service3 luồng; chuẩn bị5.000 từ/91.689 source senses,100 shard,1.211 base dispatch; 10+21+5 unit pass; resume50/50 không gọi thêm Muse; user chốt dùng Muse trực tiếp không judge; lô5k đã start/enable VPS18:18+07:00, đang chạy3 luồng; đã commit/push 10/10 (1db42a6); [bulk report](docs/reviews/m10.5-muse-bulk-2026-10-07.md), [pilot](docs/reviews/m10.5-native-three-50-2026-10-07.md) |
| M11.1 | Quiz Kanji và ngữ cảnh                                                    | ✅ backend local pass: 374 unit / 199 E2E; câu dữ liệu không gọi AI, context có reuse/validator; đã commit/push (9a2d11d); [báo cáo](docs/reviews/m11-1-kanji-quiz-2026-10-06.md)                                                                                                                                                                                                                                         |
| M12   | Hardening                                                                 | ✅ đã sửa 1 P1 + 3 P2 sau review 2026-10-05; kiểm chứng local pass, chưa deploy VPS; [recheck](docs/reviews/m12-recheck-2026-10-05.md)                                                                                                                                                                                                                                                          |
| M13   | Admin, Curation & Feedback (thống kê + duyệt nội dung + hộp thư feedback) | ✅ đã sửa 6 P2 + 2 P3 sau review 2026-10-05; local pass, chưa deploy VPS; [recheck](docs/reviews/m13-recheck-2026-10-05.md)                                                                                                                                                                                                                                                                     |

## Lộ trình DB (chốt 2026-10-01 — "thiết kế nốt cái DB")

| #      | Phase                              | Nội dung                                                                                                                                                             | Trạng thái                                                                                                                                                                                                        |
| ------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DB1    | Dọn schema & chốt nguồn sự thật    | PK staging còn thiếu; metadata curation (`concept.reviewed_by/at`, `candidate.decision_run_id` + index); COMMENT ngữ nghĩa; regenerate CSDL doc; sửa tài liệu sai số | ✅ đã triển khai ([kế hoạch](docs/plans/db1-schema-cleanup.md))                                                                                                                                                   |
| DB2    | Hạ tầng tìm kiếm                   | `pg_trgm` + 4 GIN trigram (033); `core.bigrams` + 4 GIN bigram (035); query 3 nhánh UNION dùng index; benchmark VPS `走る` 7,7s → 0,11s                              | ✅ đã triển khai ([kế hoạch](docs/plans/db2-search-infra.md))                                                                                                                                                     |
| DB3    | Seed dữ liệu nền                   | `radical` 214; KanjiVG → `media_asset`/`kanji_media`; deck hệ thống; gloss tiếng Việt cấp sense/concept; chốt chính sách JLPT; audit `/credits`                      | 📋                                                                                                                                                                                                                |
| DB4    | Hoàn tất mapping sense↔concept | Candidate generation, scoring, LLM review, audit, apply/rollback và serving | 📋 D1 hoàn tất; D2 code đã push, cohort N1–N5 đã freeze VPS (15.245 → 1.000, 200/800, 10 shard); D4/D5 quality gate chưa đạt; D0, D6/D7 còn chờ |
| DB5    | Curation + serve + go-live DB thật | Quy trình duyệt concept/gloss; refresh `serve.sense_pair`; giao M14 (admin ghi `core`); kiểm readiness DB thật                                                       | 📋 curation/serving còn chờ; API VPS đã đọc DB thật (xác minh 06/10), chưa đồng nghĩa DB5 đạt gate                                                                                                                |
| DB4-D1 | Contract mapping v1                | Schema/validator/hash/state/CLI, fixtures, spec và handoff cho D2/D4                                                                                                 | ✅ code xong local: 30/30 tests, TypeScript/lint/format pass; [spec](docs/plans/db4-schema-v1.md), [handoff](docs/handoff/db4-d1.md); đã commit/push 10/10 (c0aa519); còn tích hợp consumer review                 |
| DB4-D2 | Mapping nguồn đã xác minh và chọn candidate bằng MiniLM | READ ONLY export, source audit, ONNX CPU/cache, hybrid lexical-MiniLM RRF, cohort/sampling và D1 artifacts | 🟡 `0208649` + `b74268d` đã commit/push; cohort 1.000: raw audit JMdict/OEWN/OMW EN/JA 0 mismatch, Wiktextract blocked; RRF 966 có shortlist / 34 no-candidate, 4.830 candidates. Semantic quality chưa đo; D4 transport smoke đã lưu 1 response nhưng D1 invalid; chưa apply/deploy. [review retrieval](docs/reviews/db4-d2-cohort-retrieval-2026-10-10.md), [plan](docs/plans/db4-d2-source-minilm-retrieval.md), [handoff](docs/handoff/db4-d2-source-minilm-retrieval-2026-10-08.md) |
| DB4-D3 | Bộ quyết định mapping tự động | Pure consensus policy, Muse adapter, generation/raw-response binding, immutable rerun | ✅ engine đã kiểm local: 55/55 DB4 tests, TS/lint pass; 100 target → 20 exact proposals, 44 deferred, 4 all-none, 1 incomplete, 31 no-candidate; [plan](docs/plans/db4-d3-auto-decisions.md), [report](docs/reviews/db4-d3-auto-decisions-2026-10-10.md); đã commit/push 10/10 (3fe3863); chưa apply/deploy, còn D5–D7 |
| DB4-D4 | Prompt chọn candidate theo đầy đủ nghĩa của sense | Conditional R2 + [batch plan](docs/plans/db4-d4-d5-automated-batch-rollout.md), [runner review](docs/reviews/db4-d4-d5-batch-runner-2026-10-10.md), [v2.1 offline review](docs/reviews/db4-d4-prompt-v2.1-2026-10-10.md) | 🟡 `b955bfa` đã push; một R1 ACK/lưu response 5.203 byte sau 36,138 giây; D1 replay invalid vì Muse trả 4/5 verdict; 965 pending, R2 không đủ điều kiện. Final report incomplete do memory pressure (564/966 evaluation artifacts, không có summary). Không retry R1; chưa shadow 1.000, expansion/repair, Pilot A/B, apply/deploy |
| DB4-D5 | Audit chất lượng proposal exact | Hash-bound AI audit đủ 20 proposal; replay nguồn D3, lọc pass, report bất biến | 🟡 16 pass / 2 severe / 2 deferred; 65/65 DB4 tests, TS/lint pass; [plan](docs/plans/db4-d5-proposal-audit.md), [report](docs/reviews/db4-d5-proposal-audit-2026-10-10.md); gate chưa đạt, chưa audit 100 target/Pilot B; đã commit/push 10/10 (b0d344d, 8d83635); chưa apply/deploy |

### 2026-10-10 — DB4-D4/D5 — Mapping tự động theo batch có checkpoint

- Theo yêu cầu lên plan triển khai siêu chi tiết, lưu
  [plan batch rollout](docs/plans/db4-d4-d5-automated-batch-rollout.md): đợt đầu
  1.000 sense / 10 shard mục tiêu 100 sense, 8 worker toàn account; lexical +
  MiniLM, prompt v2.1 dự kiến, conditional R2, một expansion và một format
  repair/sense, caps mapping/audit riêng, checkpoint/resume/systemd VPS.
- Chỉ sửa tài liệu: plan mới và liên kết master DB4/D4 v2/D5/PROGRESS. D1 giữ
  nguyên; conditional R2 cần orchestration adapter mới vì D3 v1 yêu cầu hai
  phase/bundle và tối đa 500 targets/generation, 64 MiB/file.
- Không cần chủ dự án duyệt từng row; AI audit ghi reviewerKind=llm. Pilot A/B,
  confidence/curation, D6 journal/rollback và D7 exact-only/stale-safe serving
  vẫn là gate riêng; không ép unresolved thành match hoặc fabricate confidence.
- Kiểm tra tài liệu: Prettier plan mới pass; 37 link file nội bộ của bốn plan
  tồn tại; scoped diff-check/whitespace file mới sạch. Global `git diff --check`
  còn trailing whitespace có sẵn ở FE handoff dòng 3 của phiên khác, giữ nguyên.
  Không chạy code tests, gọi Muse, mở job hoặc sửa DB trong lượt này.
- Git / triển khai: plan và conditional-R2 foundation `406c8b2` đã push;
  rollout chưa deploy/apply VPS; durable runner, Muse shadow và D6/D7 còn chờ.

### 2026-10-10 — DB4-D3/D4 — Contract batch và conditional R2 foundation

- Bắt đầu triển khai theo batch plan: thêm `_batch-types.ts` cho manifest/schedule/
  job key/event hash chain/target status; `muse-batch-decide.ts` chỉ gọi pure D3
  sau R1 duy nhất exact không unresolved và R2 hợp lệ. R2 skip không tạo consensus.
- Kiểm tra: `npx tsc -p tsconfig.db4.json --noEmit`, ESLint scoped, Prettier và
  toàn bộ DB4 TypeScript suite 77/77 pass (8 tests mới cho conditional R2/event
  chain); code chưa gọi provider/DB.
- [Review foundation và gate còn thiếu](docs/reviews/db4-d4-d5-batch-foundation-2026-10-10.md).
  DB4-D2 cohort/source audit/RRF đã chạy; atomic persistence, runner/waves/
  recovery, full crash matrix, audit coordinator và DB4-D6/D7 vẫn còn thiếu.
- Git / triển khai: code/test/plan/review commit `406c8b2` đã push; không deploy/apply.

### 2026-10-10 — DB4-D4 — Prompt semantic match v2.1 và version-safe repair

- Theo bằng chứng D5 sample30, thêm rule hẹp cho possessive/reference, không suy
  abbreviation/composition và chỉ dùng witness được source/concept hỗ trợ; giữ
  bytes v1/v2. Thêm selector v2.1, version parser, repair một lần/bundle theo
  revision và validator output theo đúng thư mục revision.
- File/phạm vi: prompt v2.1 (3 file), `muse-prompt-version.ts`, prepare/repair/
  validate DB4, regression tests; cập nhật batch plan và [review](docs/reviews/db4-d4-prompt-v2.1-2026-10-10.md).
- Kiểm tra: `npx tsc -p tsconfig.db4.json --noEmit`, ESLint/Prettier scoped pass;
  `node --import tsx --test scripts/db4/*.test.ts` — 80/80 pass. Synthetic
  prepare → one repair → validate qua cả folder `v2.1`; không gọi Muse.
- Gate còn thiếu: durable runner/recovery + technical smoke trước mọi dispatch;
  semantic quality chưa đo; DB4-D5/D6/D7 chưa đạt. Không apply DB/deploy.
- Git / triển khai: commit `379ba5f` đã push lên `origin/main`; không deploy/apply.
  FE handoff và D5 repeat WIP ngoài phạm vi này vẫn local, unstaged.

### 2026-10-10 — DB4-D2 — Hybrid lexical-MiniLM retrieval bằng RRF

- Theo lựa chọn RRF của chủ dự án, thêm method version
  `db4-d2-hybrid-rrf-v1`: mỗi EN gloss và query tổng tạo lexical/MiniLM lanes;
  top 30/lane, exact-label boost + token overlap, RRF `k=60`, pool cap 100,
  tối đa 5 candidates. D1 shape giữ nguyên; `rankScore` lưu normalized RRF,
  cosine/lexical/rank/coverage giữ trong `features`, không phải xác suất.
- Cache/artifact nhận version mới; kết quả `db4-d2-minilm-v1` cũ không bị sửa.
  Code/docs: `scripts/db4/mapping_minilm.py`, `scripts/db4/_retrieval.ts`, D2
  plan/handoff; [review](docs/reviews/db4-d2-hybrid-rrf-2026-10-10.md).
- Kiểm tra tĩnh: `npx tsc -p tsconfig.db4.json --noEmit`, ESLint scoped,
  Python `py_compile`/Black và Prettier scoped pass. Global `git diff --check`
  chỉ vấp trailing whitespace có sẵn ở FE handoff dòng 3; scoped `git diff --check`
  trên file thuộc thay đổi này pass. Test suite/ONNX cohort/Muse/DB chưa chạy.
- Tại thời điểm ghi entry này split còn chờ chốt; follow-up phía dưới đã chốt
  200/800 và thêm selector code. Chưa benchmark chất lượng/thời gian RRF trên
  corpus, chưa commit/push/deploy/apply.

### 2026-10-10 — DB4-D2 — Preflight cohort JLPT N1–N5

- Đếm READ ONLY qua SSH trên VPS trong transaction repeatable-read/read-only:
  15.245 JMdict senses accepted N1–N5; các mức N1–N5: 4.334/2.705/4.611/1.613/
  1.982. Cả 15.245 đều có ≥1 EN gloss; 1.784 có field/info/domain; exact link
  hiện có bằng 0. POS: noun 8.790, verb 4.072, adjective 1.353, adverb 603,
  expression 113, pronoun 84, interjection 69, conjunction 63, suffix 63, prefix 35.
- Kết quả và điều kiện phải đếm lại ở [review cohort selector](docs/reviews/db4-d2-cohort-selector-2026-10-10.md).
  Query chỉ đọc số đếm; không export sense/concept, sửa DB, mở job hoặc gọi Muse.
- Git/triển khai: ghi nhận local chưa commit/push; VPS không đổi.

### 2026-10-10 — DB4-D2 — Selector cohort JLPT 200/800 lexeme-disjoint

- Thay đổi: export READ ONLY `jlpt-n1-n5` và deterministic split 200 development /
  800 holdout theo lexeme; cap 5 sense/lexeme, tối đa 100 target/shard.
- VPS export: 15.245/15.245 sense, 120.875 concept, `truncated=false`; selector
  tạo 1.000 target / 10 shard × 100. JLPT N1–N5: dev 60/39/53/21/27, holdout
  244/148/247/76/85. Không duplicate sense, không lexeme leakage, max 3
  sense/lexeme. 41/41 pilot lexeme hiện diện trong population; 7 vào sample và
  cả 7 thuộc development.
- Artifact immutable tại `/opt/langoo/storage/db4-batches/db4-d2-jlpt-n1-n5-20261010-0208649`;
  manifest `34eb02c2e6bfa865b326a57135b436e79b34b6af539b349d40d97387d26e3be6`,
  selected `8a224400f36abdbad7ae9c1eb694e6cdc530809abf67976be99bcef5c2628fd2`.
- TypeScript/ESLint/Prettier static checks pass; export/selector VPS run pass,
  database transaction READ ONLY + rollback, no Muse/ONNX/DB writes. Full artifact
  hashes and stratification are in [review](docs/reviews/db4-d2-cohort-selector-2026-10-10.md).
- Git: code/docs commit `0208649` đã push. VPS app code không deploy; source audit,
  ONNX/RRF measurement, Muse, D5/D6/D7 gates vẫn còn.
### 2026-10-10 — DB4-D5 — Audit chất lượng proposal exact

- Chấm đủ 20 exact proposals bằng source JA/EN + raw attrs và context concept,
  reviewerKind=llm (Codex), không cần người dùng duyệt từng dòng. 16 pass, 2
  fail/severe (オーバー vượt mức; どんな construction), 2 deferred do thiếu context
  scope. Tỷ lệ nhãn pass 80% trên 20 proposal, chưa là expert gold/toàn 100 target.
- Files: `scripts/db4/mapping-audit.ts`, `audit.test.ts`,
  [20 audit D1](docs/reviews/db4-d5-exact-audit-2026-10-10.jsonl),
  [context/result JSON](docs/reviews/db4-d5-proposal-audit-2026-10-10.json),
  [plan/report/handoff](docs/reviews/db4-d5-proposal-audit-2026-10-10.md).
  Replay D3/source/raw-response binding, đủ denominator, unique audit và immutable
  publication; pass giữ verified=false/calibratedScore=null. Output cũ giữ nguyên.
- Kiểm tra: 65/65 DB4 tests (10 D5), TS/lint/format, CLI thực tế + rerun,
  JSON/JSONL/link/whitespace và diff-check pass. Không test backend/DB hoặc gọi Muse.
- Gate: severe chặn promotion; còn D4 sửa scope trong version mới, audit đủ 100
  target, Pilot B/holdout/recall/budget và D6/D7. Subset 16 pass không tự cấp apply.
- Git / triển khai: code/test/docs local chưa commit/push; chưa deploy/apply VPS.

### 2026-10-10 — DB4-D5 — Lặp Muse một lượt và đối chiếu

- Theo yêu cầu chủ dự án, chạy thêm 20 request R2 của toàn bộ proposal exact,
  nguyên semantic prompt/payload/seed/order; fresh side-chat, không gửi audit hoặc
  verdict trước. 8 worker trên VPS, cap 20 dispatch, timeout 600s, không tự resend.
- Code freeze/replay và compare raw/normalized: `scripts/db4/muse-repeat-prepare.ts`,
  `muse-repeat-compare.ts`, read-only `muse-review-reconcile.py`;
  [phạm vi](docs/plans/db4-d5-proposal-audit.md).
- Job systemd `langoo-db4-d5-repeat-20261010`, storage riêng
  `/opt/langoo/storage/db4-d5-repeat-20261010`; đã thu đủ 20 replies, 17 output
  validated. 15 giữ exact duy nhất, 1 narrower, 1 ambiguity, 3 lỗi output;
  67/85 candidate relations giống R2 trước. どんな vẫn trùng audit severe.
- Hai reply thiếu candidate đã completed nhưng runner còn polling; thu hồi
  history, 0 dispatch thêm, dừng unit sau durable capture. 18 reply sau 92,76s;
  capture đủ 20 sau 441,63s gồm vận hành/thu hồi, không là generation time thuần.
  [Report + kết quả JSON đủ 20](docs/reviews/db4-d5-muse-repeat-2026-10-10.md).
- Kiểm tra: 65/65 DB4 tests, TS/lint/format/Python syntax, D1 adapter/compare
  thực tế + rerun/hash đối chiếu VPS, JSON/link/whitespace/diff-check pass.
  Không có unit riêng reconciler; chưa có expert gold hoặc full pilot gate.
- Git / triển khai: code/docs local chưa commit/push; chỉ chạy job VPS,
  không deploy backend hoặc apply DB. Các gate D5–D7 giữ nguyên.

### 2026-10-10 — DB4-D3 — Bộ quyết định mapping tự động

- Code pure consensus theo D1: exact duy nhất ở cả hai phase, đầy đủ branch/
  không conflict/unresolved; nonexact là proposal riêng; incomplete không tạo
  decision/hash giả. Không bắt người vận hành duyệt từng mapping.
- CLI verify generation/source proofs/prompt renders/raw response/normalized
  outputs/counts; immutable cùng-input rerun, không đọc ENV/provider/DB.
  Bound 500 target/generation, 64 MiB/file; giữ target không có bundle trong report.
- Thêm parser theo bundle dùng chung D1 decision checker để giảm validation lặp;
  shape D1 không đổi, context private không bị caller mutate. Request payload kiểm
  từng dòng rồi chỉ giữ binding metadata để giảm bộ nhớ.
- Pilot local: 100 retrieval targets = 20 exact proposals + 44 deferred + 4 all-none
  shortlist + 1 incomplete + 31 no-candidate. 340 pair decisions = 20 exact,
  94 nonexact, 94 reject_pair, 132 defer. Đây không là precision hoặc DB accepted.
- Code: `_decisions.ts`, `muse-review-decide.ts`, supporting `_mapping-types.ts`,
  `decisions.test.ts`. [Plan/CLI](docs/plans/db4-d3-auto-decisions.md),
  [report/artifact](docs/reviews/db4-d3-auto-decisions-2026-10-10.md), consumer D1
  handoff/D4/DB4 tổng đã đồng bộ.
- Kiểm tra: 55/55 Node DB4 tests (14 D3/30 D1/11 D2), TypeScript/scoped ESLint
  pass; CLI final local 21,24s/~435 MiB peak RSS, rerun cùng hash. Prettier,
  161 link nội bộ, tracked/untracked whitespace và diff-check pass. D5 quality/
  D6 apply+journal/D7 serving và VPS
  orchestration còn thiếu; chưa làm lexical calibration/scorer mới hoặc tuyên bố
  production auto-apply sẵn sàng.
- Git/triển khai: code/test/docs local chưa commit/push; không gọi thêm Muse,
  không import/promote DB hoặc deploy app/VPS; giữ thay đổi milestone khác.

### 2026-10-10 — DB4-D4 — Chốt quyết định mapping tự động không cần người duyệt

- Theo yêu cầu chủ dự án: toàn luồng chạy tự động, không cần người vận hành duyệt
  từng mapping hoặc cung cấp thêm provider. Muse R1/R2 + code quyết định exact;
  ambiguity/thiếu context tự defer/retrieval có cap, hết cap giữ unresolved.
- Đối chiếu D1: link máy không `verified=true`/curator; exact cần cùng một candidate
  duy nhất ở hai phase, đầy đủ branch, không conflict/unresolved. D6/D7 còn phải
  triển khai preflight/apply/journal/serving, chưa chạy tự động production.
- Read-only aggregate final local: 69 bundle = 20 đạt điều kiện exact tối thiểu,
  4 cùng all-none shortlist, 44 chưa đủ rule accept, 1 thiếu phase hợp lệ.
  Không phải precision hoặc 20 mapping đã đúng/đã apply. 31 no-candidate D2 riêng.
- Sửa diễn giải 0/68: comparator tính cả thứ tự/lời giải thích nên không phải
  candidate-choice disagreement và không được dùng làm gate semantic.
- [Plan tự động](docs/plans/db4-d4-semantic-match-prompt-v1.md),
  [plan DB4 tổng](docs/plans/db4-sense-concept-mapping.md),
  [report](docs/reviews/db4-d4-muse-pilot-2026-10-08.md).
- Kiểm tra: đọc validator/decision parser, recompute aggregate; 143 link nội bộ,
  `git diff --check` và whitespace tài liệu mới pass. Chỉ docs, chưa code D3
  hoặc chứng minh accuracy.
- Git/triển khai: local chưa commit/push; không gọi Muse/apply DB/deploy VPS.

### 2026-10-08 — DB4-D4 — Prompt chọn candidate theo đầy đủ nghĩa của sense

- Tạo system prompt và phase R1/R2 trong `docs/prompts/`, dùng toàn gloss cùng
  metadata, definition target và kiểm scope theo hai chiều. Giữ nhãn exact,
  broader/narrower/related/none/uncertain, không ép chọn top candidate.
- Output đúng D1: review mọi candidate, coverage row keys, conflict evidence refs,
  echo hash/IDs, confidence null, all-none/ambiguity rules. R2 không nhận R1 verdict.
- [Prompt và hướng dẫn](docs/plans/db4-d4-semantic-match-prompt-v1.md) có cách ghép
  message, version/hash, sample scope và gate. Đồng bộ consumer handoff D1/D2.
- Kiểm tra: đối chiếu schema/parser/direction, JSON template syntax/keys, link,
  whitespace/diff và working tree. Chỉ prompt/tài liệu; chưa gọi model hay chạy DB.
- Gate còn thiếu: D4 runner nạp prompt/provider/ledger, semantic pilot D5 để đo
  false exact/recall/branch coverage; prompt chưa chứng minh accuracy.
- Git/triển khai: lưu local chưa commit/push/deploy/apply.

### 2026-10-08 — DB4-D4 — Muse pilot 8 luồng, repair output thiếu candidate

- Frozen prompt/request set: 69 bundle, R1/R2, 138 request. Lượt đầu phát hiện
  Noise giới hạn 65.535 byte; thêm chunk 48 KiB và xác minh transport bằng request
  `chat.history` lớn chỉ đọc. Runner sửa để đợi output cuối thay vì HTTP ACK.
- Run3 gửi 123 request chưa gửi ở 8 worker, hoàn tất sau 22:06. D1 validator chấp
  nhận 123/138 output; 13 phản hồi hoàn tất nhưng thiếu một candidate review, 2
  output khác thiếu field hoặc sai thứ tự. Run2 có 15 output đã thu hồi, D1 pass.
- Run4 repair đúng 15 request bằng prompt reminder có version/hash riêng, 8 worker,
  timeout 600s; 14/15 pass D1. Output còn lại vẫn thiếu candidate thứ năm như lần
  đầu; giữ unresolved, không repair lần hai. Final ledger ở
  `/opt/langoo/storage/db4-d4-muse-20261008/final/`.
- D1 chấp nhận 137/138; 68 bundle có đủ hai phase. Full-output agreement 0/68;
  candidate relation 266/340, exactness 331/340, coverage 314/340 đồng ý. Đây là
  consistency signal cùng model, chưa chứng minh semantic accuracy.
- Chưa apply DB, không deploy app.
- Files: `scripts/db4/muse-review-runner.py`,
  `scripts/db4/muse-review-prepare-repairs.ts`, `scripts/db4/muse-review-validate.ts`,
  [plan](docs/plans/db4-d4-semantic-match-prompt-v1.md),
  [report](docs/reviews/db4-d4-muse-pilot-2026-10-08.md).
- Kiểm tra: Python `py_compile`, TypeScript DB4, scoped ESLint, diff-check,
  chunk transport read-only, D1 validation 15/15 thu hồi ban đầu, 123/138 ledger,
  14/15 repair và 137/138 final ledger.
- Git/triển khai: thay đổi lưu local, chưa commit/push; không deploy/apply.

### 2026-10-08 — DB4-D2 — Mapping nguồn đã xác minh và chọn candidate bằng MiniLM

- Theo yêu cầu trực tiếp, triển khai adapter export → audit → retrieval → generation
  trong `scripts/db4`: giữ đủ EN gloss/POS/restrictions/source/batch; dùng nguồn
  WordNet/JMdict gốc đã đối chiếu. Direct identity tách riêng, không auto-accept.
- READ ONLY export từ VPS: 100 sense / 41 lexeme JLPT accepted N5/N4, toàn pool
  120.875 concept. Audit scoped pass JMdict/OEWN/OMW EN/JA; Wiktextract blocked.
- MiniLM ONNX local không gọi LLM: cold 1.323,738s / 673,97 MiB, warm 51,315s /
  396,92 MiB, hits giống nhau; xuất 345 candidate / 69 bundle, giữ 31 no-candidate
  status do POS ngoài WordNet. Không coi ready hoặc top 1 là mapping semantic đúng.
- Kiểm tra: TypeScript, ESLint scope pass; 41 Node tests (30 D1 + 11 D2), 15 Python
  tests pass; py_compile/Black, real export/audit/ONNX/generation pass. Kiểm
  format/link/diff và working tree cuối lượt; không chạy app E2E/runtime.
- Lưu [plan](docs/plans/db4-d2-source-minilm-retrieval.md),
  [review + metric/mẫu](docs/reviews/db4-d2-source-minilm-retrieval-2026-10-08.md),
  [handoff/ENV/CLI](docs/handoff/db4-d2-source-minilm-retrieval-2026-10-08.md).
  Giữ parser orchestration/contract D1; adapter CLI riêng `retrieval-*`.
- Gate còn thiếu: full/legacy source audit, Wiktextract adapter, gold recall@5,
  D4 R1/R2 semantic review, D5 pilot/calibration và D6/D7 apply/serving.
- Git/triển khai: code/test/docs local chưa commit/push; VPS chỉ exporter trong
  thư mục `/tmp` riêng, không deploy app/cài ONNX/ghi DB; không gom WIP khác.

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
| 2026-09-30 | **M11 AI Quiz**: nguồn từ vựng gồm mọi `srs_state` (**kể cả `new`**), ưu tiên `review → relearning → learning → new`; 3 loại câu hỏi + mixed (MC/fill_blank/matching); matching chấm all-or-nothing                                                                                                                                        | Chủ dự án chốt (câu hỏi đa dạng, dùng cả từ mới)                                                                     |
| 2026-09-30 | M11 provider **stub deterministic** (kể cả khi `AI_PROVIDER` là provider thật — có log cảnh báo); adapter LLM thật + AI giải thích đáp án để backlog                                                                                                                                                                                       | Tránh tốn token khi chưa cần                                                                                         |
| 2026-09-30 | M11 chống lạm dụng: quota **15 quiz/ngày** (`AI_QUIZ_DAILY_LIMIT`), cooldown **15s** + dedup cùng tham số (`AI_QUIZ_COOLDOWN_MS`); validate nguồn + dry-run trước khi reserve quota                                                                                                                                                        | Chủ dự án lo người dùng lạm dụng sinh quiz tốn token                                                                 |
| 2026-09-30 | M11 XP: chỉ câu đúng cộng `quiz_correct` (+5); mọi câu vẫn cập nhật streak/user_stats qua `xpEligible` mới của GamificationService; phiên quiz trả `srs: null`                                                                                                                                                                             | Chủ dự án chốt                                                                                                       |
| 2026-09-30 | **M12 rate limit**: `@nestjs/throttler` (in-memory) — global 120/phút/IP; login 10/phút; register 5/giờ; oauth 10/phút; refresh 30/phút; lỗi `429 RATE_LIMITED`; e2e tự tắt bằng `RATE_LIMIT_ENABLED=false`                                                                                                                                | Chủ dự án duyệt (D1)                                                                                                 |
| 2026-09-30 | **M12 scheduler nội bộ** (không thêm dependency): tick 60s + advisory lock từng job; dọn `search_history` còn 50/user, tạo partition `review_log` trước 2 tháng, retention chat 180 ngày                                                                                                                                                   | Duyệt D2/D6                                                                                                          |
| 2026-09-30 | **M12 pool & ENV-01**: `DB_POOL_MAX/IDLE_TIMEOUT/CONNECTION_TIMEOUT` dùng chung PrismaPg + health pool; boot cảnh báo lệch TimeZone; `/v1/health` thêm `db_timezone`; khuyến nghị `sslmode=verify-full`                                                                                                                                    | Duyệt D3/D4                                                                                                          |
| 2026-09-30 | **M13 vai admin**: cột `users.role` + `AdminGuard` đọc DB mỗi request (thu hồi quyền hiệu lực ngay); bootstrap bằng SQL, không có endpoint tự phong                                                                                                                                                                                        | Duyệt D1                                                                                                             |
| 2026-09-30 | **M13 phạm vi**: KHÔNG ghi `core` (duyệt gloss/concept/deck tách M14); v1 = thống kê aggregate + feedback text/ảnh + gloss_report + khoá/mở user + audit log                                                                                                                                                                               | Duyệt D2                                                                                                             |
| 2026-09-30 | **M13 storage**: `StorageService` trừu tượng — `local` thật (STORAGE_DIR, gitignore); adapter s3/R2 để backlog (chọn `s3` sẽ fail-fast)                                                                                                                                                                                                    | Duyệt D3                                                                                                             |
| 2026-09-30 | **M13 audit**: bảng `app.admin_audit_log`, ghi cùng transaction mọi mutation admin; feedback giới hạn 10 lần/giờ/user + 3 ảnh ≤5MB (magic bytes)                                                                                                                                                                                           | Duyệt D6/D7                                                                                                          |
| 2026-10-03 | **M8.2 bộ đếm quiz**: quiz tính `streak_day`/`met_goal`/XP nhưng `user_stats.reviews_total` và achievement `reviews_1000` **chỉ tính lượt ôn SRS**; migration `036` rebuild `reviews_total` từ `review_log`                                                                                                                                | Chủ dự án chốt: tên "review" chỉ mô tả lượt ôn SRS                                                                   |
| 2026-10-03 | **M7.2 session profile & distractor**: `collectDueRows` nhận profile đã resolve (một `profile_id` xuyên suốt); distractor lọc theo `profile_id` và ưu tiên collection trong SQL trước `LIMIT`                                                                                                                                              | Sửa follow-up review M7/M8; tránh session lẫn thẻ/đáp án profile khác                                                |
| 2026-10-05 | **JLPT nguồn chuẩn = `jlpt_link`** (KANJIDIC2 + JLPT list, có provenance `(source_level, source_row_number)`); `lexeme_level` chỉ giữ tham chiếu, không dùng để ghi đè                                                                                                                                                                     | Chủ dự án chốt (chuẩn bị DB3)                                                                                        |
| 2026-10-05 | **LLM cho dữ liệu = OpenCode Zen `space-bunny-free`** (`AI_BASE_URL=https://opencode.ai/zen/v1`), chạy theo lô nhỏ + checkpoint vì hạn mức free; dùng cho dịch gloss VI/radical và về sau là DB4                                                                                                                                           | Chủ dự án chốt                                                                                                       |
| 2026-10-05 | **AI production (chat) đổi sang Groq `openai/gpt-oss-120b`** (`https://api.groq.com/openai/v1`, free tier 30 RPM/1.000 req-ngày; đo ~0,6–2,2s/câu, streaming OK). Zen free còn `space-bunny-free` quá chậm (6–22s, có lúc rỗng); model Zen khác bị 403/402. Giữ Zen/Gemini làm dự phòng                                                    | Chủ dự án chốt sau khi đo                                                                                            |
| 2026-10-06 | **Hủy DB3-C** (tra gloss VI có/không dấu); gỡ kế hoạch C. Phạm vi DB3 gồm DB3-A và DB3-B, tiếp theo là DB4 mapping sense ↔ concept                                                                                                                                                                                                         | Chủ dự án chốt                                                                                                       |

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

### 2026-10-08 — M6.2 — Phạm vi ngôn ngữ hồ sơ và hàng đợi SRS

- Audit BE/bundle FE/VPS: không thiếu SRS; FE bỏ cursor, sibling chiếm trang/cap; hai item EN trong hồ sơ JA bị loại khỏi queue nhưng collection vẫn hiện.
- Yêu cầu sản phẩm bổ sung: JA+EN thấy/lưu cả hai; đổi sang đơn ngữ ẩn từ/face còn lại, giữ nguyên IDs/lịch ôn và hiện lại khi bật song ngữ. Bỏ phương án chặn đổi ngôn ngữ `PROFILE_LANGUAGE_IN_USE`.
- BE local: add/clone kiểm language dưới user lock; collection lọc item/face trước page, thêm `display_sense_id`/`visible_item_count`; dictionary optional Bearer scope search/suggestions/reverse/detail/links/Kanji, cursor bind scope; quiz chọn face hợp lệ, expire ready snapshot khi đổi language và chặn finalize job AI khác scope. Queue chọn đại diện new/review sibling trước quota/limit; practice lọc rồi cắt đúng limit, giữ learning độc lập. Không migration/xóa/reset dữ liệu.
- Tài liệu/API consumers: [plan M6.2](docs/plans/m6.2-srs-new-word-visibility.md), [handoff FE mới ngày 08/10](docs/handoff/fe-handoff-2026-10-08.md); collections, profiles/settings, dictionary, SRS, sessions, quizzes.
- Kiểm tra: build pass; regression 11 suite/146 test pass, sau sửa race quiz/profile có follow-up 3 suite/30 test pass; ESLint phạm vi sửa + format/diff pass; 10 truy vấn smoke VPS chỉ đọc pass. DB test local `ECONNREFUSED`, chưa E2E ghi; không chạy E2E trên production.
- Gate/Git: code/docs đã commit/push 10/10 (bad5633); chưa deploy; **FE/E2E/UI chưa nghiệm thu**. Hai item EN/profile JA giữ ở trạng thái ẩn theo policy mới; không tự chuyển hoặc xóa.

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

### M11.1 — Quiz Kanji + ngữ cảnh (06/10/2026 — đã kiểm chứng local)

- Chủ dự án đã duyệt [plan](docs/plans/m11-1-jlpt-kanji-quiz.md): `kanji_reading` / `kanji_orthography`, hỏi từ riêng lẻ hoặc trong câu nguồn/câu tự sinh quanh đúng anchor sense.
- Các câu nghĩa/nối từ/fill-blank hiện tại/Kanji mode none sinh từ dữ liệu, không gọi model. Adapter ngữ cảnh chỉ sinh/kiểm slot thiếu evidence; tái sử dụng snapshot đã kiểm trong cùng user/profile, giữ quota lượt quiz hiện tại và ghi token thực tế/estimated riêng.
- Form resolver đọc sense restrictions + kana–kanji mapping và alternate readings/spellings; 4 options cho Kanji, loại multi-correct, homophones và clue làm lộ đáp án. Hiragana/katakana tương đương được dedupe, giữ dakuten/sokuon/long vowel.
- Styles/context lưu vào `app.quiz.generator`; GET/start/snapshot có field mới, quiz cũ vẫn đọc/chấm được. Cooldown xét style set/context mode/version. Không migration/dependency mới, không ghi core từ API.
- Build/lint sạch, **48 suite / 374 unit** và **22 suite / 199 E2E** pass trên DB test local. [Báo cáo](docs/reviews/m11-1-kanji-quiz-2026-10-06.md), [API](docs/api/quizzes.md), [FE handoff](docs/handoff/quiz-kanji.md). Model ngữ cảnh kiểm bằng mock; pilot chất lượng model thật, UI và rollout VPS còn chờ.

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
- `.env` production tại `/opt/langoo/app/.env` (600, user `langoo`): **xác minh 06/10 đang trỏ DB thật `127.0.0.1:5432/langoo`**, thay trạng thái Prisma cloud tạm ghi ngày 02/10; health/search/senses live đã kiểm. Không đổi env trong lượt khảo sát. Bản `.env.localdb.bak` là cấu hình lưu trước đó. Các thiết lập ghi nhận khi setup: `CORS_ORIGINS=*`, Google client ID, `NODE_ENV=production`, `LOG_LEVEL=info`, `STORAGE_DIR=/opt/langoo/storage`.
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
- **M11 AI Quiz — backlog:** AI giải thích đáp án từng câu; matching cho phiên review M7; siết `question_count` theo số từ nguồn nếu cần. M11.1 đã bổ sung adapter sinh/kiểm ngữ cảnh Kanji; pilot model thật còn cần cấu hình và chấm chất lượng.
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

### 2026-10-06 — M4.3 — Nhóm nghĩa Wiktextract và bảo toàn sense

- Tích hợp nhánh DeepSeek `46ec612` đã merge M4.2. Commit M4.3 `9a52b68`.
- Sửa context mọi nguồn bị coi là hierarchy, rewrite definition ID đầu và lấy câu
  trung gian: guard nguồn/definition trong 039, `group_heading` riêng, giữ nghĩa lá.
- Default grouped, có `view=flat`; flatten giữ mọi ID/thứ tự/card như detail.
- FE render con/ưu tiên vài nghĩa và dedupe đa nguồn D0.3/D0.5 còn chờ.
- [Report](docs/reviews/m4-3-subsense-integration-2026-10-06.md),
  [handoff FE](docs/handoff/db4-subsense-grouping-2026-10-06.md).

### 2026-10-06 — DB3-W1 — Khóa rollback wordfreq thiếu journal

- Rollback cũ xóa frequency_rank toàn ngôn ngữ vượt scope run: khóa trước kết nối DB.
- Apply recheck rank-null dưới table lock trong transaction; count::int dùng number.
- E2E giữ rank có sẵn khi từ chối rollback. Không import/rollback wordfreq VPS.
- [README](scripts/db3/README.md), [report](docs/reviews/db3-wordfreq-2026-10-06.md).

### 2026-10-06 — DB3-B2.1 — Tích hợp partial apply và bảo toàn review

- Khi phát hiện script VPS đổi lúc 21:35, hủy CI 37480050307 để bảo toàn patch;
  Deploy 37480283546 skipped. Chủ dự án xác nhận phiên DB3-B xong, cho tích hợp tiếp.
- Nhận ba file, sửa UNREVIEWED, resume cohort và judge promote fail/minor.
  Default 100/≥98 pass/0 severe giữ nguyên; partial chỉ apply output pass đã review.
- Audit mode/hash/count, 31 node tests pass và CI gate riêng. Không gọi AI/seed VPS.
- Commit `f700658` đã push/deploy cùng M4.3.
- [Report](docs/reviews/db3-b2-1-partial-review-integration-2026-10-06.md).

### 2026-10-06 — M4.3 / DB3-B2.1 — Deploy và kiểm chứng live hoàn tất

- Runtime `f700658`; CI 37481567514 và Deploy 37481886745 success; 038/039 đã áp.
- 354 unit / 207 E2E / 31 DB3 tests, lint/build pass; 46 live checks pass.
- run: 64 sense → 38 nhóm/26 con; draw: 138 → 6/132; apple: 20 → 8/12; dog: 23 → 14/9.
- Flat/grouped giữ IDs/card/leaf; cursor v3/canonical, sources/stroke/admin/JMdict giữ.
- Core 2.375.240 lexeme / 2.917.954 sense; runtime tracked code clean, giữ hai file .bak.
- [Report + smoke](docs/reviews/m4-3-subsense-integration-2026-10-06.md);
  tài liệu nghiệm thu được commit riêng sau deploy.

### 2026-10-07 — M4.5 — Xếp hạng nghĩa ưu tiên khi tra từ

- Nghiên cứu và lưu [plan M4.5](docs/plans/m4.5-sense-display-priority.md): tối đa 3
  nghĩa gợi ý, WordNet sense counts cho EN khi nối đúng, ranking offline có review
  cho phần thiếu dữ liệu; đo corpus có chọn lọc sau pilot.
- Phân biệt tần suất từ/nghĩa và ưu tiên học; giữ provenance/ID/card/grouping M4.3,
  fallback thứ tự nguồn; không dùng mapping confidence làm độ phổ biến.
- Phạm vi: chỉ plan + entry này; kiểm nguồn/link/diff, không chạy test ứng dụng.
- Trạng thái: plan đã lưu, chưa code/pilot/gọi AI/sửa DB; chưa commit/push/deploy.

### 2026-10-07 — M4.5 — Thứ tự triển khai nghĩa dành cho người học và thu gọn EN

- Cập nhật [plan M4.5](docs/plans/m4.5-sense-display-priority.md): pilot 100 từ EN,
  hiện 1–3 nghĩa phù hợp, bổ sung VI đúng sense khi thiếu, mở rộng khoảng 5.000 từ
  sau gate; JA chuyển sang pilot riêng. Cat/dog là ca nghiệm thu cụ thể.
- Ghi contract BE/FE dự kiến, lookup preview theo lô, bảng metadata riêng và
  thứ tự migration/data → BE → FE; xác định checkout FE là gate trước triển khai UI.
- Phối hợp DB4-D0.3 grouping/D0.5 dọn trùng; archive nghĩa riêng cần inventory,
  bảo toàn references và manifest riêng. Chưa chốt số GB tiết kiệm.
- Phạm vi: chỉ hai file tài liệu; kiểm link/format/diff, không chạy test ứng dụng.
- Git/triển khai: chưa commit/push/deploy; chưa code, audit live, gọi AI hoặc ghi DB.

### 2026-10-07 — M4.5 — Ưu tiên nghĩa bằng nguồn và rule, không gọi API AI

- Chủ dự án yêu cầu hướng tiết kiệm token; đổi V1 trong
  [plan M4.5](docs/plans/m4.5-sense-display-priority.md) sang rank/count WordNet,
  tags/topics Wiktextract và override biên tập cho ca sai; thiếu bằng chứng giữ
  fallback. AI và dịch tự động không nằm trong pipeline V1.
- Read-only SQLite nguồn local: OMW-EN 1.4 có 35.483 sense count dương; cat/dog
  noun có rank nguồn 1, count 18/42. OEWN không có count trong file này. Chưa đo
  coverage nối core; corpus provenance của count cần đối chiếu trước production.
- Đọc importer: staging chỉ giữ members synset; core tạo sense_no theo synset_id,
  bỏ rank/count nguồn. Khôi phục metadata là công việc code/data dự kiến.
- Phạm vi thay đổi: plan + PROGRESS; kiểm nguồn chính thức, link và diff. Chỉ đọc
  nguồn SQLite local, không chạy test app, không ghi DB/code hay gọi API AI.
- Git/triển khai: chưa commit/push/deploy; chưa chạy pilot 100 từ.

### 2026-10-07 — M4.5 — Pilot 100 từ EN bằng WordNet và rule

- Chủ dự án cho thử 100 từ. Đã code CLI read-only/ranking/report/tests trong
  `scripts/dictionary/learner-priority*`, đọc local full `55433/langoo` và SQLite
  nguồn, lưu [report + HTML/CSV/artifact](docs/reviews/m4.5-pilot-2026-10-07.md).
- V1.1 giữ đủ 7.903 sense IDs/100 headword; 4.179 binding WordNet exact, 1.253
  sense count dương; 100 preview OMW-EN có count, 92 đổi so sense_no của chính
  lexeme. Không merge nguồn/POS, 0 request API AI và 0 ghi DB.
- Cat/dog/book/run có nhóm nghĩa phù hợp; bank/table/plant/bat và các ca khác có
  20 ghi nhận cần xem lại ưu tiên. Chú thích VI do agent trong phiên, chỉ cho báo
  cáo; 100 preview vẫn chưa có VI trong DB. Chưa chấm gate ≥90/100.
- Kiểm: Node22.22.2; 12/12 unit, scoped TypeScript/ESLint, invariant IDs/hash và
  HTML filter trong Node VM pass. Browser visual chưa kiểm do không có provider.
- Git/triển khai: code/artifacts/docs đã lưu local, chưa commit/push/deploy;
  chưa API/FE/migration/data apply/dọn nguồn. Full M4.5 còn thiếu semantic gate.

### 2026-10-07 — M4.5 — Ưu tiên nghĩa người học cho bank/draw/plant

- Theo phản hồi chủ dự án, preview riêng chọn ngân hàng/vẽ/cây-thực vật làm nghĩa
  đầu; giữ baseline tự động, 97 record còn lại và toàn bộ 7.903 sense/evidence.
- Thêm CLI proposal có guard content/input hash và exact ID; renderer phân biệt
  đề xuất agent với bằng chứng nguồn. [Report và bản mới](docs/reviews/m4.5-pilot-2026-10-07.md).
- Kiểm Node22: 12/12 unit, scoped TypeScript/ESLint, invariant artifact và guard
  từ chối hash cũ/ID không tồn tại/lemma trùng pass. Browser visual chưa kiểm.
- Giữ 20 flags cần kiểm; semantic gate chưa chấm. Code/artifact/docs đã lưu local,
  chưa commit/push/deploy; 0 API AI/ghi DB, chưa tích hợp API/FE.

### 2026-10-07 — M4.5 — Chốt hướng hybrid rule và AI

- Chủ dự án chọn kết hợp AI với rule/nguồn; cập nhật [plan §3.1](docs/plans/m4.5-sense-display-priority.md):
  pilot hybrid cùng 100 từ, xét đủ sense, chọn ID thật, cache/resume và đo token;
  so cải thiện/thoái lui trước mở rộng AI có chọn lọc. Không chạy AI khi tra từ.
- Phạm vi: plan + PROGRESS; kiểm links/nội dung/diff, không đổi code/chạy app tests.
- Chưa chọn provider/model/budget, chưa job/pilot AI hay semantic gate. Tài liệu
  đã lưu local, chưa commit/push/deploy; lượt này 0 API/ghi DB.

### 2026-10-07 — M10.2 — Cấu hình Qwen cho chat và quiz

- Theo yêu cầu chủ dự án, đổi chat/generator/validator sang `qwen/qwen3.8-27b`
  trên Groq hiện có; đồng bộ `.env.example`/API docs, cấu hình local + VPS, clear
  reasoning effort cũ. [Report](docs/reviews/m10.2-qwen-chat-quiz-2026-10-07.md).
- Chat env đã áp và PM2 reload; completion/compiled streaming thành công, health
  DB ok. Quiz VPS vẫn StubQuizProvider; M11.1 local chưa deploy nên chưa gọi Qwen.
- Kiểm: Node22, 2 suite/20 unit pass; diff/links/status. Chưa smoke authenticated
  chat route hoặc quiz thật/chất lượng JA. Không build/pull code hay ghi DB.
- Repo config/docs lưu local, chưa commit/push; VPS chỉ đổi cấu hình/reload.

### 2026-10-07 — M10.3 — Chat nhận ảnh tạm thời

- Chủ dự án yêu cầu BE + apply VPS. Thêm images data URLs cho chat thường/SSE,
  tối đa 3 ảnh PNG/JPEG/WebP × 2 MiB, body 9 MiB chỉ hai route chat.
- Chỉ forward ảnh lượt hiện tại; không ghi file/DB/history ảnh. Redact body/log
  và bỏ error body upstream. Giữ auth/lease/quota; không migration hoặc FE.
- [Plan](docs/plans/m10.3-chat-images.md), [report](docs/reviews/m10.3-chat-images-2026-10-07.md),
  [contract](docs/api/chat.md). Release tách riêng từ baseline VPS f700658.
- Trạng thái: đang kiểm local; chưa deploy trong entry pre-release này. Không
  gom quiz/DB4/DB3 dirty. Kết quả cuối và trạng thái deploy cập nhật trong report.

### 2026-10-07 — M10.3 — Đã deploy chat nhận ảnh tạm thời

- Release code commit 1f293a8 từ baseline VPS, fast-forward source + dist cô lập,
  PM2 reload. Health DB ok; [report](docs/reviews/m10.3-chat-images-2026-10-07.md).
- Public API authenticated smoke pass thường/SSE với Qwen và fixture CAT,
  URL ngoài bị từ chối; 4 tin lịch sử không chứa ảnh, log không có payload ảnh;
  đã xóa đúng user smoke. Không migration, giữ nguyên DB3 dirty trên VPS.
- Local build/scoped lint pass; 51 tests/5 suites pass + provider 11 tests sau
  thêm regression token ảnh. Full app E2E/FE UI chưa kiểm, FE tích hợp còn thiếu.
- Code/tests/docs đã commit vào main 10/10 (294e385; nội dung khớp và là superset
  của nhánh feature/m10.3-chat-images). Nhánh cũ giữ nguyên để đối chiếu; backend
  đã apply VPS.

### 2026-10-07 — M10.2 — Khảo sát provider free có vision

- Chủ dự án muốn đổi provider miễn phí/nhanh/có ảnh; khảo sát nguồn chính thức
  Google AI Studio, Cloudflare Workers AI, OpenRouter. Ưu tiên thử Gemini 3.5
  Flash-Lite, quota thực tế cần kiểm project; chưa có benchmark/key mới.
- [Report](docs/reviews/m10.2-qwen-chat-quiz-2026-10-07.md) lưu căn cứ và gate
  smoke text/ảnh/SSE/usage/latency. Chỉ docs, kiểm links/diff, không app tests.
- Chưa đổi code/VPS/provider; Qwen/Groq vẫn đang chạy. Docs chưa commit/push.

### 2026-10-07 — M4.5 — Đề xuất luồng ưu tiên nghĩa song song DB4

- Theo câu hỏi chủ dự án về DB4 đang map candidate, cập nhật [plan §4.1](docs/plans/m4.5-sense-display-priority.md):
  M4.5 đọc snapshot/rule/AI artifacts riêng, không đổi sense hoặc concept links;
  phối hợp một writer cho migration/apply/deploy. Đề xuất 100 → 500 → 5k từ EN.
- Không coi 5k headword là phủ 99%; nguồn nghiên cứu tính word families/lexical
  coverage, khác độ đúng của nghĩa gợi ý. Từ ngoài tập vẫn có fallback đầy đủ.
- Chỉ plan + PROGRESS; kiểm links/diff, không sửa code/gọi AI/ghi DB/deploy hoặc
  spawn agent trong lượt này. Docs lưu local chưa commit/push; hybrid 100 còn gate.

### 2026-10-07 — M4.5 — Ước lượng AI và quota cho ranking

- [Plan §3.2](docs/plans/m4.5-sense-display-priority.md) ghi cách chọn ID, review
  pilot, cache/resume/cap và chia quota với DB4/chat. 100 từ local ước lượng
  413.439 input tokens bằng chars/4+600 prompt tokens/từ, không provider usage.
- Kịch bản 5k theo profile pilot khoảng 20,7M input; không coi mẫu nhiều nghĩa
  là đại diện 5k. Giá paid chỉ tham khảo theo official Gemini pricing; free
  và quota phải kiểm project. Không tự bật paid/chạy job hoặc thêm key tăng quota.
- Chỉ plan/PROGRESS + phép tính read-only từ artifact. Kiểm sources/links/diff,
  không app tests/code/API/ghi DB/deploy. Docs lưu local chưa commit/push.

### 2026-10-07 — M10.2 — Khảo sát Muse-Chat-MCP

- Đọc repo tại commit `6c00e8c`, lưu [report](docs/reviews/m10.2-qwen-chat-quiz-2026-10-07.md):
  browser bridge MCP/OpenAI qua Chrome đăng nhập, dùng quota tài khoản Muse.
- Source cho thấy model ID chỉ là nhãn, lịch sử dựa thread Muse, queue tuần tự,
  usage ước lượng; cần isolation/auth/timeout trước dùng cho Langoo nhiều user.
  Data URI ảnh chuyển Buffer/upload; không bảo đảm retention của Muse/browser.
- Chỉ khảo sát/source/docs; kiểm links/diff/status, không cài/chạy repo/login,
  benchmark/API hoặc deploy. Docs chưa commit/push; VPS giữ Qwen/Groq.

### 2026-10-07 — M10.4 — Triển khai thử Muse qua browser bridge

- Chủ dự án yêu cầu test/deploy, xác nhận quota trên Muse web và tự đăng nhập
  browser VPS. Chốt Muse cho job DB/nền, giữ Qwen chat. [Plan](docs/plans/m10.4-muse-browser-bridge.md),
  [report](docs/reviews/m10.4-muse-browser-bridge-2026-10-07.md),
  [ops/consumer contract](scripts/ops/muse/README.md).
- Deploy sidecar độc lập: Chrome/profile riêng, systemd enabled, API loopback
  có key; sửa selector tạo chat, gửi history, ảnh request-only, lỗi partial/SSE
  và usage giả. Login gateway/tunnel tạm đã đóng, profile còn sau restart bridge.
- 15 unit local + VPS pass; 8/8 live fixture, 8 thread riêng, JA→VI/JSON/history/
  ảnh thường/SSE/isolation pass. Median 14,6s, first content delta ảnh SSE 10,7s;
  lỗi navigation ban đầu và test cwd được ghi trung thực trong report.
- Ops/code/tests/artifacts/docs lưu local chưa commit/push; sidecar VPS đã deploy,
  app vẫn a55c83a/Qwen, health DB ok; không ghi DB hay đổi luồng DB4 đang chạy.
  M4.5 §3.3 chọn provider job, chưa runner/hybrid 100 hoặc apply ranking.

### 2026-10-07 — M4.5 — Pilot Muse 50 từ, worker VPS và batch tối đa 5

- Lưu exporter read-only + worker systemd/checkpoint + cohort 50 + strict batch
  validation; 4.101 source senses VPS, không truncate, không DB mutation.
- Batch theo độ dài: 54 task đầu thành 29 request + vòng tổng hợp cho 4 từ dài;
  chạy single browser, 2 RPM/150 request per run, tokens estimated.
- Local và VPS 5/5 unit pass; export VPS OK; preflight batch 5 valid/59s;
  service nền VPS enabled/active, đang chạy đủ 50 từ và review sau.
- Còn đủ 50/semantic review/latency gate; BE/FE/apply và full100 chưa làm.
- Chưa commit/push; code sidecar đã đưa VPS, không đổi app release/Qwen/DB4.
- [Report và lệnh vận hành](docs/reviews/m4.5-muse-50-2026-10-07.md).

### 2026-10-07 — M4.5 — Xong pilot Muse 50 từ và chấm đủ 50

- VPS systemd job xong: 18m28s, 32 request, đủ 50/50 inventory; 1 invalid batch
  bị chặn/tách nhỏ, 0 restart. Median 28,9s; ~202k input/4,5k output estimated.
- Review: **42 pass, 7 minor, 1 severe (face sai ID–reason); gate 50 fail**.
  Bank/plant đã cải thiện; draw còn ưu tiên kéo. Lưu đề xuất sửa 8 từ, không
  ghi đè output; có HTML so original/proposal và annotations đủ 50 trên VPS/repo.
- Local/VPS 6/6 unit pass; renderer + HTML QA pass. V1 nhãn leaf_definition chưa đúng
  core/gloss path; ghi rõ cần sửa contract/prompt + ID anchor trước run tiếp.
- Chưa commit/push; worker VPS đã chạy xong, không DB/app/FE apply, chưa full100.
- [Report](docs/reviews/m4.5-muse-50-2026-10-07.md).

### 2026-10-07 — M10.4 — Nghiên cứu Muse API, đa luồng và RAM VPS

- Đối chiếu source: bridge hiện một page/queue + guard 429, chưa đa luồng.
- Tìm native Muse web gateway client (Python/Noise) không cần Chrome thường
  trực; client có connection riêng, backend concurrency chưa test.
- Xác nhận Meta Model API chính thức có Muse Spark 1.3, minimal/low effort và
  rate limits/usage; quota 1 tỷ token app web chưa chứng minh dùng cho Model API.
- Snapshot VPS: available ~429 MiB; Chrome cgroup ~578 MiB, bridge ~97 MiB;
  đề xuất spike native 1 rồi 2 worker thay vì nhân nhiều Chrome trên VPS 2 GiB.
- Chỉ nghiên cứu/docs, chưa code/export session/test API/đổi services; chưa
  commit/push. [Report và plan thử](docs/reviews/m10.4-muse-api-concurrency-research-2026-10-07.md).

### 2026-10-07 — M10.5 — Thử Muse native gateway và hai luồng trên VPS

- Chủ dự án cho chạy thử native client sau nghiên cứu M10.4. Đang chuẩn bị venv
  và transport pin riêng VPS; cookie export chỉ Muse-origin/private 0600.
- Plan: auth smoke → một worker → hai side-chat riêng → đo browser-free RAM và
  throughput/ID/isolation; cap 20 generation, không API trả phí/DB write.
- Đang làm, chưa gate/live kết quả, chưa commit/push; app/Qwen/DB4 giữ runtime.
- [Plan](docs/plans/m10.5-muse-native-gateway.md).

### 2026-10-07 — M10.5 — Xong thử native Muse 19 lượt, hai luồng và context dài

- Native auth/gateway 4,2s, single fixture 8,9s; 19 generation có nonce/chat riêng,
  0 invalid ID/trộn chat trong mẫu; full bank78/light156 chọn đúng nghĩa chính.
- Native RSS peak 48,91 MiB. Khi tắt Chrome thử nghiệm, available 578→888 MiB,
  swap 400→114 MiB. Đã restore Chrome/bridge/display, app/DB health OK.
- A/B 1 vs2 (đảo thứ tự): speedup 2,506x và 1,307x; gộp 1,725x. **Gate ổn định
  ≥1,5x mọi round chưa đạt**, chưa tăng 5–10 worker hoặc đổi provider mặc định.
- Local/VPS 5 unit pass, gate/counter/private file check; chưa commit/push.
- Còn adapter scheduler/correlation/renew và semantic pilot, chưa production
  native endpoint/DB apply; [report](docs/reviews/m10.5-muse-native-gateway-2026-10-07.md).

### 2026-10-07 — M10.5 — Batch tự động theo inventory và thử ba worker native

- Chủ dự án yêu cầu chuẩn bị batch tự động, gửi khi cần, thử 3 luồng và chấm thời
  gian/chất lượng. [Plan](docs/plans/m10.5-native-batch-runner.md).
- Đã lưu export Node READ ONLY + Python planner/runner/8 unit; track source
  counts/chars, manifest, fragment/final DAG, checkpoint/hash/ID-anchor/cap/lock.
- Local 8/8 unit pass; đang đưa runner riêng VPS và thử 50 từ, còn live/semantic
  gate. Không apply DB/Qwen/DB4 hoặc đổi default bridge. Chưa commit/push.

### 2026-10-07 — M10.5 — Xong runner batch tự động, thử ba luồng và chấm50

- Export50 READ ONLY4101 senses + top3/64; deterministic manifest34 initial
  batches +5 dependent finals; full coverage, counts/chars/provenance, không cắt
  definitions. Native pool mỗi worker giữ Gateway, queue động, khóa run/account.
- Intent/cap/checkpoint/reconcile +2 bounded complete-reply repairs, không resend
  ambiguous sends; original lỗi archive riêng; exact IDs/anchors/marker, soft
  metadata cap1000, fail-fast, invocation ledger và HTML review hash-bound.
- Final50 hợp lệ sau41 dispatch (39+2), active423,459s gồm old-parser waits /
  reconcile/repair; elapsed895,648s gồm khảo sát; peak75,89MiB. Không khẳng định3
  tối ưu hoặc all50 đã chạy không gián đoạn trên bản cuối.
- GPT review44 pass/6 minor/0 severe; primary50 modern everyday chấp nhận được,
  không là corpus frequency gold; gate>=45 **chưa đạt**. Proposals lưu riêng,
  không apply ranking DB. Còn6 minor/clean timing/paired2vs3/larger-cohort gate.
- Local/VPS18 batch unit +5 old smoke unit; exporter/prepare/lock/no-generation
  resume/app+DB health; diff check và trạng thái Git kiểm cuối. CLI riêng đã đưa
  VPS, không đổi Qwen/DB4/defaultbridge/app env; **chưa commit/push**.
- [Report/50-word HTML và artifact](docs/reviews/m10.5-native-three-50-2026-10-07.md),
  [ops/lệnh chạy](scripts/ops/muse-native/README.md).

### 2026-10-07 — M10.5 — Automation Muse bulk trên VPS

- Chủ dự án chấp nhận chất lượng pilot và yêu cầu lấy trực tiếp kết quả Muse,
  không chấm lại. Policy `muse_direct_no_semantic_recheck`; schema/marker/ID/
  anchor/hash vẫn kiểm. Không sửa kết quả gate GPT lịch sử thành pass.
- Chuẩn hóa exporter READ ONLY query50 từ/Map + source hashes; supervisor chạy
  từng shard50/3 worker, JSONL/progress/checkpoint durable, bounded repair2/job
  +10/shard, failure circuit/backoff, scoped reconciliation, systemd resume/reboot.
  Bounded shard tránh load/scan cả5k sau mỗi batch; socket lỗi được giải phóng.
- VPS đã chuẩn bị5.000 từ EN rank<=10k,91.689 source senses,100 shard,1.211 base
  generation, hard cap2.211;0 AI dispatch ở cohort5k. Unit bulk đã cài; cohort
  `common-5000-ready-20261007` còn trạng thái prepared, chưa start/enable lô lớn.
  22 ID trống definition/path giữ trong source và đánh dấu riêng,5.000/5.000 từ
  vẫn có input hợp lệ; không có source record bị xóa khỏi DB.
- Local/VPS10 bulk +21 runner +5 old smoke unit pass; node/bash syntax, prettier,
  systemd verify; service smoke hồi phục50/50 checkpoint, counter41 không tăng;
  app/DB healthOK. Chưa test inference5k/reboot thật;3 chưa chứng minh tối ưu tuyệt đối.
- File/phạm vi: `scripts/ops/muse-native/{bulk_runner.py,batch_runner.py,export-inventory.mjs,prepare-bulk.sh,langoo-muse-bulk@.service,test_*.py,README.md}`.
  [Plan](docs/plans/m10.5-muse-bulk-automation.md),
  [report/commands](docs/reviews/m10.5-muse-bulk-2026-10-07.md).
- Git: **chưa commit/push**; sidecar/ops riêng đã cài VPS. Kết quả là ranking
  artifact; M4.5 còn apply/API/FE, không đổi Qwen/defaultbridge/DB4 hoặc ghi DB.

### 2026-10-07 — M10.5 — Khởi động lô Muse 5.000 từ trên VPS

- Chủ dự án yêu cầu chạy. Đã `systemctl enable --now
langoo-muse-bulk@common-5000-ready-20261007.service` lúc18:18:01+07:00.
- Unit active/running, enabled sau reboot; shard đầu bắt đầu dispatch và đã có
  output complete. Progress/checkpoint ghi trên VPS; app/DB healthOK.
- Quan sát ban đầu có1 complete reply bị lỗi schema (`do`), đang trong cơ chế
  repair hữu hạn; không chấm lại semantic bằng GPT. Không kết luận chất lượng
  hoặc throughput lô lớn từ vài batch đầu.
- Tiếp tục chạy nền sau khi đóng SSH/máy cá nhân; xem progress/results/unresolved
  theo [ops](scripts/ops/muse-native/README.md#bulk-vps). Chưa hoàn tất lô5k,
  chưa apply DB; code/docs vẫn chưa commit/push.

### 2026-10-07 — DB4-D2/DB4-D4 — Nghiên cứu hướng mapping sense–concept

- Theo yêu cầu chỉ viết docs để đọc dần, lưu so sánh các hướng và nguồn tham khảo:
  mapping theo danh tính WordNet, retrieval + AI, graph, so sánh sense cùng từ,
  embedding/classifier, mapping có sẵn, Naisc và BabelNet.
- Đề xuất tiếp tục hybrid, ưu tiên JLPT N5/N4, bổ sung kiểm tra cạnh tranh/phạm vi;
  chưa tìm được giải pháp thay thế tốt hơn có bằng chứng trên dữ liệu Langoo.
  Muse ranking chưa chứng minh chất lượng DB4; không thay policy R1/R2/contract
  hiện hành hoặc mở job mới. Baseline dùng snapshot local ngày 06/10.
- File: [tài liệu nghiên cứu](docs/plans/db4-mapping-methods-research-2026-10-07.md),
  liên kết trong [plan DB4](docs/plans/db4-sense-concept-mapping.md#02-nghiên-cứu-bổ-sung-ngày-0710--db4-d2db4-d4)
  và entry này. Còn chốt hướng, audit/đối chiếu luồng DB4, adapter/contract và
  đánh giá chất lượng trước triển khai/mở rộng.
- Kiểm tra: Prettier hai file plan pass; liên kết file nội bộ của tài liệu mới
  tồn tại; `git diff --check` và `git diff --no-index --check` hai file plan
  không có lỗi whitespace. Đã kiểm trạng thái Git; không chạy test code,
  benchmark hoặc gọi provider trong lượt docs này.
- Git / triển khai: tài liệu lưu local, **chưa commit/push**; không sửa code/DB,
  không tác động VPS/service hoặc job Muse đang chạy.

### 2026-10-07 — M4.5 — Audit thu gọn Wiktextract EN trên VPS

- Review READ ONLY theo yêu cầu: agent khác đã áp trim source #8 EN theo rank
  ≤100.000 hoặc tham chiếu translation/deck/collection; log mục tiêu xóa
  1.322.658 lexeme/1.437.522 sense. Wiktextract EN còn 170.177 lexeme;
  cả ba nguồn EN còn 488.407. DB lúc 22:37 là 4.331.920.407 bytes.
- Collection/deck/translation assertion orphan đều 0; 91.689 sense và 23.394
  lexeme snapshot Muse vẫn còn. API cat/dog/book timeout lúc agent vacuum full,
  kiểm lại sau maintenance trả 200 trong 0,04–0,35s. Không chấm lại Muse.
- Còn rủi ro policy missing-rank, chat/history ON DELETE SET NULL, artifact DB4
  của sense đã xóa, restore backup chưa thử. SQL/log chỉ thấy ở /tmp; cần agent
  thực hiện lưu policy/script/deletion manifest/report bền vững trong repo/storage.
- [Report và giới hạn nghiệm thu](docs/reviews/m4.5-en-trim-vps-audit-2026-10-07.md).
  Prettier/liên kết file nội bộ và kiểm whitespace (`git diff --check`, report
  mới `git diff --no-index --check`) pass; đã kiểm trạng thái Git. Không chạy
  test code hoặc sửa DB.
- Git / triển khai: report local chưa commit/push; trim đã áp VPS bởi agent khác,
  lượt audit không deploy, không thay runtime/job Muse; chưa kết luận toàn DB clean.

### 2026-10-07 — M4.5 — Audit nghĩa mặc định tiếng Nhật trên VPS

- Đã lấy 30 query có chủ đích qua public API, source/attributes/JLPT qua DB
  READ ONLY, đọc repository live/importer và đối chiếu nguồn EDRDG. Cả 30
  kết quả đầu là JMdict nhưng có 5 query cần đổi entry ưu tiên và 1 cần đổi
  reading: 来る, できる, する, ある, いる, 入る. Đây không phải tỷ lệ lỗi toàn DB.
- 21 query nghĩa đầu phù hợp cách tra cơ bản; 3 case かける/つける/結構 cần
  xem coverage/ngữ cảnh, không chấm nghĩa đầu sai. Tín hiệu form common/uk/JLPT
  đã có nhưng chưa đủ tự giải mọi ca; đề xuất ranking entry + override nhỏ,
  rồi preview nghĩa, chưa cần AI toàn JA. Giữ các entry/cách đọc hợp lệ.
- [Report và artifact 30 query + context 15 lexeme](docs/reviews/m4.5-ja-sense-audit-2026-10-07.md);
  thêm link trong plan M4.5. Còn chốt policy, implementation/regression và
  kiểm cohort rộng hơn. JSON 30 query/count/verdict + 15 context, Prettier,
  link file nội bộ, `git diff --check` và whitespace report mới pass; đã kiểm
  Git. Không test code, không gọi AI provider hoặc chấm lại job Muse.
- Git / triển khai: report/artifact local chưa commit/push; không đổi code/DB,
  không deploy, sáu case chưa được sửa trên VPS.

### 2026-10-08 — M4.5 — Ưu tiên mục từ và nghĩa tiếng Nhật bằng BCCWJ

- Migration 040, offline matching spelling/reading/POS/restrictions; 66.041 JMdict
  profiles + 10 lựa chọn nghĩa cho 4 entry; run/hash guard, dry-run/apply/deactivate.
  Không sửa ID/gloss/DB4/SRS, không gọi provider AI.
- BE search/suggestion corpus priority, metadata fallback; JA preview/recommended
  tối đa 3, flat giữ nguồn, cursor v4. Giữ source hotfix/suggestion/reverse/Kanji
  của phiên khác bằng three-way merge và full-source fingerprint.
- Đã apply/deploy langoo-vps khoảng 00:03 UTC+7; sáu query lỗi đã fix, HTTP smoke
  pass; migration/raw/profile metadata riêng. Sự cố startup DTO ở lượt swap đầu đã
  rollback runtime và sửa, có regression + gate AppModule import.
- Kiểm tra: Python 6, Node contract 4, isolated DB integration 15 checks, full stage
  unit 49/379 trước fix DTO; final targeted 7/55, DTO import + HTTP pass. Build,
  dictionary eslint, diff-check pass. Còn FE consume, audit/coverage rộng và search
  1 ký tự rất rộng; chưa coi M4.5 toàn milestone xong.
- [Plan](docs/plans/m4.5-ja-bccwj-priority.md),
  [report](docs/reviews/m4.5-ja-bccwj-deploy-2026-10-08.md),
  [handoff](docs/handoff/m4.5-ja-bccwj-priority.md),
  [API](docs/api/dictionary.md). Code/test/docs đã lưu, chưa commit/push; giữ nguyên
  các thay đổi AI/DB3/DB4 của lượt/agent khác.

### 2026-10-08 — M4.5 — Ưu tiên JMdict có gloss Việt khi tra JA

- Trong search JA: JMdict trước nguồn phụ, có gloss VI trước rank BCCWJ; rank BCCWJ
  vẫn là tần suất từ. Trong list sense JMdict, gloss VI không rỗng lên trước; các
  sense không dịch, ID/definition, curated selections và dữ liệu học vẫn giữ.
- Cursor v5 thêm khóa nguồn/bản dịch; v1–v4 cũ bị từ chối để FE nạp lại trang đầu.
  Không cần migration/provider AI.
- Files: search/priority repository, cursor/service, unit + isolated DB regression,
  [API](docs/api/dictionary.md), [handoff](docs/handoff/m4.5-ja-bccwj-priority.md),
  [report](docs/reviews/m4.5-ja-vietnamese-gloss-priority-2026-10-08.md).
- Kiểm tra: build pass; 2 suites/30 tests pass trên commit e740ace; eslint, syntax,
  Prettier pass; integration DB `_test` trên VPS 17 checks pass; HTTP smoke live
  15/15 pass, EN run/book không đổi.
- Git / triển khai: commit `e740ace` đã deploy lên `langoo-vps`; health app/DB OK;
  backup source + dist được lưu ở storage. Chưa push.

### 2026-10-10 — DB4-D2 — Source audit và hybrid retrieval trên cohort

- Project selector rows thành export riêng 1.000 sense; xác minh selected
  row/source/snapshot hashes và audit raw JMdict/OEWN/OMW EN/JA (0 mismatch).
  Wiktextract vẫn blocked do thiếu raw identity adapter.
- Chạy MiniLM/RRF trên 120.875 concepts: 966/1.000 có shortlist, 34
  `no_candidates_after_pos_filter`; 4.830 candidate / 966 bundle. Warm cache hit;
  334,841 giây, peak RSS 469,09 MiB, 2 threads × batch 32. Đây là availability,
  không phải recall/precision hay semantic pass.
- Đã tạo D1 retrieval generation với `apply=false`; không gọi Muse, không ghi DB,
  không deploy. Một lần chạy nhầm full export dừng ở 145/15.245 và được cách ly,
  không đưa vào generation/decision.
- Code, test và hash/artifact details: [review DB4-D2 cohort retrieval](docs/reviews/db4-d2-cohort-retrieval-2026-10-10.md); cập nhật [plan](docs/plans/db4-d2-source-minilm-retrieval.md) và [handoff](docs/handoff/db4-d2-source-minilm-retrieval-2026-10-08.md).
- Kiểm tra: TS, ESLint, Prettier, 45/45 Node tests, 15/15 Python tests pass;
  scoped diff-check pass. Full diff-check giữ nguyên whitespace có sẵn ở FE
  handoff phiên khác.
- Gate còn thiếu: semantic/gold recall; DB4-D4/D5 batch runner, intent/recovery,
  locks/budget/breaker và smoke; Muse shadow, D5 quality, DB4-D6/D7.
- Git / triển khai: code/docs commit `b74268d` đã push; artifacts lớn ở
  `uploads/` ignored; không deploy/apply.

### 2026-10-10 — DB4-D3/D4 — Contract batch và conditional R2 foundation

- Thay đổi / lý do: thêm orchestration contract v1, giới hạn run/call, target/schedule, deterministic job key, append-only event hash chain và pure evaluator cho R2 có điều kiện. Giữ nguyên D1/D3 v1; skipped R2 không tạo decision hai lượt giả.
- File / phạm vi: `scripts/db4/_batch-types.ts`, `scripts/db4/muse-batch-decide.ts`, `scripts/db4/muse-batch-decide.test.ts`; [plan](docs/plans/db4-d4-d5-automated-batch-rollout.md), [review](docs/reviews/db4-d4-d5-batch-foundation-2026-10-10.md).
- Kiểm tra / kết quả: `npx tsc -p tsconfig.db4.json --noEmit`; ESLint scoped; Prettier; `node --import tsx --test scripts/db4/muse-batch-decide.test.ts` — 8/8 pass; full DB4 suite 77/77 pass.
- Gate còn thiếu: atomic run artifacts, conditional waves, durable runner/recovery, cross-generation binding, D5 audit, VPS smoke và shadow. Chưa gọi Muse, chưa ghi DB/deploy.
- Git / triển khai: code/test/plan/review commit `406c8b2` đã push; không deploy/apply.

### 2026-10-10 — DB4-D4/D5 — Durable batch runner, preflight và report

- Thay đổi / lý do: thêm durable Muse Native runner, per-phase cap, conditional
  R2, read-only integrity preflight và denominator-preserving report để shadow
  run có thể resume mà không gửi lại request unknown.
- File / phạm vi: batch prepare/preflight/validation/report, Python runner,
  TypeScript/Python tests và systemd/runbook; xem
  [review DB4-D4/D5 batch runner](docs/reviews/db4-d4-d5-batch-runner-2026-10-10.md)
  và [plan rollout](docs/plans/db4-d4-d5-automated-batch-rollout.md).
- Kiểm tra / kết quả: 82/82 DB4 TypeScript tests, 12 runner tests, 2 coordinator
  tests, TypeScript/lint/format và Python compile pass. Full artifact preflight
  (read-only): 1.000 selected, 966 ready, 34 no-candidate, 1.932 requests,
  10 shards, 78 refs verified; `apply=false`, `museCalled=false`; elapsed 2:20.34,
  peak RSS 526,776 KiB, no swap.
- Gate còn thiếu: remote preflight/transport smoke (cap tối đa 1 R1 + 1 R2),
  expansion, format repair, Pilot A/B audit, shadow 1.000, D6/D7, DB apply và app
  deploy.
- Git / triển khai: phần việc được stage riêng để commit/push; chưa cài/chạy
  service VPS, chưa deploy app hoặc sửa DB.

### 2026-10-11 — DB4-D4/D5 — Nạp request theo phase để giảm RAM VPS

- Thay đổi / lý do: sau khi smoke với release 708e3b8 đạt khoảng 646 MiB cgroup,
  phát hiện runner giữ target/candidate và cả R1/R2 payload trong lúc Node preflight.
  Nạp payload sau preflight theo phase, R2 đối chiếu identity qua schedule compact,
  giải phóng queue trước Node D1 validation.
- File / phạm vi: Python batch runner + tests; runbook VPS, plan rollout và
  [review runner](docs/reviews/db4-d4-d5-batch-runner-2026-10-10.md).
- Kiểm tra / kết quả: 13/13 runner tests, 2/2 coordinator tests, 82/82 DB4 TS tests,
  tsc, Python compile, Prettier plan/review/runbook và scoped git diff check pass. VPS preflight
  cũ pass; smoke đầu tiên đã stop trước ledger/dispatch, không gọi Muse.
- Gate còn thiếu: commit/push follow-up này rồi chạy smoke mới với cap 1 R1 + 1 R2;
  shadow 1.000, expansion, format repair, Pilot A/B, apply và deploy vẫn đóng.
- Git / triển khai: foundation 708e3b8 đã push; memory fix đang được commit. VPS có
  unit/env và release cũ; service cũ dừng/failed. Không có Muse call, DB write/apply
  hay app deploy.

### 2026-10-11 — DB4-D4/D5 — Cho runner ghi thư mục account lock trong sandbox

- Thay đổi / lý do: smoke service phát hiện ensure_private_dir chmod thư mục
  /opt/langoo/storage/muse-native nhưng unit chỉ cho ghi file runner-account.lock.
  Cập nhật systemd ReadWritePaths cho thư mục cha; cookie file vẫn read-only.
  Runbook bổ sung tạo trước thư mục artifact theo run ID để langoo ghi manifest.
- File / phạm vi: systemd template, runbook VPS, plan rollout, review runner.
- Kiểm tra / kết quả: systemd-analyze verify trên bản 0644 pass; transient
  sandbox test lock pass và cookie write bị chặn (EROFS). Runtime pin, full
  preflight (78 refs) và load 966 R1 requests pass trong sandbox. Actual smoke
  chưa có ledger event hoặc Muse dispatch.
- Gate còn thiếu: commit/push và cài unit mới lên VPS, kiểm tra RAM/PSI, retry
  smoke với cap 1 R1 + tối đa 1 conditional R2. Shadow 1.000, expansion,
  format repair, Pilot A/B, apply và deploy vẫn đóng.
- Git / triển khai: foundation 708e3b8 và memory fix cbe9e56 đã push; unit
  fix đang local. VPS vẫn cài unit cũ; service smoke fail trước ledger/dispatch,
  không có Muse call, DB write/apply hoặc app deploy.

### 2026-10-11 — DB4-D4/D5 — Chạy runner bằng Muse Native virtualenv

- Thay đổi / lý do: VPS smoke cho thấy unit gọi Python hệ thống thiếu package `noise`;
  Muse Gateway chỉ khởi tạo khi dùng virtualenv đã cài của Muse Native. Unit template
  đổi `ExecStart` sang `/opt/langoo/services/muse-native/venv/bin/python`; runner phase
  kế thừa interpreter này.
- File / phạm vi: systemd template, ops regression test, VPS runbook, DB4-D4/D5 plan/review.
- Kiểm tra / kết quả: ops tests 3/3, Python compile, scoped `git diff --check` pass;
  venv gateway probe và transient sandbox import/cookie-read pass, không gửi generation.
  Smoke run ID `db4-smoke-20261011-cbe9e56` có 0 dispatch intent; service dừng trước
  dispatch khi R2 preflight đạt khoảng 723 MiB cgroup và PSI tăng.
- Gate còn thiếu: commit/push unit fix, cài/verify trên VPS, resume cap R1=1/R2=1;
  kiểm tra report/dispatch thực tế. Không chạy shadow 1.000, không apply DB hay deploy app.
- Git / triển khai: fix unit/docs/tests local; commits `cbe9e56` và `2cca836` đã push;
  VPS đang dùng unit `2cca836`, service smoke dừng, chưa có Muse generation hay DB write.

### 2026-10-11 — DB4-D4/D5 — Chia envelope theo Noise frame limit

- Thay đổi / lý do: một R1 prompt 90.681 ký tự bị NoiseInvalidMessage; Noise
  giới hạn plaintext 65.535 byte. Chia serialized Muse service envelope thành
  frame 48 KiB, giữ nguyên toàn bộ payload ứng dụng.
- File / phạm vi: DB4 Muse batch runner + regression test; DB4-D4/D5 runbook,
  plan/review và PROGRESS.md.
- Kiểm tra / kết quả: runner tests 14/14, ops tests 3/3, Python compile và
  scoped git diff check pass; test tái lắp envelope >100 KiB từ ba frame.
  Reconcile VPS chỉ đọc: 0 reply hoàn tất, 1 intent unknown, 0 dispatch mới.
- Gate còn thiếu: commit/push chunking, cài release pin mới và chạy manifest/run
  ID mới với cap R1=1/R2=1; kiểm tra report. Không chạy shadow 1.000, không apply
  DB hoặc deploy app.
- Git / triển khai: 9677b05 đã push/cài unit; chunk fix/tests/docs đang local.
  Run cũ không được retry; không DB write/apply hay app deploy.

### 2026-10-11 — DB4-D4/D5 — Replay D1 và dừng report theo ngưỡng RAM

- Thay đổi / lý do: replay offline response R1 đã lưu sau khi ACK hotfix được
  push; D1 tương thích ACK legacy và phân loại đúng output thiếu verdict.
- File / phạm vi: runner/validator và regression tests ở commit `b955bfa`;
  [plan](docs/plans/db4-d4-d5-automated-batch-rollout.md),
  [review](docs/reviews/db4-d4-d5-batch-runner-2026-10-10.md); không sửa DB/app.
- Kiểm tra / kết quả: validation manifest `r1-5a43e5931423d276` có SHA256
  `f03f319c3bf0332d2e561fe8e2c4f6056462bf96adecb8b6fb17900ec09a9e9e`;
  Muse trả 4/5 verdict, nên D1 ghi `invalid_output: 1`, `pending: 965`.
  R2 còn 966 pending và không dispatch. Một R1 duy nhất được ACK/lưu; không retry.
  Ba lần report read-only chưa hoàn tất. Lần mới nhất chạy 5:22 với cap 600 MiB,
  swap tắt và CPU 50%, dừng khi PSI `full avg10` đạt 1,58% / RAM còn ~440 MiB.
  Còn 564/966 evaluation artifact, chưa có summary; sau SIGINT RAM hồi ~652 MiB.
  Scope báo inactive khi Node còn sống; đã xác minh command và dừng đúng PID.
- Gate còn thiếu: report đầy đủ, format repair, output D1 hợp lệ, Pilot A/B,
  shadow 1.000 và D6/D7. Không apply DB hoặc deploy app.
- Git / triển khai: code hotfix `b955bfa` và docs snapshot `a265b46` đã push;
  lần report mới nhất được ghi trong follow-up docs commit. VPS sidecar chỉ dùng
  replay D1; systemd vẫn pin `8a2c475`. Không R2, không DB write/app deploy.

### 2026-10-11 — DB4-D4/D5 — Report có checkpoint và repair định dạng có giới hạn

- Streaming request JSONL; preflight giữ identity compact; report checkpoint theo
  shard có hash/lineage checks và progress. Không bỏ pending/invalid khỏi denominator.
- Wave repair immutable, tối đa một lần/target qua parent chain cùng source pin;
  preserve parsed semantic fields, D1/order validation và raw provenance; native
  intent/no-resend/R2 gate, lazy phase payload và coordinator repair resume.
- Kiểm tra local: 90/90 TS, 17/17 runner Python, 6/6 ops Python, typecheck,
  scoped lint/format/diff-check pass. Fresh review findings đã sửa.
- VPS offline report đang chạy có cap RAM; lượt 10 phút trước bị timeout, không OOM.
  Chưa có kết quả repair/R2 thật, chưa full shadow/apply/serving; expansion/Pilot A/B
  còn thiếu. [Report và trạng thái](docs/reviews/db4-d4-d5-recovery-2026-10-11.md),
  [runbook](scripts/ops/db4-batch/README.md).
- Git: `8db060c` và `82c4fa1` đã commit/push; không gom DB4/FE WIP của phiên khác.
  Runner release `82c4fa1` đã cài riêng trên VPS; job systemd
  `langoo-db4-recover-20261011-82c4fa1.service` active, đang chờ prior report
  hoàn tất rồi recovery R1 cap 1 / conditional R2 cap 1. Không deploy API/ghi DB.


### 2026-10-11 — DB4-D4/D5 — Chạy toàn bộ initial generation trên VPS

- Theo yêu cầu “cho chạy hết đi”: chạy 966 ready targets của cohort 1.000,
  original R1 + conditional R2, 8 workers; 34 no-candidate giữ denominator.
  Expansion/Pilot A/B chưa chạy, không gọi đây là đạt quality gate hoặc full Stage C.
- Orchestrator `continue-shadow.py` chờ recovery hiện tại, kiểm final report/hash/
  denominator/gate và repair pin; giữ mapping release `82c4fa1` bất biến. Bind
  journal result đúng InvocationID/current boot, không retry completed/unknown,
  không clear breaker và kiểm STOP trước phase. Không thay app/ghi DB.
- Kiểm tra: ops tests 16/16 và py_compile pass; review 2 Important đã sửa bằng
  regression RED→GREEN. Code `145ec65` đã commit/push; orchestrator đã cài riêng.
  Unit `langoo-db4-full-initial-20261011-145ec65.service` active/running, đang chờ
  recovery kết thúc; full R1/R2 sẽ tự nối tiếp với 8 workers, chưa có kết quả cuối.
- [Report](docs/reviews/db4-d4-d5-full-initial-2026-10-11.md),
  [plan](docs/plans/db4-d4-d5-automated-batch-rollout.md),
  [runbook](scripts/ops/db4-batch/README.md). Giữ gate promotion/apply/serving đóng.
