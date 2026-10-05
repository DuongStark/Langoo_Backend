# DB3-B — Example candidate v1 cho DeepSeek

Contract riêng [`_example-types.ts`](../../scripts/db3/_example-types.ts); **gloss v1 giữ nguyên**. B1 dùng `createExampleCandidate(input)`/`parseExampleCandidate(row)` và type `ExampleCandidateInput`. Ví dụ input đầy đủ trong [`example-types.test.ts`](../../scripts/db3/example-types.test.ts).

- `schemaVersion=1`, `candidateType='example_pair'`, `datasetFingerprint` lấy B0.
- `ja`/`vi`: sentenceId bigint-string, language cố định ja/vi, text gốc, textHash=`hashGlossText(text)`, sourceCode, batchId của **sentence import**.
- `links[]`: sentenceId/translationId giữ hướng thực từ staging.tatoeba_link, sourceCode và batchId của **link import**. Chỉ cạnh trực tiếp nối hai câu đó; giữ cả hai hướng nếu raw có, không tự sinh hướng ngược hoặc pivot qua EN.
- `sources[]`: GlossSource v1, batchIds gồm các batch sentence/link được dùng; thiếu snapshot/license evidence vẫn xuất artifact với `classification='blocked_source'` và blockedReasons. Chỉ source audit đạt mới dùng `classification='source_pair'`, blockedReasons=[].
- `alignment='unmapped'` bắt buộc; không có sense_id/concept_id/verified/confidence trong contract này. Một cặp dịch có nguồn chưa chứng minh câu minh hoạ sense nào; DB4/curator xử lý sau.
- `notes[]` lưu cảnh báo, không thay evidence. Helper tự tạo inputHash/candidateKey; parser xác nhận hash, text/source/batch/link endpoints và không nhận extra fields.
- Dedupe theo `(JA sentence ID, VI sentence ID)`, không theo text. Tách counts raw directed links, cặp JA–VI unique, source_pair và blocked_source. Số **8.477 cặp tham chiếu cũ cần đối chiếu định nghĩa dedupe/direction**, không ép count sau dedupe bằng số cũ nếu query khác.
- Để deterministic: sort pair theo bigint JA rồi VI; links theo bigint sentenceId/translationId; sources theo code; batchIds/evidence theo thứ tự ổn định. Không dùng Number để sort ID.
- Xuất `example-candidates.jsonl`, `example-summary.json` gồm fingerprint/counts/input file hashes/output SHA-256/source audit evidence. Chạy hai lần cùng snapshot cho cùng hash, verify parse toàn bộ rows.
- **Chỉ artifact, không seed ví dụ, không gọi LLM.** Không sửa _gloss-types hoặc tự thêm mapping field; mọi thay shape không tương thích cần version mới.

Kiểm tra: `npx tsx --test scripts/db3/example-types.test.ts` (Node 22). B2 translator/apply gloss không nhận artifact family example_pair.
