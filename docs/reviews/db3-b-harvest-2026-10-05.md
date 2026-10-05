# DB3-B1 — Harvest candidate gloss v1 (snapshot full local)

> Ngày: **2026-10-05** · READ-ONLY (không ghi DB) · contract: [`db3-b-schema-v1.md`](../plans/db3-b-schema-v1.md) · script: [`scripts/db3/gloss-harvest.ts`](../../scripts/db3/gloss-harvest.ts)
> Artifact gốc (gitignored): `uploads/db3b/harvest-2026-10-05T10-02-08-778Z/` · bản commit: [`db3-b-harvest-summary-2026-10-05.json`](db3-b-harvest-summary-2026-10-05.json).

## 0. Cách chạy

```bash
# Cần artifact B0 (inventory + source-audit) trong --artifact-dir
DIRECT_URL="postgresql://postgres@127.0.0.1:55433/langoo" \
npx tsx scripts/db3/gloss-harvest.ts --artifact-dir uploads/db3b

# Kiểm chứng lại artifact (parse + recompute hash toàn bộ):
npx tsx scripts/db3/gloss-harvest.ts --verify uploads/db3b/harvest-2026-10-05T10-02-08-778Z
```

## 1. Kết quả (khớp B0)

| Lớp | Số | File |
| --- | --- | --- |
| **`needs_translation`** (queue B3) | **15.245** | `candidates.jsonl` |
| `eligible_source` | 0 | — |
| `ambiguous` (pivot lexical EN→JA/VI) | **34.758** | `unresolved.jsonl` |
| `blocked_source` (OMW #9) | **5.368** | `unresolved.jsonl` |
| `missing_context` | 0 | — |
| **Tổng candidate** | **55.371** | 75,4 MB JSONL |

## 2. File & hash

| File | Bytes | sha256 |
| --- | --- | --- |
| `candidates.jsonl` | 33.507.884 | `be7b6901aa30395f7468af998aa1a43ba85369043abfb4fb1f1075fa28dbd5d4` |
| `unresolved.jsonl` | 41.926.263 | `0c4d46e14bbf7467bf55e1838e304e650ea919864b0d0272e0fb74241f85b758` |

- `datasetFingerprint` = `730c5bd3b08b37821cc47124ef2a75160decc0977ceb449a0c68067cbc6671ee` (digest B0).
- Inventory evidence: `e97d9daa7a154f04…` · source-audit evidence: `9852beb9b7cfce7a…` (hash đầy đủ trong summary JSON).

## 3. Kiểm chứng

- `--verify` **re-parse toàn bộ 55.371 dòng** qua `parseGlossCandidate` (schema strict + recompute `inputHash`/`candidateKey`) → **pass, 0 dòng lỗi**.
- **Deterministic**: chạy lần 2 ra output khác thư mục → hash 2 file **giống hệt** (và counts giống).
- Contract test của GPT: `npx tsx --test scripts/db3/gloss-types.test.ts` → **14/14 pass** (gồm fixture 5 lớp + invalid bị từ chối).
- Drift guard: script dừng nếu scope/EN-gloss khác số B0 (buộc chạy lại B0 thay vì dùng fingerprint cũ).

## 4. Quy tắc đã áp

- **`needs_translation`**: mỗi sense JA trong scope; `semanticKey = sense.external_id` (`jmdict:<entry>:<sense>`);
  context = **toàn bộ EN gloss JMdict** của đúng sense, sort `rank` → bigint `glossId`; `alignment=same_sense_gloss`
  với `evidenceKeys=[sense-gloss:<glossId>…]`; source `jmdict` **verified** (CC BY-SA 4.0, 3.6.2, batch `f08e6b39…`)
  với evidence = hash artifact `source-audit` của B0.
- **`ambiguous`**: pivot EN→JA gặp EN→VI cùng `source_lexeme_id` + `sense_hint`; dedupe theo cặp
  `(ja_text, vi_text)` → **34.758** (con số 36.720 ở ước lượng trước là tổng combos *chưa* dedupe).
  `target=null`, `alignment=lexical_only`, nguồn `wiktextract` #8 **blocked** (thiếu version) — chuyển DB4/reviewer.
- **`blocked_source`**: 5.368 dòng `concept_gloss` VI từ `omw-wikt-vi` #9 (thiếu version + license chưa có số phiên bản,
  gloss nghi lemma) — giữ để audit/curator, **không gửi provider**.
- `missing_context`, `eligible_source` = 0 — đúng hiện trạng B0.

## 5. Việc tiếp

1. **B2 (GPT)** dùng `candidates.jsonl` (chỉ `needs_translation`) + `_gloss-types` job/validator; cache/checkpoint/apply trên DB test riêng.
2. `unresolved.jsonl` giữ cho DB4/curator; không apply.
3. **Example candidates (Tatoeba)** chưa có schema v1 trong contract — đề xuất shape riêng trước khi làm để khỏi lệch với B2/DB4.
4. Trước B3: rotate key, chỉ định reviewer, xác nhận muse khả dụng theo plan §5.1.
