# DB4-D3 — Bộ quyết định mapping tự động

Ngày: 2026-10-10. Phạm vi được duyệt: code decision engine và chạy trên pilot
Muse đã có. Không gọi model thêm, không import/promote DB hoặc deploy app.

## Quyết định và policy

Policy: `db4-d3-consensus-exact-v1`. R1/R2 là hai lượt cùng Muse;
consensus chưa là accuracy đã đo. Không yêu cầu người vận hành duyệt từng mapping.

- `accept_exact`: cùng candidate là exact duy nhất ở cả hai phase, đủ branch,
  không conflict hoặc unresolved. Khác lời giải thích/thứ tự candidate hoặc
  bất đồng nhãn nonexact ở candidate phụ không tự loại exact này.
- `accept_nonexact`: đồng ý broader/narrower/related, không unresolved. Proposal
  lưu riêng, không ghép tương đương hoặc đưa vào exact-proposals v1.
- `reject_pair`: cả hai none và không unresolved; chỉ loại cặp trong run này.
- `defer`: có unresolved bất kỳ phase hoặc relation bất đồng. Không xóa lý do
  unresolved kể cả khi cả hai all-none; giữ đúng contract D1.
- Thiếu phase: sidecar `incomplete`, không tạo MappingDecision/output hash giả.
  All-none là `no_suitable_shortlist`, không kết luận toàn corpus thiếu concept.
- Input/output/file refs bị sửa, mất binding, duplicate hoặc thiếu denominator:
  fail trước ghi output.

LLM confidence và MiniLM rank không là threshold nhận mapping. Proposal máy
giữ `verified=false`, `calibratedScore=null`. D5/D6/D7 còn phải triển khai trước
production auto-apply; engine không tự cấp quality gate/curator status.

## Code và contract

- [`_decisions.ts`](../../scripts/db4/_decisions.ts): pure policy, bound D1 decisions.
- [`muse-review-decide.ts`](../../scripts/db4/muse-review-decide.ts): CLI verify
  generation/candidates/bundles/sources/prompt/render/response/normalized outputs
  và denominator. Request payload lớn được kiểm từng dòng, chỉ giữ binding metadata.
- [`_mapping-types.ts`](../../scripts/db4/_mapping-types.ts): thêm
  `createMappingDecisionParser()` bind/parse context một lần/bundle; dùng chung
  rule với `parseMappingDecision()`. Không đổi schema D1. Closure giữ bản parse
  riêng, caller không mutate được input đã bind.
- [`decisions.test.ts`](../../scripts/db4/decisions.test.ts): regression policy,
  integrity, partial ledger, immutable rerun, giới hạn và parser tương đương.

Adapter có positional CLI riêng; không thay `mapping-score` orchestration frozen
D1. API/ENV/dependency/migration không đổi.

```bash
npx tsx scripts/db4/muse-review-decide.ts \
  uploads/db4-d2-pilot \
  muse-d4-v1/manifest.json \
  muse-d4-v1/validated/1b03b68ea623/summary.json
```

Path sau root phải tương đối dưới artifact root. CLI không nhận `--apply`, key
hoặc cờ override policy. Giữ generation, source proof, prompt/requests, final
response ledger và normalized validation files để rerun.

Tối đa 500 target/generation và 64 MiB/file; batch lớn hơn phải chia ở upstream
D2/D4. Đây là giới hạn đọc, chưa là benchmark tối ưu VPS. Cùng inputs tạo cùng
runKey/hash; file có sẵn phải đúng bytes mới reuse. Manifest được ghi cuối.
Rerun tạo tiếp file thiếu; file bị sửa thì fail, không overwrite original.

## Artifact cho consumer

Output trong `muse-d3-v1/<runKey>/`, schemaVersion 1:

| File                    | Nội dung                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `bundles.jsonl`         | Một trạng thái/bundle, selected IDs nullable, output hashes, reasons, candidate decisions            |
| `decisions.jsonl`       | `{bundleKey,senseId,decision,decisionHash}`; decision đúng MappingDecision D1                        |
| `exact-proposals.jsonl` | Chỉ exact duy nhất, sense/candidate/concept keys, decisionHash, verified=false, calibratedScore=null |
| `manifest.json`         | Policy/run/input refs/file refs, counts, quality/apply/promotion flags và gate thiếu                 |

Manifest giữ status retrieval D2, target không có bundle vẫn được đếm.
Không gọi exact-proposals là link đã accepted trong DB hoặc đã served.
D6 verify files/binding/gate, kiểm actual DB/nguồn/existing links và journal trước
promote. Fixture mode không promote production. Nonexact/rejected/deferred không
được ghép tương đương. Không fabricate confidence để qua serving gate.

## Kiểm tra và trạng thái

Kiểm: Node tests DB4, `tsc -p tsconfig.db4.json`, scoped ESLint/Prettier,
`git diff --check`. Kết quả thực tế và Git/triển khai trong
[report DB4-D3](../reviews/db4-d3-auto-decisions-2026-10-10.md).

Chặng này là engine/proposal artifacts local. Quality D5, apply/journal D6,
serving D7 và VPS orchestration tiếp tục ở chặng tương ứng.
