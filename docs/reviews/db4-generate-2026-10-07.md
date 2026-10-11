# DB4 — D2 `mapping-generate` (retrieval offline) · 2026-10-07

> Script: [`scripts/db4/mapping-generate.ts`](../../scripts/db4/mapping-generate.ts) (offline, không LLM, không ghi DB — chỉ đọc legacy G1)
> Artifact: `uploads/db4/candidates/cb5ef09ed496b543-db4-gen-v1/` (pairs 664MB, không commit)
> Summary: [`db4-generate-summary-2026-10-07.json`](db4-generate-summary-2026-10-07.json)

## 1. Kết quả

| Chỉ số | Giá trị |
| --- | --- |
| Sense xử lý | **15.245 / 15.245** (JLPT) |
| Candidate | **75.660** (~4,96/sense, cap 5) |
| Sense không có candidate (`unresolved`) | **46** (0,3%) |
| Concept dùng | 35.121 |
| Nhánh | G1 legacy 8.275 · G3 label 37.957 · G4 definition 50.605 |
| Legacy hint bị bỏ (concept không có synset oewn) | 261 |
| Thời gian / kích thước | ~366s · 664MB |

- Cấu hình v1: `db4-gen-v1` / rank `db4-rank-v1`; branch topK 40 → union 40 → rerank 12 → **shortlist ≤5**; G1 boost 0.05; IDF theo tần suất posting; tokenizer `db4-en-token-v1`.
- Determinism: chạy lặp 3 lần cho cùng bytes — `pairs sha f55c2f6b…`, `unresolved sha 1b16545b…`, `summary sha b81340c65bb4`; rerun idempotent (so bytes summary, giữ nguyên artifact cũ).

## 2. Kiểm tra chất lượng (ví dụ)

| Sense | Kết quả top | Ghi chú |
| --- | --- | --- |
| 猫 `jmdict:1467640:1` | #1 concept 58322 "domestic cat"; #3 concept 58321 (legacy, cat family) | legacy không còn là #1 — retrieval chọn đúng "domestic cat" hơn |
| 本 `jmdict:1522150:1` ("book; volume; script") | **#1 concept 63166 ["book","volume"]** (g1+g3) | legacy cũ gán sai concept 9066 (base/radix) — không nằm trong top 5 |
| 食べる `jmdict:1358280:1` | #1 concept 37052 "eat a meal" (g1+g3+g4) | |
| Validator | 5/5 candidate đầu parse qua `parseMappingCandidate` (hash/lineage OK) | |

## 3. Hạn chế đã biết (cho R1/R2 + v2)

- **G4 nhiễu đa nghĩa**: gloss EN gộp nhiều nghĩa ("book; volume; script") → token "script" kéo theo concept "script/write" vào shortlist (rank 2–5 của 本). Đây chính là việc 2 lượt review lọc bằng relation `none`.
- **46 unresolved = gloss toàn stopword/function word** ("to be", "you", "these") — index loại stopword nên 0 token. Function word được phép unresolved (plan §8.2), nhưng v2 có thể thêm nhánh full-string label khi gloss ≤2 token.
- Chưa dùng **G2 (JA anchor omw-ja)** vì license blocked; chưa dùng G5/G6.

## 4. Chạy lại

```bash
DIRECT_URL="postgresql://postgres@127.0.0.1:55433/langoo" \
npx tsx scripts/db4/mapping-generate.ts --artifact-dir uploads/db4 \
  --export exports/cb5ef09ed496b543158ad216e262df71d285a3c7a7a9fdd61cc16ba76201b1ca/manifest.json
# --limit N để smoke (thư mục generation có hậu tố -limitN)
```

## 5. Tiếp theo

1. **Bundles**: gom candidate per sense (≤5 ready) → `bundles/<generation>/bundles.jsonl + manifest.json` (builderVersion v1) — bước đệm cho D4.
2. **D4 runner**: provider longcat R1/R2 + cache/checkpoint (mock trước) → Pilot A 100 sense.
