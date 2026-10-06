# DB4-D0.1 / DB4-D0.2 / M4.2 — Sửa projection và search, chuẩn bị dọn trùng

Ngày: **06/10/2026**. Chủ dự án đã chọn hướng sửa nguyên nhân rồi dọn bản trùng
thật. **Code xong local, chưa commit/push/deploy; chưa sửa dữ liệu VPS hay xóa ID.**
D0.3 mới có inventory read-only; membership/alias và physical cleanup còn là bước
sau, không đánh dấu toàn nhánh dọn trùng đã hoàn tất.

## 1. Phần hotfix đã giữ và thay

| Hành vi VPS                            | Implementation local                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| Một lexeme một hit                     | Giữ hướng per-lexeme; ưu tiên face khớp surface chính xác rồi chọn trước cursor/LIMIT  |
| Chọn một nguồn theo spelling           | Bỏ source suppression; giữ POS/reading/etymology và nguồn khác khi chưa có equivalence |
| Lấy gloss khác nếu sense trước đã dùng | Thay bằng source projection trong view chung, không phụ thuộc thứ tự sense             |
| Repository lấy gloss theo lexeme riêng | View trả full EN context cho cả list/detail; không thêm một query mỗi sense ở service  |

Patch gốc VPS đã lưu ở [artifact khảo sát](db4-d0-vps-dictionary-hotfix-2026-10-06.patch).
Bản này không được chép nguyên vào repo hoặc deploy chồng lên VPS. Tích hợp những
hành vi phù hợp bằng code local và fixtures; runtime cũ vẫn được giữ để đối chiếu.

## 2. Projection nguồn — migration 038

`038_dictionary_source_projection.sql` thêm function
`core.wiktextract_en_projection(bigint)` và thay view `serve.sense_card`:

- Chỉ policy Wiktextract English: cùng source/batch, EN ranks liên tục bắt đầu 1,
  không machine/reviewed. Giữ mọi gloss gốc, tags/restrictions/attributes.
- Chọn leaf cuối của chuỗi nguồn, guard definition NULL/first/leaf và language
  NULL/EN; không ghi đè custom definition khác. Reviewed override giữ precedence
  khi chuỗi không đủ điều kiện. JMdict không áp policy leaf.
- List/detail/consumer dùng view nhận cùng meaning; thêm `gloss_en_context[]`
  đầy đủ theo rank. View sửa cách đọc ngay sau migration; migration **không backfill
  core.sense**. Backfill là run độc lập có manifest/journal.

Bằng chứng policy: importer local đã chọn gloss cuối; payload eat/cat xác nhận
chuỗi cha→con; extractor English giữ supergloss trước khi gọi đệ quy subgloss.
[Source extractor chính thức](https://github.com/tatuylonen/wiktextract/blob/master/src/wiktextract/extractor/en/page.py).
Source metadata của dataset là `Wiktextract (English)`/Kaikki. Không mở policy sang
nguồn/edition khác hoặc bỏ full context khi translate/mapping.

File API/DTO/types/repository đã đồng bộ. Cursor search chuyển **v2** để tránh
nhận cursor cũ chọn từng face; FE nhận 400 với v1 thì bắt đầu trang đầu.

## 3. Writer và backfill

- Đã sửa `../data-Langoo/scripts/run_mapping.py`: foundation dùng cùng function
  của migration 038, không ghi first_gloss đè nghĩa cụ thể; upsert EN gloss không
  đè slot khác source, machine hoặc reviewed.
- Thư mục data-Langoo hiện **không có Git repo**. Patch tái áp và review được lưu
  trong repo backend: [foundation writer patch](db4-d0-2-foundation-writer-2026-10-06.patch).
  Importer core hiện chọn cuối nên không sửa importer đó trong lượt này.
- Python AST parse pass; không chạy foundation/all-safe trên corpus thật hoặc VPS.
  Khi vận hành pipeline cần migration 038 trước và source-batch drift audit.

Tool `scripts/dictionary/projection-cli.ts`:

- `export` mặc định read-only, 500 row/cohort, cap 5.000, keyset `--after`.
- Cùng SQL body migration dùng cho export trên DB cũ; không cần cài function để
  khảo sát VPS. Hash bind full EN rows + sense/lexeme/source metadata và source tags.
- `apply`/`rollback` cần manifest đúng target/policy/digest, explicit write flag,
  function SQL đã cài phải đúng hash. SERIALIZABLE, lock timeout, advisory lock,
  kiểm input trước ghi và đọc lại sau ghi. Chỉ đổi definition/language.
- Journal prepared immutable và fsync file/directory **trước** transaction; sau
  COMMIT có result riêng. Crash sau COMMIT vẫn có before-image; resume và rollback
  so before/after hash, không đè edit mới. Cả cohort rollback nếu một row drift.
- Manifest/journal nguyên bản giữ trong `uploads/dictionary/` (gitignored), không
  sửa digest/IDs để tái dùng trên target khác. Không gọi AI.

## 4. Dry-run trên VPS

[Summary/count/hash và benchmark](db4-d0-2-m4-2-dryrun-2026-10-06.json),
[SQL đếm eligibility đầy đủ](db4-d0-2-projection-eligibility-2026-10-06.sql).
Các bundle audit chạy trong `/tmp`, dọn sau khi kết thúc; mọi DB transaction là
READ ONLY. Không cài migration hay sửa code deploy/permissions của app.

| Ngôn ngữ | Scope first/last khác | Eligible backfill | Already projected | Blocked |
| -------- | --------------------: | ----------------: | ----------------: | ------: |
| en       |                53.055 |            53.055 |                 0 |       0 |
| ja       |                 1.869 |             1.869 |                 0 |       0 |
| vi       |                 1.073 |             1.073 |                 0 |       0 |
| **Tổng** |            **55.997** |        **55.997** |             **0** |   **0** |

Đây là eligibility theo source-policy guard, không phải nhãn duplicate sense.
Pilot export 500 row: 500 eligible; manifest full hash/target đã lưu, chưa apply.
Snapshot projection totals `2585:2585:`; hai export có snapshot riêng trong raw
artifact. Cùng count không chứng minh input hash không drift ở lần apply sau.

Inventory WordNet **500 cặp đầu theo ID**, không là mẫu ngẫu nhiên/gold test:

- 500 cùng full scope trong policy có verified exact WordNet anchor, source synset
  được đối chiếu với `core.wordnet_synset`; 0 context conflict trong shortlist này.
- Không thấy FK app trên bản dự kiến bỏ trong 500 cặp. **Không suy toàn DB không
  có app reference hoặc xác nhận mọi candidate WordNet được phép xóa.**
- 500 có `sense_concept`, 50 có `core.example.sense_id` trên bản dự kiến bỏ; lexeme
  liên quan vẫn chứa sense. Raw FK counts không xuất row/content người dùng.
- `directlyDeletable=0`: cần alias/source identity + importer resolution và bảo
  toàn child rows trước physical deletion. Không dùng cascade để dọn dependency.

`duplicate-cli.ts` chỉ read-only, không có `--apply` hoặc DELETE. Full-scope giữ
reading/POS/definition language/attrs/tags/restrictions/gloss content; chỉ bỏ hai
key provenance WordNet đã biết (`lexicon`, `synset_id`) khỏi comparison và lưu
riêng metadata đó. WordNet anchor/provenance không biến concept thành curated.
Pagination dùng cặp `(keep_sense_id, other_sense_id)` để không bỏ peer ở biên cohort.

## 5. Kiểm tra và giới hạn

- DB riêng `127.0.0.1:55433/langoo_dictionary_d0_20261006_test`: restore demo +
  migration tới **038**. Không reset DB full/VPS hoặc DB test của phiên khác.
- Unit: **48 suite / 375 test pass**. Lệnh test filter dùng option không đúng
  Jest 29 nên thực tế chạy toàn unit; số trên là full run thật, không chỉ dictionary.
- E2E dictionary/dedup/sense-card: **3 suite / 31 test pass**. Bao gồm paging ID,
  exact matching face, đa nguồn/POS/reading, list/detail, full ancestor context,
  reviewed/machine/gapped/mixed-source/batch/language/custom guards, fill NULL,
  backfill apply/resume/rollback/target/hash/drift và full-scope/FK inventory.
- Targeted ESLint và backend build pass; Python AST syntax pass. Prettier,
  JSON/hash/count/link và `git diff --check` được kiểm trước bàn giao.
- Single-sample comparison trên local full giữ cùng dataset: 21 rows trường 学校
  từ 13 distinct IDs → 21, 猫 từ 15 → 21. Timing ở summary, **không phải P95/SLA**.
  Benchmark đầu đo trước refinement ưu tiên surface_exact (không đổi số ID);
  test final xác nhận behavior này. Query 猫 một ký tự vẫn ~2,3s, còn nợ tối ưu riêng.
- Haste-map cảnh báo package trùng trong `.kilo/worktrees`; các suite vẫn pass.
- Chưa deploy/test runtime M4.2 trên VPS, chưa apply backfill thật; chưa chạy lại
  full source ingestion, chưa xóa/repoint IDs hoặc triển khai membership/alias.

## 6. Bước tiếp theo theo hướng đã chọn

1. Commit/deploy scope này theo [handoff](../handoff/db4-d0-2-m4-2.md), migration
   trước code; bảo toàn hotfix hiện có trên VPS. Apply backfill từ manifest live
   đã re-export, batch nhỏ, ghi journal và stale đúng input jobs bị ảnh hưởng.
2. DB4-D0.3 hoàn thiện equivalence/membership và canonical ID; DB4-D0.5 đề xuất
   cleanup: resolver alias cho ID/external source identity, importer không tái tạo,
   chuyển/giữ examples và source anchors, inventory app/artifact dependency.
3. Physical cleanup chỉ run các candidate đã đủ guards và local rollback drill;
   có core child riêng như 50 cặp mẫu thì bảo toàn trước. Không DELETE theo definition.

Git: mọi thay đổi mới trong scope **chưa commit/push**; code quiz/DB4-D1 và các
thay đổi có sẵn khác được giữ riêng. Runtime VPS vẫn là hotfix cũ, không báo đã sửa
trên live. **0 request AI / 0 ID bị xóa** trong lượt triển khai local + dry-run này.

### Preflight runtime cuối lượt — 13:10 UTC

038/function projection vẫn chưa có trên VPS, HEAD vẫn `7b13b90`. Working tree
dictionary hiện có **5 file modified**: ngoài ba file ban đầu có thêm controller
và kanji repository được sửa ngoài scope lượt này.
[Patch mới của cả dictionary](db4-d0-vps-dictionary-runtime-2026-10-06.patch) đã lưu,
SHA-256 trong summary; không revert/tích hợp các thay đổi mới đó trong local fix.
Release cần review/reconcile patch mới trước reset, không chỉ dựa vào patch 3 file
của khảo sát 12:15 UTC. Không thay đổi app trên VPS trong lượt này.

### Đối chiếu ảnh `dog` với API live — follow-up 06/10

GET công khai trên `https://langoo-api.pixpress.art` xác nhận noun lexeme `998637`
có 23 senses. Ba sense đầu `985788`, `985789`, `985790` đều trả `gloss_en` là
`A mammal of the family Canidae:`, nhưng gloss rank 2 lần lượt mô tả chó nhà,
mọi thành viên họ Canidae và con đực chó/sói/cáo. Đây là ba scope khác nhau,
không phải ba bản sao được phép xóa theo phần text cha giống nhau.

Live chưa có `gloss_en_context`; SSH xác nhận checkout vẫn `7b13b90` và function
038 chưa tồn tại. Bản sửa local chưa được push/deploy. API detail giữ cả gloss
rank 1/2; ảnh đang trình bày chúng thành hai dòng nghĩa. Sau release, FE cần dùng
nghĩa chính từ card cho nhãn chọn sense và phần nghĩa chính, tách full context
khỏi danh sách nghĩa độc lập. Chỉ deploy BE không bảo đảm FE hết hiện gloss cha
nếu vẫn render nguyên `glosses[]`. Chưa kiểm source FE hoặc sửa/deploy FE trong
follow-up; chỉ GET/SSH đọc, không thay code hoặc dữ liệu live.
