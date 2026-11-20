# PROGRESS — Langoo Backend

### 2026-11-20 — M2.3 B — Nâng cấp giao diện HTML email đặt lại mật khẩu theo đúng nhận diện Langoo

- Thay đổi / lý do: Thiết kế lại mẫu email đặt lại mật khẩu trong `PasswordResetMailer` theo đúng ngôn ngữ thiết kế **“Phiếu mục lục & dấu kiểm duyệt”** từ `LanGoo-User`: dùng biểu tượng PNG chính thức `https://langoo.org/favicon.png` (tránh lỗi Gmail image proxy biến nền trong suốt của `.webp` thành nền đen) kèm chữ thương hiệu `Langoo` trên đầu phiếu trắng có đường đứt nét (`#dfe5f2`), thanh nhấn hai tông xanh mực navy (`#1c3a8c`) + đỏ cam con dấu (`#d22d02`), nhãn con dấu `Hạn 15 phút`, nút CTA navy `#1c3a8c` (`Đặt lại mật khẩu`), hộp lưu ý bảo mật viền trái `#d22d02`, link dự phòng dễ sao chép, preheader Gmail và bản `text` đầy đủ. Giữ nguyên cơ chế bảo mật `#token=...` và `escapeHtml`.
- File / phạm vi: `src/auth/password-reset.mailer.ts`, `src/auth/password-reset.mailer.spec.ts`, `PROGRESS.md`.
- Kiểm tra / kết quả: Prettier + ESLint (`--max-warnings 0`) PASS; Jest `src/auth/password-reset` (3 suites) PASS; `npm run build` PASS; `git diff --check` sạch; gửi email xem trước v3 tới `starkduong@gmail.com` qua Resend (`01a1f802-1a85-7326-80e3-7a50ebfb0796`, đã duyệt giao diện & logo PNG sạch nền).
- Gate còn thiếu / việc tiếp theo: Chờ CI/CD hoàn tất deploy lên VPS production.
- Git / triển khai: Đã commit và push M2.3 B lên `origin/main` (chỉ gồm phạm vi M2.3 B, giữ nguyên các WIP khác ngoài commit).

### 2026-11-19 — M5.3.2 — Hỗ trợ `jmdict_id` trong Auto Import List (file backup `.japanese`)

- Thay đổi / lý do: Triển khai theo yêu cầu FE (`docs/fe/be-import-jmdict-ref-2026-11-19.md`), bổ sung trường tùy chọn `jmdict_id` (`/^\d{1,10}$/`) vào `ImportItemInputDto` và bỏ bắt buộc `word` khi đã có `jmdict_id` (bắt buộc ít nhất 1 trong 2; có cả hai ưu tiên `jmdict_id`). Thêm `findJapaneseByJmdictIds` tra 1 câu SQL `WHERE l.external_id = ANY(...)` ăn thẳng `UNIQUE B-TREE INDEX` `lexeme_external_id_key` (`jmdict:<ent_seq>`, 0 migration DB). Thêm reason `jmdict_not_found`; khi hồ sơ không học tiếng Nhật trả `language_not_in_profile`; `added[].word` trả `lemma` khi FE không gửi `word`, `not_found[].word` trả `word || "jmdict:<id>"`. Chữ Hán đơn (581 mã trong `.japanese`) giữ nguyên gửi qua `word`, chưa tạo bảng sổ tay Kanji riêng.
- File / phạm vi: [Handoff FE M5.3.2](docs/handoff/m5.3.2-jmdict-id-import-fe-2026-11-19.md), [API Collections](docs/api/collections.md); BE `src/collections/{dto/import-items.dto.ts,repositories/item-import-lookup.repository.ts,items-import.service.ts,items-import.service.spec.ts}`, E2E `test/collections-import.e2e-spec.ts`.
- Kiểm tra / kết quả: Prettier + ESLint (`--max-warnings 0`) PASS; `npm run build` PASS; Jest unit (`src/collections/`) **87/87 PASS**; PostgreSQL E2E (`test/collections-import.e2e-spec.ts`) **8/8 PASS** (test `M5.3.2` chạy 13 ms); kiểm chứng 5 mã mẫu trên DB production khớp `jmdict:<ent_seq>`; `git diff --check` sạch.
- Gate còn thiếu / việc tiếp theo: Chờ CI/CD hoàn tất deploy lên VPS production; sau khi deploy, FE tích hợp theo [Handoff FE M5.3.2](docs/handoff/m5.3.2-jmdict-id-import-fe-2026-11-19.md).
- Git / triển khai: Đã commit và push M5.3.2 lên `origin/main` (chỉ gồm phạm vi M5.3.2, giữ nguyên các WIP khác ngoài commit).

### 2026-11-19 — M4.9 — Japanese Deinflection dùng chung cho Search, Suggestions & Auto Import (M5.3)

- Thay đổi / lý do: Triển khai theo yêu cầu FE (`docs/fe/be-jp-deinflection-2026-11-19.md`), chuyển bước đưa từ tiếng Nhật đã chia thể về dạng gốc (deinflection) về BE trong 1 module dùng chung `src/common/japanese/jp-deinflect.ts` (bảng A–E + ★ bảng B bỏ `な`/`く→い` + §4.3 cụm `してくれ`/`てください`, ưu tiên `exactScript` như `ほっと` thay vì `ホット`, khớp chính xác luôn thắng). Tích hợp vào cả `M5.3` Import (kèm §4.4 cứu file cụt chữ cuối theo `reading` kana duy nhất `引っ越` → `引っ越し` và deinflect `reading`) lẫn `GET /v1/dictionary/search` và `GET /v1/dictionary/suggestions` (1 câu SQL batch `findExactJapaneseCandidates` khi trang đầu chưa có hit `is_exact`, đẩy lên đầu kèm `deinflected_from: string | null`). 0 migration DB, 0 package npm mới.
- File / phạm vi: [Kế hoạch M4.9](docs/plans/m4.9-jp-deinflection-2026-11-19.md), [Handoff FE M4.9](docs/handoff/m4.9-jp-deinflection-fe-2026-11-19.md), [API Dictionary](docs/api/dictionary.md), [API Collections](docs/api/collections.md); BE `src/common/japanese/{jp-deinflect.ts,jp-deinflect.spec.ts}`, `src/collections/{dto/import-items.dto.ts,repositories/item-import-lookup.repository.ts,items-import.service.ts,items-import.service.spec.ts}`, `src/dictionary/{types/dictionary.types.ts,dto/dictionary-response.dto.ts,repositories/dictionary-search.repository.ts,dictionary.service.ts,dictionary.service.spec.ts}`, E2E `test/collections-import.e2e-spec.ts`.
- Kiểm tra / kết quả: Prettier + ESLint (`--max-warnings 0`) PASS; `npm run build` PASS; Jest unit (`src/common/japanese/`, `src/collections/`, `src/dictionary/`) **211/211 PASS**; PostgreSQL E2E (`test/dictionary.e2e-spec.ts`, `test/collections.e2e-spec.ts`, `test/collections-import.e2e-spec.ts`) **3 suites / 44/44 PASS**; kiểm chứng chỉ đọc trên 35 từ `not_found` file Mazii thật trên DB production xác nhận giảm **35 → 2** (32 deinflect + 1 §4.4 `引っ越`, chỉ còn `恥ずかし` romaji và `何位`); `git diff --check` sạch.
- Gate còn thiếu / việc tiếp theo: Chờ CI/CD hoàn tất deploy lên VPS production; sau khi BE deploy, FE đọc `deinflected_from` và gỡ `useDeinflectionSearch` theo [Handoff FE M4.9](docs/handoff/m4.9-jp-deinflection-fe-2026-11-19.md).
- Git / triển khai: Đã commit và push M4.9 lên `origin/main` (chỉ gồm phạm vi M4.9, giữ nguyên các WIP khác ngoài commit).

### 2026-11-19 — M5.3.1 — Handoff FE Universal Import Parser (đọc mọi định dạng file & tự nhận diện cột/text)

- Thay đổi / lý do: Viết handoff riêng nối tiếp M5.3 (sau khi FE đã xong Đợt 1) để FE nâng cấp parser đọc mọi định dạng bảng/text/file đặc thù không phụ thuộc form cố định: File Sniffer theo Magic Bytes (`.xlsx`, `.csv`/`.tsv` auto UTF-8/Shift-JIS, `.json`, `.xml`/Apple `.plist`, Anki `.txt` & `.apkg`/`.colpkg` lazy-load trên trình duyệt bỏ media nặng, cảnh báo lịch sự binary mã hóa), Content-Based Column Classifier (tự chấm điểm chọn cột `word`/`reading`/`pos` theo nội dung + ngôn ngữ hồ sơ, kể cả không có header hay đảo cột), Smart Line Parser & Anki HTML/Ruby/Furigana cleaner (`食[た]べる`, `<ruby>`), cùng thanh xem trước 3 dòng + nút "Chỉnh cột". Không sửa BE (dùng nguyên 2 API M5.3 ở `20b8db8`).
- File / phạm vi: [Handoff FE M5.3.1](docs/handoff/m5.3.1-universal-import-parser-fe-2026-11-19.md), `PROGRESS.md`. Chỉ tài liệu handoff FE.
- Kiểm tra / kết quả: Đối chiếu contract với 2 API M5.3 đã push (`20b8db8`); kiểm tra link và `git diff --check` sạch.
- Gate còn thiếu / việc tiếp theo: Đội FE triển khai Đợt nhỏ 1 (File Sniffer + Column Classifier + Smart Line Parser + UI Chỉnh cột) và Đợt nhỏ 2 (Anki `.apkg`) trên `LanGoo-User` theo checklist nghiệm thu trong handoff.
- Git / triển khai: Tài liệu handoff local trên `main`, chưa commit/push.

### 2026-11-19 — M5.3 — Triển khai & Kiểm thử E2E Auto Import List vào sổ tay

- Thay đổi / lý do: Triển khai trọn bộ BE cho tính năng Auto Import List 1 bước (nhập vào bộ có sẵn `POST /v1/collections/:collectionId/items/import` và tạo bộ mới `POST /v1/collections/import`, chống tạo bộ rỗng bằng `422 IMPORT_NO_MATCHED_ITEMS` kèm `details.not_found`). Qua kiểm thử thực tế, bổ sung 4 gia cố quan trọng: (1) Whitelist các alias cột Mazii (`phonetic`, `mean`, `type`) trong `ImportItemInputDto` để không bị chặn bởi `ValidationPipe(forbidNonWhitelisted: true)`; (2) Tự tách chú thích từ loại hoặc cách đọc kana trong ngoặc ở cuối `word` (vd `"bank (n)"` → `word="bank", pos="noun"`, `"性質（せいしつ）"` → `word="性質", reading="せいしつ"`); (3) Sinh cả khóa Hiragana lẫn Katakana (giữ dấu `ー`) cho từ chỉ gồm kana để khớp cả mục từ lưu reading bằng Katakana (`炒飯` → `チャーハン`); (4) Sinh thêm dạng viết hoa chữ đầu cho từ Latin (`"japan"` → `"Japan"`). Pre-warm Quiz Bank (M11.5) đẩy nền ở `priority = 50` (trần 100 sense/lần). 0 migration DB, 0 package npm mới.
- File / phạm vi: [Kế hoạch M5.3](docs/plans/m5.3-auto-import-list-2026-11-19.md), [API Collections](docs/api/collections.md), [Handoff FE M5.3](docs/handoff/m5.3-import-list-fe-2026-11-19.md); BE `src/collections/{pos-normalizer.ts,pos-normalizer.spec.ts,dto/import-items.dto.ts,repositories/item-import-lookup.repository.ts,items-import.service.ts,items-import.service.spec.ts,items.controller.ts,collections.controller.ts,collections.module.ts}`, `src/ai/quiz/bank/quiz-bank.repository.ts`, E2E `test/collections-import.e2e-spec.ts`.
- Kiểm tra / kết quả: `npm run prisma:generate` PASS; `npm run build` (`nest build`) PASS; Prettier + ESLint (`--max-warnings 0`, 11 file M5.3) PASS; Jest unit (`src/collections/` + `src/ai/quiz/bank/`) **104/104 PASS**; PostgreSQL E2E (`test/collections-import.e2e-spec.ts` + `test/collections.e2e-spec.ts`) **2 suites / 18 tests PASS** (gồm 409 chưa có profile, 422 không tạo bộ rỗng, import Mazii payload, inline POS/reading, fallback lệch POS, khớp kana reading, dedupe trong request & trong bộ, đồng bộ `GET /v1/collections/:id/items?include=display` & `GET /v1/me/saved-senses`, ownership 404 và validation 400); `EXPLAIN ANALYZE` trên DB production xác nhận 0 Seq Scan và khớp 10/10 từ mẫu từ file Mazii; `git diff --check` sạch.
- Gate còn thiếu / việc tiếp theo: Chờ CI/CD hoàn tất deploy lên VPS production và FE thật tích hợp theo handoff `docs/handoff/m5.3-import-list-fe-2026-11-19.md`.
- Git / triển khai: Đã commit và push M5.3 lên `origin/main` (chỉ gồm phạm vi M5.3, giữ nguyên các WIP khác ngoài commit).

### 2026-11-19 — M2.3 B — Quên và đặt lại mật khẩu

- Thay đổi / lý do: Thêm recovery bằng email với `POST /v1/auth/password/forgot` (202 thống nhất) và `POST /v1/auth/password/reset` (200, không tự đăng nhập). Chỉ áp dụng identity mật khẩu đang active; không thêm mật khẩu cho tài khoản Google-only.
- Bảo mật / vận hành: token 32 byte chỉ lưu SHA-256, hạn 15 phút, dùng một lần; link cố định `AUTH_PASSWORD_RESET_URL` + fragment `#token=...`; cooldown địa chỉ 1/phút và 5/giờ dưới khóa user; reset thu hồi mọi phiên và có race guard cho login. Thiếu bất kỳ biến `AUTH_PASSWORD_RESET_URL` / `RESEND_API_KEY` / `AUTH_PASSWORD_RESET_FROM` thì **cả hai** endpoint trả `503 AUTH_PASSWORD_RESET_UNAVAILABLE`, không đọc DB/gửi mail. Migration additive `052_password_reset_challenges.sql`.
- File / phạm vi: [plan](docs/plans/m2.3-password-recovery-2026-11-19.md), [handoff FE](docs/handoff/m2.3-password-recovery-fe-2026-11-19.md), [API auth](docs/api/auth.md); BE `src/auth/password-reset.*`, `auth.controller.ts`, DTO, `env.schema.ts`, Prisma, migration 052; FE `src/pages/forgot-password`, `src/pages/reset-password`, `src/api/auth.ts`, route/login/i18n.
- Kiểm tra / kết quả: Unit BE **10 suite / 96 test PASS** (auth, password-reset service/mailer, env schema), gồm test 503 fail closed. Build FE `tsc -b && vite build` và build BE `nest build` **PASS**. E2E PostgreSQL **25 test PASS**, trong đó **7 kịch bản recovery** chạy với mail giả. Migration `052_password_reset_challenges.sql` đã áp **DB test-only** và **production** ngày 19/11 sau backup bảng `schema_migration` (`schema_migration-pre-052-20261119T051055Z.dump`, sha256 `6bdd8e4d…`): ledger `HAS_052=1`, bảng `app.password_reset_challenge` cùng 3 index đúng owner `langoo`. VPS fast-forward HEAD `8d29716`, `pm2` online; health nội bộ và public `https://api.langoo.org/v1/health` đều **HTTP 200** (`db=ok`), `/docs-json` 200 có cả hai route. Kiểm tra browser **PASS**: Chrome local với API giả xác nhận link từ màn đăng nhập, gửi quên mật khẩu, xóa fragment, đặt lại mật khẩu và quay về đăng nhập. Lint FE **các file sửa PASS**. Gộp từ entry “Bổ sung kết quả kiểm thử” cùng ngày để tránh trùng.
- Gate còn thiếu / việc tiếp theo: Express đã đặt `trust proxy` là `loopback`, nên request từ Caddy trên cùng máy lấy đúng IP client. Tuy vậy, edge Caddy/Cloudflare vẫn có thể gộp IP (ví dụ cùng IP edge) khiến hạn mức 20/giờ thành giới hạn chung; throttler còn lưu in-memory nên mỗi instance đếm riêng. Phải kiểm tra header/IP thực tế lúc rollout. Còn chờ cấu hình mail production: xác minh sender/domain Resend, đặt ba biến môi trường ứng dụng trên VPS (không dùng dashboard Render; `render.yaml` không khai báo), rồi smoke với hộp thư test. Chưa gửi email thật.
- Git / triển khai: BE đã commit/push `8d29716` lên `origin/main` (repo chuyển sang `Langoo_Backend`), deploy production và health public 200. FE mới là **code local, chưa push/deploy**; cấu hình auth mail production vẫn chờ nên chưa nghiệm thu gửi/nhận email thật.

### 2026-11-19 — M11.5 — Lọc nghĩa EN fallback trong câu hỏi nghĩa tiếng Nhật

- BE lọc nghĩa tiếng Anh fallback của sổ tay khi ghép đề Nhật. Dùng gloss tiếng Việt thay thế nếu có. Kiểm tra eligibility dùng cùng tập nghĩa với lúc tạo đề.
- Unit 26/26, PostgreSQL E2E 7/7, build, lint và replay production chỉ đọc pass. Không cần migration. Đã push và deploy `8123233`; đề đã tạo giữ nguyên snapshot. [Báo cáo](docs/reviews/m11.5-implementation-2026-11-18.md#2026-11-19--m115--bỏ-nghĩa-en-fallback-khỏi-đề-hỏi-nghĩa-nhật).

### 2026-11-18 — M6.3, M11.5, M10.5 và M4.8 — Triển khai backend production

- Triển khai VPS ở `dcd1830`. Áp migration `051` sau khi sao lưu theo phê duyệt. DB có `050`, `051` và 96.155 câu Quiz active.
- Health HTTPS 200, DB UTC. Smoke `bank`, `go`, suggestions, một kana và OpenAPI Quiz/SRS pass. FE có thể tích hợp với BE production. Phần kiểm thử có đăng nhập trên production còn chờ.
- [Báo cáo rollout](docs/reviews/m6.3-recognize-only-no-xp-2026-11-18.md#2026-11-18--m63-m115-m105-và-m48--rollout-production) · [Handoff FE](docs/handoff/docs5-fe-quiz-search-srs-2026-11-18.md).

### 2026-11-18 — M10.5, M4.8 và M6.3 — Push BE tra từ, SRS và cập nhật handoff FE

- Đã push xếp hạng mục từ, cursor v7 và tìm một kana ở `3a995c4`. Đã push SRS nhận diện, contract phiên học/XP/streak và migration `051` ở `08fc574`. Đồng bộ hai test Quiz theo contract M11.5 ở `39faebe`.
- Build, Prisma validate/generate, ESLint, 685 unit test, 300 E2E PostgreSQL, regression migration `051` và diff check PASS. E2E phân trang dùng tiền tố nhiều ký tự theo hành vi M4.8.
- [Handoff FE DOCS5](docs/handoff/docs5-fe-quiz-search-srs-2026-11-18.md) đã cập nhật trạng thái các commit. Push dùng `[skip ci]` để tách deploy. VPS giữ migration `050` và kho Quiz đã nạp. Migration `051` chờ phối hợp rollout.

### 2026-11-18 — DOCS5 — Bàn giao FE cho Quiz, tra từ và ôn tập SRS

- Gộp M11.5, M10.5 và M6.3 vào [một file gửi FE](docs/handoff/docs5-fe-quiz-search-srs-2026-11-18.md). Bổ sung cách thoát giữa phiên Quiz, mở lại đúng lượt và kết thúc sớm.
- Đối chiếu handoff với route/DTO và code FE local. Kiểm tra link, Markdown và `git diff --check`. Thay đổi handoff lần này chỉ gồm tài liệu.
- Quiz BE, Search BE và SRS BE đã push. Kho production đã nạp. Runtime VPS chờ rollout. FE thật tích hợp theo các điều kiện trong handoff.

### 2026-11-18 — M11.5 — Bàn giao ngân hàng câu hỏi Quiz và phát hành mã backend

- Thay đổi / lý do: Tạo đề đồng bộ từ kho dùng chung, trả đáp án sau từng câu đã nộp, hỗ trợ làm lại và báo lỗi. Gỡ luồng jobs V3. Giữ các trường XP tương thích với backend trước migration 051.
- Phạm vi: Migration `050`, Prisma, Quiz, phiên học, pre-warm khi lưu từ và bộ sinh/chấm offline. [Handoff FE](docs/handoff/m11.5-quiz-shared-bank-fe-2026-11-18.md) · [Báo cáo](docs/reviews/m11.5-implementation-2026-11-18.md).
- Kiểm tra: Prisma generate và backend build PASS. Unit 132/132, E2E PostgreSQL 36/36, pipeline 9/9 và `git diff --check` PASS trên bản phát hành.
- Git / triển khai: Backend và handoff FE đã push `54a14d5`. DB production VPS đã áp migration `050` và xác nhận **96.155 câu active trên 9.873 sense**. Runtime VPS vẫn ở `9a66fb4`; FE thật chờ tích hợp và rollout. Hai vòng sửa cứu 1.859 câu, còn 214 câu bị loại. Bộ lọc cách đọc production giữ ngoài kho 369 câu đã duyệt.
- Góp ý đã ghi nhận: Tái dùng câu `context_meaning` cho `context_cloze` sau khi kiểm tra câu che từ và các lựa chọn trong bộ của người học. Xem [tiêu chí](docs/design/m11.5-quiz-shared-question-bank-2026-11-18.md).

> Cập nhật lần cuối: 2026-10-28 — M2.4: Bổ sung identities, has_password, has_google vào GET /v1/auth/me, đã deploy VPS thành công tại `486de5f`. M12: CORS allowlist đã bổ sung https://admin.langoo.org (cùng localhost, langoo.org, www.langoo.org). M7.3: API xoá từ khỏi bộ sưu tập trong phiên học Flashcard (DELETE /v1/sessions/:id/items/:ordinal) đã hoàn thành, có unit test coverage đầy đủ và tài liệu handoff cho FE. M4.6: 20 bộ từ mẫu tiếng Anh (2.910 từ) đã seed vào DB VPS; API language filter và chuẩn hóa 100% nghĩa tiếng Việt đã commit/push `41a6ff2` và deploy VPS thành công. M8.3 streak và lịch hoạt động đã deploy VPS tại `7a33958`. API `https://api.langoo.org`. M10.1 chat dùng provider Groq.
> Snapshot lịch sử (không phải trạng thái hiện tại): tổng hợp mốc 2026-10-11: (DB4-D2 cohort 1.000 frozen; source audit + ONNX/RRF 966 shortlist / 34 no-candidate; DB4-D4/D5 runner và D1 ACK hotfix đã commit/push `b955bfa`; bounded VPS smoke lưu đúng 1 R1 nhưng D1 invalid do Muse trả 4/5 verdict, không R2; report tổng dừng theo memory guard sau 564/966 evaluation artifact, chưa có summary; chưa shadow 1.000, apply DB hoặc deploy app; DB4-D5 audit local: 16/20 pass, 2 severe, 2 deferred/gate chưa đạt; DB4-D3 engine local, pilot 20 exact proposals/chưa apply; M4.5 JA BCCWJ/BE đã deploy VPS, còn FE/EN scope riêng; M4.5 pilot 100 EN đã chạy local, còn semantic gate/BE/FE; M4.2 / DB4-D0.2 đã deploy; M4.3/DB3-B2.1 đã deploy VPS; M7.2/M8.2 sửa follow-up review: quiz không cộng reviews_total, session một profileId + distractor theo profile; migration 034/036/037 đã áp cloud + VPS + local full (05/10, đã push); M7/M8 M7.1/M8.1 pass full local gates; DB1 dọn schema xong; backend + DB thật đã chạy trên VPS; M13 đã sửa 6 P2 + 2 P3, local pass/chưa deploy; M12 đã sửa 4 finding, local pass/chưa deploy; M11 đã sửa sau review; M9 tạm gác; M2.3 A + C backend opt-in đã triển khai, B và rollout C còn chờ; toàn bộ thay đổi local đến 10/10 đã commit/push main, xem entry DOCS1)
> Quy trình: **kế hoạch → chờ duyệt → code → báo cáo → chờ review** (PROMPT-BACKEND.md §1).
> Quy tắc agent từ 06/10/2026: [AGENTS.md](AGENTS.md). Mọi việc có mã + tên;
> mọi thay đổi code phải lưu tài liệu, kiểm tra và trạng thái Git/triển khai.

## Quy trình và tài liệu

### 2026-11-17 — M11.3 — Push đầy đủ handoff FE và bằng chứng pilot còn lại

- Thay đổi / lý do: Chủ dự án yêu cầu push toàn bộ phần quiz sau rà soát. Đồng bộ handoff đầu mối17/11, API/status rollout, report và artifact/helper pilot; đánh dấu ghi nhận pre-rollout trong handoff là lịch sử.
- File / phạm vi: [Handoff FE duy nhất](docs/handoff/m11.3-single-question-progressive-fe-2026-11-17.md), [API](docs/api/quizzes.md), [report](docs/reviews/m11.3-single-question-implementation-2026-11-17.md), hai thư mục pilot M11.3 và ba helper ops. Chỉ stage entry M11.3 trong PROGRESS; giữ hạng mục khác riêng.
- Kiểm tra / kết quả: Node syntax2CJS PASS, ESLint scriptTS PASS0warning, parse59JSON và link PASS; quét63file theo mẫu credential không phát hiện; git diff --check sạch. Không chạy lại fullunit/E2E hoặc gọi model trong lượt đóng gói.
- Gate còn thiếu / việc tiếp theo: FE tích hợp và browser/job thật cóauth; pilot nhỏ chưa làP95/P99/SLA hoặc chứng nhận mọi câu đạtJLPT.
- Git / triển khai: Commit/push tài liệu và helper M11.3 theo yêu cầu trênmain; không thay codeAPI/ENV/DB/PM2, không chạy deploy thủ công. Hash xác nhận ở báo cáo cuối và lịch sửGit.

### 2026-11-17 — M11.3 — Pilot chất lượng và bật V3 trên VPS

- Thay đổi / lý do: Chủ dự án yêu cầu kiểm lại nhiễu Kanji khó hơn và thời gian tạo, nếu ổn thì chốt handoff FE và bật V3. Đã chạy engine single-question thật qua worker VPS với fixture công khai, model DeepSeek4.1Flash/low, rồi bật `AI_QUIZ_V3_ENABLED=true` và các biến V3 trên production.
- File / phạm vi: [pilot và artifact](docs/reviews/m11.3-quality-pilot-2026-11-17/README.md), [quality summary](docs/reviews/m11.3-quality-pilot-2026-11-17/quality-summary.json), [receipt VPS](docs/reviews/m11.3-quality-pilot-2026-11-17/vps-enable-receipt.json); harness `scripts/ops/m11.3-single-quality-pilot.ts`, worker/bridge ops; [handoff FE](docs/handoff/m11.3-single-question-progressive-fe-2026-11-17.md), [report](docs/reviews/m11.3-single-question-implementation-2026-11-17.md), [API](docs/api/quizzes.md), runbook VPS. Không sửa DB/schema/FE/model legacy.
- Kiểm tra / kết quả: EN20/20 trong18,5s; JA19/20 trong39,3s (300ms) và37,0s (500ms); blind GLM đồng ý20/20 EN,19/19 JA, toàn bộ câu mẫu `good`; 13/13 câu Kanji đủ4lựa chọn, không trùng, nhiễu gần1kýtự. JA thiếu1câu do timeout/lỗi provider, không do gate nhiễu. VPS commit`9a66fb4`, PM2 online, health/db UTC ok, metadata `v3Enabled=true`, `v3Model=deepseek-ai/deepseek-v4.1-flash`; route V3 trả401 khi chưa auth.
- Gate còn thiếu / việc tiếp theo: Chưa kiểm job có auth/browser FE trên production, chưa lặp p95/p99 hoặc nhiềujob; JA chưa chắc đủ20/20, cần pending/`accept_shorter`; 2–3 câu cloze dễ và một nhiễu typography đã ghi. FE vẫn phải QA các mục trong handoff.
- Git / triển khai: Code/docs/artifact local chưa commit; VPS đã bật V3 và restart PM2. Backup env tại `/opt/langoo/storage/ops/m11.3-v3-before-20261117T043129Z.env`; rollback bằng `AI_QUIZ_V3_ENABLED=false` + restart. Không forcepush, không đổi model chat/quiz legacy.


### 2026-11-17 — M11.3 — Xác nhận push quiz từng câu và nhiễu Kanji

- Thay đổi / lý do: Đã commit/push main codeM11.3 và dependencyprogressive/session cùngtest/docs; giữ WIP ngoài phạmvi. Không chạy lại testlocal theo yêu cầu.
- File / phạm vi: [report](docs/reviews/m11.3-single-question-implementation-2026-11-17.md), [handoffFE](docs/handoff/m11.3-single-question-progressive-fe-2026-11-17.md), [receipt](docs/reviews/m11.3-push-2026-11-17.json).
- Kiểm tra / kết quả: gitdiffcheck/stagecheck PASS; gitls-remote xác nhận main=dfe2f7412a8a8595e2c12c42f9c26d43df447f25. [CI](https://github.com/DuongStark/Langoo_Backend/actions/runs/44014130652) đang chạy, không báo pass khi chưa xong.
- Gate còn thiếu / việc tiếp theo: Deploy tự động sauCI; chưa xác nhận VPSdeploy hoặc bậtV3, chưa QA FE; các gate ngữ nghĩa/pilot mới giữ nguyên.
- Git / triển khai: Code dfe2f74 đã commit/push; receipt docs lưu trong commit kế tiếp. Không forcepush, không đổiENVVPS/FE và không gom DB3/M12 hoặc tài liệu ngoài phạmvi.

### 2026-11-17 — M11.3 — Đóng gói quiz từng câu và nhiễu Kanji để push

- Thay đổi / lý do: Chủ dự án yêu cầu push, không chạy lại test local. Gom toàn bộ dependency progressive/session của M11.3 cùng singlemodeDeepSeek/nhiễuKanji, test và docs đã kiểm; không gom DB3/M12/docs việc khác.
- File / phạm vi: Quiz/session/transportgate/config, helper/script/fixture và tài liệu M11.3; [handoffFE](docs/handoff/m11.3-single-question-progressive-fe-2026-11-17.md), [report](docs/reviews/m11.3-single-question-implementation-2026-11-17.md).
- Kiểm tra / kết quả: Dùng kết quả đã chạy (48unit liên quan,17HTTP,build/lint PASS), không chạy lại theo yêu cầu; chỉ kiểm diff/stage và Gitremote. CI tự động của repo vẫn giữ nguyên, không sửa workflow.
- Gate còn thiếu / việc tiếp theo: CI/deploy tự động sau push, FE chưa nghiệm thu; V3live vẫn tắt, không đổi ENVVPS hoặc hứa luồng mới đã mở.
- Git / triển khai: Chuẩn bị commit/push main theo yêu cầu; receipt hash/remote được ghi sau khi push thành công. Không forcepush, không sửa FE hoặc WIP ngoài phạm vi.

### 2026-11-17 — M11.3 — AI đề xuất nhiễu Kanji gần và dễ nhầm

- Thay đổi / lý do: Theo yêu cầu choAI chọnnhiễu, singlemodeKanji mộtcalltrảcontext+3distractors; BE tự chèn đápán chuẩn, không nhận key/ID từmodel. Prompt ưu tiên âm/chữdễnhầm; codechặntrùng/kana-width/phonetictrườngâm/alias-homophoneđãbiết/okurigana/Unicode/nhiễuquáxa; khôngfallbacknhiễucũ. CacheKanji đổi policy để không lấy lại câu dễ.
- File / phạm vi: Engine,testsKanji/single/worker; preflight+DTO/OpenAPI thêm source_policy ai_distractors (nhiễucóthểngoàibộ, target/answer vẫntrongbộ); smokehelper; [plan](docs/plans/m11.3-progressive-quiz-2026-11-17.md), [report](docs/reviews/m11.3-single-question-implementation-2026-11-17.md), [handoffFE](docs/handoff/m11.3-single-question-progressive-fe-2026-11-17.md), API. Không sửaFE/legacy/DB/ENV/rate.
- Kiểm tra / kết quả:4suite/48unitPASS cuối; HTTPPostgreSQL17/17PASS, gồmOpenAPIenum; buildPASS và ESLint8fileảnhhưởngPASS. Smoke6response:5quaparserbanđầu,1JSONcắt1800token; xemthủcông phát hiện2câu cùngphátâm nênbổsunggate. Replaylocal0externalcall qua gatehiệntại chỉgiữ3/6, loại2phonetic+1JSONhỏng; khôngnhầmvớibenchmarklive.
- Gate còn thiếu / việc tiếp theo:3callsmokepromptmới khôngnhậnresponsequaSSH, chưaxácnhậnlive sauchỉnhtrườngâm. Chưapilotlặp20câu/độkhó/ngườidùng/aliasngoàisnapshot; editdistancekhôngchứngminhđộkhó. Giữselfchecked/report vàretryhữuhạn; khôngnhãnchuyêngiaduyệt. Capacityplanningvẫnbảothủ.
- Git / triển khai: Code/docs/3artifactlocal,chưacommit/push/deploy/bậtV3. Khôngthay cấu hìnhVPS, giữWIPkhác.

### 2026-11-17 — M11.3 — DeepSeek sinh từng câu và làm bài trong lúc tạo tiếp

- Thay đổi / lý do: Đã tích hợp hướng chủ dự án chốt: V3DeepSeeklow,1request/câu,300msgiữa dispatch,tối đa20task song song. BỏAIvalidator/audit bắt buộc trong nhánhV3mới; server giữ mã/nguồn/answerkey, kiểmcode/marker/Unicode/trùng-lộ câu và flaggenerated_self_checked. Publish ngay từng câu vào prefix bất biến, giữ lifecycle/sessionprogressive đang làm.
- File / phạm vi: SharedgateOpenAi thường/SSE, engine/factory/workerV3, ENVschema/.env.example, unit/E2E và smokehelper; [plan](docs/plans/m11.3-progressive-quiz-2026-11-17.md), [report](docs/reviews/m11.3-single-question-implementation-2026-11-17.md), [handoffFE](docs/handoff/m11.3-single-question-progressive-fe-2026-11-17.md), [API](docs/api/quizzes.md). Không sửaFE/schemaDB hoặc modellegacy/chat.
- Kiểm tra / kết quả: Fullunit80suite/708testPASS tại đợt tích hợp; sau chỉnhfacade/fixture,3suite/21test liên quan PASS. HTTPPostgreSQL17/17PASS lần cuối trênDBtest riêng (DBmặc định tắt, đã ghi lỗi ban đầu). BuildPASS; ESLint14file ảnh hưởngPASS và diffcheckPASS. Smokeprovider thật: EN2/3,JA3/3 (6callkhôngretry), không dùng làm SLA20câu.
- Gate còn thiếu / việc tiếp theo: Chưapilotlặp20câu bằng appthật/ENJA nângcao/nguồn500item/nhiềujob/FEbrowser. Selfcheckkhông bảo đảm hếtmơhồ. Gatechia sẻtrong1process,cần gateway5req/s khi nhiều replica. Timeout20s gồmqueue,2pass tựđộng/chỉslotthiếu; giữ3round/90intent. Receipt riêng theo call và uncertainty nếutimeout, không làm mất chi phí khi vềngược thứtự.
- Git / triển khai: Code/docs/artifactlocal,chưacommit/push/deploy hoặc bậtV3live. ENVV3model/timeout riêng,không đụng cấu hìnhlegacy. Giữ WIP khác ngoài phạmvi; không tự gộp commit hoặc sửaFE.

### 2026-11-17 — M11.3 — DeepSeek prompt theo kỹ năng và gửi đều300ms

- Thay đổi / lý do: Theo thông tin model giới hạn5req/s, thử prompt cụ thể từng slot/đáp án chuẩn, phát300ms/request.19/20câu về trong16,041s;slot12timeout60s,tổng63,315sremote. Không429,không sai id/đáp án đọc-viết; chưa đủ20câu.
- File / phạm vi: Profilepaced-refined trong scripts/review/m11.3-glm-parallel.cjs; [plan](docs/plans/m11.3-glm-comparison-2026-11-17.md), [report](docs/reviews/m11.3-glm-comparison-2026-11-17.md),rawparallel-deepseek-ja-paced-refined.json. Không sửa app/ENV/FE/DB.
- Kiểm tra / kết quả:19JSON/metadata hợp lệ,19/19đáp án đồng ý trong blindreview,0cờ;max4dispatch/rolling1s;0Unicodehỏng. Xem thủ công và audit thấy4câu thiếu dấu【】theoformat(slot1,4,7,10),đã ghi hạn chế. node --check/JSONparse/diffcheck PASS.
- Gate còn thiếu / việc tiếp theo:1câuthiếu doTimeoutError không cóHTTPstatus,chưa chứng minhrate limit. Cần xử lý câu lỗi hữu hạn/định dạng và rate chung mọi job trước khi tích hợp; chưarepeat/EN/advanced/E2E. Không coi prompt tự kiểm làbảo đảm đúng.
- Git / triển khai: Localchưacommit/push/deploy,không đổi modelproduction/bậtV3; giữ WIP khác.

### 2026-11-17 — M11.3 — Thử sinh từng câu song song bằng GLM và DeepSeek

- Thay đổi / lý do: Theo yêu cầu5request/giây, thử20promptJA ởt=0,1,2,3s. GLM17/20call thành công trong8,499sremote,3lỗi429 và3answerkey sai nguồn. DeepSeek19/20 trong23,009sremote (25,874sgồmSSH),1providererror; nội dung19câu khớp khi review riêng, chưa khẳng định ổn định từ1mẫu.
- File / phạm vi: scripts/review/m11.3-glm-parallel.cjs, m11.3-parallel-content-review.cjs; [plan](docs/plans/m11.3-glm-comparison-2026-11-17.md), [report](docs/reviews/m11.3-glm-comparison-2026-11-17.md), rawparallel*.json. Không sửa engine/FE/DB/ENV.
- Kiểm tra / kết quả: node --check PASS,JSONparse/diffcheck PASS;20request hai model giống nhau trừmodel. DeepSeek trả18id sai vì sao chép ví dụid1; tách metadata khỏi chất lượng, server gắn mã theo request khi review19câu. Blindjudge đồng ý19/19khôngcờ; cùng họmodel nên có bias. Kiểm nguồn đọc/viết không có sai đáp án ởDeepSeek.
- Gate còn thiếu / việc tiếp theo: Chưa đủ20câu vìcalllỗi, chưa đo lặp/tải/EN/độkhó. Không bỏ kiểm nội dung từ chỉ dẫn tự kiểm. Cần sửa promptidentity, điều phối và retry hữu hạn trước khi tích hợp; không chốt giới hạnrate từ1lượt429.
- Git / triển khai: Script/docs/artifactlocal chưacommit/push/deploy; không đổi modelproduction hoặc bậtV3, giữWIPkhác.

### 2026-11-17 — M11.3 — Đối chứng GLM và DeepSeek trên cùng bộ quiz

- Thay đổi / lý do: Đo cùng nguồn/prompt/low, GLM đủ 20/20 EN+JA trong 28,50/61,75s; DeepSeek 20/20 EN 61,25s, JA 15/20 79,12s. GLM sinh đầu 20 câu chỉ 9,20/9,44s provider; kiểm/audit/sửa làm tăng tổng thời gian. Runtime quiz vốn dùng GLM, không đổi ENV.
- File / phạm vi: Ba script riêng scripts/review/m11.3-glm-{compare,review,oneshot}.cjs; [plan](docs/plans/m11.3-glm-comparison-2026-11-17.md), [report](docs/reviews/m11.3-glm-comparison-2026-11-17.md), artifact cùng tên. Giữ nguồn đóng băng, không sửa engine/pilot WIP khác.
- Kiểm tra / kết quả: Hai model/hai ngôn ngữ có raw và review bổ sung đủ mã câu; GLM đồng ý đáp án 40/40 nhưng còn cờ mơ hồ. node --check ba script, JSON parse và git diff --check PASS. Kiểm unit quiz trước đó 3 suite/32 test PASS.
- Gate còn thiếu / việc tiếp theo: Một call sinh trọn đề: JA20/20 trong58,48s, blindjudge19/20 đồng ý nhưng4câu có cờ; xem trực tiếp xác nhận 入口/入り口 hai đáp án đúng và câu 学生で không ổn. EN TypeError122,58s không có đề; chưa biết nguyên nhân. Chưa P95/DB/FE/E2E/progressive hoặc chuyên gia thẩm định; không suy ra hết lỗi từ blind review.
- Git / triển khai: Local chưa commit/push/deploy; không bật V3, không đổi FE/API/DB/model production. Prototype one-shot đã đo JA; EN lỗi transport, chưa đủ cơ sở bỏ bước kiểm.


### 2026-11-17 — M12 — A3F0C7: nghĩa xem trước và mã Nhật cho tra ngược

- Thay đổi / lý do: Theo yêu cầu xử lý feedbackA3F0C7, A06.1/A12 thêm preview cùng SenseCardDto của search vào en/ja; JA lexeme_id/sense_id nullable để mở trực tiếp, chọn đúng bằng chứng nghĩa và bảo toàn ambiguity. Cả reverse và suggestions/reverse, giữ aliases/order/scope; không gọi search/AI từng dòng.
- File / phạm vi: dictionary repository/service/types/DTO/unit, HTTPDB test mới; [plan](docs/plans/m12-a3f0c7-reverse-preview-2026-11-17.md), [handoff FE](docs/handoff/m12-a3f0c7-reverse-preview-fe-2026-11-17.md), [report](docs/reviews/m12-a3f0c7-reverse-preview-2026-11-17.md), API docs. Không sửa FE/schema/data/ENV hoặc WIP quiz.
- Kiểm tra / kết quả: dictionary52unit PASS; fullworkingtree77suite/689unit PASS có WIP ngoài phạm vi. Build/lint PASS;3suite/43HTTPDB PASS sau sửa SQL form_text,8test mở rộng semantic/form PASS. Probe repo production READ ONLY2reference98ms xác định cây→plant→植物 đúng140202/148381, không phải P95.
- Gate còn thiếu / việc tiếp theo: CI43994798246 PASS686unit/306E2E/31DB3; Deploy43995190301 success; publicHTTP/OpenAPI/health PASS. Còn QA FE; null khi không có bằng chứng, không sửa dữ liệu nước/of. Không gọi feedback resolved chỉ từ testlocal.
- Git / triển khai: Codeac5dccf đã commit/push/deploy VPS,4sourcehash khớp, PM2 online. Hai route q=cây trả đúngID140202/148381 và VI; docs/receipt sau rollout chốt riêng. Không sửa FE/data/statusfeedback; giữ WIP khác ngoài commit.

### 2026-11-17 — M11.3 — Push backend V3 và chuẩn bị pilot hiệu năng/chất lượng

- Thay đổi / lý do: Theo yêu cầu chủ dự án, đóng gói riêng code/test/docs M11.3 để commit/push trước khi chạy pilot provider thật; không gom WIP khác.
- File / phạm vi: Backend V3, quiz/session contract + tests, ENV example, API/design/plan/review/handoff M11.3; chỉ entry M11.3 được đưa vào commit PROGRESS.
- Kiểm tra / kết quả: Fresh full unit PASS77suites/682tests (100,317s); npm run build PASS. Lượt triển khai trước đã PASS33PostgreSQL E2E và lint; không gọi đó là benchmark model thật. git diff --check sạch trước commit.
- Gate còn thiếu / việc tiếp theo: Chạy pilot Anh/Nhật trên provider runtime với fixture công khai và lưu raw/result/nhận xét; chưa kết luận tốc độ/chất lượng model. V3/bộ mẫu/paraphrase/level filter vẫn chưa bật; FE integration còn gate.
- Git / triển khai: Chuẩn bị commit/push theo yêu cầu; hash/CI/pilot receipt cập nhật ở báo cáo17/11. Pipeline main có tự deploy sau CI; không đổi ENV live hoặc tự bật V3.



### 2026-11-16 — M11.3 — Backend quiz Anh–Nhật V3 và handoff FE theo phần triển khai

- Thay đổi / lý do: Triển khai BE opt-in cho source đúng ngôn ngữ, eligibility/max-flow và target lặp qua kỹ năng, batch tối đa4câu + validator/audit độc lập, repair/cache đúng scope, job CAS/lease/checkpoint/usage, source revalidation trong transaction. V3 resume/partial matching/feedback cuối lượt/skill summary; report pending và cách ly cache xuyên bản copy không gọi AI. Hoãn giải thích dài; không triển khai XP.
- File / phạm vi: `src/ai/quiz/v3/`, source/provider types/quiz contract/service/controller/module, env schema + `.env.example`, quiz/session grading/feedback/types/tests, `test/quiz-v3.e2e-spec.ts`; [report triển khai và biên bản](docs/reviews/m11.3-implementation-2026-11-16.md), [plan](docs/plans/m11.3-en-ai-ja-latency-2026-11-16.md), [design](docs/design/m11.3-quiz-en-ja-content-and-sources.md), [handoff FE mục10–10.6](docs/handoff/m11.3-quiz-en-ja-fe-2026-11-16.md), [API consumer](docs/api/quizzes.md). Không sửa repo FE, migration hoặc dependency.
- Kiểm tra / kết quả: PASS13unit suites/136tests; PASS4PostgreSQL E2E suites/33tests (8V3+25legacy), gồm hai worker/expired lease, cancel/source-edit race, matching4target/partial score, report receipt/blacklist xuyên copy/quota không đổi và OpenAPI. `npm run build` PASS; ESLint toàn phạm vi thay đổi `--max-warnings 0` PASS. Link/bảng5tài liệu và git diff --check sạch, đã kiểm working tree/branch main. Review độc lập không còn finding quan trọng. Chi tiết lệnh/giới hạn trong report.
- Gate còn thiếu / việc tiếp theo: Flag V3 mặc định false; factory local báo provider batch chưa khả dụng nên chưa gọi model thật/benchmark20câu, chưa thẩm định EN/JA/JLPT hoặc FE/browser. Bộ mẫu/paraphrase/level filter còn tắt; chưa có UI moderation/tự sửa câu bằng AI. Còn gate query plan/payload history lớn và chaos restart thật. Không coi toàn M11.3 hoàn tất hoặc production đã nhanh hơn chỉ từ các test này.
- Git / triển khai: Code + docs lưu local trên main, chưa commit/push/deploy; giữ WIP khác. Chỉ fixture/migrations hiện có vào PostgreSQL17 local mới ở55441; container test riêng đã dừng, không đổi DB/cloud/container khác hoặc ENV runtime. Không ghi credentials trong docs.



### 2026-11-16 — M11.3 — Rà soát toàn luồng quiz và bổ sung gate triển khai

- Thay đổi / lý do: Rà soát tạo đề→làm/chấm→feedback/lưu trạng thái, bổ sung9nhóm gate R01–R09: scope ngôn ngữ/cache, schema/version, grading, provenance matching, explanation/report, attempt/rubric, durable job/quota, snapshot nguồn và retrieval performance. Phân biệt hành vi cũ với yêu cầu mới, chưa coi tất cả là bug.
- File / phạm vi: [Review và bằng chứng](docs/reviews/m11.3-quiz-flow-audit-2026-11-16.md), [plan cập nhật](docs/plans/m11.3-en-ai-ja-latency-2026-11-16.md), [design](docs/design/m11.3-quiz-en-ja-content-and-sources.md), [handoff FE](docs/handoff/m11.3-quiz-en-ja-fe-2026-11-16.md). Chỉ docs; BE/FE chỉ đọc để audit.
- Kiểm tra / kết quả: Unit/regression PASS6suites/89tests;3probe runtime hàm thật với fixture giả lập xác minh generator không lọc language pool, fill JA nhận romaji, matching2/4cặp đúng chấm sai toàn câu. Probe đầu sai interface RNG đã sửa harness; không phải lỗi app. PASS14link/5bảng của4tài liệu, R01–R09 đồng bộ review/plan/handoff; git diff --check sạch và đã kiểm working tree.
- Gate còn thiếu / việc tiếp theo: Chưa sửa code/API/DB/ENV/FE; chưa browser/E2E/production benchmark/query plan/restart thật hoặc thẩm định ngôn ngữ. Các checkbox R01–R09 chưa hoàn thành; thứ tự thực hiện trong review/plan.
- Git / triển khai: Chưa commit/push/deploy; giữ WIP khác trên main.



### 2026-11-16 — M11.3 — Điều kiện tạo đề, lặp từ theo kỹ năng và handoff FE

- Thay đổi / lý do: Bổ sung plan/design về preflight theo dạng/blueprint, tách số từ khỏi số câu, cho target lặp có giới hạn qua kỹ năng khác nhau và chống lộ đáp án/chấm trùng. Viết handoff FE về số câu, nguồn nhiễu, job/progress thật, thiếu câu và compatibility; contract mới vẫn là thiết kế.
- File / phạm vi: [Plan M11.3](docs/plans/m11.3-en-ai-ja-latency-2026-11-16.md), [design M11.3](docs/design/m11.3-quiz-en-ja-content-and-sources.md), [handoff FE M11.3](docs/handoff/m11.3-quiz-en-ja-fe-2026-11-16.md), entry này. Chỉ docs; repo FE chỉ đọc tham chiếu.
- Kiểm tra / kết quả: Đối chiếu generator/DTO và StartStudyDialog hiện tại; PASS8link tương đối/5bảng của3tài liệu, tham chiếu file FE tồn tại, git diff --check sạch và đã kiểm working tree. Không chạy test/build hoặc gọi API production vì chưa sửa code.
- Gate còn thiếu / việc tiếp theo: Chưa có endpoint/schema mới, BE/FE/job hoặc browser/E2E; cần chốt contract, policy lặp/feedback/chấm, dữ liệu thực và benchmark. Không coi preflight là bảo đảm AI đủ câu.
- Git / triển khai: Chưa commit/push/deploy; giữ WIP khác trên main.



### 2026-11-16 — M11.3 — Thiết kế quiz Anh–Nhật và nguồn từ theo dạng câu

- Thay đổi / lý do: Lưu thiết kế mới theo trao đổi: từ mục tiêu luôn từ bộ đang chọn; ghi rõ dạng chỉ dùng nội bộ, dạng được bổ sung bộ mẫu và dạng tạo nhiễu theo quy tắc/AI. Thay đề xuất20s/hạ dạng tự động bằng blueprint, sinh nhóm nhỏ, job có tiến độ và chủ động nhận đề ngắn khi thiếu.
- File / phạm vi: [Thiết kế và bảng nguồn EN/JA](docs/design/m11.3-quiz-en-ja-content-and-sources.md), [plan M11.3 cập nhật](docs/plans/m11.3-en-ai-ja-latency-2026-11-16.md), entry này. Bộ mẫu định nghĩa là deck hệ thống xuất bản, còn phải qua gate chất lượng; không mở DB cho AI.
- Kiểm tra / kết quả: PASS kiểm link tương đối của hai tài liệu, cấu trúc3bảng Markdown và các mục policy nguồn EN/JA; git diff --check sạch, đã kiểm working tree. Không chạy lại test/build vì docs-only;57tests trong entry khảo sát trước không phải kiểm luồng mới.
- Gate còn thiếu / việc tiếp theo: Chưa code/API/job/FE/DB/ENV; cần kiểm dữ liệu bộ mẫu, thẩm định nội dung EN/JA/đối chiếu JLPT và benchmark trước triển khai. Không cam kết các dạng mở rộng đã có sẵn.
- Git / triển khai: Chưa commit/push/deploy; giữ WIP khác trên main.



### 2026-11-16 — M11.3 — AI ngữ cảnh tiếng Anh và giảm thời gian tạo quiz Nhật

- Thay đổi / lý do: Rà soát EN hiện sinh local, JA gọi sinh/kiểm định tuần tự với budget mặc định60s; người dùng chọn AI tạo câu ngữ cảnh và điền từ từ bộ từ đã lưu. Lưu thiết kế EN và đề xuất JA concurrency2/budget mặc định20s, giữ quality/privacy/cache gates.
- File / phạm vi: [Rà soát và thiết kế M11.3](docs/plans/m11.3-en-ai-ja-latency-2026-11-16.md); entry này. Chưa sửa code nghiệp vụ/DB/ENV/FE.
- Kiểm tra / kết quả: Unit quiz/provider PASS4suites/57tests; đối chiếu benchmark lịch sử06/11 (10câu,6AIcontext,12calls,34,54–35,74s). Không coi đây là benchmark live hiện tại.
- Gate còn thiếu / việc tiếp theo: Chờ duyệt thiết kế triển khai; chưa đo request production cụ thể, chưa kiểm FE live, chưa pilot EN/model thật hoặc triển khai tối ưu.
- Git / triển khai: Chưa commit/push/deploy; giữ WIP khác trong checkout main.


### 2026-11-13 — M12 — Bổ sung gloss display, backfill nghĩa legacy và bảng lỗi cho FE

- Thay đổi / lý do: Theo phản hồi FE, A19 thêm gloss_en/gloss_vi+VI quality flags từ serve.sense_card vào display theo trang để localeEN hết N+1; không đổi meaning_vi trong API read. Script backfill có plan/hash/count/row-lock/CAS, backup fsync và rollback guard. A20 lập bảng code/status, đính chính SRS quota409 và hai tên ENV AI không phải response code.
- File / phạm vi: DTO/repository/spec, M12 HTTPDB test, scripts/review/m12-meaning-vi-backfill.cjs; [handoff tiếp nối](docs/handoff/m12-fe-followup-2026-11-13.md), [bảng lỗi FE](docs/handoff/m12-error-status-fe-2026-11-13.md), [runbook backfill](docs/ops/m12-feedback-sync-2026-11-13/meaning-vi-backfill.md), plan/report/API docs, [receipt sanitize](docs/reviews/m12-fe-followup-2026-11-13/meaning-vi-verification.json). Không sửa source FE/schema/ENV.
- Kiểm tra / kết quả: Node22 full72suite/654unit PASS,4suite/32HTTPDB PASS gồm Swagger/gloss=detail.card và skip/stale/hash/apply/rollback backfill; build PASS, full lint0warning PASS sau sửa format;49link/docs/diff/status PASS. Production đã apply240source chưa sửa có meaning_vi byte-exact gloss_en; verify240/240 khớp VI/nguồn/timestamp, giữ machine provenance và backup private.2user trùngEN giữ nguyên vì không phân biệt autofill với tự nhập.
- Gate còn thiếu / việc tiếp theo: Code gloss đã deployc77be0a; FE cần QA EN và các gate browser/PWA/account/timezone/save-delete-clone chưa kiểm. Assertion216799 of→nước và cold sources optimization còn mở. Không đóng feedback theo QA tự báo.
- Git / triển khai: Codec77be0a đã commit/push/deploy VPS, CI43381237801 PASS654unit/290E2E/31DB3, Deploy43381534499 success. Live OpenAPI/health PASS,12/12display khớp (65ms mẫu service); backfill dữ liệu VPS apply240verified. Docs/receipt sau deploy chốt riêng; không migration. Giữ WIP khác ngoài commit.

### 2026-11-13 — M12 — Deploy BE và đồng bộ handoff FE

- Thay đổi / lý do: Theo yêu cầu push Git/VPS, đã push code4df8655 lên main, CI/deploy thành công; áp Caddy CF trust/client IP và HSTS86400, backup/validate/reload, gỡ log probe tạm. Handoff chuyển sang contract production, liệt kê FE cần sửa và việc BE còn mở.
- File / phạm vi: [Handoff FE](docs/handoff/m12-fe-feedback-sync-2026-11-13.md), [report triển khai](docs/reviews/m12-fe-feedback-remediation-2026-11-13.md), [ops/rollback](docs/ops/m12-feedback-sync-2026-11-13/README.md), API docs/plan và [receipt](docs/reviews/m12-feedback-release-2026-11-13/release-receipt.json). Không sửa source FE/schema/ENV hoặc ghi dữ liệu production.
- Kiểm tra / kết quả: CI43365114780 PASS653unit/289E2E/31DB3; Deploy43365414363 success.8HTTP smoke checks PASS; CF/direct origin IP spoof guard/HSTS PASS,2host study TLS200. Sources READ ONLY pool2 cold4.577ms/warm0,33ms,10caller→8repoqueries;12item/12display giữ meaning_vi, membership đúng face và owner guard. Source hash5file khớp local/VPS; PM2 onlineNode22.23.3, config final khớp candidate. Kiểm staged55link/13JSON PASS, fences/diff/status PASS;2JSON fragment cũ giữ nguyên. Commit riêng13file docs/PROGRESS/artifact, giữ WIP khác.
- Gate còn thiếu / việc tiếp theo: assertion216799 “of → nước” chưa correction; sources cold chưa tối ưu SQL/P95; CF Workers/PseudoIPv4 settings chưa đọc; chưa auth HTTP production/browser/PWA vì không có credentials test, FE cần QA và tích hợp theo handoff. Không đóng feedback hoặc toàn M12 chỉ vì deploy.
- Git / triển khai: Code4df8655 đã commit/push/deploy VPS production. Docs/receipt sau rollout chốt commit riêng; không cần build lại code cho commit chỉ tài liệu. Giữ toàn bộ WIP khác ngoài commit.

### 2026-11-13 — M12 — Sửa BE và đồng bộ FE sau rà soát 12/11

- Thay đổi / lý do: Đã thực hiện phần app của plan: M12-A11 coalesce sources/TTL/settle; A06.1 canonical reverse+aliases; A12 representative trước dedup; A17 VI không dấu/romaji một query/filter metadata romanization/cursorv6; A18 batch saved-senses theo user/profile; A19 include=display batch với cờ glossmáy; A20 private cache/nosniff/Express signature/404. A03 giữ loopback, thêm candidate Caddy+CF CIDRs+harness, chưa apply ops.
- File / phạm vi: src/sources, dictionary, collections, common/config/bootstrap, unit/HTTP tests; [report triển khai](docs/reviews/m12-fe-feedback-remediation-2026-11-13.md), [handoff FE cập nhật](docs/handoff/m12-fe-feedback-sync-2026-11-13.md), [plan](docs/plans/m12-fe-feedback-remediation-2026-11-13.md), [ops candidate/runbook](docs/ops/m12-feedback-sync-2026-11-13/README.md), docs/api collections/dictionary. Không sửa source FE/schema/provider/quota/ENV hoặc trạng thái feedback.
- Kiểm tra / kết quả: Node22.23.3 full72suite/653unit PASS;3suite/28unit kiểm lại flags/collections PASS; full33suite/289E2E PASS trên PostgreSQL17 riêng, target3suite/32HTTP PASS sau sửa alias SQL; buildNode22 và ESLint maxwarnings0 exit0. Caddy2.11.4 validate+harness thật PASS; two-client bucket/spoof/invalid/IPv6/multi/duplicate. Probe READONLY testfixture10cold→8repoqueries, cold19,81ms/warm0,48ms, không đại diện production; link/JSON/diff/status ở bàn giao. Report ghi cả RED và lỗi alias SQL/testhelper đã sửa.
- Gate còn thiếu / việc tiếp theo: Chưa deploy app/FE/ops; A03 zone/Workers/PseudoIPv4/IP live/HSTS còn mở. Đã xác minh readonly assertion216799 of→nước sai nghĩa, chưa apply correction; A12 data/rankingsemantic nước/水 chưa đóng. Chưa benchmark sources quy mô production/P95, chưa browser/PWA2account/onboarding. Không đóng các finding M12 cũ ngoài phạm vi; FE dùng API mới chỉ sau xác nhận môi trường rollout.
- Git / triển khai: Code/test/docs đã lưu local, chưa commit/push/deploy; checkout main, giữ WIP khác. DB test Docker có label/marker/loopback riêng, reset/migrate049 chỉ DB test và đã dừng sau kiểm tra; không sửa VPS/DB thật. Handoff ledger ghi local đã kiểm, production chưa có bản mới. Bàn giao37link local/4JSON/22CIDR+checksum và34file source/test whitespace/Prettier PASS; git diff --check exit0, đã kiểm working tree.

### 2026-11-13 — M12 — Kế hoạch sửa BE và handoff đồng bộ FE sau rà soát 12/11

- Thay đổi / lý do: Theo yêu cầu lập plan/handoff, gom 12 mục report và 18 feedback cụ thể từ FE main00f674d/DB production chỉ đọc; tách BE đã có, BE sẽ sửa, FE làm ngay, FE chờ rollout và việc chưa/không đổi có lý do. Đăng ký M12-A17 tìm không dấu/romaji/mục phiên âm, A18 saved membership, A19 items display projection, A20 cache riêng/header/404; tiếp tục A03/A06.1/A11/A12, không đóng audit cũ.
- File / phạm vi: [Plan M12](docs/plans/m12-fe-feedback-remediation-2026-11-13.md), [handoff FE](docs/handoff/m12-fe-feedback-sync-2026-11-13.md), [review đủ18feedback](docs/reviews/m12-feedback-crosscheck-2026-11-13.md); liên kết từ review/plan index cũ. Không sửa source FE/BE, không thay trạng thái27feedback resolved.
- Kiểm tra / kết quả: Đối chiếu contract/source/plan cũ; 74link local/2JSON ví dụ/fence/whitespace PASS trên5file tài liệu, đủ18rowfeedback; git diff --check exit0 và đã kiểm working tree. 7suite/94unit PASS và probe2item→2MC thuộc lượt review trước, không chạy lại build/unit/E2E/DB trong lượt docs-only; endpoint/projection đề xuất chưa tồn tại, ledger chưa triển khai.
- Gate còn thiếu / việc tiếp theo: Thực hiện từng mục rồi unit/DB/HTTP/OpenAPI/browser/ops; xác nhận commit/push/deploy theo từng dòng ledger trước thông báo “BE đã sửa”. Scope mở rộng, API dịch trả phí, metric SRS theo profile/quiz eligibility là đợt riêng; vẫn giữ gate M12 cũ.
- Git / triển khai: Tài liệu local chưa commit/push/deploy; làm main checkout hiện có, giữ WIP khác. Không gửi message/email FE; file handoff là bản để chuyển cho FE.

### 2026-11-13 — M12 — Đối chiếu trách nhiệm BE trong rà soát FE ngày 12/11

- Thay đổi / lý do: Đối chiếu đủ 12 mục gửi BE với source/contract/plan; phân biệt bug BE, hỗ trợ FE, thay đổi sản phẩm và việc đã có. Đính chính cache sources đã có 10 phút/warmup, scope M6.2 là contract, quiz precheck đã có và không có luật tối thiểu 3 từ; giải thích reviews_today/items_learned.
- File / phạm vi: [Review M12](docs/reviews/m12-fe-audit-crosscheck-2026-11-13.md), entry này; không sửa runtime hoặc báo cáo FE gốc.
- Kiểm tra / kết quả: Node24.22.2, 7 suite/94 unit PASS. Probe service thật + repo mock: 10 sources cold requests →80 calls, warm thêm request không tăng calls; probe wanakana xác nhận honyaku/genin khác hon'yaku/gen'in. Kiểm link local/diff/status ở bàn giao.
- Gate còn thiếu / việc tiếp theo: Chưa kiểm lại live/DB/browser/edge headers/IP, cold query plan, assertion nước/of/水 và metadata awateru. Không đóng bug từ unit xanh; ưu tiên A1 cache cá nhân, M12-A03/A11/A12 và chất lượng search; scope/translation cần chốt sản phẩm trước sửa.
- Git / triển khai: Docs local chưa commit/push/deploy; giữ WIP có sẵn, không đổi FE/BE/ENV/DB.


### 2026-11-06 — M11.1 — Tách model quiz GLM và sửa lỗi tạo quiz

- Thay đổi / lý do: theo yêu cầu chủ dự án, đã đổi ENV production riêng quiz generator+validator sang GLM5.3Flash/low/context60s, chat DeepSeeknone giữ nguyên. Sửa local mismatch FE45s/BE300s; tối ưu source Nhật bỏ lookup sense_card lặp để lấy machineflag; prepareP2028 trả503 theo contract có sẵn, không retry/gọiAI/cleanup sau rollback.
- File / phạm vi: QuizService/repository/controller/OpenAPI +unit/E2E; API docs; helper ops; FE `src/api/quizzes.ts` riêng timeout120s. [Plan](docs/plans/m11.1-quiz-reliability-2026-11-06.md), [report + evidence](docs/reviews/m11.1-quiz-reliability-2026-11-06.md), [handoff +patch FE main](docs/handoff/m11.1-quiz-glm-fe-2026-11-06.md).
- Kiểm tra / kết quả: full69suites/635unitpass;17QuizServicepass sau rút gọn diff;3suites/25E2Equizpass trên Postgres17local `_test`, gồm realexpiry15.1s sau reserve→503/noAI/quota0/quiz0. BuildBE/FE và lintpass. Readonlyparity5184/107/67items deepEqual toàn output; trace lớn6353→2515ms có cachecaveat. Chromeactualmodule/XHRlocal46s pass/1POST/global45s. ProductionnativeGLM10JA/12HTTP200/6context/34.538s; health200DBUTC. Independentreview không blocker. diff/status/link/artifactcheck trước bàn giao.
- Gate còn thiếu / việc tiếp theo: codepatchBE/FE chưa deploy; chưa authenticatedreplay bộ Nhật cụ thể của bạn người dùng; không khẳng định mọi transactiontimeout đã hết. FErepo cóWIP nên fetch/readmain308a1c4, chỉ sửa APIfile/viết docs vàpatch độc lập, không pull đè.120s làbudgetdanhnghĩa không SLA. E2Elần đầuthiếuDB đã khởi tạoDBtestriêng vàrerunpass, không đụngDBproduction.
- Git / triển khai: chủ dự án đã yêu cầu push; đang đóng gói commit M11.1 riêng, kết quả remote ghi trong receipt. Code/docs trước commit còn local. Productionvẫn0cb13d5; chỉ4quizENV đã áp/reload09:34:14UTC (receipt/backupkíntrongreport). Không push/deploy applicationcode; giữ nguyênWIPkhác.

- Cập nhật sau push: BE359fd9e và FEced83c7 đã lên main, remote SHA xác nhận; CI BE42200005152 đang chạy, server vẫn0cb13d5/health200 tại lúc kiểm. [Receipt](docs/reviews/m11.1-quiz-reliability-2026-11-06/push-receipt.json). Chưa xác nhận deploy code; các trạng thái chuẩn bị commit ở trên là lịch sử.

### 2026-11-06 — M10.6 — Deploy DeepSeek, thinking OFF và10lượt học

- Thay đổi / lý do: Chủ dự án yêu cầu thay Groq bằng DeepSeek qua Deploy và tắt thinking, thử10câu học. Secret không lưu Git. Bổ sung none cho chat enum, AI_QUIZ_REASONING_EFFORT optional và forwarding mọi gen/validator/retry; unset/blank giữ hành vi cũ, không đổi API/DB.
- File / phạm vi: config schema/spec, quiz provider/factory/spec, ENV mẫu; [plan](docs/plans/m10.6-deploy-deepseek-2026-11-06.md), [report10lượt](docs/reviews/m10.6-deploy-deepseek-2026-11-06.md), [artifact](docs/reviews/m10.6-deploy-deepseek-2026-11-06/learner-10-summary.json), [runbook](docs/ops/m10.6-deploy-deepseek-2026-11-06.md), [FE handoff](docs/handoff/m10.6-deploy-deepseek-fe-2026-11-06.md).
- Kiểm tra / kết quả: RED env2assert/provider1 trước code; target4suite/47test PASS, full69suite/633unit PASS, build/lint0warning PASS (Node24.22.2). Actual Deploy HTTPS text/stream/ảnh giả/JSON qua OpenAiChatProvider PASS.10lượt conversation dùng prompt Langoo/history thật, fixture giả: input15.870/cached6.656/output2.450/thinking0, 10HTTP200, median3,222s; ước tính$0,001798868 theo giá Deploy, chưa đối chiếu billing. Review độc lập không finding actionable.
- Gate còn thiếu / việc tiếp theo: Code none cần rollout trước ENV mới; production Node22.23.3 vẫn Groq, chưa áp none hoặc đổi provider. Chủ dự án đã chốt rollout riêng tích hợp sau thảo luận giá; không áp quota/billing, không DB migration. Sau rollout cần validate ENV/smoke server, FE recipient/model notice và browser QA, không đóng gate M12.1. Chi phí là ước tính theo cache/độ dài; nội dung học chưa nghiệm thu sư phạm.
- Git / triển khai: Chuẩn bị commit/push/CI và rollout theo yêu cầu; code cần có none trước khi đổi ENV. Preflight VPS33bc219/tracked clean/Groq/không AI_* inject PM2. Không áp gói thu phí hoặc quota, không ghi user/consent thật/mua credit; giữ WIP khác. Kiểm secret/diff/link/status trước commit.

### 2026-11-04 — M12.1 — Ghi nhận điều khoản cho nút chấp nhận tất cả

- Thay đổi / lý do: Theo yêu cầu giữ nút “Chấp nhận tất cả điều khoản và dịch vụ”, BE ba purpose đã đủ; bổ sung receipt terms độc lập theo phiên bản, không tự grant dịch vụ. Manifest thêm terms_version/terms_url; JWT GET/POST /v1/me/legal/terms có ownership/idempotency/version conflict và DB fail503.
- File / phạm vi: Migration048 + Prisma TermsAcceptance, src/privacy DTO/service/controller/module + unit/HTTP tests; [plan](docs/plans/m12.1-accept-all-terms-2026-11-04.md), [review](docs/reviews/m12.1-accept-all-terms-2026-11-04.md), [handoff FE](docs/handoff/m12.1-accept-all-fe-2026-11-04.md), API/CSDL/runbook. Không đổi register/Google DTO, privacy purpose hay global JWT guard.
- Kiểm tra / kết quả: RED manifest1 assertion và HTTP2 route test trước triển khai; HTTP test bắt prefix v1 lặp, đã sửa. Full69suite/630unit và full32suite/277E2E PASS, target15 chạy lại sau cleanup assertion PASS; build, full ESLint0warning, Prisma generate/validate PASS. DB test PostgreSQL16.2 riêng mới có marker, chỉ048 migrate thêm sau reset database mới; cluster đã dừng. Link10/fence/diff/status PASS; review độc lập không finding actionable, lỗi prefix do E2E phát hiện được ghi rõ.
- Gate còn thiếu / việc tiếp theo: BE local chưa apply048 production/deploy; FE thực hiện một click gồm4request/4UUID, partial/replay/refetch theo handoff, onboarding email/Google/user cũ và không auto-grant khi mount. Có đường terms-only/custom; không chứng nhận ép analytics hợp lệ. F1–F5 FE/browser/network QA còn mở, chưa bật enforce. Terms gate toàn app ở FE, chưa server enforcement mọi API.
- Git / triển khai: Người dùng yêu cầu push; đã áp chỉ048 trên VPS, ledger một dòng/table tồn tại, giữ043 pending. Code/docs đang chuẩn bị commit/push; CI/deploy cần xác nhận sau push. Không đổi ENV/FE runtime, giữ WIP khác; kiểm link/diff/status trước commit.

### 2026-11-04 — M12.1 — Kiểm tra FE pháp lý sau triển khai

- Thay đổi / lý do: Theo yêu cầu kiểm FE mới, đối chiếu source `DuyBigPP/LanGoo-User@05829be` và bundle live index-0_F8Rs-R/content-BZ7CVMdj. Đã bỏ 13 tuổi, thêm privacy settings/purpose/ticket; chưa nghiệm thu do 5 finding F1–F5.
- File / phạm vi: [review](docs/reviews/m12.1-fe-postdeploy-2026-11-04.md), [evidence](docs/reviews/m12.1-fe-postdeploy-2026-11-04/evidence.json), [repro](docs/reviews/m12.1-fe-postdeploy-2026-11-04/reproduce.cjs), [kết quả](docs/reviews/m12.1-fe-postdeploy-2026-11-04/reproduction-results.json); liên kết từ handoff hiện hành. Không sửa runtime FE/BE.
- Kiểm tra / kết quả: Tải archive theo SHA, không pull đè checkout/WIP; 30 asset public tải thành công, source/bundle xác nhận mốc 30 ngày và shared cache keys. Node22 + helper nguồn thật/QueryClient5.104 đúng lock tái hiện 4 lỗi: fallback dịch sau withdraw, grant guest thiếu manifest, dùng cache grant A cho B, giữ grant sau refetch503. Mạng vendor/storage đều mock. Health/manifest HTTPS200, enforce false, minimum_age null.
- Gate còn thiếu / việc tiếp theo: FE sửa cache scope/account transition, re-check trước mỗi fetch dịch, timeline theo quyền, fail-closed/cross-tab, consent AI quiz external nhưng giữ local quiz. Browser surface không khả dụng nên chưa kiểm UI/network/authed/cross-tab thực tế; chưa bật enforcement. Pháp lý/vận hành trẻ em/controller/vendor/retention/xóa thủ công vẫn mở.
- Git / triển khai: Report/repro/docs local chưa commit/push; không deploy, không thay ENV/consent/user/ticket hoặc gửi prompt vendor thật. Giữ nguyên WIP khác. Kiểm syntax/JSON/link/diff/status trước bàn giao.

### 2026-11-03 — M12.1 — Quyền riêng tư và quyền dữ liệu

- Thay đổi / lý do: Theo quyết định chủ dự án, bỏ mốc 13 tuổi và không thay bằng 16+; BE công bố policy không giới hạn tuổi, chưa xác minh người đại diện. Bổ sung manifest, event grant/withdraw theo purpose/version với retry idempotent; chặn external AI theo lựa chọn trước từng call/retry, giữ quiz local hoạt động; nhận ticket quyền dữ liệu và hàng đợi admin có audit.
- File / phạm vi: `src/privacy`, tích hợp AI/config, Prisma + migration 047; [plan](docs/plans/m12.1-privacy-controls-2026-11-03.md), [review](docs/reviews/m12.1-privacy-controls-2026-11-03.md), [handoff FE](docs/handoff/m12.1-privacy-fe-2026-11-03.md), [API](docs/api/privacy.md), [runbook](docs/ops/m12.1-privacy-rollout-2026-11-03.md), CSDL tham chiếu và ENV mẫu. Đồng bộ DOCS4 với quyết định tuổi và contract hiện hành.
- Kiểm tra / kết quả: Node22 full unit 69 suites/624 tests và E2E 32 suites/275 tests PASS trên PostgreSQL16.2 riêng; build, ESLint trực tiếp, Prisma generate/validate PASS. Đã sửa 5 finding review độc lập. Chạy lại privacy E2E 5/5 sau validation version rỗng; kiểm link/diff/status trước commit.
- Gate còn thiếu / việc tiếp theo: FE chưa sửa/QA. Cờ bắt buộc grant mặc định false chờ rollout FE, explicit withdraw luôn chặn; chưa đóng toàn finding consent. Ticket chỉ intake/manual, chưa tự export/xóa/vendor/backup hoặc xác minh người đại diện; căn cứ/notice/DPA/retention và người xử lý cần hoàn thiện theo runbook.
- Git / triển khai: Code/API/handoff đã commit/push `46680ed`; CI41574456646 và Deploy41574722395 success. VPS HEAD đúng46680ed; health/manifest HTTPS200, DBok/UTC, age null/enforce false. Đã áp chỉ migration047, ledger một dòng/hai bảng tồn tại; giữ043 đang chờ. Cluster test riêng đã dừng. Không thay ENV hoặc sửa FE; giữ WIP khác. Bổ sung trạng thái sau push ở review/PROGRESS còn local chưa commit/push.

### 2026-11-03 — DOCS4 — Handoff khắc phục pháp lý cho BE, FE và vận hành

- Thay đổi / lý do: Theo yêu cầu chủ dự án, phân công R1–R3/Y1–Y7 thành BE/FE/ops; nêu việc BE cần bổ sung consent evidence/enforcement, quyền dữ liệu/retention và policy tuổi; FE sửa nội dung, onboarding, privacy center, PDF/dịch/analytics. Contract chỉ là đề xuất chưa triển khai; không mặc định tự động xóa tài khoản là nghĩa vụ bắt buộc.
- File / phạm vi: [Handoff DOCS4 BE/FE](docs/handoff/docs4-legal-remediation-be-fe-2026-11-03.md), liên kết từ [audit](docs/reviews/docs4-vietnam-legal-audit-2026-11-03.md). Giữ mã DOCS4; chưa sửa runtime.
- Kiểm tra / kết quả: Đối chiếu BE auth/settings/chat và FE main archive a4e1a64; tải live bundle index-D0op7NmE/LegalArticle-BQhu6Kvg xác nhận vẫn có30ngày/13tuổi; kiểm thuộc tính luật trên nguồn Chính phủ. PASS 2 link local của handoff, code fence hợp lệ, phân công đủ10nhóm audit; git diff --check exit0 và đã kiểm working tree. Không chạy unit/build cho docs-only.
- Gate còn thiếu / việc tiếp theo: Chốt chủ thể/căn cứ/vendor/tuổi/retention/người xử lý yêu cầu; thiết kế và triển khai BE/FE sau handoff, test DB/browser/network và hồ sơ pháp lý. Checkbox QA trong handoff chưa chạy.
- Git / triển khai: Tài liệu local chưa commit/push/deploy; không đổi BE/FE/DB/ENV/VPS. Giữ WIP của các hạng mục khác.

### 2026-11-03 — DOCS4 — Audit pháp lý website Langoo theo luật Việt Nam

- Thay đổi / lý do: Rà soát source backend, frontend local và bundle công khai langoo.org theo `.vn-law-check`; xác minh văn bản Chính phủ và bản scan ký số. Ghi nhận 3 nhóm cần xử lý ngay (consent/căn cứ xử lý, SLA quyền dữ liệu, người dùng dưới 16 tuổi), 7 nhóm cải thiện/xác minh và 3 nhóm có bằng chứng đáp ứng một phần. Phát hiện checklist dẫn sai Điều 39 về miễn trừ; báo cáo đối chiếu đúng Điều 38 và không suy diễn miễn hồ sơ chuyển dữ liệu theo quy mô nhỏ.
- File / phạm vi: [Plan DOCS4](docs/plans/docs4-vietnam-legal-audit-2026-11-03.md), [báo cáo DOCS4](docs/reviews/docs4-vietnam-legal-audit-2026-11-03.md), [evidence](docs/reviews/docs4-vietnam-legal-audit-2026-11-03/evidence.md) và manifest JSON. Chỉ thêm tài liệu audit; giữ WIP của các việc khác.
- Kiểm tra / kết quả: Script scan hoàn tất; tải HTTP trang pháp lý/register và JS production thành công; đối chiếu chunk thay vì dùng frontend local cũ để kết luận thiếu policy. API public health/sources trả 403 từ đường truy cập audit. PASS 3 link nội bộ của bộ tài liệu, JSON evidence hợp lệ, 16 hash chunk khớp bản tải và `git diff --check` exit 0; đã kiểm working tree. Không chạy build/unit vì không sửa code.
- Gate còn thiếu / việc tiếp theo: Chưa browser E2E/network, thực thi quyền dữ liệu, kiểm DB/runtime ENV, pháp nhân, DPA/DPIA/biên nhận chuyển dữ liệu. Cần người phụ trách và luật sư xác minh các nhóm rủi ro; không coi thiếu hồ sơ trong repo là bằng chứng vi phạm.
- Git / triển khai: Tài liệu local chưa commit/push/deploy; không thay đổi website, backend, DB hoặc repo FE. Đây là kết quả rà soát sơ bộ, chưa phải nghiệm thu tuân thủ pháp lý.

### 2026-11-03 — M4.5 — Trả nghĩa trong gợi ý tìm kiếm

- Thay đổi / lý do: Suggestions trước chỉ có preview JA; bổ sung EN bằng cùng helper/policy batch như search để FE hiển thị nghĩa ngay. Trả qua preview.gloss_vi, giữ machine/reviewed/sense_id và fallback EN/definition; không thay ranking/scope/limit5/history.
- File / phạm vi: Dictionary service/spec, controller/DTO descriptions, docs/api/dictionary.md; [plan](docs/plans/m4.5-suggestions-meanings-2026-11-03.md), [review](docs/reviews/m4.5-suggestions-meanings-2026-11-03.md), [handoff FE](docs/handoff/m4.5-suggestions-meanings-fe-2026-11-03.md).
- Kiểm tra / kết quả: RED 2 ca EN preview undefined; GREEN full unit Node22 68 suites/613 tests PASS. Node22 build và ESLint thực exit0; wrapper lint lần đầu parse lỗi không tính pass. Link tài liệu và git diff --check PASS; đã đọc diff runtime và kiểm working tree.
- Gate còn thiếu / việc tiếp theo: Chưa HTTP/DB E2E hoặc FE/browser/live smoke; FE cần render preview theo handoff. Preview có thể vắng nếu không có sense/card hợp lệ theo policy hiện có.
- Git / triển khai: Commit/push theo yêu cầu 03/11/2026; CI/deploy sau push cần xác nhận riêng. Không migration/dependency/ENV/DB; giữ WIP của các việc khác.

### 2026-11-03 — M2.5 — Thu hồi access token ngay khi đăng xuất

- Thay đổi / lý do: Theo yêu cầu chủ dự án, thay thiết kế access token stateless bằng kiểm session mỗi request có token. Logout vô hiệu mọi access/refresh token của đúng session; giữ phiên khác, retry idempotent và timestamp revoke ổn định. Optional/admin/feedback cùng kiểm session; DB lỗi guard trả503, session/user không hợp lệ trả401.
- File / phạm vi: `src/auth/`, `src/feedback/feedback-rate-limit.guard.ts`, E2E revocation; [plan](docs/plans/m2.5-immediate-logout-revocation-2026-11-03.md), [review](docs/reviews/m2.5-immediate-logout-revocation-2026-11-03.md), [handoff FE](docs/handoff/m2.5-immediate-logout-revocation-fe-2026-11-03.md), [API auth](docs/api/auth.md). Không migration/ENV/dependency mới.
- Kiểm tra / kết quả: RED guard12 failures và HTTP10 failures trước sửa; GREEN 68 suite/611 unit, 31 suite/270 E2E trên PostgreSQL16.2 riêng port55440/Node22; targeted auth/feedback80 và HTTP revocation10 pass. Build/lint và review độc lập kiểm trước commit.
- Gate còn thiếu / việc tiếp theo: FE cần clear credential/cache và abort stream; không hủy request đã qua guard trước revocation. Mỗi request token thêm query DB, chưa benchmark production. Các finding M12-A01…A15 có kế hoạch riêng, chưa sửa trong M2.5; M2.3 email/recovery vẫn chưa làm.
- Git / triển khai: Code/test/docs đã kiểm local; commit/push theo yêu cầu sau review. CI tự deploy sau push; xem review M2.5 để cập nhật kết quả thực tế. Giữ nguyên WIP khác.

### 2026-10-30 — M5.3 — Đề xuất kỹ thuật & sản phẩm: Import bộ từ bên thứ ba (Mazii, Anki, Quizlet, Excel)

- Thay đổi / lý do: Phân tích toàn diện 5 thách thức kỹ thuật (DB anchor_sense_id NOT NULL, WSD đa nghĩa, OOV từ ngoại lai, SRS backlog flood, encoding/timeout) và đề xuất kiến trúc 4 trụ cột (User Custom Sense, 3-Tier Matcher, Paced Staggering, Chunked Batch Preview API) phục vụ duyệt chủ trương triển khai.
- File / phạm vi: [Tài liệu đề xuất trình cấp trên](docs/plans/m5.3-vocabulary-import-proposal-2026-10-30.md), PROGRESS. Không thay đổi code/schema hay deploy trong phiên này.
- Kiểm tra / kết quả: Đối chiếu triết lý sản phẩm CONTEXT-DU-AN.md §1.3, schema app.collection_item và core.sense; tài liệu format chuẩn markdown, không lỗi whitespace `git diff --check`.
- Gate còn thiếu / việc tiếp theo: Chờ cấp trên/chủ dự án phê duyệt đề xuất chủ trương; sau khi duyệt sẽ lập Technical Implementation Plan cho Phase 1 (MVP: Mazii CSV/Excel + Batch Preview API + Custom Sense).
- Git / triển khai: Tài liệu local chưa commit/push; không sửa đổi DB/VPS hay deploy.


### 2026-10-30 — M5.2 — Sắp xếp item collection tăng/giảm với cursor

- Thay đổi / lý do: Thêm order=asc|desc cho GET collection items để FE lấy position lớn nhất từ trang đầu, không phải tải toàn bộ rồi đảo. Mặc địnhasc/limit20/max100 và filters/ownership giữnguyên; cursor desc boundhướng và keysetlt/lt, legacyasc tươngthích.
- File / phạm vi: DTO/controller/service item, cursorhelper+tests và E2E M5.2; [plan](docs/plans/m5.2-collection-items-order-2026-10-30.md), [API](docs/api/collections.md), [FE handoff](docs/handoff/m5.2-collection-items-order-2026-10-30.md), [report](docs/reviews/m5.2-collection-items-order-2026-10-30.md). Khôngđổi schema/dependencies/M14WIP.
- Kiểm tra / kết quả: Target29unit pass (đãquan sátRED9), build/full lintpass, full63suites/557unitpass. LocaltestDBcũ offline; khởi tạo PostgreSQL16clusterriêng55436/langoo_m52_test, 3suite/20HTTP+DBtestpass gồm cursor tiedpositions/exclusiveboundary/defaultasc/directionmismatch/invalidquery. Cluster riêngđãstop/xóa. ReviewLuna độclập khôngfinding quantrọng; format/link/diff/status đãkiểm.
- Gate còn thiếu / việc tiếp theo: Chưa productionHTTP smoke hoặc FE/browser. Đổiorder phải resetcursor; sorttheopositionhiệntại khôngphải created_at khi userđãreorder.
- Git / triển khai: Code/test/docs local chưa commit/push/deploy; khôngsửaDB/VPSapp hoặc gomWIP khác.

### 2026-10-30 — M14.2 — Tự động export ảnh đã tạo khi Muse trả tên file

- Thay đổi / lý do: Muse có lượt chỉ trả workspace/tên4PNG mà khôngattachmedia; worker bảo toàn ở8/76. Luna export-only cùngownedthread lấyđược4ảnh đãtạo, resumeđạt12/76. Bổsung fallbackgeneric tự yêu cầuattachment filehiệncó, khônggenerate/reroll hoặc sceneviếttay.
- File / phạm vi: batch-worker.mjs ensureImageDelivery/ownedmarker/intent+replay/newassistantguard; batch-policy.mjs/test deliveryprompt theoID; cậpnhật [ops](docs/handoff/m14.2-restaurant-76-automation-2026-10-30.md)/[report](docs/reviews/m14.2-restaurant-76-automation-2026-10-30.md). KhôngđụngscopeAPI M5.2.
- Kiểm tra / kết quả: Policy12/12pass vớiRED→GREEN, workersyntaxpass. Đãkhôi phục4ảnhcóthật512PNG trênVPS/R2/DB màkhôngdownloadlocal hoặcgọiimagegenerationmới; kếtiếpworkerresume tựđộngđểtracktoàn76.
- Gate còn thiếu / việc tiếp theo: Chưa76/76, Luna tiếptụctrack vàchỉbáođủkhi finalverify. Quotaunavailable, API/FEđọcảnhchưa có.
- Git / triển khai: Local chưa commit/push. ChỉupdateworkerCLI/service riêng trênVPS; khôngdeploy/restartapp. Khôngxóa/dropcheckpoint hoặc secretfilekhi jobchưađủ.

### 2026-10-30 — M14.2 — Phân loại thể chia tiếng Anh cho ảnh AI (4 nhóm)

- Thay đổi / lý do: Theo yêu cầu chủ dự án, phân loại toàn bộ từ và concept thể chia tiếng Anh trong CSDL thành 4 nhóm chuẩn xác để chuẩn hoá hàng đợi sinh ảnh AI, tránh lãng phí quota Muse và không phải rà soát thủ công lại.
- File / phạm vi: `scripts/media/classify-inflections.mjs`; [báo cáo phân loại chi tiết](docs/reviews/m14.2-english-inflected-classification-2026-10-30.md), PROGRESS. Truy vấn READ-ONLY DB VPS.
- Kiểm tra / kết quả: Tầng Concept có 10.397 concept phái sinh (-ed/-ing/-en) gồm Nhóm 1 (Tính từ trực quan: 5.428), Nhóm 2 (Danh từ hoạt động/nghề/hiện vật: 4.279), Nhóm 3 (Động từ chia thì: 453), Nhóm 4 (Trừu tượng/trợ từ: 237). Tầng Sense thuần ngữ pháp có 26.615 senses gồm Nhóm 3 (26.601 senses kế thừa từ gốc) và Nhóm 4 (14 senses bỏ qua).
- Gate còn thiếu / việc tiếp theo: Áp dụng bộ lọc 4 nhóm vào worker sinh ảnh hàng loạt; cấu hình API backend fallback ảnh từ gốc cho Nhóm 3.
- Git / triển khai: Script và tài liệu local chưa commit/push; không sửa đổi schema, dữ liệu DB hay deploy app.

### 2026-10-30 — M14.2 — Worker tự động tạo/lưu 76 ảnh còn thiếu (đang chạy)

- Thay đổi / lý do: Chủ dự án yêu cầu tạo hết76nghĩa thiếu, tự scene/prompt, R2/DB tự động, không lưu bytes ảnh local. Worker VPS chạy theo source definition/POS, morphology và candidate retrieval; không prompt viết tay từng từ.
- File / phạm vi: `scripts/media/batch-{cohort,candidates,policy,worker,status}.mjs`, service unit, tests; helper profile auto và registrar assetOnly; [plan](docs/plans/m14.2-restaurant-76-automation-2026-10-30.md), [ops](docs/handoff/m14.2-restaurant-76-automation-2026-10-30.md). Không đổi schema/appAPI.
- Kiểm tra / kết quả: Full30/30 tests pass, review phát hiện3resume blockers đã sửa/test và review lại không blocker; policy9/9, SDK audit0vulnerabilities. READONLY cohort76/330candidate ban đầu, generic lexical/FTS enrichment; configephemeral0600root, R2preflight200. Service VPS đang chạy bounded76; lượt đầu plannerJSON lỗi cúpháp đã xửlý trước khi tạoảnh, không resendgeneration.
- Gate còn thiếu / việc tiếp theo: Chưa hoàn tất76, đang monitor job; chỉ báo số đã register/hash thực tế. Cần finalcoverage116, giữ44ảnh/link cũ, kiểm noimagefileslocal, docs/diff/status. QuotaMuse chưa cómeter đángtin; API/FE chưa tíchhợp ảnh.
- Git / triển khai: Code/test/docs local chưa commit/push. Worker CLI/service riêng đã start VPS; không deploy/restart app. Ảnh quaRAM lênR2; keyR2 riêng /run0600 sẽ xóa khi complete.

### 2026-10-30 — M14.2 — Khảo sát quy trình tạo khoảng 1.000 ảnh từ vựng

- Thay đổi / lý do: Đánh giá Universal Prompt và pipeline scene→ảnh→QA theo câu hỏi chủ dự án; đề xuất dùng nghĩa/POS DB, baseline C, một ảnh/concept, scene có kiểm đa dạng và rollout nhỏ có checkpoint/ngân sách retry.
- File / phạm vi: [Khảo sát/phương án](docs/reviews/m14.2-vocabulary-images-1000-options-2026-10-30.md), PROGRESS; chưa implement design/worker hoặc đổi API/schema.
- Kiểm tra / kết quả: Đối chiếu prompt/summary/manifest lô1–3 và script runner/storage hiện có; xác minh R2 pricing chính thức và tham khảo GenEval. Có timing lô nhỏ nhưng quota unavailable; không hứa chi phí hay throughput bulk. Docs links/diff/status đã kiểm.
- Gate còn thiếu / việc tiếp theo: Chưa chọn cohort/pilot hoặc tạo ảnh; cần phân biệt 1.000 ảnh mới với phủ tổng1.000concept, và kiểm mẫu baseline/hybrid trước rollout. Chưa có meter quota Muse đáng tin.
- Git / triển khai: Docs local chưa commit/push. Không gọi Muse, ghi DB/R2, deploy hoặc mở job1.000 trong lượt tư vấn.

### 2026-10-30 — M14.1 — Upload và gắn đủ 40 ảnh lô 1–2

- Thay đổi / lý do: Chủ dự án làm rõ phải gắn cả 40 ảnh trước; đã upload/gắn thêm đủ 20+20 ngoài 4C. Dùng explicit anchor definition/POS, giữ default-accept ảnh, không gọi thêm Muse hoặc tạo ảnh.
- File / phạm vi: `scripts/media/` profiles/helper/uploader/receipt/registrar/tests, bulk40-anchors và binding từng lô; CSDL/README/[plan](docs/plans/m14.1-r2-concept-images-2026-10-30.md)/[handoff](docs/handoff/m14.1-cloudflare-r2-setup-2026-10-30.md)/[report + link40ảnh](docs/reviews/m14.1-r2-all40-images-2026-10-30.md). Không thêm migration/app dependency hoặc đổi API/schema.
- Kiểm tra / kết quả: Full20/20 tests pass, review độc lập không blocker. Thêm40PNG R2 (13.441.764 bytes) GET S3/public đúng hash. Tổng44imageasset/44approvedlink, 40primary/4alternate trên40concept; view40. Bốn C giữ primary/provenance, source/mapping/status trước/sau khớp; mediaasset6461, kanjimedia6417, concept120875. Upload rerun PUT0; register/bind rerun không trùng. Syntax/format/link/diff/status đã kiểm.
- Gate còn thiếu / việc tiếp theo: API/FE đọc ảnh và gallery alternate chưa triển khai. Không tự xử lý 4B lô3 hoặc toàn kho95.258 concept ngoài phạm vi40ảnh được yêu cầu.
- Git / triển khai: Code/test/bindings/docs local chưa commit/push. Object R2 và data DB VPS đã apply theo yêu cầu; không deploy/restart app, không đổi ENV/credentials hoặc lưu bytes ảnh trên VPS.

### 2026-10-30 — M14.1 — Gắn đủ bốn ảnh theo chính sách mặc định dùng

- Thay đổi / lý do: Chủ dự án yêu cầu bỏ việc duyệt Muse toàn kho và gắn hết ảnh hiện có. Áp migration046 riêng cho view ảnh, cho concept draft dùng ảnh mà không đổi trạng thái concept hoặc mapping từ điển.
- File / phạm vi: `046_concept_image_default_accept.sql`, `scripts/media/bind-existing.mjs`, tests, binding JSON, CLI migration allowlist; cập nhật CSDL/README/[plan](docs/plans/m14.1-r2-concept-images-2026-10-30.md)/[handoff](docs/handoff/m14.1-cloudflare-r2-setup-2026-10-30.md)/[report](docs/reviews/m14.1-r2-concept-images-2026-10-30.md). Không sửa 045 đã apply.
- Kiểm tra / kết quả: Full 17/17 tests pass; sau delta khóa/gate chạy lại binding 4/4 pass, review độc lập không blocker. VPS migration046 + bind apply/rerun thành công; view và concept_media đều 4. breakfast→91622, fry→32506, spicy→21297, picnic→91634 đều approved primary. Dùng anchor nghĩa tương đương cho breakfast/spicy, giữ source gốc; asset/mapping/status/provenance picnic trước/sau khớp, không trùng. Syntax/format/link/diff/status kiểm trước bàn giao.
- Gate còn thiếu / việc tiếp theo: API/FE chưa tích hợp ảnh. Phạm vi bốn ảnh C hiện có; không chạy job Muse 95.258 concept hoặc tạo thêm ảnh.
- Git / triển khai: Local chưa commit/push. Schema/data đã apply DB VPS theo yêu cầu hiện tại; không deploy/restart app hoặc đổi ENV/credentials.

### 2026-10-30 — M14 — Khảo sát duyệt toàn bộ concept bằng Muse

- Thay đổi / lý do: Đối chiếu lại chính sách nội dung máy mặc định dùng được (15/10); đính chính curated không đồng nghĩa người đã duyệt. Khảo sát phạm vi trước khi chọn mục tiêu Muse duyệt hàng loạt.
- File / phạm vi: [Handoff M14, ghi chú 30/10](docs/handoff/m14-curation-2026-10-15.md); PROGRESS. Chỉ query DB VPS READ ONLY.
- Kiểm tra / kết quả: 95.258 draft đều có gloss_en và ít nhất một mapping exact verified confidence ≥ 0.7; chỉ 1.905 có core.concept.gloss_vi, 93.353 chưa có. Không suy số này thành thiếu core.sense_gloss hoặc chất lượng đã bảo đảm. Link/diff/status đã kiểm.
- Gate còn thiếu / việc tiếp theo: Phân biệt kiểm lại mapping/định nghĩa với bổ sung nghĩa Việt; chưa đo quota/tốc độ lượt mới, chưa gọi Muse hoặc bulk chuyển curated.
- Git / triển khai: Tài liệu local chưa commit/push; không sửa DB/schema/API hoặc deploy app.

### 2026-10-30 — M14.1 — Lưu ảnh Muse trên R2 và liên kết concept

- Thay đổi / lý do: Hoàn tất pilot 4 ảnh C lên bucket thật `langoo-image`, domain `media.langoo.org`; sau duyệt rõ ràng của chủ dự án đã apply migration 045 và đăng ký metadata/concept. Ảnh lưu R2, không chiếm dung lượng ảnh trên VPS.
- File / phạm vi: `scripts/media/`, `db/migrations/045_concept_images.sql`, `CSDL-THAM-CHIEU.md`; [plan](docs/plans/m14.1-r2-concept-images-2026-10-30.md), [handoff](docs/handoff/m14.1-cloudflare-r2-setup-2026-10-30.md), [report và link ảnh](docs/reviews/m14.1-r2-concept-images-2026-10-30.md). Credentials chỉ ở home config 0600 ngoài Git/VPS.
- Kiểm tra / kết quả: 13/13 Node/PGlite tests pass, review độc lập không finding quan trọng; 4 ảnh S3/public GET đúng hash, rerun PUT 0. DB VPS asset 6418–6421; picnic→91634 approved primary, fry→32506 pending, breakfast/spicy chưa mapping. Rerun DB tạo 0 asset; view trả 1 ảnh; 6.417 kanji media và 120.875 concept giữ nguyên, mapping/status trước/sau khớp. Syntax/format/link/diff/status đã kiểm.
- Gate còn thiếu / việc tiếp theo: Chưa tích hợp API/FE; breakfast/spicy cần mapping, fry cần curation. Không tự curated/map bằng chữ; không tạo thêm ảnh hoặc dùng thêm quota sinh ảnh trong lượt này.
- Git / triển khai: Code/test/docs local chưa commit/push. Migration 045 và dữ liệu đã apply DB VPS theo duyệt; chưa deploy app hoặc đổi ENV runtime. Giữ WIP khác.

### 2026-10-30 — DOCS3 — Prompt ảnh điện thoại: 8 mẫu mới và so sánh A/B/C

- Thay đổi / lý do: Theo phản hồi ảnh quá nét/dàn dựng, tra nguồn Adobe và nghiên cứu realism; thử 4 từ × 2 prompt tiếng Anh, dùng lại 4 ảnh A lô cũ. Tải/xem đủ 8 PNG 512×512 mới (3.302.920 bytes), preview 12 ảnh A/B/C. C mềm/rộng hơn ở một số mẫu, vẫn có ảnh kiểu stock và thiên lệch bối cảnh cũ; chưa chốt tối ưu toàn cục.
- File / phạm vi: [Plan lô 3](docs/plans/docs3-muse-image-pilot-2026-10-30.md), [report nguồn/prompt/ảnh](docs/reviews/docs3-muse-phone-prompt-2026-10-30.md); script spike nhận custom batch 1..20 với sample ID variant. Artifacts `uploads/docs3-muse-images-20261030-batch3/` (gitignored), giữ các lô trước.
- Kiểm tra / kết quả: Syntax/format/diff, cohort 4 sense/8 sample ID, ảnh/hash/UI labels, xem trực quan, 4 tham chiếu không đổi bytes, ZIP/link và health. Lượt đầu trả 4/8; lượt tiếp chỉ tạo 4 còn thiếu, không reroll. Hai runner tổng 280,69s, không tính khoảng chuẩn bị giữa lượt; quota chưa đo được.
- Gate còn thiếu / việc tiếp theo: Chủ dự án xem B/C và chọn hướng; chưa có seed/replicate để chứng minh ổn định, quota accounting, formal curation hoặc test bulk. Không suy số từ thành token/chi phí.
- Git / triển khai: Script/plan/report/PROGRESS local chưa commit/push; không đổi app/DB/ENV/deploy. Dịch vụ VPS giữ trạng thái active như trước; không lưu kho ảnh lên VPS.

### 2026-10-30 — DOCS3 — Lô 2: 20 ảnh Muse đời thường và đa dạng

- Thay đổi / lý do: Theo yêu cầu chủ dự án, thêm 20 nghĩa không trùng lô 1 từ bộ Ẩm thực & Nhà hàng; brief riêng tạo 14 ảnh giả lập chụp sinh hoạt, 2 tranh mực, 1 chì màu, 2 cắt giấy, 1 comic. Tải và xem đủ 20 PNG 512×512; 9.154.279 bytes, kết quả ổn định sau 307,02s, toàn runner 317,77s. Quota thực vẫn chưa đo được.
- File / phạm vi: [Plan lô 2](docs/plans/docs3-muse-image-pilot-2026-10-30.md), [report lô 2](docs/reviews/docs3-muse-image-batch2-2026-10-30.md); script spike nhận prompt/marker tùy chọn và ghi nhãn UI. Artifacts riêng ở `uploads/docs3-muse-images-20261030-batch2/` (gitignored), giữ nguyên lô 1.
- Kiểm tra / kết quả: Syntax/format, cohort/hash không trùng lô 1, decode/verify 20 PNG, đối chiếu filename/nghĩa, xem trực quan 20 ảnh, ZIP CRC/link/diff. Muse hoán đổi IDs stir/marinate trong raw reply; manifest đã lấy đúng cohort (`stir=2462808`, `marinate=898972`), không ghi DB. Dịch vụ browser/display/bridge giữ active như trước lô; health app/DB ok.
- Gate còn thiếu / việc tiếp theo: Chưa có quota meter, formal curation, đo trí nhớ, WebP hoặc storage/bulk production; ảnh AI chưa xuất bản. Không chạy test ứng dụng vì chỉ spike.
- Git / triển khai: Script/plan/report/PROGRESS local chưa commit/push; không deploy hoặc apply DB. Giữ nguyên các tài liệu PDF untracked có sẵn.

### 2026-10-30 — DOCS3 — Thử 20 ảnh Muse từ bộ Ẩm thực & Nhà hàng

- Thay đổi / lý do: Theo yêu cầu chủ dự án, chạy pilot Muse web một lô 20 nghĩa thật từ deck `en-restaurant-dining`; tải đủ 20 PNG 512×512 về local, tổng 4.287.485 bytes. Kết quả DOM ổn định sau 331,83s; toàn runner gồm nhận file 340,45s. Chưa đo được quota/token, không suy là miễn phí hoặc tiêu thụ 0.
- File / phạm vi: [Plan](docs/plans/docs3-muse-image-pilot-2026-10-30.md), [report](docs/reviews/docs3-muse-image-pilot-2026-10-30.md), `scripts/ops/muse-native/image-pilot-browser.mjs`; ảnh/ZIP/preview/evidence ở `uploads/docs3-muse-images-20261030/` (gitignored). Không đổi API/DB/ENV.
- Kiểm tra / kết quả: Syntax/format script, decode/kích thước/hash của 20 ảnh khác nhau, đối chiếu tên UI với cohort, xem trực quan cả 20 ảnh, kiểm ZIP/link/diff. Browser/display bật tạm để đăng nhập lại được hoàn nguyên inactive; bridge giữ active; health app/DB kiểm sau thử. Không chạy test ứng dụng.
- Gate còn thiếu / việc tiếp theo: Không có meter usage số đáng tin để đo trước–sau; chưa formal curation, xác minh điều khoản đầu ra, nén WebP hoặc triển khai R2/bulk. Native cũ lỗi DecodeError, dùng browser fallback cho pilot.
- Git / triển khai: Chưa commit/push; không deploy hoặc apply DB. Giữ nguyên các tài liệu PDF untracked có sẵn.

### 2026-10-30 — DOCS3 — Đối chiếu Muse Image, quota web và dung lượng lưu ảnh

- Thay đổi / lý do: Bổ sung [báo cáo DOCS3, mục 7](docs/reviews/docs3-vocabulary-illustration-options-2026-10-30.md#7-bổ-sung--muse-và-lưu-ảnh-ngoài-vps): tách quota Muse web chưa đo với giá API Muse Image; khuyến nghị pilot 20 nghĩa và R2 ngoài VPS.
- File / phạm vi: Chỉ báo cáo và PROGRESS. SSH read-only `date -u; df -h /; df -i /; free -m`: root 76% đã dùng, còn 6.8G; RAM available 763 MiB tại 2026-10-30 00:40:45 +07.
- Kiểm tra / kết quả: Đọc báo cáo M10.4/M10.5; tra docs chính thức Meta Image/pricing và R2; kiểm diff/link tài liệu. Không gọi Muse tạo ảnh, không tiêu quota generation, không sửa runtime.
- Gate còn thiếu / việc tiếp theo: Chưa đo usage/latency ảnh tài khoản web, chưa xác minh quyền sử dụng đầu ra theo điều khoản tài khoản hoặc billing R2; chưa triển khai storage/API.
- Git / triển khai: Chưa commit/push; không deploy hoặc dọn dữ liệu VPS.

### 2026-10-30 — DOCS3 — Phương án ảnh minh họa từ vựng

- Thay đổi / lý do: Nghiên cứu cách có ảnh minh họa đúng nghĩa, giảm rủi ro bản quyền, thời gian và chi phí; khuyến nghị AI tạo trước kết hợp asset CC0, tái sử dụng qua concept đã duyệt hoặc gắn sense khi chưa có mapping đạt chất lượng.
- File / phạm vi: [Báo cáo DOCS3](docs/reviews/docs3-vocabulary-illustration-options-2026-10-30.md); đối chiếu schema media, DTO từ điển, storage và 20 deck EN được ghi trong tiến độ. Chỉ tài liệu, không sửa code/DB.
- Kiểm tra / kết quả: Đối chiếu nguồn chính thức về giấy phép, giá API và hạn chế dịch vụ; kiểm link nội bộ, `git diff --check` và trạng thái Git. Không chạy test ứng dụng hoặc gọi API tạo ảnh.
- Gate còn thiếu / việc tiếp theo: Pilot đề xuất 100 nghĩa, đo công duyệt/chi phí thực và chốt provider; chưa triển khai hay coi ảnh AI/CC0 là bảo đảm tuyệt đối về quyền.
- Git / triển khai: Báo cáo và entry chưa commit/push; không deploy. Giữ nguyên tài liệu PDF untracked có sẵn.

### 2026-10-28 — M2.4 — Liệt kê phương thức đăng nhập và trạng thái liên kết Google trong GET /v1/auth/me

- Thay đổi / lý do: Khắc phục tình trạng người dùng đăng nhập bằng tài khoản Google bị giao diện Cài đặt/Hồ sơ yêu cầu nhập mật khẩu để liên kết Google (do FE không có thông tin định danh để ẩn/hiện khối liên kết).
- Triển khai:
  - Nâng cấp `UserResponse` và `UserResponseDto` bổ sung 3 trường: `identities` (mảng danh tính `{ provider, created_at }`), `has_password` (boolean), và `has_google` (boolean).
  - Cập nhật helper `toUserResponse` trong `src/auth/session.helpers.ts` để trích xuất trạng thái `has_password` và `has_google` từ `user.identities`.
  - Cập nhật `me(userId)` trong `src/auth/auth.service.ts` để nạp `include: { identities: true }`.
  - Cập nhật `login` và `register` (email+password) và `google-oauth.service.ts` (`applyLogin`) để luôn trả về đầy đủ `identities`.
  - Viết tài liệu bàn giao FE: [docs/handoff/m2.4-auth-me-identities-fe-handoff.md](docs/handoff/m2.4-auth-me-identities-fe-handoff.md).
- File / phạm vi:
  - `src/auth/types/auth.types.ts`
  - `src/auth/dto/auth-response.dto.ts`
  - `src/auth/session.helpers.ts`
  - `src/auth/auth.service.ts`
  - `src/auth/oauth/google-oauth.service.ts`
  - `src/auth/auth.service.spec.ts`
  - `docs/handoff/m2.4-auth-me-identities-fe-handoff.md`
- Kiểm tra / kết quả: `auth.service.spec.ts` 23/23 pass (bổ sung test kiểm tra `has_google`, `has_password` và danh sách `identities`); toàn bộ 6 test suite `src/auth` pass (58/58 test); `npx tsc --noEmit` pass; `npx prettier -c "src/auth/**"` pass; `git diff --check` pass.
- Gate còn thiếu / việc tiếp theo: Frontend đọc `user.has_google` để hiển thị badge "Đã liên kết" và ẩn form nhập mật khẩu.
- Git / triển khai: Commit `486de5f` đã push `main`; deploy VPS qua `deploy.sh` thành công (PM2 reload, health 200 OK, latency 1ms).

### 2026-10-28 — M7.3 — Sửa kiểu matcher trong test xoá từ khỏi phiên

- Thay đổi / lý do: Kiểm tra trước push M6 phát hiện hai lỗi lint có sẵn do matcher Jest lồng nhau trả `any`; thêm `as unknown`, giữ nguyên assertion và hành vi runtime.
- File / phạm vi: `src/sessions/sessions.service.spec.ts` và [entry handoff M7.3](docs/handoff/m7.3-in-session-remove-word-fe-handoff.md).
- Kiểm tra / kết quả: Lint toàn snapshot pass; hai suite SRS/sessions pass 13/13 test (9 test M7.3). Snapshot không gồm WIP auth đồng thời trong checkout.
- Gate còn thiếu / việc tiếp theo: Đã kiểm tra local; CI/E2E chạy sau push. Không đổi API hoặc migration.
- Git / triển khai: Commit `12583fc` đã push `main` cùng release M6 `bf86175`; CI `40639436179` chờ kết quả, chưa xác nhận deploy.

### 2026-10-28 — M6 — Bổ sung từ loại vào dữ liệu flashcard SRS

- Thay đổi / lý do: Theo yêu cầu chủ dự án, API `/v1/srs/due` trả thêm `pos: string | null` trong nội dung `kind=word`, lấy từ dữ liệu đã query; recognize ở `prompt.pos`, recall ở `answer.pos`.
- File / phạm vi: Mapper SRS, response type/Swagger DTO, regression test, API docs và [handoff FE](docs/handoff/m6-flashcard-pos-2026-10-28.md). Không đổi FE, query DB, migration hoặc snapshot `/sessions`.
- Kiểm tra / kết quả: Bốn ca recognize/recall × có/thiếu từ loại RED→GREEN; toàn bộ unit pass 62 suite/544 test. Snapshot đúng phạm vi commit: build/lint pass, hai suite ảnh hưởng pass 13/13 test. Checkout chung từng build lỗi auth WIP; không gom phần đó. `git diff --check` pass.
- Gate còn thiếu / việc tiếp theo: FE thêm type/nhãn từ loại; kết quả CI/E2E và trạng thái deploy sẽ ghi đúng sau push.
- Git / triển khai: Commit `bf86175` đã push `main` theo yêu cầu; CI `40639436179` đã tạo, chưa có kết quả tại thời điểm ghi. Pipeline tự deploy khi CI xanh; chưa xác nhận deploy/FE.

### 2026-10-28 — DOCS1 — Handoff FE sửa an toàn đổi file và lưu ghi chú PDF

- Thay đổi / lý do: Theo yêu cầu chủ dự án, soạn [yêu cầu chi tiết cho FE](docs/handoff/docs1-pdf-file-safety-fe-2026-10-28.md) cho P1 ghi nhầm file và P2 mất ghi chú khi đổi tài liệu.
- File / phạm vi: Handoff gồm tái hiện, nguyên nhân, các file FE liên quan, yêu cầu snapshot/handle nhất quán, bảo vệ phiên legacy, confirm khi dirty và checklist nghiệm thu.
- Kiểm tra / kết quả: Đối chiếu report và source hiện có; kiểm liên kết nội bộ và `git diff --check`. Chỉ thay tài liệu, không chạy lại test ứng dụng.
- Gate còn thiếu / việc tiếp theo: FE triển khai và chạy regression/browser smoke; chưa sửa hay nghiệm thu hai lỗi.
- Git / triển khai: Tài liệu chưa commit/push; không sửa FE, DB hoặc deploy.

### 2026-10-28 — DOCS1 — Kiểm tra chức năng đọc PDF trên langoo.org

- Thay đổi / lý do: Kiểm tra web theo yêu cầu; lưu [report PDF](docs/reviews/docs1-web-pdf-check-2026-10-28.md). Trang và tài nguyên PDF được đo đều tải được; chưa nghiệm thu giao diện.
- File / phạm vi: Đọc source FE và bundle production; chỉ thay tài liệu backend, không chạm WIP FE hoặc file người dùng.
- Kiểm tra / kết quả: HTTP app shell, 16 chunk JS và worker/font/CMap/pdf-lib thành công; kiểm thử hook cách ly tái hiện P1 restore nhầm handle A cho nội dung B (nguy cơ ghi đè A), P2 đổi file xoá ghi chú chưa lưu không confirm.
- Gate còn thiếu / việc tiếp theo: Hai lỗi FE còn mở; chưa kiểm browser E2E vì không có trình duyệt kết nối. Ưu tiên sửa P1, sau đó kiểm PDF EN/JA, ghi chú/save, zoom, mobile và khôi phục phiên.
- Git / triển khai: Nền `fefe5ab`; report/PROGRESS chưa commit/push. Không sửa code, DB hoặc deploy trong lượt kiểm tra.

### 2026-10-28 — M12 — Bổ sung admin.langoo.org vào CORS allowlist

- Thay đổi / lý do: Theo yêu cầu của chủ dự án, bổ sung domain trang quản trị `https://admin.langoo.org` vào danh sách CORS allowlist của API backend.
- Triển khai:
  - Cập nhật `DEFAULT_CORS_ORIGINS` trong `src/config/cors.ts` thêm `'https://admin.langoo.org'`.
  - Cập nhật mô tả `src/config/env.schema.ts` và `.env.example`.
  - Cập nhật unit test `src/config/cors.spec.ts` (kiểm tra 4 origin mặc định).
  - Cập nhật `.env` trên VPS: `CORS_ORIGINS=http://localhost:*,https://langoo.org,https://www.langoo.org,https://admin.langoo.org`.
- File / phạm vi: `src/config/cors.ts`, `src/config/env.schema.ts`, `.env.example`, `src/config/cors.spec.ts`.
- Kiểm tra / kết quả: `cors.spec.ts` 7/7 test pass; `npx tsc --noEmit` pass; `git diff --check` pass. Sau deploy, đo thực tế qua `curl -I -H "Origin: https://admin.langoo.org"` xác nhận `access-control-allow-origin: https://admin.langoo.org`.
- Gate còn thiếu / việc tiếp theo: Không.
- Git / triển khai: Commit `b26a542` đã push `main`; deploy VPS qua `deploy.sh` thành công (PM2 reload, health 200 OK). Đã xác nhận header ACAO phản chiếu `https://admin.langoo.org`.

### 2026-10-28 — M7.3 — API Xoá từ khỏi bộ sưu tập trong phiên học Flashcard

- Thay đổi / lý do: Theo yêu cầu chủ dự án, cho phép người học khi đang học flashcard (review hoặc practice) có thể xoá một từ khỏi bộ sưu tập nếu từ đó không cần thiết.
- Triển khai:
  - Thêm endpoint `DELETE /v1/sessions/:id/items/:ordinal`.
  - Transaction đảm bảo tính toàn vẹn: khoá user, kiểm tra trạng thái phiên (`in_progress`), cấm xoá trong phiên `quiz` (`SESSION_ACTION_UNSUPPORTED`), kiểm tra quyền sở hữu bộ từ (`COLLECTION_FORBIDDEN`).
  - Xoá `collection_item` (cascade xoá toàn bộ `collection_item_face`, `srs_state`, `collection_item_tag`) và giảm `item_count` của bộ sưu tập.
  - Loại bỏ toàn bộ session items trong phiên hiện tại tương ứng với các mặt thẻ của từ này (`removed_ordinals`).
  - Cập nhật lại số lượng thẻ còn lại (`item_count`), số thẻ đúng (`correct_count`), và tự động hoàn thành phiên (`status: 'completed'`) nếu đã hết thẻ hoặc tất cả thẻ còn lại đã được trả lời.
  - Trả về payload `{ item_id, collection_id, removed_ordinals, session }` giúp FE cập nhật state local và chuyển card mượt mà mà không cần reload phiên học.
  - Biên soạn tài liệu handoff chi tiết cho FE: [docs/handoff/m7.3-in-session-remove-word-fe-handoff.md](docs/handoff/m7.3-in-session-remove-word-fe-handoff.md).
- File / phạm vi:
  - `src/sessions/types/sessions.types.ts`
  - `src/sessions/dto/session-response.dto.ts`
  - `src/sessions/sessions.service.ts`
  - `src/sessions/sessions.controller.ts`
  - `src/sessions/sessions.service.spec.ts`
  - `docs/handoff/m7.3-in-session-remove-word-fe-handoff.md`
- Kiểm tra / kết quả:
  - `npm test -- src/sessions`: 3/3 test suites pass, 27/27 tests pass (bao gồm 9/9 test cases cho `removeWord`: xoá thẻ đơn, xoá từ đa mặt thẻ recognize+recall, tự động hoàn thành phiên khi xoá thẻ cuối cùng, điều chỉnh `correct_count`, và toàn bộ các trường hợp lỗi 400/403/404/409).
  - `npx prettier -c "src/sessions/**"`: pass.
  - `npx tsc --noEmit`: No errors found.
  - `git diff --check`: pass (không có lỗi khoảng trắng thừa).
- Gate còn thiếu / việc tiếp theo: Tích hợp nút xoá và dialog xác nhận trên giao diện Flashcard của Frontend.
- Git / triển khai: Commit `92b0f54` đã push `main`; deploy VPS qua `deploy.sh` thành công (PM2 reload, health 200 OK, latency 3ms).

### 2026-10-28 — M4.6 — Chuẩn hóa 100% mục từ bắt buộc có nghĩa tiếng Việt cho 20 bộ từ mẫu tiếng Anh

- Thay đổi / lý do: Theo yêu cầu của chủ dự án, toàn bộ các mục từ trong các bộ từ mẫu bắt buộc tối thiểu phải có nghĩa tiếng Việt; những từ không có nghĩa tiếng Việt phải tìm từ tương đương phù hợp thay thế hoặc loại bỏ hoàn toàn.
- Triển khai:
  - Thay thế 24 mục từ bằng các từ tương đương chuẩn có nghĩa tiếng Việt phong phú (`administrate` $\to$ `administer`, `rumor` $\to$ `rumour`, `crossroad` $\to$ `crossroads`, `harbor` $\to$ `harbour`, `table` $\to$ `desk`, `new` $\to$ `fresh`, `problem` $\to$ `issue`, `who` $\to$ `person`, `which` $\to$ `thing`, `these` $\to$ `group`, `whose` $\to$ `member`, `single` $\to$ `unique`, `bound` $\to$ `certain`, `physician` $\to$ `doctor`, `painkiller` $\to$ `medicine`, `checkup` $\to$ `examination`, `invoice` $\to$ `bill`/`receipt`, `visa` $\to$ `permit`, `layover` $\to$ `stopover`, `app` $\to$ `program`, `malware` $\to$ `virus`, `firewall` $\to$ `security`, `table` $\to$ `meal`).
  - Loại bỏ các từ chuyên sâu/hiếm gặp không có nghĩa tiếng Việt trong DB (chủ yếu ở C1, C2, TOEIC 800, IELTS 7.0+).
  - Cập nhật file danh mục `db/ops/data/en-decks-wanted-20261028.tsv` (còn 2.910 từ) và siết chặt `db/ops/seed-en-decks-20261028.sql` (bắt buộc `no_vi = 0`).
  - Tự động đồng bộ `anchor_sense_id`, `concept_id` và `meaning_vi` cho các collection người học đã clone từ các bộ từ mẫu tiếng Anh.
- File / phạm vi: `db/ops/data/en-decks-wanted-20261028.tsv`, `db/ops/seed-en-decks-20261028.sql`, `docs/reviews/m4.6-english-sample-decks-2026-10-28.md`.
- Kiểm tra / kết quả: `git diff --check` pass; `npm run lint` pass (0 error, 0 warning); test `src/collections` 41/41 pass. Đã thực thi trực tiếp trên PostgreSQL VPS:
  - Toàn bộ 20 deck tiếng Anh: **2.910 / 2.910 mục từ có nghĩa tiếng Việt (đạt chuẩn 100.0%)**, 2.555 từ có câu ví dụ minh họa (87.8%). Số lượng từ mỗi deck duy trì từ 89 đến 297 từ/deck.
  - Từ `anxious` trong `cefr-b1` và `en-daily-conversation` khớp 100% sang sense `1615362` (Wiktionary, nghĩa chính tiếng Việt: "Áy náy, lo âu, lo lắng, băn khoăn", chuẩn kết quả search).
  - Đã đồng bộ thành công 100% mục từ trong collection cá nhân đã clone trên VPS (đạt 100/100 có nghĩa tiếng Việt).
- Gate còn thiếu / việc tiếp theo: Không.
- Git / triển khai: Commit `41a6ff2` đã push `main`; deploy VPS qua `deploy.sh` thành công.

### 2026-10-28 — M4.6 — Tự động lọc bộ từ mẫu theo hồ sơ học viên (StudyProfile scoping)

- Điều chỉnh `GET /v1/collections/decks` theo yêu cầu chủ dự án:
  - Nếu hồ sơ học (`StudyProfile`) chỉ học 1 ngôn ngữ (chỉ tiếng Anh hoặc chỉ tiếng Nhật): tự động chỉ hiển thị các bộ từ thuộc ngôn ngữ đó, người học không bị lẫn bộ từ của ngôn ngữ không học.
  - Nếu hồ sơ học từ 2 ngôn ngữ trở lên (chế độ song ngữ): mặc định hiển thị danh sách bộ từ của các ngôn ngữ học viên đang học, và cho phép sử dụng query param `?language_id=` để lọc theo ngôn ngữ mong muốn.
- File / phạm vi: `src/collections/repositories/deck.repository.ts`, `src/collections/collections.service.ts`, `src/collections/collections.controller.ts`, `src/collections/collections.service.spec.ts`. [Report](docs/reviews/m4.6-english-sample-decks-2026-10-28.md).
- Kiểm tra / kết quả: `npm run build` pass; `collections.service.spec.ts` 19/19 pass (đầy đủ 4 test case cho profile 1 ngôn ngữ EN, 1 ngôn ngữ JA, và song ngữ EN+JA có/không filter); `git diff --check` pass.
- Git / triển khai: Commit `bba1742` đã push `main`; deploy VPS qua `deploy.sh` thành công.

### 2026-10-28 — M4.6 — Bộ từ mẫu tiếng Anh (20 English Decks Seed & API Filter)

- Biên soạn và chuẩn bị kịch bản nạp 20 bộ từ mẫu tiếng Anh (3.182 mục từ) phân chia thành 3 nhóm: 6 bộ khung chuẩn Châu Âu CEFR & Học thuật (`cefr-a1-a2`, `cefr-b1`, `cefr-b2`, `cefr-c1`, `cefr-c2`, `academic-word-list`), 5 bộ luyện thi chứng chỉ (`toeic-450`, `toeic-650`, `toeic-800`, `ielts-core-6`, `ielts-advanced-7`), và 9 bộ chuyên đề thực tế (`en-office-work`, `en-hospital-health`, `en-restaurant-dining`, `en-travel-hotel`, `en-shopping-commerce`, `en-transport-traffic`, `en-technology-digital`, `en-finance-banking`, `en-daily-conversation`).
- Tạo file dữ liệu chuẩn: `db/ops/data/en-decks-wanted-20261028.tsv` và script SQL seed: `db/ops/seed-en-decks-20261028.sql`. Script nạp vào `core.deck` (`language_id = 1`), ánh xạ lemma sang `core.lexeme`/`core.sense` (ưu tiên `serve.english_sense_priority` và `is_primary`), neo `concept_id` và tính toán `item_count`.
- Nâng cấp API `GET /v1/collections/decks`: tạo `DeckListQueryDto` hỗ trợ `?language_id=`, cập nhật `DeckRepository.findPublishedList` và `CollectionsService.listDecks`.
- File / phạm vi: `db/ops/data/en-decks-wanted-20261028.tsv`, `db/ops/seed-en-decks-20261028.sql`, `scripts/dictionary/generate_en_decks.py`, `src/collections/dto/deck-list-query.dto.ts`, `src/collections/repositories/deck.repository.ts`, `src/collections/collections.service.ts`, `src/collections/collections.controller.ts`, `src/collections/collections.service.spec.ts`. [Report](docs/reviews/m4.6-english-sample-decks-2026-10-28.md).
- Kiểm tra / kết quả: `npm run build` pass; `npm run lint` pass (0 error, 0 warning); `collections.service.spec.ts` 17/17 pass; `git diff --check` pass. Đã thực thi `db/ops/seed-en-decks-20261028.sql` trực tiếp trên PostgreSQL VPS: nạp thành công toàn bộ 20 deck mới vào `core.deck` (`language_id = 1`) và 3.177 mục từ vào `core.deck_item`.
- Gate còn thiếu / việc tiếp theo: Cập nhật FE tiêu thụ query param `?language_id=` trên màn hình chọn bộ từ mẫu.
- Git / triển khai: Commit `af0ab72` đã push `main`; deploy VPS qua `deploy.sh` thành công (PM2 reload, health 200 OK).

### 2026-10-28 — DOCS2 — Thiết lập Workspace Skills cho Antigravity

- Thiết lập 4 workspace skills tại `.agents/skills/` phục vụ Antigravity (`agy`): `langoo-workflow` (quy tắc checkout `main`, mã milestone, cập nhật `PROGRESS.md`, bất biến domain), `nestjs-swagger-contract` (chuẩn hóa Controller, DTO, validation và độ phủ 100% Swagger schema), `prisma-db-inspector` (bản đồ 5 schema, 92 bảng, quy tắc migration bất biến bắt đầu từ `033`), và `sse-stream-tester` (kiểm thử luồng SSE của Chatbot/Quiz, xử lý lỗi và abort signal).
- File / phạm vi: `.agents/skills/langoo-workflow/SKILL.md`, `.agents/skills/nestjs-swagger-contract/SKILL.md`, `.agents/skills/prisma-db-inspector/SKILL.md`, `.agents/skills/sse-stream-tester/SKILL.md`, `docs/reviews/docs2-antigravity-workspace-skills-2026-10-28.md`. [Report](docs/reviews/docs2-antigravity-workspace-skills-2026-10-28.md).
- Kiểm tra / kết quả: `git diff --check` pass, cấu trúc Markdown và YAML frontmatter hợp lệ chuẩn Progressive Disclosure của Antigravity.
- Gate còn thiếu / việc tiếp theo: Không có; các agent phiên sau tự động nạp skill khi có ngữ cảnh phù hợp.
- Git / triển khai: Chưa commit, chưa push; local workspace config.

### 2026-10-27 — M12 — CORS allowlist localhost, langoo.org và www.langoo.org

- Theo yêu cầu chủ dự án, CORS đổi từ mở hoàn toàn sang allowlist: `http://localhost:*` (mọi cổng dev), `https://langoo.org`, `https://www.langoo.org`. Đây là phần hardening CORS của M12.
- `src/config/cors.ts` thêm `DEFAULT_CORS_ORIGINS` dùng khi `CORS_ORIGINS` trống/không khai báo (trước đây trống = tắt CORS); entry có `*` được dịch thành RegExp nên `http://localhost:*` khớp mọi cổng; `*` đứng riêng vẫn là cho phép mọi origin (chỉ nên dùng khi dev). `src/main.ts` log qua `describeCorsRule()` vì danh sách có thể chứa RegExp.
- Đồng bộ `.env.example`, `src/config/env.schema.ts`, `README.md`, `render.yaml` (bỏ `'*'`), `docs/fe/chat-streaming.md`, `docs/ops/vps-deployment.md`. [Report](docs/reviews/m12-cors-allowlist-2026-10-27.md).
- Kiểm tra Node 22.22.2: `cors.spec.ts` 7/7 test pass; build và lint pass; `npm test` 60 suite/528 unit pass. Không chạy E2E, không gọi API VPS trong bước code.
- Git/triển khai: `abacacf` đã push `main`; CI `40442172409` success, Deploy VPS `40442367193` success, VPS HEAD `abacacf`, PM2 online. Đã đổi `.env` VPS sang allowlist (bản `*` backup private `.../ops/m12-cors-before-20261027.env`) + restart; log `CORS: cho phép http://localhost:[^/]+, https://langoo.org, https://www.langoo.org`. Đo header thật qua `api.langoo.org`: 3 origin mặc định + `localhost` cổng bất kỳ được phản chiếu, origin lạ không có ACAO. Không còn gate CORS; còn mở: Cloudflare SSL mode, IP thật cho rate limit, FE dùng base URL mới.

### 2026-10-27 — M12 — Chuyển API sang `api.langoo.org` (Cloudflare proxy), sửa lỗi 525

- Chủ dự án đổi domain API sang `api.langoo.org` phía Cloudflare và báo lỗi 525; domain cũ `langoo-api.pixpress.art` đã bỏ DNS. Nguyên nhân: `/etc/caddy/Caddyfile` chỉ có site block cũ nên Caddy không có chứng chỉ cho SNI mới → handshake origin fail (Node/DB vẫn 200 ở `127.0.0.1:3000`).
- VPS: backup `Caddyfile.bak-m12-20261027`, thêm block `api.langoo.org` (`encode gzip`, `reverse_proxy 127.0.0.1:3000`), `caddy validate` Valid, `systemctl reload caddy`; Let's Encrypt cấp cert qua HTTP-01 lúc 10:10 UTC. Không đổi code/DB/migration.
- Kiểm tra: `https://api.langoo.org/v1/health` 200 `status=ok db=ok db_timezone=UTC`; CORS đúng allowlist (bảng đo trong [report](docs/reviews/m12-cors-allowlist-2026-10-27.md)). Cảnh báo đã ghi: qua Cloudflare proxy nên rate limit thấy IP Cloudflare, chưa đọc `CF-Connecting-IP`; cần xác nhận SSL/TLS mode Full (strict).
- Tài liệu sống đổi base URL: `README.md`, `docs/ops/vps-deployment.md` (Caddy, luồng DNS, runbook, sự cố 525), `docs/fe/chat-streaming.md`, `docs/handoff/fe-tasks-2026-10-08.md`. Report lịch sử giữ domain cũ.


### 2026-10-27 — M8.3 — Streak và lịch hoạt động học theo ngày

- Chủ dự án chọn dừng cộng XP từ nay nhưng giữ dữ liệu XP cũ; lịch ngày hiển thị số lượt và số từ khác nhau, không cần danh sách từ. Đã khảo sát `streak_day`, `review_log`, receipt SRS/session và giới hạn lịch sử; kiểm tra read-only VPS thấy 10 lượt ôn cũ mất liên kết face.
- [Thiết kế đã duyệt](docs/superpowers/specs/2026-10-27-m8.3-streak-activity-design.md): API `GET /v1/me/activity` theo năm, dùng dữ liệu hiện có, hiển thị số lượt chưa xác định được từ; ngừng XP mới và giữ idempotency/streak. [Handoff FE](docs/handoff/m8.3-streak-activity-2026-10-27.md), [report](docs/reviews/m8.3-streak-activity-2026-10-27.md), [kế hoạch](docs/plans/m8.3-streak-activity-2026-10-27.md).
- Kiểm tra Node 22: build và lint pass; 60 suite/524 unit và 27 suite/247 E2E pass trên PostgreSQL test riêng. Review độc lập phát hiện đọc lệch snapshot; đã sửa `RepeatableRead` và kiểm thử cạnh tranh RED→GREEN. CI `40429619932` và Deploy VPS `40429831921` success. VPS `7a33958`, PM2 online, health/DB OK; activity kiểm danh tính giả không có dữ liệu: 2024/366 ngày, 2026/365 ngày, year sai 400, không token 401. Chưa kiểm FE/browser.
- Git/triển khai: code M8.3 `a64ad29`, release `7a33958` đã push và deploy VPS theo yêu cầu. Không có migration; chưa nghiệm thu dữ liệu tài khoản thật qua FE.

### 2026-10-27 — M10.1 — Khôi phục chat sau lỗi upstream 502

- Chủ dự án báo chat 503; log xác định Space Bunny trả 502, tái hiện bằng request trực tiếp cả stream và không stream. Commit M10.1 thay thời điểm bắt đầu SSE nên lỗi trước delta hiện ra HTTP 503. Chủ dự án chọn chuyển tạm sang Groq; cấu hình chat VPS hiện dùng `qwen/qwen3.8-27b`, quiz giữ cấu hình riêng; backup cấu hình cũ được lưu private trên VPS.
- Adapter production đã thử stream chữ và ảnh mẫu thành công; chủ dự án xác nhận chat chữ trong app hoạt động, PM2 online, health/DB OK. Chưa kiểm ảnh trong UI thật và chưa xác nhận Space Bunny ổn định để chuyển về. Xem [report](docs/reviews/m10.1-chat-provider-fallback-2026-10-27.md) và [runbook](docs/ops/vps-deployment.md).
- Git: tài liệu đã commit/push `7a33958`; thay đổi provider đã thực hiện trong cấu hình riêng VPS, không đổi code hay DB.

### 2026-10-26 — DOCS1 — Rà soát độ phủ chức năng và API

- Đối chiếu yêu cầu/plan/handoff với source `5fc41a7` và Swagger production: 93 operation/75 path, 19 file controller; local và live khớp method/path toàn bộ. [Report chức năng/API](docs/reviews/docs1-api-functional-coverage-2026-10-26.md), [inventory 93 operation](docs/reviews/docs1-api-inventory-2026-10-26.json).
- Thiếu có căn cứ: M2.3 xác thực email/recovery, M5 tìm trong sổ tay; M4 đã trả audio_key nhưng chưa có contract resolver/audio URL phát được. M9 reminders/devices chưa có, đúng quyết định tạm gác. Self-update tài khoản, lịch sử phiên/biểu đồ cá nhân, batch/preview list và admin deck là phần cần chốt theo UX; không tự mở scope. 39 response thành công chưa có schema Swagger (36 JSON + 3 SSE/binary).
- Kiểm tra: AST decorators + OpenAPI JSON; GET mẫu dictionary/sense và health app/DB OK. Chỉ kiểm tra độ phủ/contract, không smoke hành vi cả 93 endpoint; không mutation/AI/DB write hoặc sửa implementation. Report/inventory đã commit/push `3840adf`.

### 2026-10-26 — DOCS1 — Hợp nhất checkout và dọn worktree

- Theo yêu cầu chủ dự án: chỉ dùng `Langoo/main`; đã fast-forward 97 commit đến `7efeacd`, nhập M10.1 `9b8c6b5` thành `13d59cb`, khôi phục/hòa giải WIP và xóa 11 worktree phụ trên đĩa + prune 2 record mất đường dẫn. Branch/stash lịch sử giữ làm mốc phục hồi; không còn checkout phụ.
- [Report hợp nhất](docs/reviews/docs1-worktree-consolidation-2026-10-26.md), [snapshot tiến độ trước hợp nhất](docs/reviews/docs1-project-status-2026-10-26.md). Backup local ở `uploads/consolidation-20261026/`; 2,3 GB uploads và cấu hình riêng được giữ, không commit. Đã sửa AGENTS theo lựa chọn checkout duy nhất và bỏ symlink node_modules bị track nhầm.
- Kiểm tra: build Node 22 pass; JSON/JSONL mới 22 file parse pass; secret-pattern scan file mới không match. 60 suite/524 unit pass; DB4 typecheck và 3/3 batch-prepare pass. Lint toàn repo pass; diff-check và trạng thái chốt ghi trong report. Không reset DB, inference, push/deploy.
- Git/triển khai: các phần được lưu commit local theo mã; origin/main giữ nguyên, không deploy. E2E/FE/runtime provider chưa kiểm lại trong lượt hợp nhất.

### 2026-10-26 — M10.1 — Tích hợp sửa chat SSE còn ở worktree

- Cherry-pick `9b8c6b5` thành `13d59cb`; giữ ảnh M10.3 cùng signal/abort/retry, parser SSE và token validation. FE không cần đổi API/client code; hướng dẫn stream giữ contract hiện tại và xử lý JSON lỗi trước delta. Đã xóa thông tin login mock khỏi handoff/chat docs.
- Build + lint + 60 suite/524 unit pass khi hợp nhất. E2E chat thử local không nghiệm thu được do PostgreSQL dev/data directory `langoo_test` không có; 4 suite/31 test gặp `ECONNREFUSED` trước khi kiểm tra hành vi. CI PostgreSQL 17 sau push chạy E2E đầy đủ thành công. Deploy VPS run `40251098440` success; VPS HEAD `243585a`, PM2 online (restart 189), tracked working tree sạch, health HTTP 200 `status=ok`, `db=ok`, UTC, latency 2 ms. Không có migration. Xem [report M10.1](docs/reviews/m10-stream-review-2026-10-05.md) và report hợp nhất DOCS1.

### 2026-10-26 — M10 — Lưu khảo sát và artifact Devora còn local

- Commit local `cb5e080`: giữ 25 file khảo sát/report/JSON/JSONL/CSV ngày 12–13/10, chuẩn hóa CSV CRLF sang LF. Dữ liệu là kết quả lịch sử, không gọi provider hoặc thay đổi budget/runtime.
- Kiểm tra JSON/JSONL và secret-pattern scan pass; chưa push/deploy. Link report nằm trong các entry M10 lịch sử được giữ bên dưới.

### 2026-10-26 — DB4-D4/D5 — Giữ prompt v2 và sample audit khi hợp nhất

- Giữ plan/review/sample30 và hai script prepare/report còn untracked; không ghi đè pipeline mới hoặc chạy lại job. Retrieval streaming đã có trên remote nên WIP cũ không tạo delta code.
- Kiểm tra DB4 TypeScript tái hiện TS2790 ở fixture cũ `batch-prepare.test.ts:675`; đổi delete sang Reflect.deleteProperty để giữ ý định tạo output thiếu trường bắt buộc. Typecheck sau sửa và 3/3 batch-prepare tests pass.
- Git: đã commit local `eda6001`, chưa push. Phạm vi/files và giới hạn: [report hợp nhất DOCS1](docs/reviews/docs1-worktree-consolidation-2026-10-26.md). Không apply DB/provider/deploy; tooling lịch sử không được gọi là nghiệm thu semantic mới.

### 2026-10-26 — DOCS1 — Đối chiếu tiến độ và tồn đọng dự án

- Đã fetch/đối chiếu `origin/main` tại `7efeacd`; local `56f17fb` chậm 97 commit, có WIP quiz/DB4/M10 nên chưa pull/merge. Không dùng các dòng lịch sử “chưa apply/deploy” làm trạng thái cuối khi commit/report mới đã thay thế.
- [Report tiến độ và tồn đọng](docs/reviews/docs1-project-status-2026-10-26.md): M4.2/M4.3 đã deploy `48b8507`; DB4 đã apply mở rộng/serving; EN priority, gloss/JA examples, quiz v2, 13 deck và M14 đã có bằng chứng mới. Còn xác nhận FE/journey, auth M2.3 B/C, vận hành, coverage/chất lượng và đồng bộ tài liệu.
- Kiểm tra: đọc Git/tài liệu/SQL; public health 26/10 HTTP 200, app/DB ok, UTC. Không test/build app hoặc query DB production; số liệu dữ liệu/test lịch sử dẫn từ commit/report. Whole diff có whitespace WIP sẵn ở handoff 08/10 dòng 3; giữ nguyên.
- Git/triển khai: chỉ thêm report và entry này; chưa commit/push, không sửa code/DB hoặc deploy. Gate còn thiếu: xác nhận runtime release/FE và nghiệm thu xuyên suốt; không kết luận toàn dự án hoàn tất.

### 2026-10-26 — DOCS1 — Kiểm tra live VPS và dữ liệu PostgreSQL

- SSH `langoo-vps` từ máy này thành công; API HTTP 200, DB OK, 32 ms, UTC. PM2 online, restart counter 188 nhưng unstable restarts 0. VPS còn 7,1 GB disk, RAM khả dụng 837 MiB. App HEAD `7efeacd` khớp origin/main; local ahead 4 commit, M10.1 chưa deploy.
- Đếm DB read-only: 1.052.582 lexeme, 1.480.432 sense, 120.875 concept, 625.124 mappings, 1.046.182 serve pairs; 25.617 curated/95.258 draft. JMdict exact 47.599/253.630 (18,77%). Wiktextract EN hiện 170.177 lexeme sau trim; DB 4.721 MB.
- Backup gần nhất 25/10 (5 bản); chưa xác nhận restore drill. Ledger thiếu 043 dù function/index/unaccent tồn tại. [Bằng chứng và tồn đọng](docs/reviews/docs1-project-status-2026-10-26.md), [runbook VPS](docs/ops/vps-deployment.md).
- Chỉ SSH diagnostics/health/SELECT; không đọc env/secret, ghi DB, đổi cấu hình, dọn file VPS hoặc deploy. Các cập nhật tài liệu live chưa commit/push.

### 2026-10-20 — M4.3 — Tích hợp VPS và phát hành liên kết ít từ

- Chủ dự án yêu cầu deploy. Merge M4.2/M4.3 trên origin/main4cd6472 để giữ EN VI/canonical/POS/priority, VI autocomplete, Kanji component và ví dụ đang chạy; shared query dùng cùng policy cho links.
- Migration search đổi042→044 vì042 production thuộc M14. Backup code/schema và response trước deploy; không sửa data/mapping. [Report deploy](docs/reviews/m4.3-searchable-links-deploy-2026-10-20.md).
- Gate local: 58 suite/491 unit,25 suite/231 E2E, full eslint/build pass. Root WIP giữ nguyên; release ở worktree riêng. Migration044 đã áp với8 index valid; review không blocker. Release `48b8507` đã push/deploy, CI39357848414/Deploy39358021757 success,32 HTTPS request pass; 以下 135465 chỉ còn following, agony 261514 còn苦痛/重苦, mọi target có VI và đúng ID search. SQL exactbatch14,825 ms thay5,104s trước index; còn FE/browser cache smoke.

### 2026-10-20 — M4.2 / M4.3 — Commit search một ký tự và liên kết Anh–Nhật

- Đã commit local: `71eb828` — M4.2 single-character search/migration 042; `41ed9eb` — M4.3 tối đa 3 link khác từ, có VI và tìm được đúng ID. Code, test, plan, report, API/handoff của hai việc đã lưu; không gom WIP quiz/DB4 hay tài liệu khác.
- Kiểm tra chốt: 54 suite/439 unit pass (28,359s), build pass trong worktree cô lập; 36 integration test đã pass trong lượt triển khai trước, source/test đối chiếu byte. Staged diff-check sạch; không báo whole working tree WIP khác đã build xanh.
- [Report M4.3](docs/reviews/m4.3-searchable-links-implementation-2026-10-20.md), [report M4.2](docs/reviews/m4.2-short-search-2026-10-13.md). Chưa push/deploy; còn gate tích hợp hotfix search VPS, migration/index, đo latency và FE.

### 2026-10-20 — M4.3 — Liên kết Anh–Nhật tối đa 3 từ, có nghĩa Việt và tìm được khi search

- Code BE xong local: cả EN → JA/JA → EN, published pair + live exact/curated/confidence/scope gate, VI của chính target sense, JA JMdict có reading. Dùng chung query search kiểm đúng ID ở trang đầu mặc định; batch 6 nhãn, chọn tối đa 3 sau learner rank/dedup, không bù bằng mục không đủ gate và không gọi AI.
- Phạm vi: service, sense-pair/search repositories, hai DTO, unit + DB integration test; giữ M4.2 WIP có sẵn và không gom quiz/DB4 của phiên khác. [Plan](docs/plans/m4.3-searchable-cross-language-links-2026-10-20.md), [report triển khai](docs/reviews/m4.3-searchable-links-implementation-2026-10-20.md), [API](docs/api/dictionary.md), [handoff FE hôm nay](docs/handoff/fe-handoff-2026-10-20.md).
- Kiểm tra worktree cô lập: 54 suite/439 unit, 3 suite/36 integration pass; build/scoped ESLint pass. Review sửa nhãn >100 ký tự và EN thiếu source; re-review không còn must-fix. Regression DB đã tái hiện trước sửa, test cả stale mapping/VI sai sense/canonical ngoài pool/25 homograph/scope.
- Probe SQL VPS chỉ đọc: agony chọn 苦痛 rồi 重苦, chiều ngược 苦痛 chọn agony. Giữ canonical EXISTS theo mặt chữ khắc phục timeout 10s; batch search hai từ còn 5,104s trên VPS thiếu index M4.2. Đây chưa là gate latency production; cần giữ hotfix search VPS, rà/apply 042 và benchmark lại khi tích hợp/deploy. Không đổi DB/runtime VPS trong phiên.
- Git/triển khai: code/test/docs đã commit local `41ed9eb`, dependency M4.2 `71eb828`; **chưa push/deploy**. FE/browser smoke, tích hợp search hiện tại VPS và performance sau index còn thiếu; không gọi milestone M4.3 toàn bộ hoàn tất.

### 2026-10-20 — M4.3 — Kiểm tra mục có ví dụ nhưng thiếu nghĩa: 重苦

- Read-only DB/API VPS: JMdict lexeme 204170/sense 77994 có gloss Việt nhưng không có ví dụ; OMW-JA lexeme 625618/sense 822230 có 2 ví dụ kèm dịch Việt, định nghĩa Nhật nhưng thiếu gloss Việt/Anh và definition_language_id. Xác nhận dữ liệu đa nguồn gây ra dạng mục được báo; chưa kiểm source/DOM FE để kết luận nhánh ẩn nghĩa.
- Search hiện tại chỉ trả exact JMdict cho `重苦`; OMW-JA vẫn truy cập được qua sense detail. Nếu FE hiện cả hai exact mục, cần kiểm endpoint/ID/cache thực. Không ghép ví dụ chỉ theo mặt chữ.
- [Report M4.3](docs/reviews/m4.3-example-only-juku-2026-10-20.md) có IDs, response API, đối chiếu `重苦しい`/`重苦しげ`/`重苦しさ` và hướng xử lý metadata/fallback/gloss/mapping.
- Follow-up ảnh agony: sense 261514/concept 91144 trả 18 link JA (16 OMW-JA + 2 JMdict), xếp confidence nên OMW đứng trước. Search ẩn bản OMW thiếu reading khi có JMdict cùng mặt chữ, links không áp cùng policy; xác nhận `重苦`/`苦痛`/`悩み`/`倒懸`/`水火` mở ID khác giữa hai luồng. API agony hiện có nghĩa Việt; ảnh thiếu nghĩa cần kiểm FE/request/cache/thời điểm. Report bổ sung evidence và hướng ưu tiên canonical theo mapping cùng concept, không đổi target chỉ theo lemma.
- Chỉ lưu docs; scoped diff/whitespace/link kiểm tra, không test/build app. Chưa sửa code/DB/runtime, chưa commit/push/deploy.

### 2026-10-20 — M4.3 — Nghiên cứu ít liên kết liên ngôn ngữ, khác từ và tìm được trong search

- [Phương án M4.3](docs/plans/m4.3-searchable-cross-language-links-2026-10-20.md): theo yêu cầu cập nhật, áp dụng cả Nhật → Anh và Anh → Nhật, chỉ hiện các từ khác nhau và có gloss Việt của chính target sense; đề xuất tối đa 3 từ, không bù cho đủ. Hai mapping exact/cùng curated concept → scope → target qua cùng policy search và sense-list → nghĩa Việt → learner rank → collapse duplicate/biến thể cùng từ → cap. Không thay ID chỉ theo mặt chữ hoặc gọi HTTP search N+1 trong request.
- Evidence VPS: agony 261514 có 18 link, hai JMdict exact cùng concept 91144 là 苦痛 (BCCWJ 4347) và 重苦 (152442); phương án cập nhật có thể hiện cả hai từ khác nhau, ưu tiên 苦痛 trước. Cả hai search thấy đúng lexeme JMdict. Serving sense_pair hiện thiếu exact gate nên phương án cần recheck relation khi đọc.
- Chỉ nghiên cứu/read-only và lưu docs; chưa implement, chưa đo độ phủ/hiệu năng toàn DB; chưa commit/push/deploy. Kiểm scoped diff/whitespace/link tài liệu; không build/test app.

| Mã    | Hạng mục                       | Trạng thái                                                                                                        |
| ----- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
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

### 2026-10-12 — M10 — Khảo sát API AI miễn phí và credit thử nghiệm cho Langoo

- Đầu ra: khảo sát nhiều thị trường, tách free tier định kỳ, credit dùng thử, chương trình xét duyệt và ưu đãi cũ/chưa xác minh; ưu tiên nguồn chính thức.
- Tài liệu: [M10 — Khảo sát API AI miễn phí](docs/reviews/m10-free-ai-api-survey-2026-10-12.md).
- Phạm vi: chỉ nghiên cứu và lưu docs; không gọi inference, tạo account, đổi provider hoặc chạy job DB.
- Gate còn thiếu: eligibility/quota tài khoản từ Việt Nam, terms production, benchmark chất lượng/latency và khóa chi phí. Không nghiệm thu model bằng metadata catalog.
- Git/triển khai: tài liệu mới chưa commit/chưa push; không deploy VPS. Kiểm diff/format và đường dẫn tài liệu; không chạy test/build cho thay đổi chỉ docs.

### 2026-10-13 — M10 — Kiểm tra Devora Events và model miễn phí

- Đầu ra: bổ sung Devora vào [khảo sát M10, §9](docs/reviews/m10-free-ai-api-survey-2026-10-12.md#9-2026-10-13--m10--kiểm-tra-devora-events); phân biệt claim catalog/context và quota free thực nhận.
- Kiểm tra: đọc web/HTML/public JS; endpoint event trả 403, không có browser khả dụng nên chưa xác nhận budget/dates live. Chưa gọi inference hoặc đăng ký account.
- Gate: terms, quota/concurrency, upstream model identity, chất lượng/latency và cơ chế dừng khi hết event.
- Phạm vi: chỉ docs, không đổi provider/job VPS. Git: chưa commit/chưa push; kiểm scoped diff/format, không chạy build/test cho docs.

### 2026-10-13 — M10 — Kiểm tra thực tế API Devora bằng key được cung cấp

- Đầu ra: [report M10](docs/reviews/m10-devora-api-smoke-2026-10-13.md) và [artifact JSON](docs/reviews/m10-devora-api-smoke-2026-10-13.json), không lưu key trong repo.
- Kết quả: catalog HTTP 200; Space Bunny 403 yêu cầu subscription; DeepSeek một lượt HTTP 200/67,120 giây, JSON đúng 6/6 tình huống tổng hợp đơn giản. Đây không phải gate semantic DB4. Không thử ảnh do thiếu quyền model.
- Credit: chủ dự án cho phép tối đa 1 credit; usage quy đổi theo giá catalog 0,4324 credit, chưa xác nhận số thực bị trừ/event miễn phí.
- Phạm vi: chỉ docs/artifact; không đổi provider/config, không chạy job lớn hay deploy/apply DB. Git: chưa commit/chưa push.
- Kiểm tra: JSON/schema câu trả lời và expected; giá danh nghĩa dưới mức cho phép; secret/whitespace/scoped diff và trạng thái working tree. Gate: billing/free eligibility, vision, benchmark tập khó và tốc độ nhiều lượt.

### 2026-10-13 — M10 — Thử tiếp DeepSeek 4.1 Flash: stream và prompt mới

- [Report M10](docs/reviews/m10-devora-api-smoke-2026-10-13.md): cùng prompt stream trả đúng 6/6 trong 4,016 giây (first content 4,013); prompt mới nonstream mất 65,933 giây, finish_reason=length, không có answer content để chấm.
- Không kết luận streaming gây tăng tốc vì chưa tách cache/queue/routing; không đánh giá semantic cho output vắng. Provider báo dùng hết 256 completion token nhưng không có reasoning detail.
- Hai lượt mới giá quy đổi danh nghĩa tổng 0,722 credit, dưới hạn mức 1 credit đợt thử; actual billing chưa xác minh. Không retry, đổi runtime hoặc chạy DB thật.
- File/phạm vi: report M10 và hai artifact JSON liên kết trong report. Kiểm parse/expected/token cost/secret/scoped diff; không build/test ứng dụng vì chỉ docs/artifact. Git: chưa commit/chưa push; không deploy. Gate tốc độ ổn định, reasoning/output cap, billing và semantic DB4 còn thiếu.

### 2026-10-13 — M10 — DeepSeek 4.1 Flash Devora: test 8 luồng không đặt output cap

- [Report và artifacts M10](docs/reviews/m10-devora-8workers-2026-10-13.md): 8 worker / 24 request / 69,772 giây; 21 HTTP 200, 3 HTTP 502, không 429/timeout. Median lượt thành công 11,026 giây. Bỏ trường max_tokens theo yêu cầu, giữ default provider.
- Retry riêng ba lỗi bằng 3 worker thành công/7,198 giây. Sau retry đủ 24/24 request logic, 144/144 quyết định đúng trên 24 fixture đơn giản được lặp lại; không nghiệm thu semantic DB4 hoặc tối ưu concurrency.
- 27 HTTP inference attempt; usage được báo 15.728 token, giá danh nghĩa 9,9572 credits; phí thực/event miễn phí chưa xác nhận, lỗi 502 không có usage.
- Phạm vi: docs/artifacts, không code/config runtime, không gửi DB/PII thật, không deploy/apply DB. Kiểm JSONL/expected/DONE/stop, số request/retry, tính lại usage/credit, secret/whitespace/scoped diff và working tree; không chạy build/test app.
- Gate: actual billing/free policy, fixture DB4 thật, baseline concurrency và latency có kiểm soát. Git: chưa commit/chưa push.

### 2026-10-13 — M10 — DeepSeek 4.1 Flash: dịch và review 100 từ Anh–Việt

- [Report + artifacts M10](docs/reviews/m10-devora-en-vi-100-2026-10-13.md): 100 lemma/100 sense từ snapshot M4.5 local; gửi EN/POS, không gửi bản dịch/reference VI. Đủ 100 gloss ngắn + definition đầy đủ, giữ output gốc và đề xuất sửa riêng.
- Codex đã đọc/đối chiếu 100 mục: 86 pass, 13 minor, 1 major (`show` sai đối tượng trong định nghĩa), 0 severe quan sát được. Đây là AI review trên bộ mẫu, không gate thống kê cho toàn DB hoặc review người độc lập.
- Vận hành: 37 attempt (16 HTTP 200, 18 HTTP 502, 3 HTTP 524); 4 HTTP 200 length ở default 2.048. Tăng max_tokens=16.384, giảm luồng/chia batch để hoàn tất. Tổng thời gian các pha API 538,584 giây; usage được báo 53.675 token; giá danh nghĩa 42,4196 credits, billing thực chưa xác minh.
- Phạm vi: docs/artifacts, không code/config runtime, không apply DB/deploy. Kiểm schema/ID/hash/provenance/review/cost arithmetic/secret/links/whitespace/scoped diff và working tree; không build/test app.
- Gate: model consistency, mẫu độc lập/phức tạp, gateway throughput, billing/free policy và policy apply. Git: chưa commit/chưa push.

### 2026-10-13 — M4.2 — Khảo sát search một ký tự trên VPS

- Read-only: đủ 8 trigram/bigram index nhưng bigram một ký tự là mảng rỗng; runtime substring vẫn đọc rộng. API trực tiếp limit=5: `run` 1,267 s; `猫` 12,328 s; `a` 20,061 s rồi HTTP 200 rỗng, phù hợp nhánh nuốt timeout 20 s trên VPS.
- EXPLAIN SQL compiled runtime `猫`: 9,641 s; lemma lọc bỏ 512.025 dòng, form lọc bỏ 498.979 dòng. Hướng sửa: exact/prefix có index riêng cho input ngắn; unigram nếu giữ contains một Kanji; timeout rõ ràng.
- [Report M4.2](docs/reviews/m4.2-single-character-search-2026-10-13.md). Chưa sửa code/DB/runtime; docs chưa commit/push. Một lần đo/mẫu, chưa đo FE hay benchmark phân vị.

### 2026-10-13 — M4.2 — Tối ưu search một ký tự

- Code local: một chữ Latin dùng prefix; Kanji/kana giữ contains với character GIN; 4 lowercase B-tree, exact tier đủ trang trả ngay; suggestion EN một chữ thử frequent tier giữ mọi exact rồi fallback full. Giữ scope, face/dedup, source visibility, cursor v5. Timeout trả 504 `DICTIONARY_SEARCH_TIMEOUT`, custom plan/JIT off.
- File: migration 042, search repository + unit, dictionary controller/Swagger, integration regression, script benchmark read-only. [Plan](docs/plans/m4.2-short-search-2026-10-13.md), [report và benchmark](docs/reviews/m4.2-short-search-2026-10-13.md), [API](docs/api/dictionary.md), [FE handoff mới ngày 13/10](docs/handoff/fe-handoff-2026-10-13.md).
- Kiểm tra: 54 suite / 437 unit pass; 2 suite / 30 dictionary integration pass trên DB test riêng; scoped lint/diff pass, build worktree chỉ M4.2 pass. Build chung gặp TS1206 trong WIP quiz của phiên khác. Test dedup cũ lệch expectation đã được chứng minh lỗi trước sửa; không báo toàn e2e pass. Benchmark full đã đo exact tier; frequency tier cuối có regression xanh nhưng chưa benchmark full lại, dừng theo yêu cầu chủ dự án.
- DB local full 2.375.240 lexeme đã áp 042/ANALYZE để đo, tám index mới ~151,2 MiB. Không áp runtime/DB production. Input có quá nhiều contains match vẫn có chi phí ranking.
- Gate: tích hợp với hotfix chưa commit trên VPS, giữ source/learner policy thực; không mang frequency tier EN sang ranking khác khi chưa chứng minh bao phủ. Migration 042 trước code, smoke API/latency và UI timeout sau deploy.
- Git/triển khai: code/test/docs đã lưu local; chưa commit/chưa push/chưa deploy VPS, không gom WIP khác.

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

### 2026-10-12 — DEPLOY — Hợp nhất VPS với main; scope hồ sơ (M6.2) live

- Lý do: VPS (bản hand-merge) thiếu code scope M6.2 → đăng nhập profile JA vẫn
  thấy entry EN trong tab tự động. FE đang gửi Bearer (search_history có ghi) và
  chưa dùng reverse → deploy bản main đã merge là an toàn.
- Đã làm: backup src (`/opt/langoo/storage/backups/app-src-pre-merge-20261012.tar.gz`);
  ghi ledger 2 migration có-object-từ-trước (`040_kanji_component.sql`,
  `041_english_learner_priority.sql`); `rsync -a --delete` src main→VPS (giữ `.bak-*`,
  xóa orphan `vps-search.ts`); `npm run build` + `pm2 restart langoo-api`.
- Smoke: anon giữ catalog (en+vi+ja); token JA-only `q=go` → chỉ ja (hết EN);
  suggestions token → ja; chi tiết lexeme EN token JA → 404 (đúng scope);
  reverse camelCase OK; `走る` không hồi quy.
- Trạng thái: **VPS src == main (0 file lệch)** — hết hand-merge.
  Chi tiết + rollback: `docs/reviews/vps-deploy-merged-2026-10-12.md`.
- Git/triển khai: đã deploy VPS; commit docs/entry này sau.

### 2026-10-12 — DB4-D4/D5 — Batch đối chiếu full 966 (muse + Space Bunny confirm)

- Chạy thay pipeline muse-native đang kẹt: full 966 cohort qua batch API (zen/go muse)
  trong **11,9 phút**: pass1 651 pick, pass2 521 final (54%), 445 unresolved.
- Cross-confirm bằng Space Bunny (`space-bunny-alpha` = minimax-m3 router): sau retry
  lỗi parse (14 mục còn lại không chấm được) → **430 high-confidence (muse∩bunny)**,
  77 bunny bác (phần lớn hợp lý — over-accept của muse), trùng concept 92% trên mẫu.
- Deliverables: `proposals-high` 430 + `disagreements` 77 + `their-format` (contract
  `sense_concept_review`, adapter) — artifact
  `/opt/langoo/storage/db4-batches/db4-d4-d5-batch-crossconfirm-2026-10-12/`.
- Không apply DB/runtime; gate D5/promotion giữ nguyên, khuyến nghị validate +
  spot-check người trước promotion.
- So sánh: pipeline cũ 38h → 291 R1, 0 proposal; batch này ~30 phút → 430 proposal.

### 2026-10-12 — AI-CHAT — Hỏi đáp AI chuyển sang Space Bunny (thử nghiệm)

- Đổi env VPS: AI_BASE_URL=spacebunnymodel.com/api/v1, model `space-bunny-alpha`
  (chat + quiz dùng chung); AI_CHAT_MAX_TOKENS=4000 cho reasoning model.
- Smoke: chat non-stream + stream SSE hoạt động (reply tiếng Việt, lưu model
  minimax/minimax-m3, tokens OK); search không hồi quy. Quiz bị chặn bởi dữ liệu
  test user (không phải model).
- Backup `.env.bak-20261012-ai-spacebunny`; chi tiết + rollback:
  `docs/reviews/ai-chat-space-bunny-2026-10-12.md`. Lưu ý privacy (router bên thứ ba)
  và ảnh chat chưa smoke.

### 2026-10-12 — DB4-D4/D5 — Tiếp quản; kế hoạch hoàn thiện + vòng 2 unresolved

- Chủ dự án giao toàn quyền DB4-D4/D5 cho phiên deepseek; pipeline muse-native
  (cookie) ngừng vận hành, artifacts cũ giữ frozen tham chiếu.
- Đợt 1 (966 ready): 430 high (muse pick + bunny confirm) · 77 bác · 14 unknown ·
  445 unresolved; dev 48,0% / holdout 41,8%.
- Đang chạy vòng 2: 445 unresolved (bunny pass1+pass2 → muse confirm chéo) +
  retry 14 unknown → tier-2 proposals.
- Kế hoạch đầy đủ (audit Pilot A/B → D6 promote mới code → D7 serving → mở rộng
  population 15.245): `docs/reviews/db4-takeover-plan-2026-10-12.md`.

### 2026-10-12 — DB4-D5 — Audit Pilot A/B đạt; chốt 479 proposal

- Chốt đợt 1: 479 proposal/966 (high 439 + tier-2 40), disputes 82, unresolved 405, unknown 0.
- Audit: **Pilot A 75/75 đúng** (55 t1+20 t2); **Pilot B 175/175 positive đúng** (≥98,3% precision,
  95% CI rule-of-three); hard-negative 35 correct + 8 borderline + 7 nghi over-strict/missed (recall-side).
- Gate D5 **ĐẠT** cho tập proposal (tier-1/tier-2; disputes không promote). Chi tiết + findings:
  `docs/reviews/db4-d5-audit-2026-10-12.md`. Artifacts: `db4-d4-d5-final-2026-10-12/` (+audit-verdicts).
- Tiếp: D6 promote code (dry-run/rollback) — apply DB sẽ chờ chủ dự án duyệt.

## Checklist milestone

| #     | Milestone                                                                 | Trạng thái                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0    | Bootstrap & DB ops                                                        | ✅ hoàn thành (chờ review)                                                                                                                                                                                                                                                                                                                                                                                    |
| M1    | Data layer (Prisma schema `app` + repository `core`/`serve`)              | ✅ hoàn thành (chờ review)                                                                                                                                                                                                                                                                                                                                                                                    |
| M2    | Auth (register/login/refresh/logout/me)                                   | ✅ hoàn thành (chờ review)                                                                                                                                                                                                                                                                                                                                                                                    |
| M2.1  | Auth fixes sau review                                                     | ✅ hoàn thành                                                                                                                                                                                                                                                                                                                                                                                                 |
| M2.2  | Đăng nhập Google (OAuth2 ID token)                                        | ✅ hoàn thành (chờ review)                                                                                                                                                                                                                                                                                                                                                                                    |
| M2.3  | Sửa Google OAuth sau review                                               | 🛠️ A + C backend opt-in đã triển khai; B và rollout C còn chờ ([kế hoạch](docs/plans/m2.3-google-oauth-fixes.md))                                                                                                                                                                                                                                                                                             |
| M3    | Profile & settings                                                        | ✅ hoàn thành (chờ review)                                                                                                                                                                                                                                                                                                                                                                                    |
| M3.1  | Profile & settings fixes sau review                                       | ✅ hoàn thành                                                                                                                                                                                                                                                                                                                                                                                                 |
| M4    | Dictionary (đọc)                                                          | ✅ hoàn tất M4.1: nối lexeme→sense, cursor, romaji và hardening input                                                                                                                                                                                                                                                                                                                                         |
| M4.2  | Search một lexeme một hit và bảo toàn nghĩa đa nguồn                      | ✅ commits04112dc/d861390 đã push/CI deploy VPS, migration038 đã áp; cursor v3/canonical face giữ trong M4.3; [report](docs/reviews/m4-2-db4-d0-2-deploy-2026-10-06.md)                                                                                                                                                                                                                                       |
| M4.3  | Nhóm nghĩa Wiktextract và bảo toàn sense                                  | ✅ 9a52b68 + DB3-B2.1f700658 đã push/deploy;039 đã áp;354 unit/207 E2E/31 DB3 tests,46 live checks pass; FE render con còn chờ; [report](docs/reviews/m4-3-subsense-integration-2026-10-06.md)                                                                                                                                                                                                                |
| M4.5  | Xếp hạng nghĩa ưu tiên khi tra từ                                         | JA BCCWJ **66.041 profiles đã deploy VPS**, final 7/55 + HTTP pass; [report](docs/reviews/m4.5-ja-bccwj-deploy-2026-10-08.md). EN artifacts riêng, chưa apply trong lượt này; còn FE consume; đã commit/push 10/10 (e740ace, c3a0759, 0dba4b0)                                                                                                                                                                |
| M5    | Collections                                                               | ✅ hoàn thành cùng M5.1                                                                                                                                                                                                                                                                                                                                                                                       |
| M5.1  | Collections fixes sau review                                              | ✅ hoàn thành                                                                                                                                                                                                                                                                                                                                                                                                 |
| M6    | SRS                                                                       | ✅ hoàn tất sau M6.1; audit lại 30/30 ca pass ([báo cáo](docs/reviews/m6-recheck-2026-09-29.md))                                                                                                                                                                                                                                                                                                              |
| M6.1  | SRS fixes sau review                                                      | ✅ đã sửa 14 phát hiện + ENV-01; audit 30/30 pass; **cloud đã có 026/027**                                                                                                                                                                                                                                                                                                                                    |
| M7    | Review modes & sessions                                                   | ✅ M7.1 + M7.2 đã sửa (profile xuyên suốt, distractor theo profile); build/lint/unit/e2e local pass; migration 034 đã áp cloud+VPS+local (05/10) ([kế hoạch](docs/plans/m7-m8-fixes.md), [recheck](docs/reviews/m7-m8-recheck-2026-10-02.md))                                                                                                                                                                 |
| M8    | Gamification                                                              | ✅ M8.1 + M8.2 đã sửa (achievement quiz cùng transaction; `reviews_total`/`reviews_1000` chỉ tính SRS, migration 036); migration 034/036 đã áp cloud+VPS+local (05/10) ([kế hoạch](docs/plans/m7-m8-fixes.md), [recheck](docs/reviews/m7-m8-recheck-2026-10-02.md))                                                                                                                                           |
| M9    | Reminders                                                                 | ⏸️ tạm gác (chủ dự án chốt 2026-09-29; bảng `app.reminder`/`notification_log` giữ nguyên)                                                                                                                                                                                                                                                                                                                     |
| M10   | AI Chatbot                                                                | ✅ đã sửa 6 finding sau review; chuẩn bị OpenCode Zen free; migration 037 đã áp cloud+VPS+local (05/10); AI production chạy Groq `openai/gpt-oss-120b` (từ 05/10, ~1-2s/câu); [recheck](docs/reviews/m10-recheck-2026-10-03.md)                                                                                                                                                                               |
| M11   | AI Quiz                                                                   | ✅ đã sửa sau review 2026-10-05: 6 lỗi P2 + nguồn SRS; [recheck](docs/reviews/m11-recheck-2026-10-05.md)                                                                                                                                                                                                                                                                                                      |
| M10.2 | Cấu hình Qwen cho chat và quiz                                            | Chat đã áp env/reload VPS; quiz env sẵn, runtime còn stub; 20 unit pass; đã commit/push (44a791d); [report](docs/reviews/m10.2-qwen-chat-quiz-2026-10-07.md)                                                                                                                                                                                                                                                  |
| M10.3 | Chat nhận ảnh tạm thời                                                    | Code/tests/docs đã vào main 10/10 (294e385); VPS đã apply vision; FE UI còn thiếu; [plan](docs/plans/m10.3-chat-images.md), [report](docs/reviews/m10.3-chat-images-2026-10-07.md)                                                                                                                                                                                                                            |
| M10.4 | Triển khai thử Muse qua browser bridge                                    | Sidecar VPS đã deploy cho job DB/nền; 15 unit local/VPS + 8/8 live fixture pass; giữ Qwen chat; chưa chạy hybrid M4.5 100; đã commit/push (bff5175); [report](docs/reviews/m10.4-muse-browser-bridge-2026-10-07.md)                                                                                                                                                                                           |
| M10.5 | Muse native gateway và automation bulk VPS                                | Đã cài runner/service3 luồng; chuẩn bị5.000 từ/91.689 source senses,100 shard,1.211 base dispatch; 10+21+5 unit pass; resume50/50 không gọi thêm Muse; user chốt dùng Muse trực tiếp không judge; lô5k đã start/enable VPS18:18+07:00, đang chạy3 luồng; đã commit/push 10/10 (1db42a6); [bulk report](docs/reviews/m10.5-muse-bulk-2026-10-07.md), [pilot](docs/reviews/m10.5-native-three-50-2026-10-07.md) |
| M10.6 | Deploy DeepSeek, thinking OFF và10lượt học | Local:633unit/build/lint PASS;10lượt thinking0 ≈$0,0018; chưa rollout, server vẫn Groq; [report](docs/reviews/m10.6-deploy-deepseek-2026-11-06.md) |
| M11.1 | Quiz Kanji và ngữ cảnh                                                    | ✅ backend local pass: 374 unit / 199 E2E; câu dữ liệu không gọi AI, context có reuse/validator; đã commit/push (9a2d11d); [báo cáo](docs/reviews/m11-1-kanji-quiz-2026-10-06.md)                                                                                                                                                                                                                             |
| M12   | Hardening                                                                 | ✅ đã sửa 1 P1 + 3 P2 sau review 2026-10-05; kiểm chứng local pass, chưa deploy VPS; [recheck](docs/reviews/m12-recheck-2026-10-05.md)                                                                                                                                                                                                                                                                        |
| M13   | Admin, Curation & Feedback (thống kê + duyệt nội dung + hộp thư feedback) | ✅ đã sửa 6 P2 + 2 P3 sau review 2026-10-05; local pass, chưa deploy VPS; [recheck](docs/reviews/m13-recheck-2026-10-05.md)                                                                                                                                                                                                                                                                                   |

## Lộ trình DB (chốt 2026-10-01 — "thiết kế nốt cái DB")

| #      | Phase                                                   | Nội dung                                                                                                                                                                                                                         | Trạng thái                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------ | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DB1    | Dọn schema & chốt nguồn sự thật                         | PK staging còn thiếu; metadata curation (`concept.reviewed_by/at`, `candidate.decision_run_id` + index); COMMENT ngữ nghĩa; regenerate CSDL doc; sửa tài liệu sai số                                                             | ✅ đã triển khai ([kế hoạch](docs/plans/db1-schema-cleanup.md))                                                                                                                                                                                                                                                                                                                                                                                                   |
| DB2    | Hạ tầng tìm kiếm                                        | `pg_trgm` + 4 GIN trigram (033); `core.bigrams` + 4 GIN bigram (035); query 3 nhánh UNION dùng index; benchmark VPS `走る` 7,7s → 0,11s                                                                                          | ✅ đã triển khai ([kế hoạch](docs/plans/db2-search-infra.md))                                                                                                                                                                                                                                                                                                                                                                                                     |
| DB3    | Seed dữ liệu nền                                        | `radical` 214; KanjiVG → `media_asset`/`kanji_media`; deck hệ thống; gloss tiếng Việt cấp sense/concept; chốt chính sách JLPT; audit `/credits`                                                                                  | 📋                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| DB4    | Hoàn tất mapping sense↔concept                          | Candidate generation, scoring, LLM review, audit, apply/rollback và serving                                                                                                                                                      | 📋 D1 hoàn tất; D2 code đã push, cohort N1–N5 đã freeze VPS (15.245 → 1.000, 200/800, 10 shard); D4/D5 quality gate chưa đạt; D0, D6/D7 còn chờ                                                                                                                                                                                                                                                                                                                   |
| DB5    | Curation + serve + go-live DB thật                      | Quy trình duyệt concept/gloss; refresh `serve.sense_pair`; giao M14 (admin ghi `core`); kiểm readiness DB thật                                                                                                                   | 📋 curation/serving còn chờ; API VPS đã đọc DB thật (xác minh 06/10), chưa đồng nghĩa DB5 đạt gate                                                                                                                                                                                                                                                                                                                                                                |
| DB4-D1 | Contract mapping v1                                     | Schema/validator/hash/state/CLI, fixtures, spec và handoff cho D2/D4                                                                                                                                                             | ✅ code xong local: 30/30 tests, TypeScript/lint/format pass; [spec](docs/plans/db4-schema-v1.md), [handoff](docs/handoff/db4-d1.md); đã commit/push 10/10 (c0aa519); còn tích hợp consumer review                                                                                                                                                                                                                                                                |
| DB4-D2 | Mapping nguồn đã xác minh và chọn candidate bằng MiniLM | READ ONLY export, source audit, ONNX CPU/cache, hybrid lexical-MiniLM RRF, cohort/sampling và D1 artifacts                                                                                                                       | 🟡 `0208649` + `b74268d` đã commit/push; cohort 1.000: raw audit JMdict/OEWN/OMW EN/JA 0 mismatch, Wiktextract blocked; RRF 966 có shortlist / 34 no-candidate, 4.830 candidates. Semantic quality chưa đo; D4 transport smoke đã lưu 1 response nhưng D1 invalid; chưa apply/deploy. [review retrieval](docs/reviews/db4-d2-cohort-retrieval-2026-10-10.md), [plan](docs/plans/db4-d2-source-minilm-retrieval.md), [handoff](docs/handoff/db4-d2-source-minilm-retrieval-2026-10-08.md) |
| DB4-D3 | Bộ quyết định mapping tự động                           | Pure consensus policy, Muse adapter, generation/raw-response binding, immutable rerun                                                                                                                                            | ✅ engine đã kiểm local: 55/55 DB4 tests, TS/lint pass; 100 target → 20 exact proposals, 44 deferred, 4 all-none, 1 incomplete, 31 no-candidate; [plan](docs/plans/db4-d3-auto-decisions.md), [report](docs/reviews/db4-d3-auto-decisions-2026-10-10.md); đã commit/push 10/10 (3fe3863); chưa apply/deploy, còn D5–D7                                                                                                                                            |
| DB4-D4 | Prompt chọn candidate theo đầy đủ nghĩa của sense | Conditional R2 + [batch plan](docs/plans/db4-d4-d5-automated-batch-rollout.md), [runner review](docs/reviews/db4-d4-d5-batch-runner-2026-10-10.md), [v2.1 offline review](docs/reviews/db4-d4-prompt-v2.1-2026-10-10.md) | 🟡 `b955bfa` đã push; một R1 ACK/lưu response 5.203 byte sau 36,138 giây; D1 replay invalid vì Muse trả 4/5 verdict; 965 pending, R2 không đủ điều kiện. Final report incomplete do memory pressure (564/966 evaluation artifacts, không có summary). Không retry R1; chưa shadow 1.000, expansion/repair, Pilot A/B, apply/deploy |
| DB4-D5 | Audit chất lượng proposal exact                         | Hash-bound AI audit đủ 20 proposal; replay nguồn D3, lọc pass, report bất biến                                                                                                                                                   | 🟡 16 pass / 2 severe / 2 deferred; 65/65 DB4 tests, TS/lint pass; [plan](docs/plans/db4-d5-proposal-audit.md), [report](docs/reviews/db4-d5-proposal-audit-2026-10-10.md); gate chưa đạt, chưa audit 100 target/Pilot B; đã commit/push 10/10 (b0d344d, 8d83635); chưa apply/deploy                                                                                                                                                                              |

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

### 2026-10-10 — DB4-D2 — Source audit và hybrid retrieval trên cohort

- Project selector rows thành export riêng 1.000 sense; xác minh lại selected
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
- Git / triển khai: implementation/docs commit `b74268d` đã push; artifacts lớn
  ở `uploads/` ignored; không deploy/apply.

### 2026-10-10 — DB4-D5 — Thử prompt v2 trên 30 cặp mới

- Đã chạy 30 sense / 15 lemma ngoài mọi lemma của nhóm 20 audit cũ; giữ đủ 5
  candidate = 150 pairs, 2 phase v2 = 60 request / 8 worker, không apply DB.
- VPS 386,71s; 60 replies, D1 valid 59/60. Pure D3 policy: 1 exact (sense 72),
  27 deferred, 1 all-none, 1 incomplete (police R1 thêm `missingBranches2`).
- Blind AI scope assessment đủ 30; sanitizer R2 false exact bị bất đồng/defer;
  còn over-restriction your husband/organization và ambiguity nhiều concept.
  V1 cùng mẫu 0 proposal exact; không suy quality/precision từ yield 1/30.
- [Report và cách chọn mẫu](docs/reviews/db4-d5-muse-v2-sample30-2026-10-10.md).
- TS/scoped lint/format, D3 14/14 tests, prepare/report replay/hash/negative guard
  pass; scoped diff-check pass, toàn tree có FE whitespace phiên khác giữ nguyên.
- Code/docs local chưa commit/push; job VPS success/inactive; chưa deploy app,
  chưa full D5/D6/D7, không apply DB; giữ thay đổi phiên khác.

### 2026-10-10 — DB4-D4 — Prompt semantic match v2

- Follow-up: [sample 30 sense mới với v2](docs/reviews/db4-d5-muse-v2-sample30-2026-10-10.md) đã chạy sau bước chuẩn bị dưới đây; quality gate chưa đạt.
- Lưu system/R1/R2 v2: xác định source frame, điều kiện/construction, hai chiều
  bao hàm có phản ví dụ, phân biệt style và scope, sáu cặp đối chiếu; trả đầy đủ
  candidate theo thứ tự input và tự giữ unresolved. Contract D1 không đổi.
- Prepare thêm selector `v1|v2` (default v1), artifact v2 riêng; giữ seed để so
  với v1, đổi prompt version/render hash. [Plan và cách chạy](docs/plans/db4-d4-semantic-match-prompt-v2.md).
- Kiểm tra: TS/scoped ESLint pass; smoke temp 69 bundle / 138 request mỗi version,
  hash/replay/order/binding/default v1/immutable pass; adapter giữ 138 not-dispatched
  unresolved. Max input v2 147.670 byte, chưa dispatch hoặc đo chất lượng mới.
- Format/link/whitespace/diff-check phạm vi v2 pass; diff-check toàn tree báo
  whitespace ở FE handoff của phiên khác, chi tiết trong plan; giữ nguyên file đó.
- Gate: semantic pilot v2, full D5/D6/D7 còn thiếu; prompt không bảo đảm exact đúng.
- Git / triển khai: code/prompt/docs v2 local chưa commit/push, chưa deploy/apply;
  giữ thay đổi của phiên khác.

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
- Git / triển khai: phiên khác đã commit/push code/report nền `b0d344d`,
  `8d83635` trong lúc kiểm cuối, rồi `9e01f07` gồm guard duplicate normalized repeat.
  Cập nhật Git/format report cuối còn local tại thời điểm ghi. Origin/main chứa
  các commit này khi kiểm; không thay đổi/undo commit đó.
  [Report](docs/reviews/db4-d5-muse-repeat-2026-10-10.md) đã ghi rõ. Rerun vẫn cùng
  hash/counts; TS/lint/format, JSON/link/whitespace/diff-check pass. Chỉ chạy và
  thu hồi job VPS, không deploy backend hoặc apply DB. Các gate D5–D7 giữ nguyên.

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
| 2026-09-26 | Quyết định cũ (đã thay bởi **M2.5 ngày 2026-11-03**): access token stateless 15 phút; hiện kiểm session mỗi request và logout thu hồi tức thì                                                                                                                                                                                                      | Chủ dự án chốt; đổi sang "tra session mỗi request" nếu cần thu hồi tức thì                                           |
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
  10 shards, 78 refs verified; `apply=false`, `museCalled=false`.
- Gate còn thiếu: remote preflight/transport smoke (cap tối đa 1 R1 + 1 R2),
  expansion, format repair, Pilot A/B audit, shadow 1.000, D6/D7, DB apply và app
  deploy.
- Git / triển khai: code + docs chưa commit/push ở thời điểm cập nhật; chưa cài/
  chạy service VPS, chưa deploy app hoặc sửa DB.

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


### 2026-10-11 — DB4-D4/D5 — Transport canary và phục hồi batch với 4 luồng

- 121 R1 mới đã gửi: 118/966 distinct senses có reply, 108 D1 valid, 10 invalid,
  4 unknown, 844 pending; 57 eligible R2, chưa dispatch R2. Breaker mở do transport
  failures liên tiếp. Native health probe đã thành công; chưa chứng minh generation.
- Hai unit ops riêng: canary max 1 với ledger post gate; OnSuccess nối pending
  R1/conditional R2 với 4 workers. Giữ release `82c4fa1`, orchestrator `145ec65`,
  source/repair pin, no-resend và DB/apply gates. Chưa có kết quả canary.
- Ops tests 18/18 pass; post gate timing RED→GREEN và 5 ledger boundary fixtures.
  Config commit local `bc852a6`, tích hợp latest main tại worktree thành `2c881f5`.
  Unit đã cài/verify VPS; canary đang activating/native preflight, resume4 chờ
  OnSuccess. Coordinator cũ chỉ có report đã dừng; raw/checkpoints được giữ.
  Không thay runner semantic/DB/app runtime, chưa có kết quả canary mới.
- [Report](docs/reviews/db4-d4-d5-full-initial-2026-10-11.md),
  [runbook](scripts/ops/db4-batch/README.md).

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

### 2026-10-30 — M14.2 — Prompt v2 hạn chế người và ảnh dàn dựng

- Theo phản hồi chủ dự án, cập nhật planner/style trong `scripts/media/batch-policy.mjs`: ưu tiên chủ thể không người, chỉ dùng người khi nghĩa yêu cầu; giảm bóng nhựa, showroom, đối xứng và màu điện ảnh. Version `muse-ordinary-auto-v2`.
- Kiểm tra: policy 12/12 pass, syntax pass; chưa tạo ảnh mẫu hoặc nghiệm thu chất lượng. [Report](docs/reviews/m14.2-restaurant-76-automation-2026-10-30.md).
- Git/triển khai: local chưa commit/push; chưa cập nhật VPS/restart job. Checkpoint prompt cũ chưa đổi; phải giữ request đã dispatch/uncertain và chỉ replan phần chưa gửi khi rollout.

### 2026-10-30 — DOCS1 / M5.2 / M14.1 / M14.2 — Kiểm tra và phát hành thay đổi còn local

- Chủ dự án yêu cầu commit/push các phần đã sửa. Rà toàn bộ WIP, chia commit PDF/docs, pilot DOCS3, M14 ảnh/R2/worker và M5.2 collection order.
- Kiểm tra lại Node22: full63suite/557unit pass, build pass; collection HTTP/DB3suite/20test pass trên clusterUTF8 riêng55438 đãstop. Script media33/33pass; syntaxpass. E2E có MaxListeners warning, khôngfail/skip; lần initDB đầu lỗi encoding đã thay cluster riêng UTF8.
- M5.2 desc theo(position,id), cursor bound hướng; không đổi defaultasc. [Report](docs/reviews/m5.2-collection-items-order-2026-10-30.md).
- M14 worker vẫn chưa hoàn tất, promptv2 mớilocal; commit/push không có nghĩa chạy lại worker hoặc nghiệm thu ảnh. API/FEảnh chưa tíchhợp. Migration045/046 được giữ nguyên; testreset đãáp thànhcông trongDBtest.
- Git: chuẩn bị commit/push theo từnghạngmục; CI tự chạy saupush và app tựdeploy khiCIxanh. Trạngthái cụthể báo cuối; chưa xácnhận deploy.

### 2026-10-30 — M14.2 — Áp dụng policy v2 và batch8 cho worker Muse

- Đãcopy policyv2/worker/classifier lên runtime VPS, backup checkpoint/worker, startlại service theo yêu cầu. Khôngrestartapp hoặc đổiDB. Batch mới tốiđa8; requestđãgửi giữnguyên, completedrequests khôngreplay.
- Classifier có test cho tính từ/danh từ riêng, cooked/ran/plural kếthừa và auxiliary bỏqua; planner theo4nhóm. Guard khônggọi gen cho inherit/skip.
- Tests42/42pass, syntaxpass. Gate: resolver ảnhgốc/binding và skipaccounting chưa tựđộng; gặp nhóm3/4 workerdừng INFLECTION_RESOLUTION_REQUIRED để khôngtốnquota. Chưanghiệmthu ảnhv2 hoặc đủ76.
- [Report](docs/reviews/m14.2-restaurant-76-automation-2026-10-30.md). Code/docs localchưacommit/push tronglượt này; runtimeVPSđãcopy theo yêu cầu áp dụng.

### 2026-10-30 — M14.2 — Sửa validator receipt không nhận profile v2

- Lỗi RECEIPT_IMAGE_INVALID do worker upload namespacev2 nhưng registry profile chỉv1. Thêm profilev2, regressionRED→GREEN; khôngnới checkhash/key/MIME. Planmới lưuversion, legacydùngv1 đểkhônggắnnhầmnhãn.
- Media42/42testpass, syntax/diffcheckpass; ảnhpending terrace trênpublicR2 đúnghash. Backupcheckpoint, cậpnhậtworker/images/policyVPS và restart riêngservice. Khônggenlạiảnhpending; khôngrestartapp.
- [Chi tiết và ngoại lệ provenance terrace](docs/reviews/m14.2-restaurant-76-automation-2026-10-30.md). Code/docslocalchưacommit/push. Chưahoàn tất76, gateinherit/skipvẫn còn.

### 2026-10-31 — M14.2 — Sửa resume nhận attachment lazyload

- Xácđịnh ảnhđãattach nhưng workerđọcDOM quásớm (snapshotmedia rỗng). Thêm hydrateAttachments cuộn/chờ thumbnail load và đọc lại, giữexactfilename/host/hashguard, khônggenlại. Diagnostic lỗi lọcURL.
- Kiểmtra: media44/44testpass, syntax/diffcheckpass; VPS logattachment_probe4 vàimage_registered tăng13→16/76 (reservation/special/starter) xácnhậnluồngthậtđãqua.
- [Report](docs/reviews/m14.2-restaurant-76-automation-2026-10-30.md). RuntimeVPSđãcậpnhật; localchưacommit/push. Chưahoàntất76 hoặc rootinherit/skipgate, chưanghiệmthu ảnhv2.

### 2026-10-31 — M14.2 — Sửa dispatch kế hoạch mất URL và xác nhận gửi

- Plan-2 bịsentnhưng /thread/new; sửadebounce/composerack/sendfallback theodrivergốc, waitURL120giây; retryboundedtextonly giữarchive, generationkhôngretry. Chờknownthreadmarker trướcownershipcheck.
- Media48/48testpass, syntax/diffcheckpass; đãrestart riêngChromevìCDPtimeout/RAM, khôngrestartapp. VPSxácnhận scenes_planned8 vàgen-2-0dispatched; vẫ n16/76, chưaxácnhậnảnhbatch2.
- [Report](docs/reviews/m14.2-restaurant-76-automation-2026-10-30.md). Code/docs localchưacommit/push; runtimeđãápdụng. Gateđủ76/ảnhv2/rootinheritcònmở.

### 2026-10-31 — M14.2 — Gia cố toàn luồng resume và media identity

- Sửa aliaslemma theo requestduynhất+numericreceipt, bỏreplayrecordcũđãcovered, lấyURLattachmentmới thay vìblobURLcheckpoint, xửlýthumbnailẩn/lazy. Khôngnới host/hash/IDguard hoặc rerollảnh.
- Kiểmtoàncohort: cooked kếthừa, táchdeferredkhỏigeneration đểkhôngchặn từkhác; jobcódeferred kếtthúcneeds_resolution, khôngbáocompletegiả. Root-sensefallback vẫn cần xửlý riêng.
- Media52/52testpass, syntax/format/diffcheckpass. VPSđãlưu20→24, batch3đãplan8/dispatch, resume knownthread đangchạy. [Report](docs/reviews/m14.2-restaurant-76-automation-2026-10-30.md). Chưanghiệmthuđủ76 hoặc ảnhv2.
- RuntimeVPSđãcậpnhật; code/docs đangchốtGit, khônggom proposalM5.3 vàkhôngrestartapp.

M14.2 xác nhận thêm cùnglượt: batchmới đãlưu24→28/76, serviceactive; targeted19/19pass sau chốt resume chỉcovered bằnglaterrecords córequestđãlưu. Toànmedia52/52pass ởlượtrộng trước. Khôngbáođủ76; worker tựtiếptụcphầncònthiếu.

M14.2 Git chốt: code/test/docs gia cố worker đã commit `e50a685`, chưa push. RuntimeVPS đã áp dụng các fix chính; lầnkiểmcuối28/76/serviceactive, gen-3-1đanggửi/xửlý. ProposalM5.3 giữngoài commit. Khôngbáođãhoàn tấtlô.

### 2026-11-01 — M14.3 — Kế hoạch cấp ảnh cho API chi tiết nghĩa và Flashcard

- Theo yêu cầu chủ dự án, soạn [kế hoạch đầy đủ](docs/plans/m14.3-image-delivery-api-2026-11-01.md): shared DTO/resolver batch, provenance source khácanchor, gateview, metadata/ENV, fallbackcóbằngchứng, tests/rollout/rollback/handoff.
- Kiểm tra: đối chiếu source/relationDDL013/view046; tựreviewspec/type/taskcoverage vàlinks/diff. Khôngchạytestứngdụng vìchỉkếhoạch.
- Gate: chờduyệtkếhoạchtrướctriểnkhai. KhôngbáoM14.3đãcode/deploy, khôngcamkếtcookedcóảnhkhithiếumapping.
- Git: plan/entrylocalchưacommit/push; giữWIPreportM14.2/proposalM5.3ngoàiphạmvi.

### 2026-11-01 — M4.7 — Plan và handoff tiêu đề dạng chính trong tìm kiếm

- Theo yêu cầu chủ dự án, chỉ soạn [plan M4.7](docs/plans/m4.7-canonical-search-title-2026-11-01.md) và [handoff FE](docs/handoff/m4.7-canonical-search-title-fe-2026-11-01.md), để agent khác code.
- Đã đọc BE search/suggestions/mapper/cursor và FE thực tế LanGoo-User: list/autocomplete dùng surface, modal dùng card.lemma. Đề xuất BE thêm lemma additive; FE dùng canonical title và nhãn dạng khớp, giữ surface/query/ID/ranking/cursor.
- Kiểm tra: tự review contract/file paths/consumer/rollout và links/diff; chưa chạy test ứng dụng vì không sửa implementation. FE có WIP được giữ nguyên.
- Gate: agent khác triển khai BE/FE, kiểm unit/HTTP/DB/browser theo plan. Git: plan/handoff/entry local chưa commit/push; không deploy, không gom WIP M14.3/M5.3.

### 2026-11-01 — M14.3 — Review API trả ảnh trước commit

- Theo yêu cầu review và chỉ commit khi ổn, kiểm WIP media/dictionary/SRS/ENV. [Report](docs/reviews/m14.3-image-delivery-api-2026-11-01.md) có3finding: target fallback thiếu kiểm language/POS/grammar; E2E thiếuprefix và chấp nhận404 làm pass giả; regex abstract chặn cả vật thể có định nghĩa chứa grammatical.
- Targeted unit7suite/86testpass, repro chạy policy thật xác nhận thiếuguard; full lint fail24errors/0warnings (media/SRS/E2E typing), chưa đạt CIgate. Chưa build/E2E hoặc mutationDB/deploy.
- Trạng thái: chưa đạt gate commit, không commit implementation. Cần agent sửa findings/tests, hoàn thiệnconsumerdocs và review lại. Report/entry local chưa commit/push; không gom WIP khác.

### 2026-11-01 — M14.3 — Sửa findings và triển khai API ảnh chi tiết nghĩa/SRS

- Theo yêu cầu chủ dự án, sửa target fallback validation, keyword false-positive, E2E pass giả và lint; tích hợp sharedimagecontract, batchresolver tối đa3SELECT, ENV/Swagger/docs/handoff. [Report cập nhật](docs/reviews/m14.3-image-delivery-api-2026-11-01.md), [handoff FE](docs/handoff/m14.3-image-delivery-api-2026-11-01.md).
- Kết quả combined M14.3/M4.7: full67suite/596unitpass; build/lintpass; PostgreSQLUTF8test riêng55437,7suite/78HTTPDBtestpass, khôngskip. Fixture ảnh ban đầu thiếubytes/sha failsetup đãsửa vàrerunpass; khôngnới constraint.
- Gate: chưa publicproduction/FE/browser smoke, chưa push/deploy; khôngmigrationmới. Giữ WIP khác ngoài commit; đang chốt commit riêng M14.3.

### 2026-11-01 — M4.7 — Backend canonical lemma đã code và kiểm tra

- Theo yêu cầu chủ dự án, thêm lemma cho search/suggestions từ cùnglexeme, giữsurface/exact/ranking/cursor; Swaggerrequired vàservice/HTTPregression RED→GREEN. [Report](docs/reviews/m4.7-canonical-search-title-2026-11-01.md), [handoff FE](docs/handoff/m4.7-canonical-search-title-fe-2026-11-01.md).
- Combinedunit595/build/lint/E2E78pass. FE giữ nguyên, cần agentFE tíchhợptitle helper theohandoff sau releaseBE. Khôngsửaquery/ID hoặcDBdata.
- Git: chuẩn bị commit riêng M4.7 sauM14.3; chưa push/deploy. Khônggom reportM14.2/proposalM5.3.

### 2026-11-01 — M14.3 / M4.7 — Chốt commit sau review và kiểm tra

- M14.3 `59c8c79` và M4.7 `8e380ff` đã commit riêng theo yêu cầu. Các entry plan/review trước sửa phía trên là lịch sử, đã được thay thế bởi trạng thái code xong và kiểm tra này.
- Node22: full67suite/596unit pass, build/lint pass;7suite/78HTTPDB test pass trên PostgreSQL test UTF8 riêng, cluster đã stop. Review độc lập không còn blocker sau sửa ENV delimiter rỗng. EXPLAIN fixture nhỏ có số đo trong report, chưa benchmark production.
- Chưa push/deploy hoặc nghiệm thu FE/browser. FE M4.7 còn theo handoff, M14.3 không tự phân giải cooked khi thiếu mapping chắc chắn. WIP M14.2/proposal M5.3 giữ ngoài commit.


### 2026-11-08 — M14.4 — Sense-first vocabulary images (BE code)

- Theo yêu cầu chủ dự án: ảnh theo sense thay vì concept; giữ concept image làm fallback. Thêm migration `049_sense_images.sql` (`core.sense_media`, `serve.sense_image`), backfill 100 ảnh pilot, và **Tier 0** trong `SenseImageRepository` để ảnh sense thắng ảnh concept.
- Test bổ sung: SQL repository phải chứa `serve.sense_image` và `0 AS tier`. Spec/handoff: `docs/plans/2026-11-08-sense-first-vocabulary-images.md`, `docs/handoff/2026-11-08-sense-first-images-be.md`.
- Dữ liệu: 100 ảnh pilot đã upload R2 + `media_asset`; 13 ảnh concept cũ, 87 ảnh chờ sense backfill. Tổng 9.734 sense thiếu ảnh; 9.144 direct, 1.144 prompt 8 ảnh, 9 inherit, 581 no-image.
- Gate: **chưa apply migration/backfill production, chưa build/deploy**. Thứ tự: apply 049 → backfill pilot → deploy Tier 0 → kiểm tra manager/政策/employee → style test 64 ảnh → batch 9.144.
- Không đụng `concept_media`/`serve.concept_image`, mapping từ điển, hay `media_asset.kind`.

- Verification: `npm test -- --runInBand src/media/sense-image.repository.spec.ts` 4/4 pass; `npm run build` pass. Chưa apply migration/backfill production.


### 2026-11-08 — M14.4 — Apply migration + backfill + deploy 100 ảnh pilot

- Muse translation hoàn tất: **13.667/13.667 batch** (batch lỗi cuối đã rerun thành công).
- Apply `049_sense_images.sql` + `backfill-sense-media-pilot-20261108.sql`: **100 `sense_media`**, **100 `serve.sense_image`**, **13 concept pilot**.
- Build + restart `langoo-api`; API đã trả ảnh WebP cho `manager` (1811634), `政策` (149550), `employee` (373668).
- Bắt đầu style test **8 style × 8 từ = 64 ảnh**, nén 512 WebP q75; chờ kết quả để chốt style trước batch 9.144.
- Docs: spec/handoff đã cập nhật trạng thái applied.


### 2026-11-08 — Muse translation apply vào DB

- Job `ja-vi-20261108-muse`: 13.667/13.667 batch, 273.338 sense.
- Apply `core.sense_gloss`: **273.338 gloss VI** mới, source mới `public.source.id=187` (`llm-sense-vi-v2-muse-native-20261108`), `is_machine=true`, rank 1, default-accept; không reviewed/curated.
- Dry-run sạch: 0 duplicate, 0 missing sense, 0 gloss VI đã có.
- Tổng VI gloss sau apply: 624.331; sample `736617` API trả `"thách thức (ai đó) thực hiện lời tuyên bố"`.
- Handoff: [2026-11-08-muse-translation-apply.md](docs/handoff/2026-11-08-muse-translation-apply.md).


### 2026-11-09 — Tạm dừng image generation + chốt trạng thái

- Full image runner đã dừng: **953/9.016 ảnh**, **119/1.128 prompt** hoàn tất; 1 prompt dở; 8 style × 141 prompt.
- Ảnh local: `C:\Users\PC\Desktop\muse-native\full-images`; gallery live `http://127.0.0.1:8766/`; checkpoint `result.json` để resume.
- DB/app hiện có **124 ảnh** sense-level (100 pilot + 24 validation); **124/124 public R2 OK**; API trả ảnh.
- Dịch: 13.667/13.667 batch; apply source 187 = 273.338 gloss VI; tổng VI 624.331; JA còn 73.731 sense ngoài scope.
- Code/docs: `cd2d172`, `0cbbd16`, `1805f43`; migration 049 + backfill + app restart đã xong.
- Handoff: [2026-11-09-full-image-pause.md](docs/handoff/2026-11-09-full-image-pause.md).
