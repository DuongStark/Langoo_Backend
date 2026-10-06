# DB4 — Inventory & audit D0 (snapshot full local)

> Ngày: **2026-10-06** · READ-ONLY (không ghi DB, không gọi LLM) · script: [`scripts/db4/mapping-inventory.ts`](../../scripts/db4/mapping-inventory.ts)
> Artifact gốc: `uploads/db4/inventory/2026-10-06T09-38-14-260Z/` — bản commit: [`db4-inventory-2026-10-06.json`](db4-inventory-2026-10-06.json), [`db4-source-audit-2026-10-06.json`](db4-source-audit-2026-10-06.json), [`db4-legacy-audit-2026-10-06.json`](db4-legacy-audit-2026-10-06.json).
> Plan: `docs/plans/db4-sense-concept-mapping.md` (phiên plan giữ ở worktree chính, chưa commit trên nhánh này) · Baseline tham chiếu: `docs/reviews/db4-baseline-2026-10-06.json` (worktree chính).

## 0. Cách chạy

```bash
DIRECT_URL="postgresql://postgres@127.0.0.1:55433/langoo" \
npx tsx scripts/db4/mapping-inventory.ts --artifact-dir uploads/db4
```

## 1. Fingerprint

- DB `langoo` @ `127.0.0.1:55433` (full local) · PostgreSQL 16.2 · migrations **36** (mới nhất `037_chat_request_lease.sql`).
- Ngôn ngữ: EN 1.811.065 lexeme / 2.206.691 sense · **JA 512.279 / 649.026** · VI 51.896 / 62.237.
- Phạm vi v1: **15.245 sense JLPT** (7.285 primary / 7.960 secondary).

## 2. Lớp legacy

| Hạng mục | Kết quả | Ghi chú D0 |
| --- | --- | --- |
| `sense_concept` | 577.525 — 100% `exact` + `verified` | **0 cho JLPT** |
| Nguồn link | oewn 212.478 · omw-en 206.978 · omw-ja 158.069 | 63% link đến từ OMW (license chưa rõ — xem §4) |
| Candidate | 685.757, tất cả `pending` | EN 535.419 pair/260.489 sense · JA 150.338/59.863 |
| Candidate cho JA theo method | `wikt_exact_lemma_pos_wordnet` 105.119/46.784 · `jmdict_form_pos_wordnet_ja` 45.219/**13.079** | phương pháp JMdict phủ đúng tập JLPT |
| JLPT chưa có candidate | **2.166 sense** | G2–G4 phải sinh bù hoặc `no_candidates` |
| Pair/sense JLPT | 45.219 pair / 13.079 sense (~3,5; cap 5) |  |
| Evidence candidate | keys: `lexeme_id`, `source`, `wordnet_method` (chỉ JA) | provenance **mỏng**: `source` là chuỗi (vd "JLPT"), không có source_id/batch/hash |
| `candidate.llm_result` | 1.200/685.757 có dữ liệu | phần còn lại rỗng |

## 3. Legacy review (LLM cũ)

- Tổng **3.200** review, reviewer `jev-1.13-free`, provider `opencode_zen`, 4 run (`semantic_llm_jlpt_review`, `..._noul_validation`, `..._validation`).
- `artifact_hash` = **prompt_hash** trong `result` (cùng 1 giá trị cho cả run) — **không phải hash file artifact content**; chưa định vị được file gốc ⇒ giữ `legacy_unverifiable` cho các lượt không có `relation`.
- Chỉ **1.000 lượt** (run 17) có `relation`: none 644 · related 175 · uncertain 113 · narrower 26 · broader 22 · **exact 20**; 2.200 lượt còn lại `relation NULL` (không diễn giải NULL thành `none`).

## 4. Source audit (DB4)

| id | code | license | version | Ghi chú |
| --- | --- | --- | --- | --- |
| 5 | oewn | CC BY 4.0 | 2024 | ✅ dùng được (EN) |
| 4 | cili | CC BY 4.0 | 1.0 | ✅ map ILI |
| 6 | omw-ja | **"ghi nguồn"** | 1.4 | ⛔ **blocked** tới khi audit license thật (OMW per-wordnet) |
| 7 | omw-en | **"ghi nguồn"** | 1.4 | ⛔ **blocked** tương tự |
| 16 | wordnet-stack | "nhiều (xem từng wordnet)" | wn 1.1.1 | hash chung `76a86feb…` cho cả 4 nguồn — cần snapshot/hash **từng lexicon** |
| 1 | jmdict | CC BY-SA 4.0 | 3.6.2 | ✅ (context sense JA) |

- Concept gloss: EN 124.462 · JA 67.071 · VI 5.368 — đủ định nghĩa EN cho retrieval/LLM.
- **Hệ quả nếu omw-ja/en vẫn blocked**: G2 (JA anchor) không dùng được; pilot phải dựa G1/G3/G4 (legacy + EN labels/definition). Cần audit license OMW JA/EN trước D2 nếu muốn giữ nhánh JA.

## 5. View audit

- `serve.sense_pair`: **0 dependent** (chỉ chính nó) → D7 rebuild trong transaction được, không phải recreate object phụ.
- Unique index `sense_pair_pair (sense_a, sense_b)` **không khớp** SELECT (có `concept_id`) → đúng cảnh báo plan: cần dedupe `(sense_a,sense_b)` khi thêm relation mới; view hiện **chưa lọc `relation='exact'`**.
- `TODO D7`: `serve.sense_card` + `sense-lookup/deck` repositories cần exact-gate/recheck stale (thuộc GPT/integrator).

## 6. Đề xuất export (D2)

- Targets: 15.245 sense JLPT (kèm 41.123 EN gloss rows).
- Candidates: 45.219 pair (shortlist ≤5/sense).
- Concept context: 120.875 concept (100% có `gloss_en`; 124.462 dòng `concept_gloss` EN).
- Ước tính call pilot: 100 sense × 2 lượt = 200 (+retry) — longcat free, không đụng quota.

## 7. Việc tiếp

1. **D1 (GPT)**: `_mapping-types.ts` + contract/fixture v1; mình review phần harvest/runner.
2. **D2 (mình)**: export sense/concept context + retrieval generator G1–G4 + token index; audit license OMW JA/EN song song.
3. **D4 (mình)**: runner/cache/checkpoint + mock; sau đó Pilot A longcat (2 lượt).
