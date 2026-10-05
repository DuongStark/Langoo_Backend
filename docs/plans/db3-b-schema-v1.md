# DB3-B — Contract candidate/job v1 (bàn giao B1 ↔ B2)

> Ngày: 2026-10-05. Interface triển khai tại [`_gloss-types.ts`](../../scripts/db3/_gloss-types.ts), dùng Zod sẵn có; không cần migration/dependency mới.
> Phạm vi phiên này: schema, validator, fixture và kiểm tra offline. B0 do DeepSeek đã hoàn thành ở worktree dữ liệu; chưa gọi provider hoặc apply gloss.

## 1. Cách B1 xuất artifact

```ts
import {
  createGlossCandidate,
  hashGlossText,
  type GlossCandidateInput,
} from './_gloss-types';

const input: GlossCandidateInput = /* dữ liệu target/context/source đã đọc */;
const candidate = createGlossCandidate(input);
// Ghi JSON.stringify(candidate) + '\n' vào candidates.jsonl hoặc unresolved.jsonl.
```

- Dùng `schemaVersion: 1`. Tất cả field của từng variant bắt buộc; trường chưa có dùng `null`/`[]` theo schema. Không dùng `undefined`, không tự thêm field.
- ID PostgreSQL bigint (`targetId`, `lexemeId`, `glossId`, `senseId`, `conceptId`) là **chuỗi số thập phân dương**, không qua `Number`; source ID/int, rank, JLPT là số nguyên đúng miền.
- `datasetFingerprint` lấy nguyên `summary.fingerprint.dataset_digest` của B0, hiện là `730c5bd3b08b37821cc47124ef2a75160decc0977ceb449a0c68067cbc6671ee`. Đây là digest baseline B0; hash context của từng candidate bổ sung kiểm tra nội dung cụ thể, không chứng minh bigint ID dùng được trên DB khác.
- `target` gồm targetType/targetId/semanticKey và metadata tương ứng. Với sense, ưu tiên semanticKey từ **source code + sense external identity hiện hữu**, giữ lexeme ID/senseNo; không dùng lemma đơn lẻ để resolve. Nếu không có source identity, báo unresolved, không đoán mapping sang VPS.
- `context.rows` giữ text gốc và `textHash: hashGlossText(text)`; EN gloss xếp **rank rồi gloss ID theo bigint**, không sort ID theo chuỗi. `context_kind/context_language` phải khớp rows. Không ghép row từ sense khác. B1 cần đọc đủ mọi EN gloss của mỗi sense, không chỉ `serve.sense_card.gloss_en` đã LIMIT 1.
- Mỗi context row tham chiếu `sourceCode` tới đúng phần tử `sources`, chứa sourceId/version/snapshot/hash/license/attribution/URL. `batchId` phải có trong source.batchIds. Định danh row gốc là glossId hoặc senseId/conceptId cho definition.
- Nguồn verified cần đủ metadata, version **hoặc** snapshot, hash và audit evidence. Source thiếu metadata giữ `audit.status='blocked'` kèm lý do; không ghi verified chỉ vì có chữ license. Evidence có path tương đối và hash của artifact audit thật; fixture không phải bằng chứng audit production.
- Sắp sources theo code, batchIds/evidenceKeys/forms theo thứ tự ổn định trước tạo candidate; giữ thứ tự context đã quy định. `createGlossCandidate()` tự tạo inputHash/candidateKey và kiểm tra lineage. Chạy lại cùng snapshot phải cho cùng candidate/hash.

## 2. Năm lớp candidate

| classification      | target/context                       | sourceGlossVi                               | Điều kiện                                                         |
| ------------------- | ------------------------------------ | ------------------------------------------- | ----------------------------------------------------------------- |
| `needs_translation` | Target xác định, context không null  | null                                        | Source verified, alignment rõ, blockedReasons=[]                  |
| `eligible_source`   | Target xác định; context có thể null | VI text không rỗng, ≤500 Unicode code point | Nguồn VI/alignment có chứng cứ; EN context không tự chứng minh VI |
| `ambiguous`         | Cho phép target=null/context=null    | null hoặc lexical VI có nguồn               | Lý do bắt buộc; pivot text không chọn primary tự động             |
| `missing_context`   | Target có thể null, context=null     | null hoặc text để audit                     | Lý do bắt buộc; không vào translator                              |
| `blocked_source`    | Target/context có thể null           | null hoặc text để audit                     | Lý do bắt buộc; không gửi provider/apply                          |

`alignment.method`: `same_sense_gloss`, `direct_source`, `accepted_mapping`, `existing_alignment`, `lexical_only`, `none`. `evidenceKeys` giữ khóa/source row hoặc identity của assertion/mapping; không chứa SQL. Candidate sẵn sàng không chấp nhận lexical_only/none hoặc thiếu evidence.

Theo B0: B1 xuất **15.245 sense JA needs_translation**, EN context JMdict #1, với điều kiện audit từng nguồn đạt; không cần definition JA. Eligible VI hiện 0. Pivot EN→JA/VI chưa mapping xuất ambiguous với target=null; dữ liệu OMW thiếu snapshot/license version giữ blocked_source. Nếu inventory/content đổi, cập nhật baseline và báo count thay vì ép đủ 15.245.

Fixture [`candidates-v1.jsonl`](../../scripts/db3/fixtures/gloss/candidates-v1.jsonl) có đủ năm lớp, một sense có nhiều EN gloss, POS và ID lớn. [`invalid-candidates-v1.jsonl`](../../scripts/db3/fixtures/gloss/invalid-candidates-v1.jsonl) phải bị từ chối. Các ID/text/audit trong fixture là **giả lập**, không seed lên DB thật.

## 3. Hash và phiên bản

- Canonical JSON sort key của object, giữ nguyên thứ tự array và text gốc; SHA-256 UTF-8, hex thường 64 ký tự. Không tự normalize input trước khi hash; NFC/trim dùng ở apply phải giữ input gốc trong provenance.
- Input hash bao gồm version, dataset, target metadata, ordered context, sources/audit, alignment và sourceGlossVi. Candidate key dùng version/dataset/target/input hash. Classification/notes/blockedReasons là trạng thái báo cáo, không nằm trong semantic input hash.
- Parser xác nhận lại hash, không tin hash được ghi trong JSONL. Muốn thay context/nguồn phải tạo candidate mới bằng helper, không sửa hash bằng tay.
- Cache key thêm provider/baseUrl/protocol/model/promptVersion. Job key đóng băng snapshot/provider/session/caps và danh sách candidate key/input hash theo thứ tự; đổi các field này là job mới. Trạng thái/attempt/child journal không đổi job key.
- Consumer chỉ nhận version 1; thay contract không tương thích phải tăng version, thêm fixture/validator và bàn giao cả hai bên trước khi đổi reader/writer.

## 4. Contract job cho B2

- Dùng `createGlossJob()` rồi `parseGlossJob()` khi resume. Fixture [`job-v1.json`](../../scripts/db3/fixtures/gloss/job-v1.json) có một entry pending, provider stub; snapshot lưu host/port/database, không lưu connection string/auth.
- Provider là cấu hình **không secret**: name, baseUrl, protocol (`responses` hoặc `chat_completions`), model và promptVersion; không hardcode model/quota vào schema. Các quyết định provider hiện hành lấy từ [plan DB3-B](db3-b-vietnamese-gloss.md).
- Session UUID cố định cho job; caps gồm maxRequests/maxTokens nullable/maxCostUsd và concurrency=1. Attempt count ghi **trước request**, gồm retry/unknown; mỗi attempt có số thứ tự, thời điểm và outcome. `response` phải trỏ artifact thật khi outcome=response. Smoke phải được ghi vào job riêng và trừ khỏi budget chung trước tạo job dịch; không lẩn vào request cap của cả đợt pilot.
- Chỉ entry running có một attempt in_flight cuối cùng. Generated/validated/applied cần output; validated/applied cần validation passed và gloss khác null. State này là **code validation**, không phải human review và không cho phép ghi reviewed fields.
- Child runKey/journalPath/inputHash được đăng ký trước mutation; entry applied cần child applied. Job schema chỉ kiểm tra dữ liệu checkpoint; B2 vẫn phải đọc journal/DB để xác nhận transaction thật và phục hồi cửa sổ COMMIT/checkpoint.
- **Bắt buộc gọi `validateGlossJobCandidates(job, candidates)` trước request/apply/resume**: so dataset/key/input hash/classification và output target. Translator chỉ nhận needs_translation; eligible_source dùng đường apply nguồn riêng.
- `parseGlossOutput(output, target)` chỉ nhận `target_type`, `target_id`, `gloss_vi`, `reason`. Null gloss cần reason, không apply; từ chối ID/type khác target, extra field/confidence, text rỗng hoặc >500 Unicode code point.
- Artifact paths tương đối với `--artifact-dir`, không nhận absolute/traversal. B2 kiểm tra filesystem/symlink, quyền 0600, atomic/fsync và hash **trước khi đọc lại artifact**; validator không truy cập file, không chống symlink hoặc xác thực source thay con người.
- Actual token/cost usage có thể vượt cap do provider trả sau request: giữ số thật để audit, runner phải dừng. Không xóa bớt attempt/usage để schema pass; không tự đổi provider/model hay tăng cap để resume.

## 5. Bàn giao và kiểm tra

```bash
npx tsx --test scripts/db3/gloss-types.test.ts
npx tsc --noEmit --strict --skipLibCheck --target ES2023 --module commonjs --esModuleInterop scripts/db3/_gloss-types.ts scripts/db3/gloss-types.test.ts
npx eslint scripts/db3/_gloss-types.ts scripts/db3/gloss-types.test.ts --max-warnings 0
```

DeepSeek nhận commit interface vào branch B1 trước khi import module. GPT sở hữu `_gloss-types.ts`/validator/job; DeepSeek sở hữu harvest và fixtures nguồn mới, không sửa shape v1 trực tiếp. B1 báo total/unique/hash theo từng lớp, invalid bị từ chối và source audit paths để B2 nối queue. Không cần chờ full B2 hoặc gọi API thật để bắt đầu harvest.
