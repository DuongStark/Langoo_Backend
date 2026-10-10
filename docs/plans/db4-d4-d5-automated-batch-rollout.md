# DB4-D4/D5 — Mapping tự động theo batch có checkpoint

Ngày: **2026-10-10**. Trạng thái: **DB4-D2 cohort 1.000 đã freeze trên VPS,
source-audit/RRF và DB4-D4/D5 runner nền đã chạy local; 82/82 DB4 TypeScript
tests, 12 fake-transport tests và 2 coordinator tests pass**. Read-only preflight
trên artifact thật xác nhận 1.000 target / 966 ready / 34 no-candidate / 1.932
request; Muse chưa được gọi bởi runner mới, chưa cài service VPS, chưa apply DB.
Expansion, format-repair dispatch và Pilot A/B audit coordinator còn thiếu.
Phạm vi: sense JA → concept đã xác minh;
Muse là model duy nhất cho review tự động, MiniLM chạy local cho retrieval.

## 1. Chốt hướng triển khai

Triển khai một pipeline có giới hạn rõ ràng, chạy nền trên VPS:

1. Đóng băng cohort, nguồn và context.
2. Retrieval kết hợp nhãn từ vựng + MiniLM, shortlist tối đa 5 concept.
3. Muse R1 cho mỗi bundle đủ điều kiện.
4. Muse R2 chỉ khi R1 có một exact duy nhất, đủ phạm vi và không unresolved.
5. Hai phase cùng chọn một exact → proposal; trường hợp khác tự để unresolved.
6. Nếu có bằng chứng shortlist thiếu concept, cho mở rộng retrieval đúng một lần.
7. Audit chất lượng tự động, lưu provenance và báo rõ gate.
8. DB4-D6/D7 chỉ ghi DB/phục vụ mapping khi gate tương ứng đạt.

Đợt đầu: **1.000 sense, 10 shard × 100 sense, tối đa 8 request Muse đang chạy**
trên toàn account. Có checkpoint bền vững; tắt máy cá nhân không ảnh hưởng.

Không yêu cầu chủ dự án đọc tiếng Nhật hoặc duyệt từng dòng. Mapping không chắc
tự dừng ở artifact unresolved. Mục tiêu là vận hành tự động và chỉ nhận mapping
có đủ bằng chứng; số sense chưa map là một kết quả hợp lệ của pipeline.

**Không mở vòng sửa prompt vô hạn.** Chốt một bản prompt mới, chạy đợt đại diện,
đo lỗi theo nguyên nhân rồi quyết định tiếp. Không lấy việc hai lượt Muse đồng ý
làm bằng chứng duy nhất rằng liên kết đúng.

## 2. Tài liệu và thành phần kế thừa

- [Plan DB4 tổng thể](db4-sense-concept-mapping.md).
- [Contract DB4-D1](db4-schema-v1.md).
- [DB4-D2 nguồn và MiniLM](db4-d2-source-minilm-retrieval.md).
- [DB4-D3 quyết định tự động](db4-d3-auto-decisions.md).
- [DB4-D4 prompt v2](db4-d4-semantic-match-prompt-v2.md).
- [DB4-D5 audit proposal](db4-d5-proposal-audit.md).
- [Report v2 sample30](../reviews/db4-d5-muse-v2-sample30-2026-10-10.md).
- [Handoff retrieval](../handoff/db4-d2-source-minilm-retrieval-2026-10-08.md).

Plan này mở rộng orchestration; không thay kết quả của các run đã đóng băng.
Nếu khác lịch thử ở plan prompt v2, ưu tiên lịch triển khai trong tài liệu này:
regression offline trước, sau đó cohort đại diện; không bắt buộc chạy lại toàn
69 bundle cũ bằng Muse trước khi được chạy shadow batch.

## 3. Bằng chứng hiện có và giới hạn

| Đợt           | Kết quả có thể sử dụng                                                        | Điều chưa chứng minh               |
| ------------- | ----------------------------------------------------------------------------- | ---------------------------------- |
| DB4-D2        | 100 sense / 41 lexeme N5/N4; 69 bundle, 31 no-candidate; pool 120.875 concept | Recall semantic toàn cohort JLPT   |
| D4/D3 v1      | 137/138 output valid; 20 proposal exact                                       | Precision production               |
| D5 audit 20   | AI audit: 16 pass, 2 severe, 2 deferred                                       | Gate 100 target / holdout positive |
| Lặp cùng Muse | Một false exact vẫn lặp lại                                                   | Sự độc lập giữa hai judge          |
| V2 sample30   | 60 reply, 59 valid; 1 proposal exact; 386,71 giây / 8 worker                  | Yield và accuracy của mẫu đại diện |

Sample30 gồm 30 sense / 15 lemma, không phải 30 từ hoàn toàn ngoài pilot D2.
Các sense này đều không có exact consensus ở v1; đây là mẫu khó phục vụ phát
triển prompt, không dùng làm tỷ lệ lỗi hoặc yield cho 15k sense.

Lỗi và thiếu sót cần xử lý trong đợt này:

- `your husband` / `your organization`: sở hữu và lối xưng hô không tự động làm
  denotation khác concept husband/organization.
- Sanitizer: model tự mở rộng chữ viết tắt và suy thêm alcohol composition.
- Police: output có field lạ `missingBranches2`, bị D1 từ chối đúng.
- Come / chemical alcohol / fashion jewelry: shortlist thiếu đúng concept hoặc
  thiếu concept cho toàn bộ nghĩa.
- Nhiều concept có thể tương đương: chưa đủ bằng chứng chọn một ID; không dùng
  ID nhỏ nhất hay điểm embedding cao nhất để tự phá hòa semantic.

## 4. Định nghĩa thành công

### 4.1 Thành công vận hành

- Mọi target có đúng một trạng thái cuối của run, kể cả không có candidate.
- Không mất response đã nhận; không gửi lại request có dispatch outcome unknown.
- Resume cùng run không phát sinh thêm call cho request đã gửi.
- Có giới hạn calls, expansion, repair, thời gian và dung lượng.
- Có report tổng và theo shard; query tiến độ được khi không giữ phiên SSH.
- Không có đường đi tự động từ reply raw đến ghi `core.sense_concept`.

### 4.2 Thành công semantic

- Chỉ whole-sense exact mới vào exact-proposals; relation khác giữ artifact riêng.
- Source branches được phủ đủ; điều kiện loại nghĩa phải dựa vào dữ liệu nguồn.
- No-candidate / ambiguous / disagreement không bị biến thành accept để tăng yield.
- Chất lượng được audit theo gate §14; reviewer tự động được ghi là LLM.
- Mỗi proposal có thể replay nguồn, shortlist, prompt, R1/R2 và decision hash.

Không đặt mục tiêu map 100% JMdict. Compound sense có nhiều nghĩa mà corpus
không có concept phủ cả sense sẽ còn chưa map, kể cả retrieval chạy đúng.

## 5. Phạm vi và quyền sở hữu dữ liệu

### 5.1 Đợt triển khai đầu

- Nguồn sense: JMdict JA, có accepted JLPT; chọn đại diện N5–N1 nếu dữ liệu có.
- Concept: corpus được DB4-D2 source audit xác minh, giữ phiên bản cụ thể.
- Evidence chính: **toàn bộ EN gloss của đúng sense**, raw POS/field/info,
  spelling/reading restrictions và definition nếu có.
- VI gloss máy chỉ là dữ liệu phụ hiển thị/debug; không dùng làm căn cứ exact.
- Existing source links và source-identity proposals đi lane riêng, không giả
  output Muse hoặc tính vào tỷ lệ exact consensus.

Con số 15.245 sense là snapshot lịch sử. Preflight phải đếm lại target hiện tại,
không coi 15.245 là lượng target bất biến sau mọi đợt import/trim.

### 2026-10-10 — Preflight READ ONLY trên DB VPS

Transaction `REPEATABLE READ READ ONLY`, statement timeout 20–25 giây; chỉ đếm
cohort `jmdict` có `jlpt_link.status=accepted`, level 1–5. Không export content,
không ghi DB, không khởi động Muse/job.

| Thuộc tính                                                              |                   Count quan sát được |
| ----------------------------------------------------------------------- | ------------------------------------: |
| Tổng sense                                                              |                                15.245 |
| N1 / N2 / N3 / N4 / N5                                                  | 4.334 / 2.705 / 4.611 / 1.613 / 1.982 |
| EN gloss: 1 / 2+                                                        |                        3.870 / 11.375 |
| Có field/info/domain                                                    |                                 1.784 |
| Có exact `sense_concept`                                                |                                     0 |
| POS noun / verb / adjective / adverb                                    |           8.790 / 4.072 / 1.353 / 603 |
| POS expression / pronoun / interjection / conjunction / suffix / prefix |          113 / 84 / 69 / 63 / 63 / 35 |

Vì mọi target đều có EN gloss và chưa có exact, hai mục này không phân tầng
thêm trong selector mẫu hiện tại. Giữ chúng trong population summary để phát
hiện drift. Actual DB name và count là thông tin môi trường; query không trả
credentials. Trước freeze sampling phải lặp lại count cùng snapshot export.

### 5.2 Không thuộc đợt này

- Dịch lại gloss VI; sắp xếp nghĩa phổ biến; sửa search/FE/SRS.
- Tạo concept mới, gộp concept DB hoặc xóa sense để tăng tỷ lệ map.
- Tự xác minh nguồn thiếu license bằng output model.
- Bật nonexact như quan hệ tương đương trong app.
- Thay provider chat/quiz hoặc khởi động thêm browser Muse.

### 5.3 Fingerprint

Tách semantic input fingerprint khỏi promotion baseline fingerprint.

- Semantic fingerprint: source version/audit, sense EN context, restrictions,
  concept lineage/definitions, retrieval version/model revision, prompt version.
- Promotion baseline: actual DB identity, rows/existing links cần ghi, các gate
  serving và trạng thái concept tại thời điểm apply.
- DB3 chỉ bổ sung VI gloss không tự làm semantic input JA→concept stale.
- Sense/concept bị xóa hoặc thay semantic context: proposal bị stale; không
  tự thay bằng ID có cùng mặt chữ.

## 6. Chọn mẫu 1.000 sense và chia shard

### 6.1 Selector mới

Không dùng `ORDER BY s.id LIMIT 1000` của export pilot hiện tại để gọi là mẫu
đại diện. Tạo selector deterministic với seed và sampling manifest.

1. Đếm cohort theo level, POS, số EN gloss, field/info, existing-link status.
2. Nhóm theo **lexeme**, gán development/holdout trước khi chọn sense.
3. Tách mọi lexeme đã dùng thiết kế prompt/audit cũ vào development.
4. Chọn 1.000 sense có quota theo strata và seed; giữ cùng lexeme trong một shard.
5. Ghi population counts, selected counts, inclusion rule, seed và exclusions.

Đã có code local cho selector ở `scripts/db4/cohort-select.ts` và cohort export
`jlpt-n1-n5` ở `retrieval-export.ts`; cohort `jlpt` cũ vẫn giữ nghĩa N4/N5.
Selector xác minh export fingerprint, ranker version, hash sense file và
population count; từ chối export partial. Nó chia split theo stable JMdict
`identity.externalId`, ép **41 lexeme pilot cũ** vào development, phân tầng độc
lập theo JLPT level/POS family/EN gloss count/field-info/original-link status
(unlinked/nonexact/exact), rồi gán lexeme cùng shard. Giới hạn 5 sense/lexeme và
100 target/shard. Target row giữ
artifact path + line + row SHA256 để consumer đọc lại đúng context.

Danh sách pilot có nguồn/hash tại
[known development lexemes](../reviews/db4-d2-known-development-lexemes-2026-10-10.json).
Mẫu cũ 31 no-candidate + 69 có bundle hợp thành 41 lexeme; v2 sample30 và repeat
được đối chiếu, không thêm lexeme ngoài tập này. JLPT level được báo đúng level;
export hiện không có frequency corpus nên N5/N4 **không được gọi là tần suất từ**.
Không tính sampling weights.

Lệnh dưới đây được chạy trên VPS từ commit `0208649`; `--limit 20000` phủ đủ
population 15.245 trong snapshot đó. Cohort đã freeze tại
`/opt/langoo/storage/db4-batches/db4-d2-jlpt-n1-n5-20261010-0208649/`: 1.000
targets, 200 development / 800 holdout, 10 shard × 100. Full manifest/selection
hash và strata ở [review selector](../reviews/db4-d2-cohort-selector-2026-10-10.md).

```bash
cd /opt/langoo/app

npx tsx scripts/db4/retrieval-export.ts \
  --artifact-dir /opt/langoo/storage/db4-batches/<run-id> \
  --prefix export --cohort jlpt-n1-n5 --limit 20000 --chunk 500

npx tsx scripts/db4/cohort-select.ts \
  --artifact-dir /opt/langoo/storage/db4-batches/<run-id> \
  --manifest export/manifest.json \
  --known-development docs/reviews/db4-d2-known-development-lexemes-2026-10-10.json \
  --seed db4-d4-d5-cohort-2026-10-10-v1 \
  --prefix cohort/2026-10-10-v1
```

Đầu ra `population.json`, `selected.jsonl`, `sampling.json` là artifact
immutable. Projector local tạo export nhỏ đúng 1.000 selected senses; source
audit kiểm JMdict/OEWN/OMW EN/JA không có mismatch; hybrid RRF có 966 shortlist
và 34 no-candidate. Kết quả không đo semantic recall/precision và chưa gọi Muse;
chi tiết ở [review retrieval DB4-D2](../reviews/db4-d2-cohort-retrieval-2026-10-10.md).

Không giả sampling weight khi không có inclusion probability. Báo cả kết quả
theo strata; mẫu quota có chủ đích không đại diện tự động cho phân bố toàn DB.

### 6.2 Quota ban đầu

| Nhóm        | Số sense dự kiến | Cách dùng                                                  |
| ----------- | ---------------: | ---------------------------------------------------------- |
| Development |              200 | Debug và theo dõi lỗi; không làm precision holdout         |
| Holdout     |              800 | Chưa dùng để sửa prompt; tách hoàn toàn lexeme development |
| Tổng        |            1.000 | Denominator của đợt shadow                                 |

Trong mỗi nhóm, phân bổ theo tỷ lệ accepted JLPT thực tế; bảo đảm có noun,
verb, adjective/adverb, expression; sense một gloss và nhiều gloss; cùng sense
có/không restriction/field. Hiện không có corpus frequency trong selector nên
không giả định JLPT level tương đương tần suất sử dụng. Nếu nhóm nhỏ không đủ quota, ghi số thực tế
và deterministic redistribution; không lặp target cho đủ 1.000.

Nên giới hạn ban đầu tối đa 5 sense/lexeme để vài từ đa nghĩa không chiếm mẫu.
Phần bị cap vẫn trong population manifest nhưng không trong selected set.
Khi không đủ 1.000 target, report đúng số đã chọn và lý do, không nhân bản row.

### 6.3 Shard và giới hạn artifact

- 10 shard, mục tiêu 100 sense/shard; giữ lexeme cùng shard nên size có thể lệch
  nhẹ, nhưng **không shard nào quá 500 target/generation**.
- Mỗi generation/generation mở rộng giữ đầy đủ status denominator của shard.
- Giới hạn 64 MiB/file ở D3 tiếp tục áp dụng; preflight kiểm byte trước dispatch.
- Pool concept chung có index/cache đọc streaming hoặc partition; bundle chỉ
  mang context concept đang được chấm. Không nhét toàn corpus vào prompt.
- File corpus vượt cap cần index reader riêng có giới hạn, không chuyển nguyên
  file quá cap vào adapter D3 hoặc tùy tiện tăng giới hạn parser.

## 7. DB4-D2 — Retrieval kết hợp nhãn và MiniLM

### 7.1 Dữ liệu chuẩn bị một lần

- Reuse nguồn gốc `wn.db`, source audit và model revision đã pin.
- Reuse embedding cache nếu content/model hashes đúng; không reuse chỉ theo ID.
- Xây local lexical index từ audited English concept labels/synonyms/definitions;
  không đưa gloss VI máy vào index như synonym EN.
- Chuẩn hóa case/Unicode cho index, giữ nguyên raw context trong artifact.
- Không index gloss VI máy làm synonym EN và không suy synonym JA chưa có proof.

Triển khai lexical deterministic trong code hiện có: compact inverted index,
unique-token overlap và exact-label phrase boost; không cần thêm dịch vụ tìm
kiếm. Thay sang BM25 chỉ sau benchmark và phải version ranker/index riêng.

### 7.2 Cách lấy pool

1. Tạo query riêng cho từng EN gloss và query tổng từ toàn bộ EN gloss/definition;
   giữ branch boundaries.
2. Lexical lookup lấy tối đa 30 concept ID/query; exact-label phrase boost chỉ
   thay thứ tự retrieval, không là semantic acceptance.
3. MiniLM lấy tối đa 30 concept ID/query với filter POS tương thích.
4. Union theo concept identity đã audit; rank pool bằng Reciprocal Rank Fusion
   (RRF), `1/(60 + rank)` cho mỗi lane lexical/MiniLM. `k=60` là default cố
   định của phiên bản, chưa benchmark/tune.
5. Nếu union >100, giữ 100 đầu theo RRF score, số gloss branch được phủ, rồi
   semantic key. Chọn tối đa 5 candidate và lưu rank từng lane/provenance.
6. Điểm lưu vào D1 là normalized RRF 0–1; raw RRF, cosine, token overlap và
   branch coverage ở `features`. Không gọi điểm này confidence/xác suất.

Các giá trị 30/100 và `k=60` là cấu hình khởi đầu cần ghi vào retrieval version,
không phải ngưỡng đã benchmark. Tối đa 5 candidate là contract D1 hiện hành.

### 7.3 POS và domain

- POS không biết: giữ reason; không tự đổi expression thành noun để có candidate.
- Filter hard chỉ với xung đột đã có mapping POS rõ ràng và test.
- Field như chemistry/medicine là tín hiệu boost/filter có trace, không ép
  concept phải có domain tag y hệt nếu nguồn concept không cung cấp đầy đủ tag.
- Ví dụ chemical alcohol: phải truy hồi lane noun/chemical bên cạnh lexical
  `alcohol`; không chỉ trả beverage vì seed đầu đã là drinking alcohol.
- Restriction nguồn không đầy đủ: giữ unknown; không tự thêm thông tin bằng LLM.

### 7.4 Trùng concept và ambiguity

Chỉ canonicalize candidate identity khi source audit chứng minh cùng synset
đúng lexicon/version, hoặc crosswalk được xác minh có quan hệ identity phù hợp.
ILI đơn lẻ, label giống nhau hay definition giống nhau không đủ để gộp.

Không đổi bảng concept trong retrieval. Nếu hai concept khác ID đều exact mà
không có identity proof, D3 giữ `ambiguous_concepts`; lưu nhóm cạnh tranh để xử
lý riêng. Mục tiêu đợt này không phụ thuộc việc dọn sạch toàn concept corpus.

### 7.5 Whole-sense coverage

Shortlist cần khả năng so sánh toàn source sense, không chọn một concept cho
một gloss rồi coi như phủ các gloss còn lại. `come/go/be` hoặc `house/home/family`
không exact nếu chỉ có concept cho một phần và không có concept bao quát đúng.
Retrieval có thể đưa các concept từng nhánh vào shortlist để model đánh giá;
kết quả vẫn unresolved khi không có whole-sense exact.

## 8. DB4-D4 — Prompt kế tiếp và điều kiện chốt

### 8.1 Version

Tạo prompt **v2.1** trong file mới, kế thừa v2; không sửa bytes của v1/v2 đã run.
Chuẩn hóa selector version và prompt refs ở prepare/repair/validator.
Prompt file + render hash + source context hash định danh response; request ID
trùng giữa hai version không đủ để reuse.

**Đã triển khai offline ngày 2026-10-10:** ba file v2.1 riêng; prepare giữ v1
default, selector nhận `v1|v2|v2.1`; repair lấy revision từ manifest và chỉ cho
phép đúng một lần; validator kiểm version từng request và lưu dưới thư mục của
revision. Synthetic end-to-end test cover prepare → repair → validate. Chi tiết
và hash prompt ở [review DB4-D4 v2.1](../reviews/db4-d4-prompt-v2.1-2026-10-10.md).
Chưa gọi Muse với prompt v2.1; prompt hiện chỉ được freeze về mặt artifact, chưa
được xác nhận chất lượng ngữ nghĩa.

### 8.2 Chỉ sửa các điểm có bằng chứng

1. Phân biệt denotation với polite/familiar/possessive usage: `your husband`
   vẫn có thể denotate husband; tuổi/giới/role là constraint khi nguồn nêu rõ.
2. Không mở rộng abbreviation/ellipsis ngoài source, không suy alcohol-based
   sanitizer thành rubbing alcohol khi source không cho composition tương ứng.
3. Scope hai chiều dựa vào source/concept thật. Counterexample phải chỉ ra
   constraint trong dữ liệu hoặc khác biệt nghĩa thông thường rõ ràng; không
   bịa domain sentence rồi dùng nó làm bằng chứng phân biệt.
4. Reason và branch coverage không được mâu thuẫn với relation exact.
5. Output đủ mọi candidate đã giao, đúng identity, không extra field.
6. Nếu thiếu concept, được trả unresolved; không cần chọn gần nhất để hoàn tất.

Calibration examples dùng tình huống tổng quát, không đưa đáp án của holdout,
ID target, audit hoặc verdict R1 vào R2.

### 8.3 Kiểm chốt prompt

- Offline kiểm render, hashes, D1 example outputs và regression logic.
- Các case lỗi cũ là development fixtures; không tính là holdout pass rate.
- Chỉ một vòng hiệu chỉnh v2.1 trong đợt triển khai này. Nếu batch đại diện còn
  severe, đóng promotion và report nguyên nhân; không tự chạy v2.2/v2.3 vô hạn.
- Không claim prompt mới sửa được model cho tới khi đã chạy và audit.

## 9. DB4-D3/D4 — R2 có chọn lọc

### 9.1 Điều kiện R2

R1 phải valid D1, bind đúng bundle/prompt/render, không unresolved; có **đúng
một candidate exact** và đủ source branch coverage. Candidate phụ được nonexact
nhưng không được còn unresolved gây nghi ngờ exact lựa chọn.

| Kết quả R1                            | Bước tiếp                                                               | Trạng thái vận hành                       |
| ------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------- |
| Unique whole-sense exact              | Lên lịch R2, fresh context, full shortlist                              | `r2_pending`                              |
| Nhiều exact                           | Không tự phá hòa; kết thúc hoặc expansion nếu có retrieval miss độc lập | `unresolved_ambiguous`                    |
| Không exact, có bằng chứng miss       | Thử expansion một lần                                                   | `expansion_pending`                       |
| Không exact, không bằng chứng miss    | Không gọi R2                                                            | `unresolved_no_exact`                     |
| Compound không có whole-sense concept | Không buộc ghép concept                                                 | `unresolved_compound`                     |
| Invalid format                        | Repair có giới hạn nếu còn budget                                       | `format_repair_pending`                   |
| Unknown dispatch / auth blocked       | Recovery hoặc park                                                      | `transport_unknown` / `blocked_transport` |

R2 được seed shuffle riêng; không có relation, lời giải thích hoặc lựa chọn R1.
Hai pass cùng Muse có lỗi tương quan; R2 là kiểm tra ổn định và phản biện phạm
vi, không được ghi là hai model/judge độc lập.

### 9.2 Quyết định khi có hai output

Reuse pure `decideMappingBundle()` với **full candidate objects**, không truyền
slim candidate projection trong bundle thay thế.

- Cùng unique exact và không unresolved → exact proposal `verified=false`.
- Candidate phụ nonexact có thể bất đồng theo policy D3 hiện hành; không tự
  làm mất exact nếu không có unresolved/conflict liên quan.
- Selected exact khác nhau, multiple exact, uncertain hoặc unresolved → defer.
- Không gán MiniLM score / LLM confidence thành calibrated score.

### 9.3 Adapter mới, không hack adapter cũ

`muse-review-decide.ts` hiện yêu cầu hai request/bundle và đủ response cho toàn
generation. Nó không dùng nguyên trạng được cho conditional R2.

Tạo orchestration envelope version mới và adapter riêng:

- D1 `MappingCandidate/Bundle/Output/Decision` giữ nguyên.
- Schedule ghi rõ phase planned/dispatched/skipped và lý do skip.
- Tất cả target vẫn có status, không bỏ row R1 không exact khỏi denominator.
- Một phase thiếu do skip hợp lệ khác với mất response sau dispatch.
- Không tạo fake R2, output hash giả, hoặc `reject_pair` từ một lượt all-none.
- R1-only row có sidecar status vận hành; không mang một D1 two-pass decision.
- Khi đủ hai phase, adapter gọi pure D3 và ghi D1 decision đúng binding.

Frozen D3 v1 CLI và các pilot manifest cũ phải replay như trước.

## 10. Expansion có giới hạn

### 10.1 Trigger

Cho expansion khi không có exact và ít nhất một tín hiệu có thể ghi evidence:

- Lexical index có concept khớp label/definition mà shortlist chưa gồm.
- Field/POS/query lane bị thiếu ở lượt đầu và có pool hợp lệ để bổ sung.
- R1 nêu thiếu nhánh hoặc retrieval miss; thông tin này chỉ tạo query, không
  được coi là chứng minh concept LLM đề xuất tồn tại hoặc exact.

Không expansion chỉ để cố làm hai lượt đồng ý. Không chạy với source blocked,
context trống, nhiều exact không có miss evidence hoặc compound đã xác định
không có whole-sense target trong corpus sau kiểm pool.

Nếu R1 từng chọn exact nhưng R2 bác vì concept thiếu phạm vi, chỉ mở rộng khi
có miss evidence ở trên. Selected exact không nhất quán tự nó không phải miss.

### 10.2 Bundle mới

- Tối đa một expansion/sense; pool mới cũng tối đa 5 candidate trong bundle.
- Sinh generation/bundle/context hash mới, source sense giữ đúng identity.
- Ghi parent generation + trigger evidence + config/query diff.
- Không mutate shortlist của run đầu, không chèn candidate vào raw response cũ.
- **R1 phải chạy mới** cho shortlist mới. Chỉ nếu đạt điều kiện §9 mới gọi R2.
- Không ghép R1 generation đầu với R2 generation sau để tạo consensus.
- Chọn final result theo generation cuối đã hoàn tất; giữ toàn lịch sử đầu.

## 11. Repair output và ngân sách

### 11.1 Repair chỉ cho format

Cho phép tối đa **một format-repair request cho mỗi sense trong toàn run**, kể
cả khi sense đã expansion. Chỉ repair schema/ledger: missing/extra field,
candidate missing, JSON hỏng, identity/order không đúng nếu có thể sửa.

- Lưu raw response gốc và parser errors trước repair.
- Repair input gồm đúng context/prompt/bundle phase gốc và lỗi contract, có hash.
- Repair phải được validate D1 đầy đủ, không strip field lạ để giả thành pass.
- Với semantic fields parse được ở response gốc, so relation/selected meaning/
  branch evidence trước–sau. Nếu đổi semantic claim, repair không được nhận là
  sửa format; giữ unresolved và ghi `semantic_change_during_repair` ở sidecar.
- Candidate thiếu không được copy từ phase còn lại. Nếu repair bổ sung candidate
  thì toàn reply vẫn cần validate và provenance là repaired output.
- Normalization deterministic như bỏ Markdown fence có thể cho phép trong
  adapter version riêng; luôn giữ raw hash và normalized hash. Không tự bỏ key.

Không dùng utility repair hardcode v1 cho v2.1 trước khi sửa binding/version.

### 11.2 Caps

| Ngân sách                   |                                       Cap đợt đầu |
| --------------------------- | ------------------------------------------------: |
| Target senses               |                                             1.000 |
| Shard target                |               Khoảng 100; hard max 500/generation |
| Muse concurrent generations |                                    8 toàn account |
| Semantic generations/sense  |                        2: initial + một expansion |
| Semantic passes/generation  |                                R1 + tối đa một R2 |
| Format repair/sense         |                                        1 toàn run |
| Mapping dispatch/sense      |                                          Tối đa 5 |
| Mapping dispatch/run        |                     Tối đa 5.000, thường thấp hơn |
| Audit dispatch/run          |       Cap riêng 250; không trừ/ẩn vào mapping cap |
| Candidate/bundle            |                                          Tối đa 5 |
| Target timeout              | 240 giây/request ban đầu; cấu hình được đóng băng |

Audit cap 250 gồm tối đa 100 target Pilot A, 100 positive holdout và 50 hard
negative; có thể reuse một audit đáp ứng cả hai mục nếu cùng binding/scope,
nhưng denominator mỗi gate giữ riêng. Không tự tăng audit cap để repair audit.
Audit invalid/missing giữ chưa đủ gate; việc thu thêm mẫu phải là run kế tiếp.
Proposal ngoài tập đã audit tiếp tục `unaudited`, không được apply nhờ gate của
mẫu 100 positive. Canary chỉ dùng proposal đã audit pass. Đợt apply lớn sau đó
phải có audit budget tương ứng hoặc policy sampling/calibration riêng được chốt;
plan hiện tại không tự cấp quyền ghi mọi proposal của toàn corpus.

Cap đếm **dispatch intent**, không chỉ successful replies. Generation rejected
hoặc timeout sau intent vẫn tiêu budget. Hết budget: park target với lý do,
không chạy vòng fallback vô hạn. Không giả telemetry token nếu transport thiếu.

## 12. Orchestration, contract và artifact

### 12.1 Contract mới cho batch

Đề xuất schema version 1 cho envelope `db4_automated_mapping_batch`; đây là
schema orchestration mới, không gọi là D1 schema v2.

`run-manifest.json` tối thiểu:

- `runId`, `schemaVersion`, `task`, `createdAt`, Git revision + dirty-source hash.
- `mode=shadow`, `apply=false`, `promotionReady=false`.
- Snapshot identity/fingerprint; source audits + refs/hashes.
- Cohort ref/hash, sampling config/seed, population/selected counts.
- Shards/generations refs; prompt/adapter/retrieval/model versions.
- Caps mapping/audit/expansion/repair, workers/timeouts.
- Source semantic fingerprint; không chứa credential/cookie/session ID.

`targets.jsonl`: đúng một row/selected sense; target/sense/lexeme key, strata,
split development/holdout, shard key, original status và source ref.

`schedule.jsonl`: immutable planned job record; run/shard/target/generation/
bundle/phase/attempt kind; prompt/render/input hashes; dependency; dispatch cap.
R2/expansion có thể được lập thành wave mới với manifest hash mới, được bind
đến quyết định tạo wave; không append nội dung vào một manifest đã finalized.

`events.jsonl`: append-only ledger có sequence/hash chain; event type, job ID,
timestamps và response ref. Cần một writer qua coordinator hoặc file lock;
worker không tự append đồng thời làm hỏng JSONL.

`target-results.jsonl`: một final status/target; generation được chọn, D1
decision ref nếu có; operational reason; audit status. Không nhét operational
reason mới vào enum D1 chưa hỗ trợ.

### 12.2 Cây thư mục trên VPS

```text
/opt/langoo/storage/db4-batches/<run-id>/
  run-manifest.json
  cohort/{population.json,selected.jsonl,sampling.json}
  sources/{snapshot.json,audit.json,refs.json}
  shards/0001/
    initial/{generation/,prompt/,planned-waves/}
    expansion/{generation/,prompt/,planned-waves/}
    responses/{raw/,normalized/}
    decisions/{bundles.jsonl,exact-proposals.jsonl,manifest.json}
  ledger/{events.jsonl,checkpoint.json}
  private/jobs/
  audit/{planned.jsonl,responses/,results.jsonl,report.json}
  reports/{progress.json,summary.json,summary.md,unresolved.jsonl}
  final-manifest.json
```

Đây là layout dự kiến, không phải thư mục đã được tạo trong lượt viết plan.
Shared concept index/embedding cache nằm ngoài từng run, version/hash được refs
vào manifest. Không xóa cache đang dùng bởi run khác.

### 12.3 Invariant của artifact

- Dùng atomic temp-write → fsync → rename; fsync directory ở điểm checkpoint.
- File immutable tồn tại cùng bytes thì reuse; khác bytes thì fail, không overwrite.
- Manifest output ghi cuối, sau mọi referenced file đã đóng và hash được kiểm.
- Raw/private jobs 0600, thư mục private 0700; report public không chứa session ID.
- Path phải nằm dưới artifact root; từ chối symlink/path traversal ngoài root.
- Kiểm byte/row/count trước load; lớn quá cap không dispatch.
- Replay không cần gọi Muse và cho cùng decision hashes.

## 13. VPS runner và phục hồi

### 13.1 Reuse transport

Giữ Muse native gateway/account session đang có; mỗi request dùng fresh side-chat.
Không mở Chrome mới/request, không dựng tám browser, không đưa cả batch vào một
chat khiến context R1/R2 và các target ảnh hưởng nhau.

Tám worker là concurrency đã thử; không cam kết đó là tối ưu tuyệt đối. Index
MiniLM chạy trước dispatch, threads ban đầu 1–2 và cap ONNX rõ để tránh CPU
tranh với app. Không tăng worker vượt 8 trong đợt này.

### 13.2 Request state machine

```text
planned → ready → intent_persisted → dispatched → completed_raw
                                                → transport_unknown
completed_raw → validated → semantic_result
             → invalid_format → repair_planned → validated/unresolved
```

- Lưu intent + job identity bền vững **trước** gọi generation.
- Nếu crash giữa intent và ACK, không biết đã gửi chưa: `transport_unknown`.
- Sau intent, không tự resend generation request. Reconcile chỉ đọc chat history
  với session/job proof; tìm được completion thì lưu raw, không tạo lượt mới.
- Nếu chưa từng có intent, restart được gửi request planned đó.
- Request completed ở gateway nhưng JSON sai: lưu raw ngay; không tiếp tục
  chờ đủ 600 giây chỉ vì D1 không parse được.
- Complete cần transport signal/history phù hợp; không coi text đang stream là
  completion chỉ vì tình cờ parse được một JSON fragment.
- Timeout 240 giây dẫn unknown/recovery, không đánh dấu semantic `none`.

### 13.3 Locks và circuit breaker

- Account-global flock phải tương thích runner Muse hiện hành. Một coordinator
  giữ lock toàn vòng chạy; không khởi động nhiều unit tranh cùng account.
- Run lock riêng chống hai process resume cùng artifact.
- 401/403/session expired: dừng dispatch mới, checkpoint; cần refresh login.
- 429 hoặc overload: dừng nhận job mới, cooldown có giới hạn, giảm 8 → 4 → 2.
  Không resend các intent cũ; job chưa dispatch có thể tiếp tục sau cooldown.
- Lỗi infrastructure liên tiếp 3 lần: breaker mở; report `blocked_transport`.
- Integrity/hash/DB identity drift: fail ngay, không repair bằng LLM.
- Giới hạn cooldown tổng 30 phút; quá giới hạn unit thoát có checkpoint,
  trạng thái blocked, không busy loop hoặc tự reset run.

### 13.4 systemd

Đã thêm unit template
[`langoo-db4-batch@.service`](../../scripts/ops/db4-batch/langoo-db4-batch@.service)
và [runbook VPS](../../scripts/ops/db4-batch/README.md). Service dùng immutable
release path trong env file, không sửa/build `/opt/langoo/app`; artifact ghi
trong `/opt/langoo/storage/db4-batches`, account lock dùng chung với Muse native.

- `run-shadow.py` chạy R1 → kiểm tra validation manifest → conditional R2 →
  report; caps riêng từng phase cho phép smoke một request R1 + tối đa một R2.
- Runner lưu intent trước generation, không tự gửi lại unknown; stop yêu cầu
  checkpoint. `Restart=on-abnormal`, tối đa ba lần/giờ; lỗi auth/integrity không
  tự lặp. Resume thủ công dùng đúng manifest/release.
- Unit hiện đặt `MemoryHigh=700M`, `MemoryMax=800M`, `CPUQuota=100%`, `Nice=10`.
  Quan sát VPS 10/10: RAM 1,9 GiB, available khoảng 681 MiB, swap dùng 860 MiB.
  Preflight full artifact local sau streaming/hash optimization với Node heap
  448 MiB mất 2:20.34, peak RSS 526.776 KiB (~514 MiB), không phát sinh swap;
  VPS preflight cùng artifact đã pass trước đó trong 5:55.69, max RSS 279.220
  KiB. Service template đã được cài/verify; env file smoke riêng đã tạo. Lượt
  chạy release `708e3b8` ngày 11/10 dừng trước ledger/dispatch khi cgroup lên
  khoảng 646 MiB và RAM khả dụng còn 136 MiB. Phân tích cho thấy runner giữ cả
  targets, candidates và hai phase request trong khi chạy Node preflight.
- Memory fix `cbe9e56` đã push: chỉ nạp payload của phase đang chạy sau preflight,
  bỏ giữ targets/candidates trong Python, giải phóng queue trước D1 Node validation.
  Nó pass 13/13 runner tests; preflight + nạp 966 R1 requests cũng pass trong
  sandbox systemd tương đương, cgroup quan sát khoảng 457 MiB.
- Smoke với manifest `db4-smoke-20261011-cbe9e56` không dispatch: systemd unit cũ
  chỉ cho ghi file account lock, trong khi runner chmod thư mục cha mode 0700.
  Reproduce được `EROFS`; thêm quyền ghi thư mục Muse vào `ReadWritePaths` khiến
  test lấy/release cả run lock và account lock pass. Unit update đang local, chưa
  cài lên VPS. Cookie file vẫn nằm trong `ReadOnlyPaths`.
- Unit cũ đã qua `systemd-analyze verify` trên VPS. Smoke mới chỉ được chạy lại
  sau khi commit/push và cài unit đã sửa, xác nhận RAM/PSI; giữ cap R1=1/R2=1.
  Chưa có Muse dispatch, ledger event, DB write, apply hoặc app deploy.

## 14. DB4-D5 — Audit và gate tự động

### 14.1 Cách audit

Reviewer dùng Muse trong fresh session, prompt audit riêng đóng băng:

- Input đủ source raw + shortlist + proposed relation/candidate binding.
- Không đưa lời giải thích R1/R2, confidence, rank hay expected answer.
- Hỏi source coverage, scope hai chiều, material restriction, counterexample
  có căn cứ; verdict `pass|fail|deferred` và severity.
- Ghi `reviewerKind=llm`, model/provider/session provenance private, prompt hash.
- Validator kiểm target/candidate membership, đầy đủ rows, scope proof và hash.
- Audit invalid/missing/ambiguous không tính pass; không tự lấy agreement làm pass.

Muse audit cùng model vẫn có lỗi tương quan. Báo là **AI-assessed quality**,
không gọi human gold hay bảo đảm chuyên gia đã xác nhận. Tự động hóa không có
nghĩa phải xử lý mọi sense thành link accepted.

### 14.2 Gate kỹ thuật trước shadow batch

- Contract/adapter/replay/integrity tests pass.
- Chọn mẫu/split/denominator chính xác.
- Resume, unknown dispatch, cap, breaker và lock được kiểm bằng transport fake.
- Export/source audit và integrity preflight trên full artifact thật đạt ở local;
  VPS preflight và transport smoke vẫn là gate trước dispatch.

Đạt gate local cho phép cài release riêng, chạy VPS preflight và một transport
smoke riêng giới hạn tối đa 1 R1 + 1 conditional R2. Đây **chưa** phải gate để
chạy shadow 1.000: đợt đó còn cần expansion, format-repair dispatch và Pilot
A/B audit coordinator được triển khai/test theo Stage C. Không tự chạy partial
1.000 khi các khả năng đó thiếu trong manifest/runner.

### 14.3 Pilot A — audit 100 target

Chọn 100 target holdout bằng seed sau khi đóng cohort, gồm có và không có
proposal. Audit đúng decision/stated uncertainty; không chấm defer mặc định là
đúng nếu thực tế evidence đủ để map và pipeline bỏ qua.

- Gate kế thừa: **≥98/100 target decision pass, 0 severe**.
- Mẫu có no-candidate phải được kiểm bằng corpus/index, không chỉ hỏi LLM với
  shortlist rỗng rồi kết luận corpus thiếu concept.
- Missing/invalid/deferred audit tính chưa đạt, không loại khỏi denominator 100.
- Nếu chưa đủ evidence để adjudicate retrieval miss, giữ audit deferred.

### 14.4 Pilot B — precision trước production

- Thu ≥100 distinct positive proposals holdout và ≥50 hard-negative/deferred.
- Gate kế thừa: ≥99/100 positive đúng relation/scope và 0 severe.
- Mọi link đã xác định sai bị loại; không dùng quyền một lỗi/100 để ghi link sai.
- Denominator dương riêng với overall target; report CI và strata.
- Recall@5 chỉ đo trên subset được audit xác định có whole-sense concept trong
  corpus; mục tiêu ban đầu ≥95%, ghi rõ ground truth là AI adjudication nếu vậy.
- Khi 1.000 target chưa đủ 100 positives: vẫn finalize shadow report, gate
  `insufficient_positive_sample`; không lấy 1/1 hoặc 20/20 thay 100.

Nếu dùng holdout để sửa prompt/ranker thì cohort đó chuyển thành development;
đợt gate sau cần holdout lexeme mới. Không tiếp tục gọi nó là untouched holdout.

### 14.5 Khi gate fail

- Đóng promotion toàn run; giữ proposals để debug/retrieval và theo dõi.
- Phân loại lỗi: source, retrieval, scope reasoning, output, duplicate identity,
  ambiguity, transport, validator.
- Không auto rerun cả cohort bằng prompt khác, không mở apply subset pass của
  một run severe khi batch gate chưa đạt.
- Hết cap: hoàn tất artifact/status, ghi việc còn thiếu; không yêu cầu người dùng
  duyệt từng mapping. Sửa nguyên nhân cụ thể là hạng mục tiếp theo được ghi rõ.

## 15. DB4-D6/D7 — Đường từ proposal đến app

### 15.1 Điều kiện mở DB4-D6

Đây là bước triển khai tiếp sau shadow; kế thừa plan DB4 tổng thể, cần:

- Technical gate và Pilot A/B đủ; manifest gate hash-bound đúng run.
- Proposal đã pass audit, chưa stale, đúng source/target environment.
- Source identity lane được audit riêng; không tự ăn theo gate Muse positives.
- Preflight actual DB/existing links/ownership; mutation journal, rollback,
  idempotency, concurrent-writer guard được test.
- Apply đúng tập cho phép; các trạng thái unresolved không là input apply.

Một lần đồng ý triển khai automation không được tool hiểu là `--force` vượt gate.
Run đầu cố định shadow; tool không có đường tự đổi mode trong cùng manifest.

### 15.2 Apply và rollback

- Dry-run tạo deterministic action plan + before-state hashes.
- Recheck các rows tại transaction boundary; drift thì fail/park, không overwrite.
- Existing đúng relation/provenance: reuse, không chiếm ownership.
- Link mới `verified=false`, method/run/source/batch đúng policy; audit evidence
  ở candidate/review/run artifacts, không thêm field tùy ý vào bảng link.
- Commit theo shard có journal; partial run không gọi là atomic toàn 1.000.
- Reapply cùng action → no-op; rollback chỉ own rows còn khớp before/after hashes.
- Không xóa link của phiên khác hoặc set verified=true chỉ vì Muse đồng ý.

### 15.3 Curation/confidence còn là gate riêng

Serving hiện có concept-curated/confidence ≥0,7; không được fabricate confidence
0,7/1,0 từ consensus để làm mapping xuất hiện. LLM confidence là audit-only;
`calibratedScore` tiếp tục NULL nếu chưa có calibration dataset/policy hợp lệ.

Trước production serving cần chốt cách tạo link confidence/candidate curation
theo plan DB4 tổng thể. Nếu dùng calibrated score: dataset đề xuất tối thiểu
500 cặp, có positive/hard negatives, calibration/holdout/report riêng. Đợt đầu
không mặc nhiên giải quyết gate này; core import có thể chưa visible trên app.

### 15.4 DB4-D7 bắt buộc trước phục vụ

- `serve.sense_pair` chỉ ghép **hai mapping exact**, curated và confidence gate.
- Dedupe directed pair khi nhiều shared concept; chọn strongest pair/tie-break
  deterministic, giữ response shape.
- `serve.sense_card` chọn exact theo policy, giữ ordering/badge gloss VI hiện có.
- Dictionary pair query recheck base mappings khi materialized view stale.
- Collection/deck lookup cũng exact-only/recheck; không chỉ sửa materialized view.
- Migration mới audit OID/dependencies/ACL/owner/index; không DROP CASCADE tùy tiện.
- Refresh failure không được làm API trả mapping đã bị rollback/downgrade.

Kế hoạch này không hứa mapping mới xuất hiện ngay sau batch Muse. Trạng thái
`proposed`, `audited`, `imported`, `served` được report tách biệt.

## 16. Công việc triển khai và file

Các file batch foundation bên dưới đã được triển khai local cho frozen initial
R1/R2 flow. Điều này chưa hoàn tất expansion, format repair, Pilot A/B, shadow
1.000 hoặc apply.

| Thứ tự | Mã        | File/phạm vi                                                | Trạng thái / đầu ra                                                            |
| ------ | --------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1      | DB4-D2    | `retrieval-export.ts`, `cohort-select.ts`                   | Cohort/source audit đã chạy; re-export nếu snapshot drift                      |
| 2      | DB4-D2    | `mapping_minilm.py`, `_retrieval.ts`                        | Hybrid RRF, ≤5 candidates; recall/semantic quality chưa đo                     |
| 3      | DB4-D4    | Prompt v2.1, prepare/repair/validate                        | Version pinning và offline regression đã có                                    |
| 4      | DB4-D3/D4 | `_batch-types.ts`, `batch-prepare.ts`, preflight/validate   | Manifest, schedule, denominator, integrity/read-only gates                     |
| 5      | DB4-D4    | `muse-batch-runner.py`, ops coordinator                     | Durable intent/lock/recovery/fake transport/caps; real transport smoke còn chờ |
| 6      | DB4-D3    | `muse-batch-decide.ts`; reuse `_decisions.ts`               | Conditional R2 + generation binding; D1 policy giữ nguyên                      |
| 7      | DB4-D2/D4 | Expansion planner                                           | Chưa triển khai                                                                |
| 8      | DB4-D4    | Format-repair planner/dispatch                              | Chưa triển khai                                                                |
| 9      | DB4-D5    | Pilot A/B audit coordinator                                 | Chưa triển khai; report hiện ghi `not_run`                                     |
| 10     | DB4-D4/D5 | `batch-report.ts`, `scripts/ops/db4-batch/`                 | Initial-generation report, systemd template và runbook đã có                   |
| 11     | DB4-D4/D5 | TypeScript/Python tests, lint, format, service verification | Local technical suite và read-only real-artifact preflight                     |
| 12     | DB4-D4/D5 | Separate transport smoke                                    | Tối đa 1 R1 + 1 R2; chưa chạy                                                  |
| 13     | DB4-D4/D5 | Shadow 1.000 + report                                       | Chưa chạy; chờ smoke và các gate mở rộng/repair/audit                          |
| 14     | DB4-D6    | Mutation/journal/preflight/rollback                         | Chưa triển khai; chỉ nhận batch gate đầy đủ                                    |
| 15     | DB4-D7    | Serving migration/repositories/test                         | Chưa triển khai; exact-only, stale-safe refresh/index/API còn chờ              |

Nếu tách transport helper, giữ runner pilot cũ dùng behavior cũ hoặc version
adapter rõ ràng; không làm CLI cũ mặc nhiên resume/resend khác policy.

Không cần endpoint mới, ENV provider mới hoặc migration ở bước 1–12. Credentials
reuse gateway hiện có, không ghi secret vào repo/manifests/command examples.
Handoff consumer phải ghi adapter/schema version và cách đọc legacy/new artifact.

## 17. Thứ tự thực hiện và điểm nghiệm thu

### Chặng A — Chuẩn hóa input và contract

1. Ghi nhận Git baseline/dirty files và phiên chạy khác; không gom WIP khác.
2. Cohort selector + source audit + export read-only.
3. Hybrid retrieval, cache provenance và candidate/generation version.
4. Prompt v2.1; envelope batch và validation adapters.
5. Chạy regression/replay offline; lưu report dưới đúng DB4 code.

**Exit:** cohort/generation/requests có thể chuẩn bị bất biến; không call Muse.

### Chặng B — Runner và phục hồi

1. Persistent intent/events/checkpoint và locks — local implementation/test có.
2. Conditional waves R1/R2 và per-phase dispatch cap — initial flow có; expansion/
   repair vẫn thiếu.
3. Complete-invalid behavior, read-only reconcile, breaker và systemd — local
   implementation/fake tests có; unit chưa cài trên VPS.
4. Report/status và fake-transport tests — local implementation/test có.
5. Cài release riêng trên VPS, chạy read-only preflight tại VPS, rồi smoke riêng
   tối đa một R1 + một R2 sau khi remote resource/gateway/account lock được kiểm.

**Exit:** local fake-transport/recovery gate đã pass. Real Muse transport smoke,
remote release/preflight và reboot-level verification chưa xong; shadow 1.000
chưa được mở. Smoke là run riêng với caps, không phải promotion test.

### Chặng C — Shadow 1.000

1. Preflight source/gateway/lock/disk/memory/byte cap.
2. Freeze run config/cohort; start systemd với 8 worker toàn account.
3. Chạy R1 cho ready bundles; R2/expansion/repair theo schedule.
4. Reconcile unknown bằng history; finalize target statuses.
5. Audit Pilot A và positives/hard negatives theo cap.
6. Report final: elapsed/calls/latency/counts/gates/failures/unresolved.

**Exit:** đủ artifacts, dù gate semantic chưa đạt hoặc positives chưa đủ.
Không loop chờ đạt bằng cách gửi thêm ngoài cap; không auto-enable core apply.

### Chặng D — Mở rộng và phục vụ

Nếu batch đạt chất lượng, thu đủ holdout positives nếu thiếu, freeze policy và
triển khai DB4-D6/D7. Sau dry-run/rollback/serving tests mới apply canary theo
scope được duyệt; canary target là **100 proposals đã audit**, không 100 target
ngẫu nhiên chưa đủ điều kiện. Smoke API rồi mở rộng theo shard, có journal.

Nếu không đạt: đóng gate, báo loại lỗi và bước sửa cụ thể; không quay lại thử
30 cặp ngẫu nhiên liên tục mà không thay nguyên nhân input/retrieval/policy.

## 18. Ma trận kiểm thử

| Nhóm       | Tình huống cần kiểm                                    | Kết quả bắt buộc                                            |
| ---------- | ------------------------------------------------------ | ----------------------------------------------------------- |
| Sampling   | Lexeme có nhiều sense, old pilot lemma, thiếu quota    | Không leak holdout, không duplicate, counts thật            |
| Source     | Audit/version drift, source thiếu, target deleted      | Block/stale; không fake identity                            |
| Retrieval  | Chemical alcohol, physical come, multi-gloss compound  | Đủ lane/query trace; không claim whole exact từ một nhánh   |
| Identity   | Cùng label/definition nhưng khác proof                 | Không tự canonicalize concept                               |
| D1         | Extra field, missing candidate, foreign ID, bad hash   | Invalid; không silent strip/borrow row                      |
| R2         | R1 multiple exact/unresolved, R1 unique exact          | Skip có lý do hoặc fresh R2; denominator không mất          |
| Decision   | Unique consensus, disagree, competing exact            | D3 policy đúng; calibratedScore NULL                        |
| Expansion  | New shortlist + old R1, repeat expansion               | Reject cross-generation; cap một                            |
| Repair     | Semantic relation đổi, repair thứ hai                  | Guard/park; không tính format-only pass                     |
| Dispatch   | Crash trước intent, sau intent/trước ACK, sau raw save | Chưa gửi được resume; unknown không resend; completed reuse |
| Polling    | Completed malformed JSON, partial streaming JSON       | Raw hoàn tất lưu ngay; partial không đóng sớm               |
| Locks      | Hai runner cùng account/run                            | Runner thứ hai fail trước intent                            |
| Budget     | 5.001 mapping intents, repair/expansion vượt cap       | Không dispatch thêm; checkpoint/status đủ                   |
| Recovery   | History có reply hoặc không tìm được                   | Bind raw đúng job hoặc giữ unknown                          |
| Integrity  | Path escape, symlink, oversized file, tampered event   | Fail trước quyết định/dispatch                              |
| Audit      | Missing/foreign/duplicate/stale row, severe            | Gate fail; không dùng exit 0 làm quality pass               |
| Replay     | Cùng artifact chạy nhiều lần, frozen v1 CLI            | Hash không đổi, không call Muse                             |
| D6 sau này | Reapply, writer drift, partial shard, rollback         | No-op/journal/ownership đúng                                |
| D7 sau này | Nonexact, low confidence, stale view, duplicate pairs  | Không ghép sai; refresh/index/API đúng                      |

Lệnh kỹ thuật dự kiến dùng các test hiện có + suite mới khi viết code:

```bash
npx tsc -p tsconfig.db4.json
node --import tsx --test scripts/db4/contract.test.ts scripts/db4/retrieval.test.ts scripts/db4/decisions.test.ts scripts/db4/audit.test.ts
python3 -m unittest discover -s scripts/db4 -p 'test_*.py'
```

Lint/format scoped tất cả file mới/sửa; không reset DB để kiểm docs. Các test
DB4-D6/D7 cần isolated DB target và test migration riêng, chưa thuộc shadow.
Lệnh trong phần này là kế hoạch kiểm thử, không phải kết quả đã chạy lượt docs.

## 19. Theo dõi tiến độ và báo cáo

### 19.1 Progress đọc được khi job đang chạy

`progress.json` ghi atomically khoảng 10 giây/lần và mỗi checkpoint lớn:

- Run/shard/stage/current generation; updatedAt/heartbeat.
- Selected, blocked-source, identity-lane, no-candidate, ready counts.
- R1 completed/valid; R2 eligible/planned/dispatched/completed/valid.
- Expansion used; repair used; unknown transport; pending/active jobs.
- Exact proposals, ambiguity, disagreement, no exact, incomplete.
- Audit planned/completed/pass/fail/deferred/severe; gate status.
- Mapping/audit budget consumed/reserved/remaining; worker count/breaker state.
- Elapsed, completion rate, estimated remaining dạng khoảng nếu đủ quan sát.

Không cộng counts overlapping thành target tổng. Final terminal statuses phải
partition đúng selected targets; phase/request metrics báo bảng riêng.

### 19.2 Final report

- Selected denominator 1.000 hoặc số thực tế; split/strata và exclusions.
- Tổng calls theo R1/R2/expansion/format repair/audit, không chỉ calls success.
- Transport completion vs D1 validity vs exact proposal yield vs audit quality.
- Latency p50/p95/max, elapsed, recovery delay, CPU/RAM quan sát và cách đo.
- Token usage nếu có telemetry; thiếu thì `unknown`, bytes không đổi thành token.
- Gate Pilot A/B/recall/curation/confidence/apply/serving từng mục và lý do thiếu.
- Danh sách lỗi nổi bật + unresolved theo root cause, refs/hashes để replay.
- Git hash/source manifest, environment, deployed tools/core/app state riêng.

Qua đó người dùng chỉ cần hỏi tiến độ; agent đọc status/report trên VPS, không
cần mở laptop giữ browser hoặc đoán từ log cuối.

## 20. Ước lượng thời gian và calls

Mốc đã đo sample30: 60 request, 8 worker, 386,71 giây. Ngoại suy tuyến tính
**chỉ phần model transport** ở workload tương tự:

| Số ready senses | Hai phase mọi sense                 | R2 25% sense, chưa expansion/repair/audit |
| --------------- | ----------------------------------- | ----------------------------------------- |
| 1.000           | Khoảng 3 giờ 35 phút / 2.000 call   | Khoảng 2 giờ 14 phút / 1.250 call         |
| 15.000          | Khoảng 53 giờ 43 phút / 30.000 call | Khoảng 33 giờ 34 phút / 18.750 call       |

25% là kịch bản để tính, chưa đo tỷ lệ R2 thực tế. Công thức ban đầu:

```text
mapping calls = R1 initial + R2 initial + R1 expansion + R2 expansion + format repairs
model time rough = calls / 60 × 386,71 giây
total elapsed = export + index/retrieval + mapping + audit + recovery + finalize
```

Không coi đây là SLA. Prompt mới, queue Muse, rate limit, target complexity,
payload length và lỗi auth có thể thay đổi tốc độ. Retrieval cold 100-sense
pilot trước đây mất khoảng 22 phút; cache warm khoảng 51 giây trên workload
đó, không suy warm 1.000/15k bằng phép nhân khi chưa benchmark.

Tốc độ ưu tiên: reuse cache/index, R2 có chọn lọc, không polling invalid reply
đã complete, không khởi tạo browser mới, giảm call bị lặp sau crash. Không bỏ
source context hoặc tăng worker vượt giới hạn đã kiểm để lấy con số nhanh hơn.

## 21. Runbook

Runbook đã được triển khai tại
[`scripts/ops/db4-batch/README.md`](../../scripts/ops/db4-batch/README.md).
Tạo manifest smoke mới từ release đã commit; dùng cohort/export/generation đã
freeze nhưng run ID mới để request ledger và cap không trộn với lần preflight.

```text
install -d -o langoo -g langoo -m 0700 \
  /opt/langoo/storage/db4-batches/<cohort-id>/batch-runs/db4-smoke-<commit-short>

runuser -u langoo -- node --max-old-space-size=448 --import tsx scripts/db4/batch-prepare.ts \
  --artifact-dir /opt/langoo/storage/db4-batches/<cohort-id> \
  --run-id db4-smoke-<commit-short> \
  --sampling cohort/2026-10-10-v1/sampling.json \
  --generation generation/cohort-2026-10-10-v1/manifest.json \
  --export export/manifest.json \
  --output-prefix batch-runs/db4-smoke-<commit-short> --prompt-revision v2.1

runuser -u langoo -- node --max-old-space-size=448 --import tsx scripts/db4/batch-preflight.ts \
  --artifact-dir /opt/langoo/storage/db4-batches/<cohort-id> \
  --manifest batch-runs/<id>/run-manifest.json

systemctl start langoo-db4-batch@<id>.service  # smoke: R1 cap=1, R2 cap=1

batch-status --root /opt/langoo/storage/db4-batches/<id>

systemctl stop langoo-db4-batch@<id>.service

batch-resume --root /opt/langoo/storage/db4-batches/<id>

batch-report --root /opt/langoo/storage/db4-batches/<id>
```

`resume` chỉ tiếp tục job chưa dispatch và reconcile job unknown; không có
`--retry-all`/`--force-accept`/`--ignore-hash`. Default của toàn bộ shadow tooling
không ghi DB. Dry-run/apply/rollback thuộc CLI DB4-D6 riêng, không cài vào runner
Muse để một restart nhầm có thể đổi core.

## 22. Tiêu chí dừng và bước kế tiếp

| Tình trạng cuối                   | Kết luận                                  | Bước tiếp                                                |
| --------------------------------- | ----------------------------------------- | -------------------------------------------------------- |
| Technical pass, chưa đủ positives | Automation hoạt động; quality chưa đủ mẫu | Thu cohort holdout mới có cap                            |
| Technical pass, quality fail      | Pipeline có lỗi semantic                  | Sửa root cause, run version mới; promotion đóng          |
| Source/corpus không có exact      | Unmapped hợp lệ                           | Giữ nguyên sense; mapping concept bổ sung là scope riêng |
| Transport/auth blocked            | Chưa chạy xong                            | Recovery/login rồi resume đúng run                       |
| Quality đủ, D6/D7 thiếu           | Proposal có gate nhưng chưa production    | Journal/rollback/serving trước apply/serve               |
| Quality + D6/D7 đủ                | Có thể rollout phạm vi đã duyệt           | Canary rồi mở rộng shard, theo dõi rollback              |

Không gán một target `done` đồng nghĩa với mapped. `done_unresolved` là trạng
thái hoàn tất xử lý với lý do; còn unknown dispatch không được gọi là semantic
unresolved đã review.

## 23. Checklist giao việc

- [x] DB4-D2: cohort 1.000, source audit và hybrid RRF artifact đã freeze; drift cần re-export.
- [x] DB4-D4: v2.1 frozen + render/repair/validator version binding; offline tests pass.
- [x] DB4-D4: durable runner/recovery, intent ledger, raw completion, reconcile/locks qua fake transport tests.
- [x] DB4-D3/D4: envelope batch và conditional-R2 adapter, giữ D1/v1 replay.
- [ ] DB4-D2/D4: một retrieval expansion và một format repair/sense.
- [ ] DB4-D5: AI audit cap + full gate/denominator report.
- [x] DB4-D4/D5: initial-generation status/report/systemd/runbook và local technical tests.
- [x] DB4-D4/D5: remote read-only preflight; lazy-load runner + request loading pass trong sandbox systemd.
- [ ] DB4-D4/D5: transport smoke mới; service trước đó fail `EROFS` khi chmod thư mục account lock, unit fix chưa deploy.
- [ ] DB4-D4/D5: shadow 1.000, không apply.
- [ ] DB4-D5: đủ Pilot A/B; provenance/CI/recall, không giả human gold.
- [ ] DB4-D6: journal/preflight/dry-run/reapply/rollback/concurrency.
- [ ] DB4-D7: exact-only/curation/confidence/stale-safe refresh/API tests.
- [x] Commit/push foundation DB4-D4/D5 đúng phạm vi; follow-up memory fix sẽ commit riêng.

## 24. Nhật ký tài liệu

### 2026-10-10 — DB4-D3/D4 — Contract batch và conditional R2 foundation

- Thay đổi / lý do: thêm orchestration contract v1, event/hash-chain schema,
  deterministic job key và evaluator conditional R2 bọc pure D3. Giữ nguyên
  D1/D3 v1; không tạo two-pass decision khi R2 bị skip.
- File / phạm vi: `scripts/db4/_batch-types.ts`,
  `scripts/db4/muse-batch-decide.ts`; report
  [foundation DB4-D4/D5](../reviews/db4-d4-d5-batch-foundation-2026-10-10.md).
- Kiểm tra / kết quả: TypeScript, ESLint scoped, Prettier; 8/8 unit tests cho
  conditional R2/event hash chain và toàn bộ DB4 TypeScript suite 77/77 pass;
  chưa gọi model, chạy code trên VPS hoặc ghi DB.
- Gate còn thiếu: sampling selector, lexical/MiniLM fusion, artifact persistence,
  initial/conditional waves, durable runner/recovery, audit coordinator và full
  crash/transport test matrix. DB4-D2 selector/source audit/RRF cohort đã chạy.
- Git / triển khai: foundation code/test/plan/review commit `406c8b2` đã push;
  không deploy/apply.

### 2026-10-10 — DB4-D4/D5 — Mapping tự động theo batch có checkpoint

- Thay đổi / lý do: chốt triển khai từ các pilot nhỏ thành pipeline tự động có
  caps, cohort đại diện, conditional R2, expansion và audit trước promotion.
- File / phạm vi: plan này, liên kết trong plan DB4 tổng thể, D4 v2, D5 và
  `PROGRESS.md`; không thay source code/DB/ENV/service.
- Kiểm tra / kết quả: xem entry cùng ngày trong `PROGRESS.md`; chỉ format,
  link file nội bộ và whitespace của tài liệu. Không chạy model hoặc code tests.
- Gate còn thiếu: toàn bộ checklist §23; plan không phải implementation nghiệm thu.
- Git / triển khai: tài liệu local **chưa commit/push**; không deploy/apply VPS
  trong lượt này. Các pilot VPS cũ giữ nguyên artifacts và trạng thái trước đó.

### 2026-10-10 — DB4-D4/D5 — Durable batch runner, preflight và report

- Thay đổi / lý do: bổ sung runner Muse Native có intent bền vững, không tự gửi
  lại request outcome unknown, conditional R2 và cap theo lần chạy; preflight
  kiểm integrity/denominator chỉ đọc; final report giữ đủ target statuses và
  để Pilot A/B, promotion/apply ở trạng thái đóng.
- File / phạm vi: `scripts/db4/batch-preflight.ts`, `batch-validate.ts`,
  `batch-report.ts`, `muse-batch-runner.py`, `batch-prepare.ts` và tests;
  systemd/runbook ở `scripts/ops/db4-batch/`; báo cáo
  [review DB4-D4/D5 batch runner](../reviews/db4-d4-d5-batch-runner-2026-10-10.md).
- Kiểm tra / kết quả: read-only preflight full artifact — 1.000 selected, 966 ready,
  34 no-candidate, 1.932 requests, 10 shards, 78 artifact refs verified;
  exit 0, `apply=false`, `museCalled=false`; heap-capped run elapsed 2:20.34,
  max RSS 526.776 KiB (~514 MiB), 0 swap. Full tests and final scoped checks are recorded
  in the review.
- Gate còn thiếu: VPS preflight và transport smoke tối đa 1 R1 + 1 R2;
  expansion, format repair, Pilot A/B coordinator, shadow 1.000, semantic gate,
  D6/D7, DB apply và app deploy.
- Git / triển khai: trạng thái commit/push được ghi lại sau khi hoàn tất kiểm tra;
  VPS service chưa cài/chạy, app chưa deploy, DB chưa sửa.

### 2026-10-11 — DB4-D4/D5 — Nạp request theo phase để giảm RAM VPS

- Thay đổi / lý do: runner trước smoke giữ target/candidate JSONL và payload R1+R2
  đồng thời với Node preflight. Tách metadata/preflight khỏi nạp request; chạy
  chỉ nạp phase cần thiết và giải phóng payload trước Node D1 validator. R2 identity
  giờ đối chiếu schedule compact, không cần giữ R1 payload.
- File / phạm vi: `muse-batch-runner.py`, test runner, runbook, review và plan.
- Kiểm tra / kết quả: Python runner 13/13 tests và `py_compile` pass; remote
  manifest mới pass: 1.000 selected, 966 ready, 34 no-candidate, 1.932 requests,
  78 refs. Smoke đầu dừng ở memory 136 MiB trước ledger/dispatch; memory-safe
  service sau đó fail ngay ở account-lock directory `EROFS`, cũng trước dispatch.
- Gate còn thiếu: sửa/commit/push systemd `ReadWritePaths`, cài template mới,
  verify sandbox rồi chạy lại smoke tối đa 1 R1 + 1 conditional R2. Shadow 1.000,
  expansion, format repair, Pilot A/B, apply và deploy vẫn đóng.
- Git / triển khai: memory fix `cbe9e56` đã push. Unit lock-dir fix đang local;
  VPS có release/env/manifest `cbe9e56`, service instance failed nhưng không có
  ledger event/Muse call/DB write/app deploy.

### 2026-10-11 — DB4-D4/D5 — Cho runner ghi thư mục account lock trong sandbox

- Thay đổi / lý do: transient test cùng sandbox systemd tái hiện `EROFS`: runner
  chmod thư mục `/opt/langoo/storage/muse-native` để xác nhận mode riêng tư,
  trong khi unit chỉ cho ghi file lock. Thêm thư mục cha vào `ReadWritePaths`;
  cookie file vẫn được mount read-only.
- File / phạm vi: systemd template, runbook, plan/review và `PROGRESS.md`.
- Kiểm tra / kết quả: transient systemd lock test pass với quyền mới; runtime pin,
  full read-only preflight (78 refs) và nạp phase R1 pass trong sandbox. Cần chạy
  `systemd-analyze verify`, cài unit và retry transport smoke sau commit/push.
- Gate còn thiếu: áp template mới lên VPS, service smoke cap 1 R1 + 1 conditional
  R2; shadow 1.000, expansion, repair, Pilot A/B, apply và deploy vẫn đóng.
- Git / triển khai: `cbe9e56` đã push; template/runbook fix đang local. VPS unit cũ
  chưa được thay, service failed trước mọi ledger event/dispatch.
