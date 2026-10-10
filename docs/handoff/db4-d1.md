# DB4-D1 — Bàn giao contract mapping v1 — 06/10/2026

## DeepSeek đọc trước khi làm D2/D4

1. `docs/plans/db4-sense-concept-mapping.md` (§22 phân công) và
   `docs/plans/db4-schema-v1.md` (contract frozen).
2. Import types/helpers từ `scripts/db4/_mapping-types.ts`.
3. Đọc `scripts/db4/fixtures/cat-exact.json`, `director-compound.json`,
   `thin-uncertain.json`, `job.json`, `pilot.json` và `contract.test.ts`.
4. Chạy TypeScript, ESLint và Node tests theo spec. Không đổi shape để vừa input;
   báo trường hợp D0 thực tế không biểu diễn được trước khi tăng schema version.

## D2

- Hoàn tất D0 audit/version/license/identity thật trước đánh source eligible.
- Export toàn nhóm EN sense_gloss, raw POS/restrictions; definition language đúng.
- Sense keys dùng source code + external entry + sense anchor; concept keys giữ
  lexicon/synset/ILI. Không thay bằng numeric ID hoặc ILI đơn lẻ.
- `createMappingCandidate()` tính hash; `parseMappingCandidates()` chặn duplicate pair.
- `createMappingBundle()` chỉ ready, tối đa 5, giữ đủ source branches và loại rank/hypothesis.
- Output JSONL/export/shortlist manifest/chunk streaming thuộc D2, không sửa DB3-B types.

## D4

Prompt semantic v1 đã soạn ngày 08/10 tại
[DB4-D4 prompt/handoff](../plans/db4-d4-semantic-match-prompt-v1.md), giữ đúng
output/coverage/ref ownership D1; provider runner và semantic pilot chưa triển khai.

- Provider config/job/attempt/reservation/cache có trong D1. API keys lấy từ ENV DB4,
  không ghi vào checkpoint. Các executable CLI chưa được triển khai trong D1.
- Verify raw bytes từng artifact ref, bind bundle với generation và job với pilot manifest.
- R1/R2 render/cache khác phase; R2 không nhận R1 verdict hoặc lexical score.
- Reserve request+token+integer micro USD trước dispatch; unknown giữ reservation,
  dừng để reconcile, không retry tự động. Không xóa attempts để làm mới cap.
- Received chưa validated; dùng `parseMappingOutput()` trước đăng ký validated ref.
- D4 bổ sung append-only persistence/fsync/lock/recovery/HTTP mock/quota tests.
  Reconcile unknown cần evidence/audit thật trong runner, không overwrite ledger bằng patch.

## Trạng thái

D1 đã kiểm tra offline: TypeScript (`tsconfig.db4.json`), ESLint scope `scripts/db4`,
30/30 Node tests và `git diff --check` pass. Các test gồm identity/hash/provenance,
coverage/ambiguous exact, cache phase, reservation/cap, retry/unknown/history,
gate denominator và CLI target guard. Không chạy E2E DB hoặc provider live ở D1.

D1 đã có code/test local, chưa commit trong lượt này. Cần tích hợp cùng base và
DeepSeek review khả năng consumer trước mở D2/D4. Chưa có D0 full source audit,
retrieval/scorer/provider runner, pilot thật hay DB/VPS apply. Fixture là dữ liệu
synthetic, không chứng minh model dịch/mapping đạt chất lượng.

### 2026-10-08 — DB4-D2 consumer đã triển khai

Đoạn trạng thái trên là tại thời điểm bàn giao D1. Hiện có
[adapter source audit/MiniLM](db4-d2-source-minilm-retrieval-2026-10-08.md)
và [review smoke thật](../reviews/db4-d2-source-minilm-retrieval-2026-10-08.md):
100 sense → 345 candidate / 69 bundle, chưa semantic review/apply. Giữ contract
và orchestration parser D1; adapter CLI tên `retrieval-*`. Consumer D4 dùng
bundles/candidates bound, vẫn phải tạo job/pilot/provider/ledger riêng.

### 2026-10-10 — DB4-D3 consumer quyết định tự động

[DB4-D3 engine/CLI](../plans/db4-d3-auto-decisions.md) dùng artifacts D2/D4,
không đổi shape frozen D1/CLI `mapping-score`. D1 bổ sung helper
`createMappingDecisionParser(candidates,bundle,r1,r2)` bind/validate context
một lần và kiểm nhiều decision bằng cùng rule với parser từng decision.
Context parse private không bị caller mutate; không mở API/ENV/DB write.

Consumer import/promote đọc `decisions.jsonl` và `exact-proposals.jsonl` qua
manifest D3 hash-bound, rồi kiểm D5 và actual-target preflight D6/D7.
20 exact proposals chưa là link promoted; machine không verified/curator.
Missing phase chỉ có sidecar incomplete, không phải decision với hash tự tạo.
[Report D3](../reviews/db4-d3-auto-decisions-2026-10-10.md).
