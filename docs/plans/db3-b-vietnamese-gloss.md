# Kế hoạch DB3-B — Gloss tiếng Việt và nguồn ví dụ

> Ngày: 2026-10-05 · **Đề xuất chờ duyệt; chưa triển khai hoặc gọi LLM.**
> Worktree: `Langoo-worktrees/deepseek-data`, branch `parallel/deepseek-db3`.
> Căn cứ: [kiểm kê DB3](../reviews/db3-inventory-2026-10-05.md), [DB3-A](db3-a-foundation.md), [hậu kiểm DB3-A](../reviews/db3-a-recheck-2026-10-05.md), migrations 005/007/009/010/011/013/025/032.

## 1. Mục tiêu và phạm vi

1. Bổ sung gloss VI **đúng nghĩa cụ thể** cho sense và concept, ưu tiên nội dung JA thuộc JLPT N5 → N1.
2. Tận dụng dữ liệu đã có trước; dịch bằng LLM phần thiếu có definition/ngữ cảnh đủ rõ.
3. Giữ nguồn, chất lượng, kết quả duyệt, checkpoint và khả năng rollback theo từng lô.
4. Thu thập cặp ví dụ JA–VI có nguồn vào artifact để dùng ở bước sau.

Đầu ra chính: công cụ offline trong `scripts/db3/`, artifact candidate/job và seed gloss. DB3-B không tạo liên kết sense↔concept mới, không đổi `verified` hay `concept.status`; các quyết định mapping thuộc DB4, quy trình curator/API ghi thuộc M14. Không tự sinh câu ví dụ rồi coi là câu từ nguồn. Bước đầu chỉ xuất candidate ví dụ; chưa seed `example`/`example_sense`/`example_translation`.

API vẫn read-only đối với nội dung core; DB3-B là công cụ vận hành riêng. Không đổi provider chat Groq, runtime `AI_*`, `src/**`, Prisma, package/dependency hoặc migrations đã chạy. Đề xuất ban đầu **không cần migration mới**; nếu schema không đủ thì ghi rõ thiết kế và để người tích hợp cấp số/duyệt trước khi code phần đó.

## 2. Hiện trạng và cách đo lại

Kiểm kê full local 05/10 trước bước seed DB3-A ghi nhận:

| Dữ liệu | Số liệu tham chiếu | Ý nghĩa cho DB3-B |
| --- | --- | --- |
| Lexeme có JLPT accepted | 7.285 lexeme | Tập ưu tiên; không đồng nghĩa 7.285 sense |
| `sense_gloss` VI | 0 | Cần đo số sense có definition đủ dùng và chưa có VI |
| `concept_gloss`/`concept_label` VI | 5.368 dòng mỗi bảng, 3.533 concept | Phải phân biệt nhãn/lemma và definition; không coi mọi dòng là gloss đạt chất lượng |
| `concept` | 120.875, trong đó 3.533 có cache VI | Không dịch toàn bộ 120k concept ngay |
| Wiktionary pivot JA–VI | 39.551 cặp text theo báo cáo | Candidate từ vựng, chưa phải 39.551 cặp sense đúng |
| OMW VI | 5.498 dòng `(pwn30_offset, lemma)` | **Lemma VI**, không phải definition VI |
| Tatoeba JA–VI | 8.477 cặp câu | Nguồn candidate ví dụ; chưa chứng minh câu minh hoạ đúng sense |

Nhánh hiện có nhật ký DB3-A local trong commit `8f70427`: 214 radical, 6.417 media, 5 deck/7.285 item. Đây là kết quả được ghi trong tài liệu, không phải xác nhận trạng thái VPS. B0 sẽ đo lại gloss/coverage trên snapshot được chỉ định; không dùng DB demo để suy coverage full dataset.

### B0 phải xuất

- Fingerprint dataset, host/port/database không chứa credential, phiên bản migrations và snapshot các nguồn.
- JLPT dùng `core.jlpt_link WHERE status='accepted'`; cấp duy nhất của lexeme = `MAX(source_level)`, N5 trước N1. Không ghi `lexeme_level`.
- Theo cấp: số lexeme, primary sense, tất cả sense, sense có VI nguồn/VI máy/VI đã duyệt, sense thiếu definition và sense không có primary.
- Coverage theo **sense**, riêng primary và các nghĩa khác; loại trừ candidate chỉ khớp lemma khỏi số đã phủ.
- Concept có VI definition thực, concept chỉ có label, concept liên quan qua các link hiện hữu đủ bằng chứng.
- Audit license/version/attribution, nguồn thiếu metadata, gloss cũ có dấu hiệu nhầm lemma thành definition.
- Đo hiệu năng query/EXPLAIN trên bản full read-only trước khi chạy các join lớn; tránh load toàn bộ hàng triệu sense vào RAM.

Không tự sửa gloss cũ đáng ngờ; đưa vào báo cáo để người tích hợp/curator xử lý.

## 3. Các chặng triển khai

| Chặng | Việc | Sản phẩm và điều kiện kết thúc |
| --- | --- | --- |
| B0 — Inventory | Query read-only, schema/source audit, chốt snapshot và target IDs | `db3-b-inventory-<date>.md/json`, baseline coverage và danh sách nguồn đủ điều kiện |
| B1 — Harvest | Đọc Wiktionary/OMW, tái sử dụng mapping đã có, phân loại ambiguity; thu cặp câu | Candidate JSONL có lineage; chạy hai lần cùng snapshot cho cùng hash; chưa ghi core |
| B2 — Offline tooling | Provider stub, validator, cache/checkpoint, apply/rollback trên DB mới riêng | Regression các lỗi DB3-A và gloss rank/review/concurrency/resume đều pass |
| B3 — Pilot LLM | Preflight provider/model; tối đa 100 target, concurrency 1; human audit | Báo cáo chất lượng, token/quota/cost, nguồn sai/nghĩa sai; không tự tăng batch/model |
| B4 — Apply có giới hạn | Seed candidate đạt gate vào DB local cùng snapshot, từng lô nhỏ | Manifest trước/sau từng lô, kiểm chứng serving, count/rank/idempotency/rollback |
| B5 — Mở rộng | N5 → N4 → N3 → N2 → N1, primary trước rồi các nghĩa khác đủ ngữ cảnh | Coverage thực theo từng đợt; full/VPS là bước vận hành được chỉ định riêng |

Đề nghị duyệt triển khai **B0–B2 trước**. B3 chỉ chạy khi có cấu hình/key trong máy, model và chính sách sử dụng phù hợp, budget đã chốt; B4/B5 dùng kết quả pilot được review. Việc lập kế hoạch này không cấp quyền chạy batch LLM, seed VPS hoặc tự mua/nạp tiền.

## 4. Harvest: nguồn và quy tắc gắn nghĩa

### 4.1 Wiktionary

Ưu tiên theo độ chắc chắn:

1. Translation assertion trực tiếp có `scope='sense'`, `source_sense_id` rõ và target VI: candidate gloss cho **chính source sense đó**, sau khi kiểm tra ngôn ngữ/nguồn/definition. `source_sense_id` của entry EN không được dùng như sense JA.
2. Tái sử dụng `translation_target_candidate` đã accepted với target sense cụ thể hoặc mapping nguồn hiện hữu đủ bằng chứng; kiểm tra lại sense thuộc đúng lexeme, ngôn ngữ và source snapshot. Không tự promote pending candidate.
3. Pivot JA–VI qua cùng `source_lexeme_id` EN và cùng `sense_hint` không rỗng: giữ ID của cả hai assertion, nguồn, hint, forms/reading/POS. Nếu đã có một đường gắn nghĩa cụ thể đáng tin cậy thì xuất candidate eligible; nếu chỉ khớp text/lemma thì xuất candidate lexical/ambiguous để DB4/người review giải quyết.

Trùng lemma, đồng âm, khác POS hoặc nhiều sense phù hợp → không tự lấy primary sense hay match đầu tiên. Chuẩn hoá Unicode NFC, whitespace; giữ text gốc/evidence, không bỏ dấu VI hoặc tự đổi kana/kanji để mở rộng match.

### 4.2 OMW/WordNet

- `staging.omw_wikt_vi.lemma` là nhãn tiếng Việt. Đối chiếu `pwn30_offset` với `staging.ili_map_pwn30`/`core.wordnet_synset` và concept hiện có theo đúng lexicon/version.
- Xuất label candidate; chỉ seed `concept_label(label_kind='lemma')` khi concept mapping là xác định và source/license đã được kiểm tra. Không chép lemma vào `concept_gloss` hay cache `concept.gloss_vi`.
- Definition VI chỉ được lấy từ nguồn có definition thực gắn đúng synset/concept; nếu không có, đưa vào hàng đợi dịch definition EN đã chọn.
- Không tạo ILI/concept mới, không sửa sense_concept hoặc tự đặt verified=true.

### 4.3 Wikidata và ví dụ

- Wikidata là nguồn phụ: snapshot có entity ID và mapping concept bằng khóa đã tồn tại, không suy từ label giống nhau. Nếu chưa có mapping chắc, chỉ xuất artifact; không dùng tên riêng như definition.
- Tatoeba: dedupe cặp theo sentence ID, kiểm tra lang JA/VI, lưu ID/text/batch/source/license. Candidate liên quan từ vựng không đồng nghĩa câu đúng sense.
- Không có LLM sinh ví dụ trong pilot này. Cấu trúc seed ví dụ và matching sense sẽ có đề xuất riêng sau khi kiểm chứng candidate.

### 4.4 Phân lớp đầu ra

`eligible_source` = nguồn trực tiếp/đường mapping đã có đủ bằng chứng; `needs_translation` = target thiếu VI nhưng có definition/ngữ cảnh đủ; `ambiguous` = chưa gắn chắc vào nghĩa; `missing_context` = thiếu dữ liệu; `blocked_source` = license/version/lineage chưa đủ. Chỉ hai lớp đầu được đi tiếp theo gate tương ứng. Điểm heuristic không tự chuyển ambiguity thành đủ bằng chứng.

## 5. Dịch phần thiếu bằng OpenCode

### 5.1 Provider và model

Theo quyết định mới nhất trong DB3-A, provider dữ liệu ưu tiên **OpenCode Go**. Tài liệu cũ ở main còn ghi Zen; khi tích hợp cần cập nhật lại bằng quyết định hiện hành, không đổi provider chat.

Theo [tài liệu Go chính thức](https://opencode.ai/docs/go/) đã kiểm tra 05/10, Go dùng API `/zen/go/v1`, có catalog `/models`; `space-bunny-free` hỗ trợ chat completions. Client cần User-Agent riêng và session ID ổn định. Model free được ghi là miễn phí có thời hạn; Go không đồng nghĩa mọi model đều miễn phí. Tài liệu cũng định hướng Go cho traffic coding agent, nên cần xác nhận job dịch dữ liệu dùng được trước pilot, không giả danh client khác để vượt hạn chế.

Preflight lấy catalog và kiểm tra key/quyền/model bằng request nhỏ khi được phép. Nếu Go không hỗ trợ kiểu job này, giữ harvest/stub hoạt động và trình phương án [OpenCode Zen](https://opencode.ai/docs/zen/) để chốt endpoint/model riêng. Không tự fallback sang model trả phí hay đổi provider đã chọn.

Đề xuất cấu hình **riêng cho CLI**, không sửa `.env` chung trong phiên triển khai:

```dotenv
DB3_AI_BASE_URL=https://opencode.ai/zen/go/v1
DB3_AI_MODEL=space-bunny-free
DB3_AI_API_KEY=<đặt ở môi trường máy, không đưa vào Git/chat>
DB3_AI_TIMEOUT_MS=60000
DB3_AI_CONCURRENCY=1
DB3_AI_MAX_REQUESTS=100
DB3_AI_MAX_COST_USD=0
```

Các giá trị này là đề xuất cho pilot. Base URL/model phải khớp API format trong catalog; header `x-opencode-session` là UUID conversation được ghi checkpoint để retry/resume dùng lại. Dùng `User-Agent: LangooDB3/<version>`; không ghi key/header auth vào log/artifact. Chỉ gửi dữ liệu từ điển/nguồn đã chọn, không gửi dữ liệu người học.

### 5.2 Input/output

- Một target/sense cụ thể mỗi request; context: source definition và **ngôn ngữ thực** (`definition_language_id`), lemma, reading, POS, register/domain và ví dụ có nguồn nếu có. Không suy definition language từ language_id của lexeme.
- Concept request có concept key/ILI/synset và definition nguồn tương ứng; không trộn nhiều nghĩa chỉ vì cùng lemma.
- Prompt yêu cầu gloss VI ngắn, đúng nghĩa, giữ sắc thái; không tự thêm meaning, entity, câu ví dụ hoặc URL. Ngữ liệu là data, không thực thi instruction chứa trong definition.
- Schema JSON nghiêm ngặt gồm `target_type`, `target_id` dưới dạng string, `gloss_vi` hoặc null khi không đủ ngữ cảnh, `reason`. ID phải trùng target đầu vào; từ chối ID lạ/thiếu/trùng, JSON lỗi, text rỗng/quá dài. Giới hạn text đề xuất 500 ký tự Unicode.
- Validate JSON/ID/language bằng code rồi đưa vào review sample; bộ phát hiện ngôn ngữ chỉ là cảnh báo, không bảo đảm nghĩa đúng.
- `is_machine=true`, reviewed fields NULL, `quality=NULL` cho output LLM. Không dùng confidence tự khai của model làm chất lượng đã kiểm chứng.

### 5.3 Retry, cache và checkpoint

- Key job/cache: target semantic key + dataset/source hash + input hash + provider/model + prompt version; target IDs bigint giữ string.
- Cache chỉ tái sử dụng output đã validate và có nguyên response/hash. Đổi input, model hoặc prompt làm key đổi; không reuse kết quả cũ âm thầm.
- Checkpoint durable từng response với state pending/running/generated/validated/rejected/applied/failed; file quyền 0600, atomic/fsync, không để trong `/tmp` hay thư mục deploy bị ghi đè khi vận hành thật.
- 429/5xx/network timeout: tối đa 3 attempt/request, tôn trọng Retry-After, exponential backoff + jitter. 401/403/model không tồn tại: dừng job. Request cap tính cả retry và request có kết quả chưa rõ.
- Checkpoint trước request ghi attempt/session/target; timeout có thể đã tiêu quota. Không cam kết exactly-once ở provider: đánh dấu attempt không rõ, resume phải tính budget và quyết định retry; không tự chạy lại mọi request completed.
- Dừng khi đạt request/token/cost cap hoặc quota/provider thay đổi; giữ kết quả đã có. Không tự nạp tiền hoặc đổi sang model trả phí.

Pilot: tối đa **100 target tổng cộng**, đề xuất 80 sense JA và 20 concept đủ ngữ cảnh; ưu tiên N5/N4, có tối thiểu 10 ca đa nghĩa/đồng âm/POS dễ nhầm trong mẫu. Gold review độc lập đối chiếu đúng source meaning: mục tiêu ≥98/100 đúng nghĩa, **0 lỗi nghiêm trọng đảo nghĩa/gắn sai target/bịa nội dung**. Đây là gate đề xuất, không phải chất lượng đã được xác nhận của model.

## 6. Schema ghi, provenance và chất lượng

| Bảng | Khoá thực / cách dùng | Chính sách |
| --- | --- | --- |
| `core.sense_gloss` | id identity; UNIQUE `(sense_id, language_id, rank)` | Append gloss VI eligible, không overwrite slot của nguồn khác/người duyệt |
| `core.concept_gloss` | PK `(concept_id, language_id, rank)` | Append definition VI, không đổi status/cache concept |
| `core.concept_label` | id identity; UNIQUE `(concept_id, language_id, rank, label_kind)` | Chỉ label có provenance, đúng kind; không thay definition bằng lemma |
| `public.source` | id cấp dưới lock, UNIQUE code | Nguồn gốc thật hoặc nguồn derived/AI riêng; không sửa license của nguồn cũ để vừa pipeline |
| `staging.import_batch` | id UUID | Batch kết quả dẫn xuất, không sửa batch raw đã nạp |
| `core.mapping_run` | id identity, UNIQUE run_key | Task/run metadata, model/prompt/snapshot, count/status; không ghi quyết định mapping DB4 |
| Gloss history | trigger UPDATE/DELETE hiện có | Giữ lịch sử audit; không disable trigger/xoá lịch sử khi rollback |

Các bảng metadata ghi mới ở trên là scope seed DB3-B cần được duyệt; staging raw vẫn read-only. Nếu dùng batch dẫn xuất trong staging.import_batch thì source_code/file_name/hash chỉ tới artifact thực của run, không giả là original import.

### Quy tắc apply

- Language ID tra theo `public.language.code='vi'`, không giả định ID 3 trên mọi đích.
- Chuẩn hoá NFC/trim nhưng giữ text/source/evidence gốc trong artifact. Dedupe trong target VI theo text hash và lineage trước khi cấp rank.
- Rank mới append sau rank hiện có, trong transaction có lock phù hợp; hết miền smallint thì báo lỗi. Khi chạy lại cùng candidate, tìm dòng đã ghi và xác nhận payload thay vì cấp rank mới.
- Đối chiếu candidate key→ID/rank/payload trong journal và batch metadata để idempotent dù target nhận thêm gloss từ run khác. Nếu artifact/journal bắt buộc bị mất/không khớp, dừng thay vì đoán slot hoặc overwrite.
- Dòng reviewed hoặc nguồn khác không được ghi đè. Dữ liệu đã được curator chỉnh sau apply khiến rollback dừng, không hoàn nguyên việc duyệt.
- Gloss từ nguồn do con người biên soạn giữ `is_machine=false` chỉ khi là trích xuất trực tiếp/gắn nghĩa đủ chắc; reviewed fields vẫn NULL. Text do LLM dịch là machine dù nguồn đầu vào là human.
- `quality` NULL khi chưa có thước đo hiệu chuẩn; mọi candidate giữ evidence và review result trong artifact. Chưa rõ license/lineage → giữ blocked_source, không apply.
- Không ghi `concept.gloss_vi`, `concept.status`, `sense_concept`, `translation_target_candidate.decision` hoặc deck.concept_id. Cache/canonical promotion thuộc bước curation/mapping được duyệt riêng.
- `serve.sense_card` hiện chọn reviewed trước, rồi non-machine, rồi rank, và đã có gloss_vi_machine/gloss_vi_reviewed. Kiểm chứng view/API đọc đúng badge sau seed; concept gloss mới không được tuyên bố tự xuất hiện ở API sử dụng cache cũ.

Provenance mỗi candidate: original source IDs/version/license/URL/hash, assertion/source row IDs, target semantic key/ID, cách align, definition language, run/batch, model/prompt/input/output hash. Hai nguồn pivot cần lineage của cả hai; một source_id trong row không thay thế manifest lineage đầy đủ.

## 7. Apply, resume và rollback

- Phát triển trên DB UUID mới riêng tạo từ fixture; TEST URL phải local `_test`. Không reset DB dùng chung của DeepSeek/GPT.
- Apply và rollback đều cần `--apply --allow-db <db>`; `_test` cần `--allow-test`. Đích manifest phải khớp host/port/database và dataset fingerprint.
- Candidate từ full local không được apply bằng bigint ID sang DB demo/VPS khác lineage. Phải xác nhận snapshot cùng nguồn hoặc resolve **duy nhất bằng source identity/ILI/synset key** và xuất mapping review; không đoán theo lemma.
- Mở rộng `_mutations.ts` bằng allowlist task/bảng/scope typed cho gloss/metadata; không nhận tên bảng/SQL predicate từ artifact.
- Mỗi lô đề xuất 50 gloss, một transaction, journal prepared trước COMMIT/applied sau COMMIT. Không giữ transaction hoặc DB lock khi gọi LLM.
- Job manifest đăng ký child run key/ID/path/input hash **trước mutation**, rồi ghi trạng thái child commit theo thứ tự. Resume đối chiếu child journal và `mapping_run.run_key`/batch đã có để xử lý cửa sổ COMMIT thành công nhưng checkpoint job chưa cập nhật; không cấp rank mới cho lô đã commit. Khi một lô lỗi, các lô trước vẫn có manifest. Không báo toàn job rollback nếu các lô trước đã commit.
- Rollback child theo thứ tự ngược, kiểm tra after-state, chỉ loại dòng của lô/khôi phục dòng cũ. Dùng recovery prepared/rollback-prepared của DB3-A và thêm regression cho các bảng mới.
- Source/import_batch/mapping_run cần được giữ để audit history có thể tra lineage; rollback job đánh dấu run rolled_back và ghi count/reason. Không xoá metadata dùng bởi lô còn lại hoặc dữ liệu khác. Candidate/cache không bị xoá để có thể tái kiểm chứng.
- File checkpoint/journal thật lưu ở volume bền vững ngoài release directory trên VPS, backup cùng thao tác vận hành; không hardcode path của máy dev vào tool.

## 8. File dự kiến

```text
docs/plans/db3-b-vietnamese-gloss.md         # kế hoạch này
docs/reviews/db3-b-inventory-<date>.md       # số liệu thật + queries
docs/reviews/db3-b-pilot-<date>.md           # quality/budget/coverage/failed cases
scripts/db3/gloss-inventory.ts              # B0 read-only
scripts/db3/gloss-harvest.ts                # candidate Wiktionary/OMW/Wikidata
scripts/db3/example-candidates.ts           # Tatoeba artifact, không seed
scripts/db3/gloss-translate.ts              # queue/cache/checkpoint, stub + Go adapter
scripts/db3/gloss-apply.ts                  # guarded append, resume/rollback
scripts/db3/verify-gloss.ts                 # coverage/rank/provenance/serving audit
scripts/db3/_gloss-types.ts                 # schema input/output/candidate/job
scripts/db3/_mutations.ts                   # thêm scope/table allowlist và regression
scripts/db3/gloss-regression.test.ts        # DB mới riêng + HTTP mock
scripts/db3/fixtures/gloss/*                # polysemy/POS/lemma-only/duplicate mẫu nhỏ
scripts/db3/README.md                       # commands/recovery/budget
```

Artifact mặc định development trong `uploads/db3b/` đã nằm dưới uploads gitignored: inventory, candidates JSONL, unresolved JSONL, queue/checkpoints/cache, pilot review, manifests và verify JSON. Nơi lưu thật nhận qua `--artifact-dir` và phải bền vững. Chưa thêm các file code trên trong phiên lập plan.

## 9. Chia việc để làm song song

| Người thực hiện | Việc/file sở hữu | Điểm bàn giao |
| --- | --- | --- |
| DeepSeek V4 Flash | B0/B1: inventory, harvest và example candidate, fixtures nguồn | Dataset/candidate schema đã thống nhất, lineage và ambiguity report |
| GPT Sol high hoặc Luna max | B2: typed candidate/job, translator stub/adapter, validator, checkpoint, apply/rollback và regression | Không phụ thuộc harvest đã xong; chạy trên candidate fixture cùng schema |
| Người tích hợp/chủ dự án | Chốt interface trước, gate provider/budget, review sample, merge và vận hành đích thật | Đồng ý pilot/đợt apply cụ thể khi có artifact và báo cáo |

Mỗi nhánh/worktree riêng; ai sở hữu `_gloss-types.ts` và `_mutations.ts` là GPT để tránh sửa chung. DeepSeek dùng interface đã chốt, không cấp migration number hoặc sửa env/PROGRESS/package chung. Không dùng cùng DB để chạy destructive test. Sau B0/B1 mới nối queue thật vào translator; không chờ harvest toàn corpus để kiểm thử cơ chế stub.

## 10. Kiểm thử và nghiệm thu

- [ ] Inventory có queries/fingerprint và phân biệt full/demo/VPS; số đã phủ tính trên sense/concept thực, không trên cặp text.
- [ ] Pivot đa nghĩa/đồng âm/khác POS không bị gắn vào primary mặc định; OMW lemma không vào concept_gloss.
- [ ] Harvest ổn định theo snapshot, dedupe và evidence đủ cho từng candidate; nguồn thiếu metadata bị giữ lại.
- [ ] Dry-run không ghi DB hoặc gọi LLM; generate cần chế độ explicit, apply không tự generate.
- [ ] Translator mock: JSON lỗi/ID sai/empty/null/too long, 401/403/429/5xx/timeout, quota cap, Retry-After, checkpoint corruption và resume giữa request đều được kiểm tra.
- [ ] Cache đổi khi input/model/prompt đổi; repeated completed target không gọi lại provider.
- [ ] DB: apply hai lần không tạo duplicate; rank conflict/concurrent apply được giải quyết trong lock/transaction; reviewed data giữ nguyên.
- [ ] Rollback lần hai giữ dữ liệu lần đầu; after-state đổi/đích sai/legacy/dry-run bị từ chối; bigint và timestamp không mất precision.
- [ ] Trigger history vẫn hoạt động; rollback không xoá trace; metadata run còn để truy nguồn.
- [ ] Lỗi ghi journal trước/sau COMMIT và rollback recovery được tái hiện trên DB test riêng.
- [ ] Pilot tối đa 100 target có human review, báo cáo token/cost/request cap; đạt gate chất lượng mới mở rộng.
- [ ] `serve.sense_card` chọn reviewed/native/machine đúng thứ tự, trả cờ machine/reviewed đúng; không làm thay đổi phục vụ sense_pair/concept curated.
- [ ] Build/lint/TypeScript, parser/unit/provider mock và regression DB liên quan pass; README/report đủ cách chạy và phục hồi.
- [ ] Mỗi đợt apply có counts trước/sau, số skipped/ambiguous/missing context, số machine/native/reviewed và coverage theo cấp; mọi partial failure có child manifest.

## 11. Điểm cần chốt khi duyệt

1. Duyệt B0–B2 offline trước, gồm append gloss VI và metadata trong các bảng §6; ví dụ chỉ artifact.
2. Pilot tối đa 100 target, concurrency 1, **không phát sinh phí** mặc định; provider/model được kiểm tra lại lúc chạy. Nếu phải dùng model trả phí thì cần ngân sách cụ thể.
3. Dữ liệu nguồn/mapping yếu giữ artifact; seed gloss source chỉ cho target đã xác định, LLM luôn machine/unreviewed. Không promote concept/mapping ở DB3-B.
4. Mốc mở rộng: hoàn thành N5/N4 primary trước, sau đó các cấp còn lại và secondary sense đủ ngữ cảnh. Không cam kết phần trăm coverage trước B0/pilot.

Sau khi duyệt, bắt đầu B0–B2 và báo cáo trước khi gọi provider thật. Plan này không yêu cầu key trong chat và không thực hiện thay đổi DB hay hạ tầng.
