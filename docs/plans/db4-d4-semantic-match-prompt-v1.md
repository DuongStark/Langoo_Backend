# DB4-D4 — Prompt chọn candidate theo đầy đủ nghĩa của sense

> 2026-10-10: đã có [prompt semantic match v2](db4-d4-semantic-match-prompt-v2.md)
> và selector prepare. V1 giữ nguyên để đối chiếu các lượt đã chạy;
> [sample v2 30 sense](../reviews/db4-d5-muse-v2-sample30-2026-10-10.md) đã chạy, quality gate chưa đạt.

Ngày: 2026-10-08. Trạng thái: prompt pilot đã chạy 138 request và một repair pass
15 request bằng 8 worker. D1 chấp nhận 137/138 output; một output vẫn thiếu
candidate review. Semantic accuracy chưa được chứng minh; chưa apply DB,
chưa commit/push/deploy.

## 1. File sử dụng trực tiếp

| File                                                            | Nội dung                                                                   |
| --------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [System prompt](../prompts/db4-d4-semantic-match-v1.system.txt) | Toàn bộ quy tắc semantic, coverage, evidence và output DB4-D1              |
| [R1](../prompts/db4-d4-semantic-match-v1.r1.txt)                | Hướng dẫn bắt đầu từ nghĩa đầy đủ của source rồi xét từng concept          |
| [R2](../prompts/db4-d4-semantic-match-v1.r2.txt)                | Review độc lập, bắt đầu từ definition và tìm phản ví dụ trước khi xác nhận |

Prompt dùng tiếng Anh để đọc trực tiếp context JA/EN; lý do output bằng tiếng Việt
để người vận hành đọc. R1/R2 cùng tiêu chí, khác cách kiểm. R2 nhận bundle đã
shuffle theo phase, không nhận kết luận R1. Chạy hai phase cùng model vẫn không
chứng minh lỗi độc lập; prompt không thay gate DB4-D5.

Prompt v1 đã được đóng băng cùng native Muse runner cho semantic pilot DB4-D4;
đây là runner nghiên cứu, chưa phải provider production trong CLI/API. Prompt
version: `db4-d4-semantic-match-v1-r1` / `db4-d4-semantic-match-v1-r2`; mỗi lần
đổi text phải tăng version và lưu checksum để không reuse cache của prompt cũ.

## 2. Gửi cho LLM như thế nào

1. Parse và kiểm bundle bằng `parseMappingBundleIntegrity` hoặc bound parser D1
   với candidates của đúng generation. Chỉ gửi 1–5 ready candidate cùng sense.
2. Gọi `renderMappingBundle(bundle, phase, seed, promptVersion)`. Không bổ sung
   MiniLM score/rank, hypothesis, verdict legacy, gloss VI dịch máy hoặc output R1.
3. System message = nguyên văn system prompt + newline + đúng phase text.
   User message = JSON nguyên vẹn của `rendered.payload`.
4. Output là **một object `MappingOutput`**, không chọn ID bằng một câu văn.
   Parse JSON rồi gọi `parseMappingOutput(value, originalBundle)`; schema-only
   hoặc JSON mode không thay được bound validator.
5. Runner lưu raw response, validated output, phase, prompt version, hash các
   prompt text và rendered payload. Reserve input/output gồm cả prompt thật.
   Không âm thầm cắt gloss, metadata, definition hoặc evidence để vừa context.

Với Muse web không có system role riêng, ghép nguyên system text + phase text
trước JSON payload; phân định payload là dictionary data. Ghi rõ đây là transport
khác trong runner/prompt version/cache; còn phải kiểm thực tế trước chạy lớn.
Mặc định thiết kế **một sense/request**. Nếu batch nhiều sense, runner cần contract
transport riêng để bind từng output về bundle; không đưa array vào parser D1
hoặc đổi shape `MappingOutput` chỉ vì muốn batch.

Empty shortlist thuộc status DB4-D2, không gửi LLM. Input quá lớn/không đủ ready
được runner xử lý riêng; không yêu cầu LLM dựng ID/hash để sửa input.

## 3. Những quyết định semantic trong prompt

- Xét **đúng source sense**, không dùng nghĩa phổ biến nhất của lemma làm đáp án.
  Tất cả EN gloss là context bắt buộc; phân biệt synonyms với distinct usages,
  giữ điều kiện của từng usage. Gloss VI không là bằng chứng độc lập.
- Definition concept quyết định phạm vi nghĩa. Label giống nhau chỉ là gợi ý;
  “be”, “come”, “bank”, “plant” không đủ để chứng minh exact.
- Kiểm containment theo **hai chiều**. Direction luôn source → target:
  source “animal” → target “dog” là **broader**; source “older brother” → target
  “brother” là **narrower**. Hướng này theo [contract](db4-schema-v1.md#3-candidate).
- Exact cần toàn bộ meaning/điều kiện semantic, không chỉ một gloss. Concept
  chứa thêm nghĩa vẫn có thể làm source narrower dù mọi gloss được covered.
- POS/register/reading/kanji restrictions được đọc theo ngữ cảnh. Không yêu cầu
  definition tiếng Anh lặp chữ Nhật; không tự loại mọi paraphrase/cross-language
  POS difference, cũng không bỏ điều kiện làm thay đổi meaning để lấy exact.
  Nếu tác động semantic của honorific/register chưa xác định được, giữ uncertain.
- `related` cần một association/overlap cụ thể; cùng keyword hay chung chủ đề
  rất rộng không đủ. Mismatch rõ là none; thiếu chứng cứ quyết định là uncertain.
- Nhiều candidate thực sự exact phải báo ambiguity. Không bẻ tie theo thứ tự,
  source priority hay IDs. Hai candidate chỉ giống nhau về label chưa phải tie.

Không viết “hãy chọn candidate gần đúng nhất”: shortlist có thể thiếu concept
đúng. Prompt hỗ trợ no match và quan hệ nonexact; v1 chưa promote nonexact.

## 4. Coverage và JSON đúng DB4-D1

`sourceBranches` là **row.key của mọi gloss/definition**, không phải nhánh nghĩa
do LLM tự tạo. Mỗi review partition đầy đủ danh sách này thành covered/missing;
các synonyms có thể đều covered bởi một concept. Một row chỉ khớp một phần
hoặc chưa xác định coverage thì nằm ở missing; reason giải thích phần khớp.

Conflict dùng **evidence.key**, thường lấy từ `row.evidenceKey`; khác với
branch `row.key`. Ref phải tồn tại, đúng owner và đúng candidate. Metadata có
evidence riêng nhưng không thuộc danh sách sourceBranches. Không invent ref để
nhét một constraint vào coverage. Exact bắt missing/conflicts rỗng.

Output chỉ có những field sau, theo [parser](../../scripts/db4/_mapping-types.ts):

```json
{
  "schemaVersion": 1,
  "task": "sense_concept_review",
  "bundleKey": "COPY_EXACT_BUNDLE_KEY",
  "senseId": "COPY_EXACT_SENSE_ID_STRING",
  "contextHash": "COPY_BUNDLE_CONTEXT_HASH",
  "reviews": [
    {
      "candidateKey": "COPY_EXACT_CANDIDATE_KEY",
      "conceptId": "COPY_EXACT_CONCEPT_ID_STRING",
      "relation": "uncertain",
      "coveredBranches": [],
      "missingBranches": ["COPY_EACH_ACTUAL_SOURCE_BRANCH_KEY"],
      "conflicts": [],
      "reason": "Giải thích ngắn về điểm chưa đủ chứng cứ.",
      "confidence": null
    }
  ],
  "noSuitableCandidate": false,
  "unresolvedReason": {
    "code": "missing_context",
    "detail": "Nêu cụ thể thông tin semantic còn thiếu."
  }
}
```

Đây là **shape minh họa**, các chuỗi `COPY_*` phải được thay bằng giá trị thật;
không phải output có thể import. LLM không tự hash. Echo `bundle.contextHash`,
không echo `renderedContextHash`. Review đủ mọi candidate, ID giữ dạng string.
`confidence=null` vì chưa có calibration; không yêu cầu điểm “99% đúng”.

`noSuitableCandidate=true` **chỉ khi tất cả relation=none**. Không có exact mà
có broader/narrower/related/uncertain thì field này vẫn false. Khi all none,
unresolvedReason dùng `no_suitable_concept`; khi uncertain hoặc nhiều exact,
reason bắt buộc theo contract. LLM không thể kết luận toàn DB thiếu concept chỉ
từ tối đa 5 candidate. Không dùng `retrieval_miss` như một sự thật nếu chưa biết
concept đúng nằm ngoài shortlist.

## 5. Các tình huống prompt cần xử lý

Đây là các tình huống về scope, chưa phải gold set hay kết quả model đã chạy:

| Source và target                                                                           | Kết luận cần tránh / cách xét                                                                  |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| “genitals / private parts / nether regions” → “external sex organ”                         | Không tự coi 3 synonym gloss là 3 nghĩa khác nhau; xét scope/metadata để quyết định exact      |
| “that far / that much / that point” → “distance estimated in terms of audibility of a cry” | Keyword “far” không xác nhận exact; định nghĩa riêng “far cry” không phủ đầy đủ source         |
| 居らっしゃる sense “to come / to go / to be (somewhere)” → “be received”                   | Một “come” label không phủ cả source; đọc metadata và từng usage, không chọn vì top 1          |
| Auxiliary sense “to be (doing)” → “be identical to; be someone or something”               | Phân biệt auxiliary/aspect với identity/copula; gloss “be” giống nhau không chứng minh mapping |
| Source rõ “animal” → concept rõ “dog”                                                      | broader, không đảo thành narrower; target chỉ là một phần phạm vi source                       |
| Source rõ “older brother” → concept “brother” gồm mọi độ tuổi                              | narrower dù source branches đều có thể covered                                                 |
| Source “film director OR supervisor” thực sự hỗ trợ hai use → concept chỉ “film director”  | Chỉ exact nếu toàn source thực sự tương đương; union rõ rộng hơn một use là broader            |
| Source “plant” nghĩa factory → concept living organism                                     | Same label nhưng mismatch rõ: none; không related chỉ vì cùng keyword                          |
| Source “car” → concept “automobile” cùng scope                                             | Paraphrase rõ có thể exact; không uncertain chỉ vì khác spelling                               |
| Hai target definition thật sự tương đương với cùng source                                  | Giữ các exact độc lập + ambiguous_concepts, không chọn theo ID                                 |
| Source/context có contradiction quyết định scope                                           | uncertain + lý do cụ thể; không tự sửa gloss để hợp target                                     |

Các mẫu live D2 và hạn chế retrieval ở
[report D2](../reviews/db4-d2-source-minilm-retrieval-2026-10-08.md).
Fixture D1 chỉ chứng minh contract, không dùng các verdict synthetic làm semantic
ground truth; ví dụ director fixture không là chứng cứ coverage thật của prompt.

## 6. Kiểm tra và gate còn thiếu

- Validator D1 kiểm output field, enum, relation direction, coverage/ref ownership,
  hash echo, candidate count/order và ambiguity. Không đổi schema D1.
- Pilot Muse và một repair pass đã chạy trên VPS. Final D1 ledger chấp nhận
  137/138; một output còn thiếu candidate review sau cùng một bounded repair.
  Kết quả đã được merge/validate; không apply mapping nếu chưa qua quality gate.
- Còn gate: independent semantic review, top-5 retrieval recall và kiểm trên
  positive exact/near miss/synonyms/compound/missing candidate/POS/restrictions.
  Hai phase cùng model chỉ cho consistency signal, không chứng minh accuracy.
- Nếu true concept nằm ngoài top 5, sửa retrieval D2; prompt không thể lấy lại
  một definition không được gửi. JSON valid không chứng minh verdict đúng.

### 6.1 Yêu cầu vận hành tự động — chốt ngày 10/10/2026

Chủ dự án yêu cầu **không có bước người vận hành duyệt từng mapping** và không
phụ thuộc việc có thêm một provider/model. R1/R2 Muse cung cấp đánh giá semantic;
D3 quyết định bằng code theo policy version. Không bắt người dùng biết tiếng Nhật
để vận hành. Audit bằng AI lưu `reviewerKind=llm`; kiểm quy tắc lưu `rule`;
không ghi `human`, `verified=true` hoặc curator cho quyết định máy.

Luồng dự kiến tự động: retrieval → Muse R1/R2 → D1 validation → D3 decision →
preflight D6 → apply/journal → refresh/check serving D7. Các gate phần mềm/nguồn
vẫn cần triển khai; yêu cầu tự động hóa không làm chúng thành đã hoàn thành.

- `accept_exact`: hai output đầy đủ, đúng input/hash; cùng một candidate là
  exact duy nhất; cả hai không unresolved; exact phủ đủ branch và không conflict.
  Trước promote còn rebind DB/source, giữ existing verified/curator link và kiểm
  điều kiện serving. Không dùng lời giải thích giống nhau làm điều kiện consensus.
- Các nhãn broader/narrower/related không promote như tương đương trong v1.
- Bất đồng/ambiguity/thiếu context chuyển `defer`; thiếu hoặc hỏng output chuyển
  unresolved. Runner xử lý lại theo cap và generation/prompt version mới khi có
  input thay đổi; không retry vô hạn và không ép chọn top 1.
- Hai lượt đều all-none chỉ xác nhận **shortlist hiện tại** không có match; có thể
  đưa sang retrieval mở rộng có giới hạn. Không kết luận toàn corpus thiếu concept.
- Hết cap thì giữ unresolved tự động, báo coverage và dùng gloss từ điển hiện hữu.
  Đây không phải hàng đợi bắt buộc người duyệt; không tự tạo concept hoặc sửa sense.

Kiểm lại 69 bundle của pilot final: **20** có cùng exact duy nhất và không
unresolved ở cả hai phase; **4** cùng all-none; **44** còn lại chưa đáp ứng rule
accept trên; **1** thiếu một phase hợp lệ. Đây là phân loại theo điều kiện tối
thiểu D1, **không phải 20 mapping đã chứng minh đúng hoặc đã apply**. 31 sense
no-candidate ở retrieval nằm ngoài mẫu 69 bundle này.

Metric full-output agreement 0/68 hash cả mảng review theo thứ tự phase, reason,
conflict detail và unresolved detail. Thứ tự được shuffle và lời văn có thể khác;
metric này không đo candidate selection và không được dùng làm gate tự duyệt.
Candidate-level relation/exactness/coverage mới là các tín hiệu consistency phù hợp.
Hai lượt cùng Muse vẫn có thể cùng sai; accuracy chưa có số đo đáng tin cậy.
Kiểm đối chiếu nguồn tham chiếu đã xác minh và audit tự động là hướng đánh giá
chất lượng; khi thiếu reference, báo rõ uncalibrated, không đổi consistency thành
accuracy hoặc tuyên bố kiểm code đã chứng minh semantic correctness.

### 2026-10-10 — DB4-D4 — Chốt quyết định mapping tự động không cần người duyệt

- Thay đổi/lý do: ghi yêu cầu vận hành tự động, rule accept/defer/retrieval mở
  rộng hữu hạn; sửa cách diễn giải full-output agreement để không gây hiểu nhầm.
- File/phạm vi: plan này, plan DB4 tổng, report pilot và `PROGRESS.md`.
- Kiểm tra/kết quả: đọc parser D1/metric validator; aggregate R1/R2 final local
  cho 20/4/44/1 trên 69 bundle. 143 link nội bộ của bốn tài liệu tồn tại;
  `git diff --check` và whitespace của tài liệu chưa track pass.
- Gate còn thiếu: D3 decision engine, D5 chất lượng, D6 apply/journal và D7 serving;
  chưa coi pilot đủ accuracy hoặc production auto-apply đã sẵn sàng.
- Git/triển khai: tài liệu local chưa commit/push; lượt này không đổi code,
  gọi Muse, apply DB hoặc deploy VPS.

### Consumer DB4-D3 — cập nhật 10/10/2026

[Decision engine/CLI](db4-d3-auto-decisions.md) đã có code local, đọc frozen
generation + final D4 validation. Kết quả 20 exact proposals/44 deferred/4 all-none/
1 incomplete trên 69 bundle, giữ riêng 31 no-candidate D2.
[Report D3](../reviews/db4-d3-auto-decisions-2026-10-10.md) là trạng thái mới nhất
cho decision stage. D4 output/prompt/schema không sửa; D5/D6/D7 còn thiếu.

### 2026-10-08 — DB4-D4 — Prompt chọn candidate theo đầy đủ nghĩa của sense

- Thay đổi/lý do: tạo system + phase R1/R2 để tránh chọn theo label/top 1 và bỏ
  gloss; giữ đúng contract, cho abstention/nonexact và giải thích tiếng Việt.
- File/phạm vi: ba `docs/prompts/db4-d4-semantic-match-v1.*.txt`, tài liệu này,
  `PROGRESS.md` và link consumer trong handoff D2/D1.
- Kiểm tra/kết quả ban đầu: đối chiếu schema/parser và các tình huống scope; JSON
  template, file links, whitespace và `git diff --check` pass.
- Gate: chờ pilot Muse và hai lượt R1/R2; semantic accuracy, recall của top-5 và
  independent review chưa được chứng minh.
- Git/triển khai: lưu local chưa commit/push/deploy; không apply DB.

### 2026-10-08 — DB4-D4 — Gọi Muse 8 luồng và khắc phục transport/polling

- Đóng băng 138 request (69 bundle × R1/R2; 345 candidate review mỗi phase).
  Muse chạy qua native gateway/session VPS, không qua API key; không có token
  telemetry để báo mức dùng chính xác.
- Lần đầu 15 request bị `NoiseInvalidMessage` trước khi websocket gửi: Noise
  giới hạn message 65.535 byte, còn body request tới khoảng 149 KB. Read-only
  history của 15 side-chat đều rỗng; chưa phát sinh generation. Thêm chia envelope
  thành chunk 48 KiB. Transport-only `chat.history` lớn nhận HTTP 400 của endpoint,
  xác nhận frame đã tới tầng ứng dụng mà không gọi generation.
- Run kế tiếp gửi 15 request, nhưng runner nhầm HTTP 200 ACK của `chat.stream` là
  model đã xong. Lịch sử ban đầu chỉ có JSON prefix. Sau khi chờ, thu hồi đủ 15
  output; validator D1 xác nhận 15 hợp lệ. Đây là hai lượt cùng Muse model, không
  phải hai giám khảo độc lập.
- Sửa runner để đợi assistant output bind đủ request thay vì kết thúc theo HTTP
  ACK, giữ một native connection cho mỗi worker và chunk request lớn. Run3 gửi
  đủ 123 request chưa gửi, 8 worker, hoàn tất sau 22:06. D1 chấp nhận 123/138
  output; còn 13 message đã completed nhưng thiếu một candidate review, 2 output
  complete khác thiếu `missingBranches` hoặc sai thứ tự.
- Run4 là một repair pass có giới hạn 15 request. Phase prompt giữ nguyên semantic
  rules và bổ sung bước đếm đúng số candidate/đủ field; version repair1 và
  `renderedContextHash` mới được đóng băng. 14/15 output qua D1; output còn lại
  thiếu cùng candidate thứ năm như lần đầu, nên giữ unresolved và không repair lần hai.
- Final ledger: D1 chấp nhận 137/138; 69 bundle có ít nhất một phase và 68 có cả
  R1/R2. Full-output agreement 0/68; candidate-level relation agreement 266/340,
  exactness agreement 331/340, coverage agreement 314/340. Cả hai phase dùng cùng
  model; đây không phải semantic accuracy.
- Files: `scripts/db4/muse-review-runner.py`,
  `scripts/db4/muse-review-prepare-repairs.ts`,
  `scripts/db4/muse-review-validate.ts`, response artifacts riêng trên VPS và
  `uploads/db4-d2-pilot/muse-d4-v1/responses-final.jsonl` local-ignore.
  [Report pilot](../reviews/db4-d4-muse-pilot-2026-10-08.md).
- Kiểm tra: `py_compile`, `tsc -p tsconfig.db4.json`, scoped ESLint và
  `git diff --check` pass. Read-only chunk transport pass tới application response;
  D1 pass 15 output thu hồi ban đầu, 123/138 ledger chính, 14/15 repair và
  137/138 final ledger. Một output còn incomplete; chưa kết luận semantic accuracy.
- Git/triển khai: thay đổi local chưa commit/push; không deploy app hoặc apply DB.
