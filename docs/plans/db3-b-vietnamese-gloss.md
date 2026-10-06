# Kế hoạch DB3-B — Gloss tiếng Việt và nguồn ví dụ

> Ngày: 2026-10-05 · **Đã chốt hướng kỹ thuật + model pilot; chưa triển khai tooling/pilot (mới smoke provider).**
> Worktree: `Langoo-worktrees/deepseek-data`, branch `parallel/deepseek-db3`.
> Căn cứ: [kiểm kê DB3](../reviews/db3-inventory-2026-10-05.md), [DB3-A](db3-a-foundation.md), [hậu kiểm DB3-A](../reviews/db3-a-recheck-2026-10-05.md), migrations 005/007/009/010/011/013/025/032.

### Quyết định bổ sung 05/10

| Mục | Chốt triển khai | Người phụ trách |
| --- | --- | --- |
| Context | EN `sense_gloss` của chính sense JA là input chính; lưu từng source row trong provenance | DeepSeek B0/B1, GPT validator |
| Harvest/pilot | Dịch EN → VI cho sense JA đã xác định; không kỳ vọng pivot text tạo coverage JA khi DB4 chưa mapping | DeepSeek B0/B1 |
| Hiển thị | Chọn (a): gloss máy có badge **Máy dịch · chưa duyệt**; xác nhận FE trước rollout VPS | Người tích hợp + FE; M14 quản lý review/credits |
| Nguồn | DeepSeek audit dump/license/version; GPT kiểm tra lineage và bàn giao credits. EN gloss tập ưu tiên thực tế là JMdict #1 | DeepSeek + GPT |
| Model/key | Pilot dùng **`muse-spark-1.3-contributor`** qua Responses API, `reasoning.effort=minimal` (thấp nhất được nhận; `none` bị từ chối), 100 sense; `space-bunny-free` chỉ dự phòng, LongCat loại (bench JSON 6/8). Chủ dự án/ops thu hồi key cũ, cập nhật key mới trước B3 | Chủ dự án/ops |
| Data policy | Muse Contributor đổi giá rẻ lấy quyền **dùng prompt/completion để train model Meta**, không ZDR — chấp nhận cho dữ liệu nguồn đã audit; tuyệt đối không gửi dữ liệu người học; `space-bunny-free` (no-train, 0-day) là phương án dự phòng | Chủ dự án |
| Interface/hạ tầng | Tích hợp DB3-A trước; GPT đóng băng schema v1 trước B1/B2 song song; snapshot full local `55433`; VPS artifact `/opt/langoo/storage/db3b/` | GPT + người tích hợp/ops |
| Review | Quyết định mới 06/10: chủ dự án chấp nhận GPT chấm ngữ nghĩa đủ 100 mẫu thay reviewer con người; ghi rõ reviewer AI, giữ gate ≥98 pass/0 severe | GPT review, DeepSeek chuẩn bị mẫu |
| Tài liệu | VPS DB3-A đã áp (`b052d2f`); Tatoeba 8.477 là cặp đã lọc; lưu contract request Go ở §5.1 | Người tích hợp |

## 1. Mục tiêu và phạm vi

1. Bổ sung gloss VI **đúng nghĩa cụ thể** cho sense và concept, ưu tiên nội dung JA thuộc JLPT N5 → N1.
2. Tận dụng VI có alignment đã xác định; phần chính của pilot là dịch EN gloss của sense JA sang VI, không đợi definition JA hoặc mapping DB4.
3. Giữ nguồn, chất lượng, kết quả duyệt, checkpoint và khả năng rollback theo từng lô.
4. Thu thập cặp ví dụ JA–VI có nguồn vào artifact để dùng ở bước sau.

Đầu ra chính: công cụ offline trong `scripts/db3/`, artifact candidate/job và seed gloss. DB3-B không tạo liên kết sense↔concept mới, không đổi `verified` hay `concept.status`; các quyết định mapping thuộc DB4, quy trình curator/API ghi thuộc M14. Không tự sinh câu ví dụ rồi coi là câu từ nguồn. Bước đầu chỉ xuất candidate ví dụ; chưa seed `example`/`example_sense`/`example_translation`.

API vẫn read-only đối với nội dung core; DB3-B là công cụ vận hành riêng. Không đổi provider chat Groq, runtime `AI_*`, `src/**`, Prisma, package/dependency hoặc migrations đã chạy. Đề xuất ban đầu **không cần migration mới**; nếu schema không đủ thì ghi rõ thiết kế và để người tích hợp cấp số/duyệt trước khi code phần đó.

## 2. Hiện trạng và cách đo lại

Baseline full local 05/10, kết hợp kiểm kê ban đầu và đối chiếu bổ sung của phiên này:

| Dữ liệu | Số liệu tham chiếu | Ý nghĩa cho DB3-B |
| --- | --- | --- |
| Lexeme có JLPT accepted | 7.285 lexeme | Tập ưu tiên; không đồng nghĩa 7.285 sense |
| Sense của lexeme JLPT accepted | 15.245 sense, 0 có definition, 0 link `sense_concept` | Không dùng số definition JA toàn DB để suy ngữ cảnh của tập ưu tiên |
| `sense_gloss` EN trong tập ưu tiên | 41.123 dòng / 15.245 sense (100%), ~2,7 gloss/sense | Input chính; query read-only xác nhận toàn bộ thuộc JMdict #1 |
| `sense_gloss` VI | 0 | Hàng đợi `needs_translation` nếu source audit đạt; ~2,53M EN gloss toàn DB không phải số target pilot |
| `concept_gloss`/`concept_label` VI | 5.368 dòng mỗi bảng, 3.533 concept | Phải phân biệt nhãn/lemma và definition; không coi mọi dòng là gloss đạt chất lượng |
| `concept` | 120.875, trong đó 3.533 có cache VI | Không dịch toàn bộ 120k concept ngay |
| Wiktionary assertions | EN→JA 69.786; EN→VI 29.626; không JA→VI | Source sense là EN; pivot 39.551 cặp text không chứng minh alignment sense JA |
| `translation_target_candidate` | 82.355 pending, 0 `target_sense_id` | Rule tái sử dụng accepted hiện không có dữ liệu để dùng |
| OMW VI | 5.498 dòng `(pwn30_offset, lemma)` | **Lemma VI**, không phải definition VI |
| Tatoeba JA–VI | 8.477 cặp JA–VI lọc từ hơn 870k dòng `tatoeba_link` | Số cặp sau lọc, không phải tổng link; chưa chứng minh đúng sense |

DB3-A đã áp full local (`8f70427`) và **VPS cùng ngày** (`b052d2f`): 214 radical, 6.417 media, 5 deck/7.285 item; xem nhật ký §8.1 của plan DB3-A. B0 dùng full local `127.0.0.1:55433/langoo`, read-only, đóng băng target/context bằng artifact và fingerprint. Trước apply VPS phải đối chiếu lineage/fingerprint; kết quả áp DB3-A không chứng minh mọi bigint ID của hai DB giống nhau.

Kiểm tra bổ sung bằng `SELECT` read-only: JOIN sense của lexeme có JLPT accepted → `sense_gloss` EN → `public.source` cho **source #1 `jmdict`, 41.123 gloss / 15.245 sense**, license trong DB `CC BY-SA 4.0`, version `3.6.2`. Version này vẫn cần đối chiếu ngày dump/hash, không mặc định là ngày snapshot. Source #8 `wiktextract` và #9 `omw-wikt-vi` đều thiếu version; #9 hiện ghi `CC BY-SA` chưa có số phiên bản. Số liệu license “CẦN XÁC MINH” ở kiểm kê cũ phải đối chiếu DB/snapshot cụ thể, không chép lại thành trạng thái hiện tại.

### B0 phải xuất

- Fingerprint dataset, host/port/database không chứa credential, phiên bản migrations và snapshot các nguồn.
- JLPT dùng `core.jlpt_link WHERE status='accepted'`; cấp duy nhất của lexeme = `MAX(source_level)`, N5 trước N1. Không ghi `lexeme_level`.
- Theo cấp: số lexeme, primary sense, tất cả sense, sense có VI nguồn/VI máy/VI đã duyệt, sense thiếu definition và sense không có primary.
- Coverage theo **sense**, riêng primary và các nghĩa khác; loại trừ candidate chỉ khớp lemma khỏi số đã phủ.
- Xuất count từng rule §4.1: raw assertions, accepted có target sense, pivot lexical, pivot có alignment sense JA, eligible cuối sau source audit; tách source sense EN khỏi target JA. Xuất count từng lớp §4.5, EN gloss coverage/source và số bị blocked.
- Concept có VI definition thực, concept chỉ có label, concept liên quan qua các link hiện hữu đủ bằng chứng.
- Audit license/version/attribution, nguồn thiếu metadata, gloss cũ có dấu hiệu nhầm lemma thành definition.
- Đo hiệu năng query/EXPLAIN trên bản full read-only trước khi chạy các join lớn; tránh load toàn bộ hàng triệu sense vào RAM.

Không tự sửa gloss cũ đáng ngờ; đưa vào báo cáo để người tích hợp/curator xử lý.

## 3. Các chặng triển khai

| Chặng | Việc | Sản phẩm và điều kiện kết thúc |
| --- | --- | --- |
| B0 — Inventory | Query read-only, schema/source audit, chốt snapshot và target IDs | `db3-b-inventory-<date>.md/json`, baseline coverage và danh sách nguồn đủ điều kiện |
| B1 — Harvest | Xuất target sense JA + EN gloss từ cùng sense, needs_translation; harvest VI/mapping hiện hữu theo rule, pivot lexical và cặp câu riêng | Candidate JSONL có lineage/count từng rule; không hứa VI sẵn có phủ JA; chạy hai lần cùng snapshot cho cùng hash; chưa ghi core |
| B2 — Offline tooling | Provider stub, validator, cache/checkpoint, apply/rollback trên DB mới riêng | Regression các lỗi DB3-A và gloss rank/review/concurrency/resume đều pass |
| B3 — Pilot LLM | Dùng contract Go đã kiểm chứng, kiểm tra key mới/model còn khả dụng; 100 sense JA, một model, concurrency 1; review ngữ nghĩa bằng GPT theo quyết định 06/10 | Báo cáo chất lượng, token/quota/cost, nguồn sai/nghĩa sai; không tự tăng batch/model |
| B4 — Apply có giới hạn | Seed candidate đạt gate vào DB local cùng snapshot, từng lô nhỏ | Manifest trước/sau từng lô, kiểm chứng serving, count/rank/idempotency/rollback |
| B5 — Mở rộng | N5 → N4 → N3 → N2 → N1, primary trước rồi các nghĩa khác đủ ngữ cảnh | Coverage thực theo từng đợt; full/VPS là bước vận hành được chỉ định riêng |

Đề nghị duyệt triển khai **B0–B2 trước**. B3 chỉ chạy khi có cấu hình/key trong máy, model và chính sách sử dụng phù hợp, budget đã chốt; B4/B5 dùng kết quả pilot được review. Việc lập kế hoạch này không cấp quyền chạy batch LLM, seed VPS hoặc tự mua/nạp tiền.

## 4. Harvest: nguồn và quy tắc gắn nghĩa

### 4.1 Wiktionary

Ưu tiên theo độ chắc chắn:

**Kỳ vọng theo dữ liệu hiện tại:** assertions chỉ EN→JA/EN→VI, source sense là EN; không có JA→VI trực tiếp. Rule 1 có thể tạo candidate cho sense EN, không tính vào coverage JA. Rule 2 hiện không có accepted/target sense để tái sử dụng. Rule 3 chỉ là lexical khi chưa có mapping đủ chắc. Vì vậy `eligible_source` cho JA dự kiến rất ít hoặc bằng 0; B0 phải đo, không giả định. Pipeline chính lấy sense JA hiện hữu và EN `sense_gloss` gắn trực tiếp vào sense đó → `needs_translation`; không tự tạo mapping EN↔JA. DB4 mở rộng alignment ở bước sau.

1. Translation assertion trực tiếp có `scope='sense'`, `source_sense_id` rõ và target VI: candidate gloss cho **chính source sense đó**, sau khi kiểm tra ngôn ngữ/nguồn/definition. `source_sense_id` của entry EN không được dùng như sense JA.
2. Tái sử dụng `translation_target_candidate` đã accepted với target sense cụ thể hoặc mapping nguồn hiện hữu đủ bằng chứng; kiểm tra lại sense thuộc đúng lexeme, ngôn ngữ và source snapshot. Không tự promote pending candidate.
3. Pivot JA–VI qua cùng `source_lexeme_id` EN và cùng `sense_hint` không rỗng: giữ ID của cả hai assertion, nguồn, hint, forms/reading/POS. Nếu đã có một đường gắn nghĩa cụ thể đáng tin cậy thì xuất candidate eligible; nếu chỉ khớp text/lemma thì xuất candidate lexical/ambiguous để DB4/người review giải quyết.

Trùng lemma, đồng âm, khác POS hoặc nhiều sense phù hợp → không tự lấy primary sense hay match đầu tiên. Chuẩn hoá Unicode NFC, whitespace; giữ text gốc/evidence, không bỏ dấu VI hoặc tự đổi kana/kanji để mở rộng match.

### 4.2 OMW/WordNet

- `staging.omw_wikt_vi.lemma` là nhãn tiếng Việt. Đối chiếu `pwn30_offset` với `staging.ili_map_pwn30`/`core.wordnet_synset` và concept hiện có theo đúng lexicon/version.
- Xuất label candidate; chỉ seed `concept_label(label_kind='lemma')` khi concept mapping là xác định và source/license đã được kiểm tra. Không chép lemma vào `concept_gloss` hay cache `concept.gloss_vi`.
- Definition VI chỉ được lấy từ nguồn có definition thực gắn đúng synset/concept; nếu không có, đưa vào hàng đợi dịch definition EN đã chọn.
- Không tạo ILI/concept mới, không sửa sense_concept hoặc tự đặt verified=true.

### 4.3 Audit nguồn và attribution

- **DeepSeek phụ trách B0**: đối chiếu nguồn raw đã import, manifest/hash, release hoặc commit/date của dump, license của đúng file và attribution; xuất `source-audit.json`. **GPT/người tích hợp** kiểm tra lineage và bàn giao yêu cầu hiển thị cho FE/M14. Không tự sửa source cũ trong scope DB3-B.
- Source #9: concept gloss VI cũ có dấu hiệu là lemma OMW. Chỉ audit/export, không dùng làm definition hay âm thầm xoá/overwrite. Header [file OMW VI upstream](https://raw.githubusercontent.com/omwn/omw-data/main/wns/wikt/wn-wikt-vie.tab) ghi `CC BY-SA` nhưng chưa xác định version license/snapshot đã import; candidate dùng nguồn này giữ `blocked_source` đến khi đủ chứng cứ. M14 xử lý gloss cũ theo báo cáo curator riêng.
- Tập pilot dùng EN gloss **JMdict #1**, không gắn nhãn “dịch từ Wiktionary” mặc định. [License EDRDG hiện hành](https://www.edrdg.org/edrdg/licence.html) xác nhận JA/EN JMdict dùng CC BY-SA 4.0 và yêu cầu ghi nhận nguồn, liên kết tài liệu/license; B0 vẫn xác nhận file/hash đã import. Nguồn #8 chỉ được dùng khi audit version/license/lineage của nó đạt.
- Gloss dẫn xuất giữ attribution gốc và ghi việc dịch/chỉnh sửa. Credits/Sources trong app phải có tên nguồn/chủ sở hữu, snapshot/version, URL gốc, license/link và thông báo dịch máy; với phần dẫn xuất CC BY-SA, ghi license tương ứng cho dữ liệu dẫn xuất. Provider/model thuộc provenance, không thay attribution tác giả nguồn.
- Mẫu credits cho pilot: “Gloss tiếng Việt được dịch máy từ phần JA/EN của JMdict — EDRDG/Jim Breen; CC BY-SA 4.0; snapshot <ngày/hash>”, kèm link nguồn/license. FE/người tích hợp bàn giao credits trước khi công bố; M14 quản lý màn hình curation/review. Nguồn chưa đủ chứng cứ bị chặn trước khi gửi LLM và trước apply.

### 4.4 Wikidata và ví dụ

- Wikidata là nguồn phụ: snapshot có entity ID và mapping concept bằng khóa đã tồn tại, không suy từ label giống nhau. Nếu chưa có mapping chắc, chỉ xuất artifact; không dùng tên riêng như definition.
- Tatoeba: dedupe cặp theo sentence ID, kiểm tra lang JA/VI, lưu ID/text/batch/source/license. Candidate liên quan từ vựng không đồng nghĩa câu đúng sense.
- Không có LLM sinh ví dụ trong pilot này. Cấu trúc seed ví dụ và matching sense sẽ có đề xuất riêng sau khi kiểm chứng candidate.

### 4.5 Phân lớp đầu ra

`eligible_source` = nguồn trực tiếp/đường mapping đã có đủ bằng chứng; `needs_translation` = target thiếu VI nhưng có definition/ngữ cảnh đủ; `ambiguous` = chưa gắn chắc vào nghĩa; `missing_context` = thiếu dữ liệu; `blocked_source` = license/version/lineage chưa đủ. Chỉ hai lớp đầu được đi tiếp theo gate tương ứng. Điểm heuristic không tự chuyển ambiguity thành đủ bằng chứng.

## 5. Dịch phần thiếu bằng OpenCode

### 5.1 Provider và model

Theo quyết định mới nhất trong DB3-A, provider dữ liệu ưu tiên **OpenCode Go**. Tài liệu cũ ở main còn ghi Zen; khi tích hợp cần cập nhật lại bằng quyết định hiện hành, không đổi provider chat.

Theo [tài liệu Go chính thức](https://opencode.ai/docs/go/) đã kiểm tra 05/10, Go dùng API `/zen/go/v1`, có catalog `/models`; `space-bunny-free` hỗ trợ chat completions. Client cần User-Agent riêng và session ID ổn định. Model free được ghi là miễn phí có thời hạn; Go không đồng nghĩa mọi model đều miễn phí. Tài liệu cũng định hướng Go cho traffic coding agent, nên cần xác nhận job dịch dữ liệu dùng được trước pilot, không giả danh client khác để vượt hạn chế.

Muse Spark 1.3 Contributor **không hỗ trợ `/chat/completions`** (HTTP 400 `ModelProtocolUnsupported`) mà dùng **Responses API** `POST /zen/go/v1/responses` ([bảng endpoint docs Go](https://opencode.ai/docs/go/)); `reasoning.effort` nhận từ `minimal` trở lên (`none` bị từ chối) và `max_output_tokens` phải đủ lớn vì token suy luận tính vào output (để 64 → `status: incomplete`, output rỗng). Contract dưới **đã chạy thật 05/10** (không lưu auth/key): mini-bench 8 ca EN gloss → VI qua Go đạt **8/8 JSON đúng, 8/8 echo đúng `target_id`**, ~4,0s/ca ở mức `minimal` (~275 token/ca); `space-bunny-free` cũng 8/8 (5,8s/ca, miễn phí) là dự phòng; `longcat-2.5-preview-free` chỉ 6/8 (JSON bị cắt) nên không dùng. B0 ghi thời điểm/model/status + input/output hash (đã redact) từ artifact; khi B3 bắt đầu chỉ cần kiểm tra model còn khả dụng với key mới, smoke request tính vào cap.

Contract request Go (đã kiểm chứng, không kèm key):

```http
POST https://opencode.ai/zen/go/v1/responses
Authorization: Bearer <DB3_AI_API_KEY từ môi trường>
Content-Type: application/json
User-Agent: LangooDB3/1.0
x-opencode-session: <UUID ổn định từ checkpoint>

{"model":"muse-spark-1.3-contributor","reasoning":{"effort":"minimal"},"max_output_tokens":1200,"instructions":"<prompt §5.2>","input":"Target: sense JA mẫu, id=fixture-cat, lemma=猫, reading=ねこ, POS=noun, EN gloss=cat. Dịch đúng nghĩa sang VI. Chỉ trả object JSON: target_type=sense, target_id=fixture-cat, gloss_vi (text|null), reason (text|null)."}
```

Kết quả nằm ở `output[].content[].text` (Responses API), khác `choices[].message.content` của chat completions. Body mẫu chỉ minh hoạ format; B2 dùng prompt/schema §5.2 với ID/context thật, không dùng fixture ID này cho pilot. Pilot dùng **một model `muse-spark-1.3-contributor` / 100 sense JA** để gate 98/100 có một mẫu thống nhất; `space-bunny-free` chỉ thay thế khi muse hỏng/hết quota và phải ghi rõ trong báo cáo pilot.

**Chủ dự án/ops thu hồi key Zen cũ từng lộ trong Console và cấp key mới trước B3**, cập nhật secret CLI riêng trên máy chạy, quyền 0600 nếu lưu file. Không chỉ thay biến env mà giữ key cũ còn hiệu lực. Agent không có quyền quản lý Console trong phiên này và không thể tự xác nhận đã xoay; log chỉ ghi kết quả/định danh không nhạy cảm, không gửi key vào chat.

Đề xuất cấu hình **riêng cho CLI**, không sửa `.env` chung trong phiên triển khai:

```dotenv
DB3_AI_BASE_URL=https://opencode.ai/zen/go/v1
DB3_AI_PROTOCOL=responses            # muse không hỗ trợ chat/completions
DB3_AI_MODEL=muse-spark-1.3-contributor
DB3_AI_REASONING_EFFORT=minimal      # mức thấp nhất được nhận; "none" bị từ chối
DB3_AI_MAX_OUTPUT_TOKENS=1200        # reasoning tokens tính vào output
DB3_AI_API_KEY=<đặt ở môi trường máy, không đưa vào Git/chat>
DB3_AI_TIMEOUT_MS=60000
DB3_AI_CONCURRENCY=1
DB3_AI_MAX_REQUESTS=100              # cap cứng pilot, gồm retry/smoke
DB3_AI_MAX_COST_USD=0.05             # trần nội bộ (~100 ca × $0,00005); không nạp thêm tiền
```

Các giá trị này là đề xuất cho pilot. Base URL/model/protocol phải khớp catalog; header `x-opencode-session` là UUID conversation được ghi checkpoint để retry/resume dùng lại. Dùng `User-Agent: LangooDB3/<version>`; không ghi key/header auth vào log/artifact. Chỉ gửi dữ liệu từ điển/nguồn đã audit, không gửi dữ liệu người học. **Muse Contributor là tier đổi quyền train lấy giá rẻ: prompt/completion được dùng để train model Meta và không ZDR** — chủ dự án đã chấp nhận cho tập dữ liệu nguồn công khai này; nếu chính sách thay đổi, chuyển sang `space-bunny-free` (no-train, 0-day retention).

### 5.2 Input/output

- Một target/sense JA cụ thể mỗi request. Context ưu tiên **toàn bộ EN `core.sense_gloss` của chính sense đó**, sắp theo rank/ID, giữ từng dòng; không ghép gloss của các sense khác cùng lemma. Tập ưu tiên có 0 definition, nhưng EN gloss phủ 100%, nên không loại target chỉ vì thiếu `sense.definition`.
- Bổ sung lemma/forms, reading, POS, register/domain và ví dụ có nguồn nếu có; không invent trường thiếu. Definition chỉ bổ sung khi có text và **ngôn ngữ thực** (`definition_language_id`), không suy từ ngôn ngữ lexeme. Sense không có EN gloss/definition dùng được → missing_context.
- Provenance context: `context_kind='sense_gloss_en'`, `context_language='en'`, ordered `gloss_id/rank/text/hash/source_id/batch_id`, snapshot/version/license từng nguồn, target JA sense ID + semantic key. Khi dùng definition, ghi `context_kind='sense_definition'`, language/source row thực; khi kết hợp ghi từng thành phần. Đổi thành phần/thứ tự context làm input hash đổi.
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

Pilot: chọn **100 sense JA riêng biệt**, EN gloss đủ và nguồn đã audit; ưu tiên N5/N4, ít nhất 10 ca đa nghĩa/đồng âm/POS dễ nhầm. Không lấy 20 concept trong pilot vì tập ưu tiên chưa có sense_concept. Cap 100 lần gọi bao gồm retry/smoke/attempt không rõ: nếu chưa đủ 100 output hợp lệ thì báo pilot chưa hoàn tất, không tự tăng cap hoặc tính ít mẫu thành gate 98/100. Bổ sung budget chỉ sau quyết định vận hành riêng.

### 5.4 Reviewer và rubric

- **Quyết định chủ dự án 06/10/2026: chấp nhận GPT làm reviewer ngữ nghĩa cho pilot, không bắt buộc reviewer con người.** GPT đọc đủ 100 mẫu, đối chiếu đúng sense JA/EN, ngữ dụng và nguồn từ điển khi cần; artifact ghi reviewer là AI, không giả danh người biết JA–VI. Schema v1 đã có reviewer string nên giữ nguyên shape. Quyết định này thay yêu cầu human review cũ, không đổi gate ≥98 pass/0 severe hoặc quyền gọi thêm API/apply VPS. DeepSeek xuất sheet/JSONL gồm JA forms/reading/POS, EN gloss/source, output VI và cảnh báo.
- Mỗi mẫu chấm pass/fail theo: (1) đúng sense JA và nghĩa EN; (2) đủ phần nghĩa chính, không mở rộng sang sense khác; (3) đúng POS/sắc thái/register/domain; (4) tiếng Việt tự nhiên, ngắn, không bịa chi tiết; (5) target/source/context đúng lineage. Ghi reviewer, thời điểm, verdict, severity và lý do; giữ output gốc nếu người duyệt đề xuất sửa.
- Lỗi nghiêm trọng: đảo nghĩa/phủ định, sai sense/target, bịa nội dung làm sai cách dùng hoặc bỏ nghĩa chính làm người học hiểu sai. **Duyệt đủ 100 mẫu, ≥98 pass và 0 lỗi nghiêm trọng** mới qua gate. Mẫu fail không được apply; gate pass không biến mọi output thành reviewed.
- Review pilot lưu artifact; output máy vẫn machine/unreviewed. Chỉ quy trình curator riêng mới ghi reviewed fields khi review từng dòng đã áp. Không dùng confidence của model hoặc check tự động làm chứng nhận chất lượng.

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
- `quality` NULL khi chưa có thước đo hiệu chuẩn; mọi candidate giữ evidence và review result trong artifact. Chưa rõ license/version/lineage → blocked_source, không gửi provider hoặc apply.
- Không ghi `concept.gloss_vi`, `concept.status`, `sense_concept`, `translation_target_candidate.decision` hoặc deck.concept_id. Cache/canonical promotion thuộc bước curation/mapping được duyệt riêng.
- **Chốt hiển thị (a)**: giữ `serve.sense_card` chọn reviewed trước, rồi non-machine, rồi rank; API đã trả gloss_vi_machine/gloss_vi_reviewed. FE hiển thị **Máy dịch · chưa duyệt** khi machine=true và reviewed=false; gloss machine đã review vẫn có nguồn gốc máy và trạng thái đã duyệt riêng. API flags không chứng minh FE đã render badge: người tích hợp/FE phải xác nhận trước rollout VPS; thiếu badge thì giữ pilot local/artifact. Không cần đợi toàn bộ M14 mới kiểm tra badge/credits; M14 phụ trách thao tác curation. Concept gloss mới không được tuyên bố tự xuất hiện ở API dùng cache cũ.

Provenance mỗi candidate: original source IDs/version/license/URL/hash, assertion/gloss/source row IDs, target semantic key/ID, cách align, context_kind/context_language và từng thành phần context, run/batch, model/prompt/input/output hash. Hai nguồn pivot cần lineage của cả hai; một source_id trong row không thay thế manifest lineage đầy đủ.

## 7. Apply, resume và rollback

- Phát triển trên DB UUID mới riêng tạo từ fixture; TEST URL phải local `_test`. Không reset DB dùng chung của DeepSeek/GPT.
- Apply và rollback đều cần `--apply --allow-db <db>`; `_test` cần `--allow-test`. Đích manifest phải khớp host/port/database và dataset fingerprint.
- Candidate từ full local không được apply bằng bigint ID sang DB demo/VPS khác lineage. Phải xác nhận snapshot cùng nguồn hoặc resolve **duy nhất bằng source identity/ILI/synset key** và xuất mapping review; không đoán theo lemma.
- Mở rộng `_mutations.ts` bằng allowlist task/bảng/scope typed cho gloss/metadata; không nhận tên bảng/SQL predicate từ artifact.
- Mỗi lô đề xuất 50 gloss, một transaction, journal prepared trước COMMIT/applied sau COMMIT. Không giữ transaction hoặc DB lock khi gọi LLM.
- Job manifest đăng ký child run key/ID/path/input hash **trước mutation**, rồi ghi trạng thái child commit theo thứ tự. Resume đối chiếu child journal và `mapping_run.run_key`/batch đã có để xử lý cửa sổ COMMIT thành công nhưng checkpoint job chưa cập nhật; không cấp rank mới cho lô đã commit. Khi một lô lỗi, các lô trước vẫn có manifest. Không báo toàn job rollback nếu các lô trước đã commit.
- Rollback child theo thứ tự ngược, kiểm tra after-state, chỉ loại dòng của lô/khôi phục dòng cũ. Dùng recovery prepared/rollback-prepared của DB3-A và thêm regression cho các bảng mới.
- Source/import_batch/mapping_run cần được giữ để audit history có thể tra lineage; rollback job đánh dấu run rolled_back và ghi count/reason. Không xoá metadata dùng bởi lô còn lại hoặc dữ liệu khác. Candidate/cache không bị xoá để có thể tái kiểm chứng.
- Path vận hành VPS chốt **`/opt/langoo/storage/db3b/`**, dưới storage hiện có và ngoài `/opt/langoo/app`; truyền `--artifact-dir`, không hardcode vào tool. Ops tạo/quản lý thư mục cho user vận hành `langoo`, quyền thư mục 0700/file 0600, đủ dung lượng; backup inventory/candidate/cache/checkpoint/review/journal và kiểm tra phục hồi trước apply. Không chỉ dựa vào backup DB để cứu journal. Phiên viết plan chưa tạo thư mục hay đổi quyền trên VPS.

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
| Người tích hợp/chủ dự án/ops | Merge nền DB3-A, gate provider/budget, chỉ định reviewer, badge/credits, key và artifact path | Bàn giao key mới an toàn + artifact directory; reviewer chốt verdict; apply đợt cụ thể theo báo cáo |

Mỗi nhánh/worktree riêng; ai sở hữu `_gloss-types.ts` và `_mutations.ts` là GPT để tránh sửa chung. DeepSeek dùng interface đã chốt, không cấp migration number hoặc sửa env/PROGRESS/package chung. Không dùng cùng DB để chạy destructive test. Sau B0/B1 mới nối queue thật vào translator; không chờ harvest toàn corpus để kiểm thử cơ chế stub.

**Thứ tự tích hợp và interface bắt buộc:**

1. Người tích hợp merge toàn bộ nền DB3-A + hậu kiểm vào nhánh đích trước, gồm `b052d2f` và journal recovery; lấy HEAD đã tích hợp làm base cho nhánh DB3-B. Trạng thái đã apply VPS khác với trạng thái merge Git; không mở nhánh B từ main còn thiếu `_mutations.ts` mới.
2. GPT chốt `_gloss-types.ts` schema **v1** và fixture JSONL hợp lệ/bị chặn, commit interface trước khi DeepSeek B1 và GPT B2 code song song. B0 SELECT/audit có thể làm trong lúc chờ; DeepSeek không tự tạo schema candidate khác.
3. Contract tối thiểu: schemaVersion; candidate key/class/blocked reason; target type/ID bigint-string/semantic key/JLPT; source lineage; context_kind/language + ordered context rows; input hash. Job có dataset fingerprint, provider/model/prompt version, session UUID, caps/attempt count, states và child run key/path/hash. GPT định nghĩa discriminated union/nullability, runtime validator và tương thích version; không đưa API key vào artifact.
4. DeepSeek bàn giao B0/B1 theo contract; GPT kiểm tra fixture và nối translator/apply. Đổi contract cần commit version/fixture và thông báo bên còn lại trước khi đổi reader/writer; merge phần harvest/tooling sau interface, chạy regression chung trước B3.

## 10. Kiểm thử và nghiệm thu

- [ ] Inventory có queries/fingerprint và phân biệt full/demo/VPS; số đã phủ tính trên sense/concept thực, không trên cặp text.
- [ ] Count từng rule/từng lớp; 15.245 JA sense được đối chiếu EN gloss/source trực tiếp, thiếu definition không làm queue rỗng; pending EN assertions không bị tính thành coverage JA.
- [ ] Interface v1/fixture đã commit trước B1/B2 song song; snapshot target/context cố định; key cũ đã thu hồi trước B3.
- [ ] Pivot đa nghĩa/đồng âm/khác POS không bị gắn vào primary mặc định; OMW lemma không vào concept_gloss.
- [ ] Harvest ổn định theo snapshot, dedupe và evidence đủ cho từng candidate; nguồn thiếu metadata bị giữ lại.
- [ ] Dry-run không ghi DB hoặc gọi LLM; generate cần chế độ explicit, apply không tự generate.
- [ ] Translator mock: JSON lỗi/ID sai/empty/null/too long, 401/403/429/5xx/timeout, quota cap, Retry-After, checkpoint corruption và resume giữa request đều được kiểm tra.
- [ ] Cache đổi khi input/model/prompt đổi; repeated completed target không gọi lại provider.
- [ ] DB: apply hai lần không tạo duplicate; rank conflict/concurrent apply được giải quyết trong lock/transaction; reviewed data giữ nguyên.
- [ ] Rollback lần hai giữ dữ liệu lần đầu; after-state đổi/đích sai/legacy/dry-run bị từ chối; bigint và timestamp không mất precision.
- [ ] Trigger history vẫn hoạt động; rollback không xoá trace; metadata run còn để truy nguồn.
- [ ] Lỗi ghi journal trước/sau COMMIT và rollback recovery được tái hiện trên DB test riêng.
- [ ] Pilot 100 sense JA một model, đủ 100 output được GPT review ngữ nghĩa theo quyết định 06/10, ≥98 pass/0 lỗi nghiêm trọng; request cap tính retry, thiếu mẫu phải ghi chưa đạt gate. Chỉ mẫu pass được apply. [Kết quả output gốc 06/10](../reviews/db3-b-pilot-2026-10-06.md): 97 pass, 2 severe/1 minor fail, chưa đạt gate.
- [ ] `serve.sense_card` chọn reviewed/native/machine đúng thứ tự, trả cờ machine/reviewed đúng; không làm thay đổi phục vụ sense_pair/concept curated.
- [ ] FE badge và credits nguồn đúng đã xác nhận trước rollout VPS; source audit/attribution bàn giao, artifact path có backup/phục hồi ngoài release.
- [ ] Build/lint/TypeScript, parser/unit/provider mock và regression DB liên quan pass; README/report đủ cách chạy và phục hồi.
- [ ] Mỗi đợt apply có counts trước/sau, số skipped/ambiguous/missing context, số machine/native/reviewed và coverage theo cấp; mọi partial failure có child manifest.

## 11. Thứ tự thực hiện và gate vận hành

1. B0–B2 offline trước theo thứ tự/interface §9; apply thử gloss/metadata §6 trên DB fixture riêng, ví dụ chỉ artifact.
2. Pilot 100 sense JA, concurrency 1; muse tiêu quota gói Go ($0,10/$0,20 per M, hạn mức $60/tháng cho model này — 100 ca ≈ $0,005), **không nạp thêm tiền**, cap nội bộ $0,05/lần chạy; vượt cap/quota thì dừng và báo, không tự đổi sang model trả phí.
3. Dữ liệu nguồn/mapping yếu giữ artifact; seed gloss source chỉ cho target đã xác định, LLM luôn machine/unreviewed. Không promote concept/mapping ở DB3-B.
4. Mốc mở rộng: hoàn thành N5/N4 primary trước, sau đó các cấp còn lại và secondary sense đủ ngữ cảnh. Không cam kết phần trăm coverage trước B0/pilot.

Sau khi triển khai B0–B2, báo cáo artifact/schema/source audit trước khi gọi provider thật. Điều kiện còn phải hoàn thành: ops thu hồi key cũ/cấp key mới, source audit đạt, reviewer được chỉ định; trước rollout VPS có FE badge/credits và artifact backup. Phiên chốt plan này không thực hiện thay đổi DB hay hạ tầng.
