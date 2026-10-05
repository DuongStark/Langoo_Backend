# DB3-B1 — Harvest cặp ví dụ Tatoeba (schema v1)

> Ngày: **2026-10-05** · READ-ONLY (không ghi DB) · contract: [`db3-b-example-schema-v1.md`](../plans/db3-b-example-schema-v1.md) · script: [`scripts/db3/example-candidates.ts`](../../scripts/db3/example-candidates.ts)
> Artifact gốc (gitignored): `uploads/db3b/examples-2026-10-05T11-08-24-241Z/` · bản commit: [`db3-b-example-summary-2026-10-05.json`](db3-b-example-summary-2026-10-05.json).

## 0. Cách chạy

```bash
DIRECT_URL="postgresql://postgres@127.0.0.1:55433/langoo" \
npx tsx scripts/db3/example-candidates.ts --artifact-dir uploads/db3b

# Kiểm chứng:
npx tsx scripts/db3/example-candidates.ts --verify uploads/db3b/examples-<stamp>
```

## 1. Kết quả

| Chỉ số | Số |
| --- | --- |
| Cặp JA↔VI unique (dedupe theo cặp không hướng) | **8.477** |
| `source_pair` (đủ điều kiện lineage/audit) | **8.477** |
| `blocked_source` | 0 |
| Cặp có **đủ 2 chiều link** (ja→vi và vi→ja) | 8.477 |
| Tổng directed link tham chiếu | 16.954 |
| `examples.jsonl` | **15.747.971 B** · sha256 `ba348e39cd57841daad42884af0845cc3d52fd777c3f423421fb2d12f8a98daf` |

- `datasetFingerprint` = `730c5bd3b08b37821cc47124ef2a75160decc0977ceb449a0c68067cbc6671ee` (B0).
- Evidence audit: source-audit `9852beb9b7cfce7a…` · inventory `e97d9daa7a154f04…` (hash đầy đủ trong JSON).
- Con số **8.477 khớp** kiểm kê DB3 (`db3-inventory-2026-10-05.md`) — trước đó chỉ là số ước lượng, giờ có artifact.

## 2. Kiểm chứng

- `--verify`: **re-parse toàn bộ 8.477 dòng** qua `parseExampleCandidate` (schema strict + recompute `inputHash`/`candidateKey` + kiểm lineage) → **pass, 0 lỗi**.
- **Deterministic**: chạy lần 2 ra thư mục khác → hash `examples.jsonl` **giống hệt** (`ba348e39…`).
- Test contract của GPT: `npx tsx --test scripts/db3/example-types.test.ts` → **3/3 pass**.
- Drift guard: row_count batch Tatoeba trong audit B0 (`872.814` link / `2.319.079` câu) phải khớp staging hiện tại, nếu không script dừng.

## 3. Quy tắc đã áp

- Nguồn `tatoeba` #10 — license **CC BY 2.0 FR**, attribution có, sha256 có; `version` trống nên đánh **snapshot = 2 import batch** (`86a34cbb…` links + `f778375e…` sentences, 2026-09-23) theo đúng schema (cho phép `version` **hoặc** `snapshot`), evidence = hash file source-audit B0.
  → Nếu ops không chấp nhận snapshot thay version, chỉ cần đổi audit sang `blocked` là toàn bộ chuyển `blocked_source` (schema cho phép cả 2; hiện tại tất cả `source_pair`).
- Mỗi candidate: 1 câu JA + 1 câu VI + **các link trực tiếp** giữ đúng hướng (dedupe link trùng), `alignment='unmapped'` — **không gán sense, không seed** `example`/`example_sense`/`example_translation`.
- Text giữ nguyên gốc (không normalize) + `textHash`.

## 4. Việc tiếp

1. `examples.jsonl` là artifact cho DB4/curator gán sense + chọn ví dụ hiển thị — chưa có bước nào tự động promote.
2. Khi B3/B4 chạy thật: cần key mới + reviewer JA–VI; example không nằm trong apply gloss.
3. Bản tổng hợp mới nhất của DB3-B (sau khi merge): candidates 15.245 · unresolved 34.758+5.368 · examples 8.477.
