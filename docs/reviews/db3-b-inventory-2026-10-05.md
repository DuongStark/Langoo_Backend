# DB3-B0 — Kiểm kê gloss/nguồn (snapshot full local)

> Ngày: **2026-10-05** · READ-ONLY (không ghi bảng nghiệp vụ) · script: [`scripts/db3/gloss-inventory.ts`](../../scripts/db3/gloss-inventory.ts)
> Artifact gốc: `uploads/db3b/2026-10-05T09-29-37-673Z-{gloss-inventory,source-audit}.json` — bản commit:
> [`db3-b-inventory-2026-10-05.json`](db3-b-inventory-2026-10-05.json) · [`db3-b-source-audit-2026-10-05.json`](db3-b-source-audit-2026-10-05.json).

## 0. Cách chạy

```bash
DIRECT_URL="postgresql://postgres@127.0.0.1:55433/langoo" \
npx tsx scripts/db3/gloss-inventory.ts --manifest-dir uploads/db3b
```

## 1. Fingerprint

- DB `langoo` @ `127.0.0.1:55433` (bản full local) · PostgreSQL 16.2 · migrations **36** (mới nhất `037_chat_request_lease.sql`).
- Dataset digest: `730c5bd3b08b37821cc47124ef2a75160decc0977ceb449a0c68067cbc6671ee`.
- Source hashes dùng cho digest: jmdict `8cdbb0cc9625f775`, omw-wikt-vi `2f74ee9d80a96aeb`, wiktextract `de6533a7bc714316`, tatoeba `b4d467dc5108b861`, jlpt-list `8863a96442adeadf`… (đầy đủ trong JSON).

## 2. Phạm vi JLPT (accepted, cấp duy nhất = MAX(source_level), N5 → N1)

| Cấp | lexeme | sense | primary | sense có definition |
| --- | --- | --- | --- | --- |
| N1 | 2.567 | 4.334 | 2.567 | 0 |
| N2 | 1.513 | 2.705 | 1.513 | 0 |
| N3 | 2.011 | 4.611 | 2.011 | 0 |
| N4 | 568 | 1.613 | 568 | 0 |
| N5 | 626 | 1.982 | 626 | 0 |
| **Tổng** | **7.285** | **15.245** | **7.285** | **0** |

- 46 lexeme nhiều cấp **trong accepted** (132 nếu tính mọi trạng thái `jlpt_link` — theo `verify-jlpt` DB3-A); 0 lexeme thiếu primary; 3.470 lexeme có sense phụ.

## 3. Coverage input

- **EN gloss: 41.123 dòng / 15.245 sense (100%)** — toàn bộ source **#1 jmdict**; theo cấp đúng bằng số sense từng cấp (N1 4.334 … N5 1.982).
- **VI gloss: 0** · thiếu EN gloss: **0** → toàn scope là `needs_translation` (nếu source audit đạt); `eligible_source` cho JA = **0**.
- `sense_relation`: 3.416 sense có relation — **toàn bộ là JA↔JA** (method `jmdict_source_relation`) ⇒ **không có alignment EN↔JA**, pivot hiện không gắn được sense JA (đúng như quyết định §4.1).

## 4. Rule §4.1 — count thật

| Rule | Kết quả |
| --- | --- |
| Assertions EN→JA | 69.786 (entry 5.981 + sense 63.805; sense có `source_sense_id` = 63.805; 100% có `sense_hint`) |
| Assertions EN→VI | 29.626 (entry 3.127 + sense 26.499) |
| `translation_target_candidate` | 82.355 — **toàn bộ `pending`, 0 `target_sense_id`** |
| Pivot dedupe (`source_lexeme_id` EN + `sense_hint`) | **15.989 cặp** / 14.377 source lexeme; lọc `scope='sense'`: **14.242** cặp |
| `eligible_source` (JA) | 0 |
| `needs_translation` | 15.245 |
| `missing_context` | 0 |

Ghi chú: con số **39.551 "cặp (ja,vi)"** trong kiểm kê cũ dùng định nghĩa khác (không dedupe theo `(source_lexeme_id, sense_hint)`, gồm entry scope). Số ở đây là định nghĩa chặt dùng cho B1 (query trong script). Rule 2 (tái dùng candidate accepted) hiện **không có dữ liệu để chạy**.

## 5. Concept

- 120.875 concept — **100% có `gloss_en`**; 3.533 concept có cache `gloss_vi`.
- `concept_gloss` VI: **5.368 dòng / 3.533 concept** — 100% source **#9 `omw-wikt-vi`**, `is_machine=false`; `concept_label` VI: 5.368 dòng kind `lemma`.
- **Nghi lemma-as-gloss: 5.388 cặp khớp text với label cùng concept** (≈ toàn bộ 5.368 dòng), mẫu: "Gibraltar", "Thụy Sĩ", "Suriname", "Tanzania"… ⇒ đúng cảnh báo của plan; B0 chỉ báo cáo, curator/M14 xử lý, không tự sửa.

## 6. Source audit

| id | code | license | version | sha256 | file / batch |
| --- | --- | --- | --- | --- | --- |
| 1 | **jmdict** | CC BY-SA 4.0 | **3.6.2** | `8cdbb0cc9625f775…` | `jmdict-examples-eng-3.6.2+20260921173324.json` · 218.794 dòng · import 2026-09-22 |
| 8 | wiktextract | CC BY-SA 4.0 | **∅** | `de6533a7bc714316…` | `English.jsonl.gz` · 1.492.836 dòng |
| 9 | omw-wikt-vi | CC BY-SA (**chưa số phiên bản**) | **∅** | `2f74ee9d80a96aeb…` | `wn-wikt-vie.tab` · 5.498 dòng |

- **Thiếu version (8)**: wiktextract, omw-wikt-vi, tatoeba, kanji-data, jlpt-list, ili-map-pwn30, llm-vi, wordfreq.
- **"CẦN XÁC MINH"**: kanji-data, jlpt-list · thiếu URL: llm-vi · thiếu license/attribution: **0**.
- `public.source.imported_at` đang NULL toàn bộ — lấy thời điểm import từ `staging.import_batch` (bảng đầy đủ trong JSON).
- Đối chiếu `data-Langoo/downloads/manifest.json` (generated 2026-09-22): khớp sha256 cho jmdict, omw, tatoeba, wordnet-stack; license OMW ghi "CC BY-SA" như DB; snapshot JMdict 3.6.2 = `20260921173324`.

## 7. Hiệu năng (EXPLAIN ANALYZE)

- Scope theo cấp: **~90–330ms** (lần đầu/lần sau, index đủ tốt).
- Pivot join EN↔EN qua `sense_hint`: **~1,3–1,4s** cho 15.989 cặp — chấp nhận cho B1 (chạy 1 lần, không nằm trong request path).
- Plan đầy đủ (40 dòng đầu) lưu trong inventory JSON.

## 8. Kết luận B0 & việc tiếp

1. Nguồn dịch chính đã xác định: **JMdict #1** (CC BY-SA 4.0, 3.6.2, snapshot 2026-09-21) — đủ cho pilot; attribution EDRDG + ghi chú dịch máy theo §4.3.
2. 15.245 sense vào hàng đợi `needs_translation`; **không có đường VI sẵn có** (eligible = 0) — đúng kỳ vọng đã chốt trong plan.
3. Trước B3: key mới (rotate), fallback `space-bunny-free`, quota muse; license/version #8/#9 chỉ cần khi dùng cho concept/ví dụ.
4. **B1 chờ `_gloss-types.ts` v1** (GPT) để chạy B1/B2 song song — B0 không phụ thuộc interface.
