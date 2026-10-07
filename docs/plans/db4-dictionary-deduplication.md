# DB4-D0 — Kế hoạch sửa trùng từ điển và chuẩn hóa đầu vào mapping

Ngày: **06/10/2026**. Chủ dự án đã duyệt hướng sửa nguyên nhân rồi dọn bản trùng thật.
**DB4-D0.1/DB4-D0.2/M4.2 đã code và test local**, chưa commit/push/deploy/apply VPS;
DB4-D0.3 mới có read-only shortlist. [Report triển khai](../reviews/db4-d0-2-m4-2-implementation-2026-10-06.md)
và [handoff](../handoff/db4-d0-2-m4-2.md) ghi trạng thái/gates thực tế. Nội dung dưới
đây giữ toàn lộ trình; các chặng chưa triển khai không được coi là đã hoàn tất.

Nguồn: [báo cáo VPS](../reviews/db4-d0-vps-duplicates-2026-10-06.md),
[số liệu gốc](../reviews/db4-d0-vps-duplicates-2026-10-06.json),
[SQL](../reviews/db4-d0-vps-duplicates-2026-10-06.sql),
[patch runtime cần bảo toàn](../reviews/db4-d0-vps-dictionary-hotfix-2026-10-06.patch).
Đối chiếu [DB4 mapping](db4-sense-concept-mapping.md) và
[contract DB4-D1](db4-schema-v1.md). Đây là nhánh chất lượng đầu vào/serving bổ trợ
D0; không thay schema mapping v1, không đánh dấu toàn D0 hoặc DB4 hoàn tất.

## 1. Mục tiêu và số liệu dùng để ra quyết định

| Vấn đề                              | Baseline VPS                                       | Cách xử lý ưu tiên                                         |
| ----------------------------------- | -------------------------------------------------- | ---------------------------------------------------------- |
| View search lặp cùng ID/surface     | 218.794 cặp JA; live hotfix đã lọc ở mẫu thử       | Giữ một matching face tốt nhất trước cursor/LIMIT          |
| Projection Wiktextract cần xét      | 53.055 EN + 1.869 JA + 1.073 VI = **55.997 sense** | Khôi phục từ ranked gloss/context nguồn; không AI viết lại |
| Definition lặp trong cùng lexeme    | EN 44.345, JA 1.666, VI 678 row vượt một row/nhóm  | Đo lại sau sửa projection; full-scope comparison           |
| Lexical groups có >1 lexeme         | EN 174.367, JA 34.200                              | Group có membership; NULL reading JA phải unresolved       |
| WordNet cùng key/concept/definition | 199.101 nhóm EN đa nguồn                           | Ưu tiên rule/provenance để xác nhận reuse                  |
| Bản vá runtime ngoài Git            | 3 file lúc khảo sát; 5 file tại preflight 13:10 UTC | Bảo toàn và tích hợp trước deploy                          |

Các con số khác cấp, có overlap. **Không dùng tổng của chúng làm số từ trùng, số
xóa được, hoặc số job AI tiết kiệm.** Tập 55.997 là candidate projection; số apply
thực tế chỉ chốt sau source-policy validation. 199.101 là nhóm/membership, không
mặc định 199.101 sense ID an toàn để gộp vật lý.

Tiêu chí sản phẩm: mỗi lexeme một hit; cùng sense có cùng meaning giữa list/detail;
truy cập được tất cả sense hợp lệ của nguồn bổ sung; giữ biến thể reading/POS/scope;
không đổi anchor của dữ liệu học; không để writer tái tạo lỗi sau backfill.

## 2. Thứ tự, mã công việc và giao việc

| Mã           | Tên/đầu ra                                                      | Phụ thuộc                     | Gate bàn giao                                                             |
| ------------ | --------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------- |
| **DB4-D0.1** | Bảo toàn và tích hợp hotfix dictionary trên VPS                 | Không                         | Patch/hash + Git baseline rõ; review từng hành vi; không reset mất hotfix |
| **DB4-D0.2** | Projection nguồn nhất quán và backfill có journal               | D0.1; dữ liệu nguồn audited   | List/detail/source context đồng nhất; dry-run/local rollback đạt          |
| **M4.2**     | Search một lexeme một hit và cursor ổn định                     | D0.1; phối hợp projector D0.2 | Không lặp ID qua trang; không mất nghĩa/POS vì chọn nguồn                 |
| **DB4-D0.3** | Group đa nguồn, full-scope equivalence và serving membership    | D0.2 + M4.2                   | ID nguồn còn truy cập; scope khác giữ riêng; coverage không giảm          |
| **DB4-D0.4** | Tái dùng dịch/mapping theo nhóm tương đương và thống kê chi phí | D0.3 + DB3-B/DB4 contract     | Binding/hash/provenance từng target đúng; đo job trước/sau                |

Có thể chuẩn bị fixture/SQL manifest D0.2 và query/tests M4.2 song song sau D0.1,
nhưng không chạy hai writer trên VPS. Chia **vai trò** khi mở phiên triển khai:

- Backend: projector chung, search/cursor, contract API và regression M4.2.
- Data pipeline: source exporter/policy, before/after manifest/journal/rollback D0.2.
- Data review: full-scope equivalence, membership và cost inventory D0.3/D0.4.
- Ops: chốt thời gian ghi/deploy, backup, đích DB và artifacts ngoài release.

Lượt lập plan ban đầu chưa giao agent chạy code; sau đó đã code local D0.1/D0.2/M4.2. Mỗi người chỉ sửa file thuộc scope;
trước triển khai chốt interface projector, manifest và membership để không lệch.

## 3. DB4-D0.1 — Bảo toàn và tích hợp hotfix VPS

### Việc phải làm

1. Đo lại checkout HEAD, `git status --short` ở dictionary, SHA-256 source/dist,
   process cwd/entrypoint và DB target **chỉ host/port/database**. Không in secrets.
2. Export patch đầy đủ + untracked backup liên quan vào artifact bền vững. Patch
   survey đã lưu có SHA-256 trong JSON; nếu VPS đổi thì lưu phiên bản mới, không
   ghi đè artifact cũ hoặc giả định HEAD là code đang phục vụ.
3. Tích hợp vào nhánh dựa trên HEAD repo được chỉ định, resolve cùng các thay đổi
   hiện có. Không chép cả working tree VPS, không gom quiz/DB3/DB4-D1 ngoài phạm vi.
4. Review riêng ba hành vi: per-lexeme dedup, source suppression, alternate-gloss
   display. Per-lexeme là fix hợp lý; hai hành vi sau phải thay bằng policy đầy đủ
   ở D0.2/D0.3. Prefix-noise filter EN có fixture/policy riêng, không trộn thành
   bằng chứng semantic duplicate.
5. Đối chiếu deploy script reset tracked source. Code đã commit và gates đạt mới
   có baseline deploy; không deploy HEAD cũ để làm mất hotfix đang chạy.

### Gate

Có bản patch có thể phục hồi, danh sách file/hành vi, base commit và status rõ.
Không tự tuyên bố hotfix đã pass vì live 4 search không trùng. Runbook ghi runtime
có modified source cho tới khi một deploy đã được xác minh từ commit cụ thể.

## 4. DB4-D0.2 — Sửa projection nguồn, không mất ngữ cảnh

### 4.1 Interface projector

Thiết kế hàm thuần theo từng sense:

- Input: stable sense/lexeme/source identity, source version/batch, full ordered
  EN glosses gồm rank/detail/source, raw POS/etymology/attributes, tags/restrictions,
  definition hiện hữu + language + review metadata, policy version.
- Output: `definitionText`, `definitionLanguageId`, `displayGlossEn`,
  `fullContext`, `selectionReason`, `inputHash`, `policyVersion`, `needsSourceReview`.
- Cùng input phải cho cùng output, không phụ thuộc sense trước/sau hoặc thứ tự
  HTTP call. Source details không bị rút bỏ chỉ vì text ngắn hoặc đã xuất hiện.
- Policy Wiktextract chọn nghĩa cụ thể khi hierarchy nguồn đủ chứng cứ, giữ ancestor
  context cho translation/mapping. Không tự suy mọi gloss cuối là leaf.
- Policy JMdict giữ toàn bộ EN gloss list cùng restriction/tags: không chọn gloss
  cuối làm meaning duy nhất. Không ghi definition cho JMdict trong đợt backfill.
- Reviewed/user-derived gloss và source ownership có precedence được chốt; không
  ghi đè gloss VI hay tự gắn reviewer/verified cho projection máy.

Nếu API cần structured context mới, thêm field additive/versioned và docs consumer.
Hai field cũ definition/gloss_en phải có policy rõ; FE fallback cũng được đối chiếu.
Không chỉ đổi definition mà để FE tiếp tục ưu tiên gloss_en cha.

### 4.2 Nguồn triển khai và file dự kiến

- `src/dictionary/`: projector chung; service list/detail dùng cùng kết quả;
  repositories load context theo batch để tránh N+1.
- `serve.sense_card`: xem xét read-model phù hợp bằng migration mới nếu đổi view;
  không sửa migration 025 đã áp. Slot/rank `sense_gloss` giữ nguyên nguồn.
- `../data-Langoo/scripts/run_mapping.py`: bỏ foundation ghi first_gloss đè policy;
  đồng bộ importer `import_core.py`. Repo dữ liệu có Git/report riêng; chỉ sửa khi
  chặng triển khai bao gồm repo đó. Backend-only fix không ngăn pipeline tái nhập.
- Script Node/TypeScript scoped dry-run/apply/verify/rollback và artifacts theo run.
  Chốt nơi đặt script cùng người làm pipeline trước mở nhánh.

### 4.3 Manifest backfill và guard

Candidate từ metric 55.997, không auto apply toàn tập. Export keyset trên local
full hoặc read-only VPS, batch giới hạn; đóng transaction export trước review.
Manifest từng sense: ID string, source/batch, original definition/language,
ordered full gloss hash/context, expected/projected output, policy/reason,
before/after hash. Partition `eligible`, `ambiguous_source`, `unchanged`, `stale`.

Staging VPS raw rỗng nhưng core còn full ranked EN gloss và attrs. Có thể sửa tập
eligible từ core; cần hierarchy/IPA/raw thiếu thì export bundle từ local cùng
snapshot nguồn và kiểm external_id + hashes. **Không restore toàn staging lên VPS**
chỉ để chữa projection. Không dùng dữ liệu local khác version để ghi live.

Allowlist write backfill chỉ `core.sense.definition`, `definition_language_id`
cho source/sense thuộc manifest eligible; journal lưu ngoài release, source gloss
không rewrite. Journal có before-image immutable và run metadata; chi tiết journal
DB/file phải chốt trước apply. Không ghi app, concept status, mapping verified,
rank/gloss VI. View/membership schema là migration được review riêng.

Dry-run mặc định; apply có explicit target/run ID + precondition hashes, transaction
mỗi batch nhỏ; stale/conflict dừng hoặc loại rõ trong manifest, không upsert mù.
Resume idempotent. Verify read lại output/count/hash, list/detail và toàn source
context. Rollback chỉ restore row do run sở hữu nếu after-image còn khớp; có edit
mới thì conflict, không force rollback đè người khác.

### 4.4 Fixture và gate

- eat sense 1810300/01/02: cả sense đầu và sense sau đúng leaf/context; list/detail
  cùng output; gloss_en không tiếp tục làm nghĩa khác biệt thành To ingest.
- cat 1417635/36: tripod/trap-ball riêng; giữ archaic/games/countability.
- Single gloss, >2 level, multi-gloss không hierarchy, empty input, tags phủ định,
  same text nhưng scope khác, reviewed override; JMdict synonymous gloss list.
- Source pipeline chạy lại không đưa definition về first-gloss; thử trên fixture
  hoặc DB local `_test`, không chạy generator toàn corpus live.
- Local dry-run + apply + resume + drift + rollback drill đạt. Verify no changes
  ngoài allowlist; semantic hashes của job dùng input đã đổi được đánh stale.

## 5. M4.2 — Search một lexeme một hit, đủ nghĩa và đúng phân trang

### Query

1. Giữ 3 indexed matching branches phục vụ DB2, điều kiện kiểm chứng ILIKE sau
   bigram. Tổng hợp full hit set, chọn matching face tốt nhất **per lexeme_id**.
2. Ranking deterministic: exact/prefix/face match, quality/length/frequency theo
   contract, stable ID + surface-kind/surface để phá hòa. Một lexeme không lọt hai
   trang qua face khác. Chọn đại diện trước cursor filter và trước LIMIT+1.
3. Bỏ source suppression chưa có membership scope: `min(source_priority)` theo
   surface toàn POS không đủ điều kiện bỏ entry. Khi D0.3 chưa có, giữ per-lexeme
   dedup và entries độc lập; UX dùng metadata nguồn/POS/reading để phân biệt.
4. Sau D0.3, search group chỉ dùng membership đã đủ lexical identity; trả một
   đại diện nhưng consumer lấy được **sense của mọi member hợp lệ**.
5. Kiểm cursor cũ sau đổi ranking. Dùng version/binding query+lang theo contract;
   cursor lỗi version xử lý rõ, không nhận cursor rồi bỏ/sót rows âm thầm.
6. Filter prefix EN là policy riêng: query có case, space, dấu, apostrophe/hyphen,
   acronym, digit, proper names. Không xem LOWER là bằng chứng hai lexeme bằng nhau.

### File và regression cần thiết

Repository search, dictionary-search-cursor, DTO/API docs nếu đổi contract,
service response và dictionary unit/e2e hiện hữu. Fixtures E2E local `_test`:
lemma/form cùng ID; nhiều form cùng ID; same spelling khác POS/reading/etymology;
nguồn phụ có unique sense/POS; 猫/ねこ và 猫/ねこま; NULL reading không bridge;
romaji/kana/kanji; exact/prefix/escape; limit 1/2 đi hết các trang không lặp/mất ID;
query/lang/version cursor khác bị chặn đúng.

`EXPLAIN (ANALYZE, BUFFERS)` trên local full theo nhóm query và plan budget; VPS
chỉ smoke bounded sau deploy. Mẫu khảo sát VPS: 学校 562ms, 猫 4.802ms, cat 1.116ms,
eat 794ms — **mỗi query một phép đo**, không phải P95/SLA, chưa tách cache/network.
Gate: đủ coverage và deterministic pagination; benchmark cùng dataset trước/sau,
không fullscan/regression lớn từ window grouping; chốt budget từ baseline lặp lại.

## 6. DB4-D0.3 — Group đa nguồn và xác nhận sense tương đương

### 6.1 Tách lexical grouping khỏi semantic equivalence

Một group word có thể chứa nhiều sense khác nhau. Thêm membership/audit read-model
với ID ổn định, representative policy version, member lexeme/sense IDs và source
refs. Tên bảng/view và migration chốt trước code sau dependency audit; không tự
đổi natural key core.lexeme hoặc uniqueness sense_no.

- Lexical key gồm language, original spelling/NFC policy, POS/raw POS, reading
  applicability và identity chứng thực, etymology/homograph evidence. Unknown JA
  reading không join vào group đã có reading; không dùng coalesce(NULL,'') để
  chứng minh equivalence. EN reading not-applicable là trạng thái khác JA unknown.
- NFC/trim/whitespace dùng comparison có version, giữ raw text. Case/width/kana
  normalization chỉ retrieval nếu chưa có chứng cứ lexical identity.
- Đại diện JA ưu tiên JMdict vì reading/restrictions; EN chọn source đủ context
  sau sửa projection. Priority không cho phép bỏ POS/nghĩa khác hay hidden member.
- Union senses của members; collapse presentation chỉ đối với equivalence đủ
  scope/provenance. UI/API vẫn có source metadata và truy cập member IDs trực tiếp.
- Giữ homographs, qualifier/domain/register/negation và source-specific nghĩa;
  không auto merge synonym chỉ vì chung concept.

### 6.2 Các lớp bằng chứng và artifact

Lớp `exact_source_identity` xác nhận entries thật sự cùng input nguồn; lớp
`verified_wordnet_anchor` dùng 199.101 nhóm ưu tiên nhưng còn so raw context/version;
full-context equality so chính payload sau normalize conservative; lớp khác scope
là `distinct`; thiếu/bất đồng là `ambiguous`.

Artifact pair/group: members IDs, full context hashes, source/batch/version/license,
rule version, lexical identity evidence, semantic relation, conflicts/reason,
owner run, decision. Hash chỉ tạo shortlist; so payload thật để xác nhận, bỏ qua
volatile import metadata có allowlist nhưng không bỏ tags/restrictions/domain.
Không promote concept/mapping từ duplicate classifier.

### 6.3 Thống kê sau sửa và gate

Chạy lại SQL baseline rồi thêm counts theo `confirmed_equivalent`, `distinct`,
`ambiguous`, `blocked_source`, coverage theo source/reading/POS và top lexical keys.
Đếm distinct sense IDs/job keys song song với memberships để không double count.
Kiểm source-sense coverage trước/sau; sense không equivalent vẫn truy cập được.
Pilot phân tầng gồm nhiều nguồn, polysemy/homograph, parent-child gloss, NULL JA
reading, raw POS character, archaic/slang/negation. Zero known false merge ở fixture;
100% preserve ID/FK và provenance. Accuracy sampled chưa thay thế exhaustive guards.

## 7. DB4-D0.4 — Tiết kiệm dịch/mapping có thể đo được

1. Exact duplicates/source repair/per-lexeme faces xử lý bằng SQL/rule, **0 AI**.
2. Translation job dedup chỉ cùng full semantic scope + language target + policy
   - source/license + context hash; shared representative computation có binding
     riêng từng target. Không copy JSON rồi thay ID để vượt validator.
3. Equivalent VI output không chứng minh same concept; concept mapping cần evidence
   exact/broader/narrower theo DB4. Derived VI không thành phiếu độc lập thứ hai.
4. Cache key gồm context/source policy, normalizer, prompt/model/output schema và
   task family. Reviewed/provenance không truyền sang target khác vô điều kiện.
5. AI chỉ shortlist ambiguous có raw context đủ, top-K và budget được chốt cho
   đợt triển khai. Không all-pairs, không translate lại 2,9M sense để tìm trùng.
6. Xuất `raw_target_jobs`, `eligible_jobs`, `distinct_equivalence_job_keys`,
   `cache_hits`, `ambiguous_jobs`, `blocked_jobs`, actual request/token/cost và
   reuse theo language/source. Tỷ lệ tiết kiệm đo trên **cùng manifest target**;
   không dùng 199.101 memberships như token saving của 15.245 sense JLPT.

JLPT accepted hiện toàn JMdict nên backfill scoped Wiktextract không trực tiếp
chạm đợt DB3-B. Nếu context builder thay đổi hoặc dịch/mapping đang dùng definition
đã backfill thì đánh stale đúng subset; giữ legacy artifacts immutable và audit.

## 8. Triển khai VPS và rollback

- Dev/fixture/apply drill trên local DB `_test` được chỉ định; inventory/full data
  dùng `55433/langoo` read-only. Không reset VPS hoặc DB của phiên khác.
- Trước ghi: đo lại runtime Git + target/migration + manifest hashes, backup mới
  và dung lượng/temp/disk; backup hiện có chỉ đã thấy file, chưa chứng minh restore.
  Đặt run artifacts/journal tại `/opt/langoo/storage/db4/duplicate-audit/<run-id>`
  ngoài release, có checksum và backup. Chốt thực tế path/ownership trước apply.
- Một writer; phối hợp DB3-B apply/DB4 promote/refresh. 1 vCPU/2GB: worker một,
  pool nhỏ, batch đọc ≤2.000 là điểm bắt đầu rồi đo; write batch nhỏ hơn theo lock
  và runtime. Không chạy nhiều aggregate/backfill concurrent.
- Nếu có migration serving mới: additive/membership schema trước code; dùng role
  langoo và migration số kế tiếp thực tế, không đoán 038 khi nhánh khác có migration.
- Deploy commit chứa hotfix đã tích hợp + tests; CI/build/restart theo runbook.
  Verify health, 4 search + kana/romaji/pagination, list/detail nhất quán, original
  IDs còn đọc được, new member coverage và DB target. Ghi deployed hash/runtime sạch.
- Rollback serving theo feature flag/policy version cũ; code rollback phải tới
  baseline có hotfix đã lưu, không HEAD làm mất hotfix. Data rollback dùng journal
  conditional after-image. Không auto drop additive schema còn consumer.
- **Các chặng D0.1–D0.4 không xóa lexeme/sense hoặc repoint app anchors.** 27 FK và
  downstream ID consumers khiến physical cleanup cần một milestone độc lập sau
  khi serving ổn định và dependency/data migration/restore đã được thử.

## 9. Nghiệm thu và bàn giao

Mỗi hạng mục lưu code/test/SQL + report/handoff + PROGRESS theo AGENTS; ghi commit,
push, deploy riêng. Gate tổng của nhánh này:

- Same lexeme search không lặp ID qua cursor; homographs/POS/reading đúng còn đủ.
- Same sense output list/detail đồng nhất, source context giữ đầy đủ, writer không
  tái ghi gloss cha; affected-input drift và rollback có dấu vết.
- Multi-source representative có toàn bộ distinct senses/members/provenance;
  equivalence uncertain không bị silent collapse hoặc auto curated.
- Manifest/journal/apply/resume/conflict/rollback được kiểm; live coverage/count
  trước/sau có artifact; user anchor IDs còn nguyên.
- Cost report theo job target thật; không có tuyên bố tiết kiệm theo count ứng viên.

**Trạng thái 06/10:** DB4-D0.1/DB4-D0.2/M4.2 code local, 375 unit / 31 e2e pass;
migration 038 áp DB test riêng. VPS dry-run 55.997 eligible projection; 500 cặp
WordNet có full-scope candidate equivalence, 50 cặp chứa examples cần bảo toàn.
Chưa commit/push/deploy/apply VPS, không gọi AI hoặc xóa ID. Bước tiếp theo là
release/backfill theo handoff và hoàn thiện DB4-D0.3/DB4-D0.5 dưới đây.

## 10. DB4-D0.5 — Dọn bản ghi trùng thật sau khi đủ điều kiện

Chủ dự án chấp nhận xóa bản trùng thật; chặng này bổ sung đường physical cleanup
sau D0.3. **Chưa code alias/delete tool, chưa áp dữ liệu**. D0.1–D0.4 không xóa IDs.

1. Chốt canonical sense/lexeme từ equivalence đầy đủ và evidence WordNet synset
   nguồn; source version và raw identity vẫn lưu riêng. Definition bị projection
   lỗi không là bằng chứng merge. Unknown JA reading/etymology không nối mù.
2. Thêm alias/resolver cho ID cũ và external source identity; mọi consumer/API,
   import joins, source rebuild, DB3/DB4 job bindings kiểm canonical resolution.
   Importer không tái tạo bản đã gộp; input thay đổi thì conflict/review lại.
3. Manifest có context + dependency hashes, canonical IDs, before-images và run
   ownership. Inventory cả FK core/app, legacy artifacts và unique constraints;
   FK count 0 chưa chứng minh không có consumer ngoài DB.
4. Giữ/chuyển examples, gloss review/provenance, source anchors, relations và app
   references; collision không tự drop dữ liệu người học. **50/500 cặp mẫu có
   examples** là dependency đã thấy, không dùng cascade để giải quyết.
5. Chỉ xóa sense tương đương thuộc run đã đủ guard. Lexeme chỉ xóa khi mọi sense
   và child/source identities đã được xử lý; lexeme còn nghĩa riêng vẫn giữ.
   Không xóa concept/synset nguồn hoặc tự curate/đổi verified ownership.
6. Test local ID/API resolution, importer rerun, FK uniqueness, drift/resume,
   interrupted commit và rollback cả source identity/dependencies. Pilot nhỏ,
   backup/restore drill + resource budget trước production writer.
7. Verify dictionary/source coverage, anchors người học, source credit, counts/
   hashes và journal; có edit mới thì conditional rollback conflict, không force.
   Report distinct IDs removed/repointed và job/cost reuse thật, không cộng memberships.

Candidate inventory code hiện chỉ READ ONLY, **không có DELETE hoặc --apply**.
Tài liệu này ghi điều kiện cần hoàn thiện trước khi một run xóa được chuẩn bị và
kiểm chứng; không coi việc đã lưu shortlist là alias/delete tooling đã hoàn tất.
