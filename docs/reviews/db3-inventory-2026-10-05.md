# DB3 — Kiểm kê hiện trạng (2026-10-05)

> Phiên song song B (DeepSeek V4 Flash) · branch `parallel/deepseek-db3` · **chỉ đọc, không ghi DB**.
> Phạm vi: radical, KanjiVG/media, JLPT, deck, gloss sense/concept, credits — phục vụ plan [`db3-a-foundation.md`](../plans/db3-a-foundation.md).
> Repo backend: `f1ee0d6`. Nguồn tham chiếu: `/media/duongstark/Du lieu/code/data-Langoo` (đọc-only, không sửa).

## 0. Môi trường đo & phương pháp

| | |
| --- | --- |
| DB dùng cho số liệu | **Full local** `postgresql://postgres@127.0.0.1:55433/langoo` (read-only, chỉ `SELECT`) |
| DB fixture của phiên này | `langoo_parallel_deepseek_test` (PG tạm 55432) — **demo**, không đại diện coverage |
| Không dùng | `.env` production, SSH/VPS, không chạy write query, không tạo schema/view/bảng tạm |

Mọi con số dưới đây đều kèm query. Số nào chưa đo được ghi rõ **[chưa xác minh]**.

## 1. Tổng quan

| Hạng mục | Schema (migration) | Hiện có (full DB) | Nguồn đã có? | Kết luận DB3 |
| --- | --- | --- | --- | --- |
| Bộ thủ 214 | `public.radical` (024) | **0 dòng** | ❌ Không có file 214 bộ; demo có 13 bộ làm mẫu | Cần chọn nguồn + quyết định tên VI |
| KanjiVG / media | `core.media_asset`, `core.kanji_media` (024) | **0 / 0** | ❌ **Chưa tải KanjiVG** | Được phép làm sau khi chốt nơi lưu + tải nguồn |
| JLPT | `core.jlpt_link` (012), `core.lexeme_level` (008) | 8.480 link / 7.850 lexeme; lexeme_level 7.810 | ✅ `staging.jlpt_entry`, `downloads/extras/jlpt-n{1..5}.csv` | Canonical đã chốt = `jlpt_link`; DB3-A chỉ audit |
| Deck hệ thống | `core.deck`, `core.deck_item` (024) | **0 / 0** | ✅ dữ liệu đủ (JLPT + core) | Làm được, **cần chốt tiêu chí** |
| Gloss VI | `core.sense_gloss`, `core.concept_gloss`, `core.concept_label` (005/010) | sense vi = **0**; concept vi 5.368 (3.533 concept) | ✅ Wiktionary pivot + OMW vi + Tatoeba (demo) | Thuộc **DB3-B** (harvest + LLM) |
| Credits | `public.source` (001) | 16 nguồn; license 16/16, attribution 16/16, url 15/16, version 8/16 | ⚠️ 2 nguồn license "CẦN XÁC MINH" | DB3-A: audit + đề xuất, không tự đổi |

## 2. Chi tiết từng mục

### 2.1 Radical (`public.radical`)

**Schema (024_core_reference.sql):** `number` PK (1..214, CHECK), `character` UNIQUE (1 ký tự),
`name_en`, `name_vi`, `meaning_vi`, `stroke_count` (>0), `variants text[]` — comment ghi rõ
variants để join với `core.kanji_radical.part`. Bảng **không có cột provenance** (không source_id/batch_id).

**Đo (full DB):**

```sql
SELECT 'public.radical' t, count(*) n FROM public.radical
UNION ALL SELECT 'core.kanji (radical_classical NOT NULL)', count(*) FROM core.kanji WHERE radical_classical IS NOT NULL
UNION ALL SELECT 'core.kanji_radical rows', count(*) FROM core.kanji_radical
UNION ALL SELECT 'core.kanji_radical distinct parts', count(DISTINCT part) FROM core.kanji_radical
UNION ALL SELECT 'core.kanji_radical distinct kanji', count(DISTINCT kanji_literal) FROM core.kanji_radical;

-- radical / kanji               | 0        (chưa seed)
-- radical_classical NOT NULL    | 13.108 / 13.108 kanji
-- kanji_radical rows            | 54.321
-- distinct parts                | 253
-- distinct kanji (có parts)     | 12.156
```

**Tham chiếu UI:** `serve.kanji_card` LEFT JOIN `public.radical r ON r.number = k.radical_classical`
→ khi chưa seed, `radical_char/name_vi/meaning_vi` của `GET /v1/kanji/:literal` là **NULL**.
`KanjiRepository` (backend) đã select sẵn 4 field này — seed xong là UI tự có.

**Nguồn hiện có trong data-Langoo:**
- `scripts/seed_core_demo.py` — hằng `RADICALS` chỉ có **13 bộ** (comment: "214 bộ Kangxi — seed một phần"),
  mỗi dòng `(number, character, name_en, name_vi, meaning_vi, strokes, variants)`; đây là **mẫu văn phong VI** để theo
  (ví dụ "bộ Nhân đi", "bộ Lực", "người (biến thể của 人)").
- `downloads/extras/kanji-data.kanji.json` có `wk_radicals` — **radical WaniKani**, không phải 214 bộ Kangxi → không dùng.
- KANJIDIC2 (`radicals[].value`) cho số bộ mỗi kanji (đã nạp vào `kanji.radical_classical`), không cho danh sách 214.
- **Không có file 214 bộ đầy đủ** trong `downloads/` (manifest 22 file, đã kiểm).

**Nguồn 214 bộ: đã tìm được online (05/10)** — chi tiết ở [plan §4.2](../plans/db3-a-foundation.md):
Unicode `CJKRadicals.txt` (number↔ký tự↔unified, validate 214/214), vi.wikipedia "Bộ thủ Khang Hi"
(bảng 214 dòng: ký tự + biến thể + tên Hán-Việt + nghĩa VI), Unihan `kTotalStrokes` (số nét),
en.wikipedia "Radical N" (cho `name_en`, mẫu `meaning "water"`). **Đã chốt:** `name_vi` = "Thủy"
(không tiền tố "bộ "), **có** `name_en`. Cần người tích hợp tải raw vào `data-Langoo/downloads/extras/`
trước khi seed; API phục vụ ảnh KanjiVG gộp vào **M14** (không nằm trong DB3-A).

**Khoảng trống/kết luận:**
1. Cần chọn nguồn chuẩn cho 214 dòng: số bộ + ký tự + biến thể + số nét + tên EN
   (đề xuất: Unicode `CJKRadicals.txt` cho number↔character↔unified + danh sách tên EN chuẩn — xem plan).
2. **Tên/nghĩa VI chưa có nguồn** — cần quyết định: người cung cấp danh sách, hay LLM draft (DB3-B) rồi review.
3. `variants` phải đối chiếu 253 `kanji_radical.part`; không tự suy mapping chỉ từ chuỗi bộ phận (quyết định đã có).

### 2.2 KanjiVG / media

**Schema (024):** `media_asset(kind CHECK IN ('stroke_svg','stroke_gif','audio_tts'), object_key UNIQUE,
mime, bytes, sha256, provider, source_id)`; `kanji_media(kanji_literal, asset_id, kind CHECK IN
('stroke_svg','stroke_gif'), frame_count, PK (kanji_literal, kind))`. Comment: `object_key` trỏ object
storage, **không lưu blob trong DB**.

**Đo:** `media_asset = 0`, `kanji_media = 0` (cùng query mục 2.1).

**Tham chiếu:** `serve.kanji_card` tổng hợp `media_kinds` từ `core.kanji_media` → hiện NULL.
`media_kinds` chỉ là **metadata "có asset loại gì"** (ví dụ `["stroke_svg"]`), **không chứa file**:
file nằm ngoài DB theo `media_asset.object_key`. **Chưa có route phục vụ file SVG** trong backend
(StorageService hiện chỉ dùng cho ảnh feedback) — muốn FE xem được ảnh nét cần thêm route đọc media
(việc backend riêng, xem plan §4.1).

**Nguồn:** **chưa tải KanjiVG** (manifest không có; `downloads/README.md` không nhắc).
Đề xuất: KanjiVG (github.com/KanjiVG/kanjivg, **CC BY-SA 3.0**, ~11k SVG) — cần chốt version + sha256 khi thực hiện.

### 2.3 JLPT

**Đo (full DB):**

```sql
SELECT source_level, count(*) rows, count(DISTINCT lexeme_id) lexemes,
       count(DISTINCT lexeme_id) FILTER (WHERE status='accepted') accepted
FROM core.jlpt_link GROUP BY 1 ORDER BY 1;
-- cấp 1: 2.757 rows / 2.672 lexeme / 2.571 accepted
-- cấp 2: 1.778 / 1.582 / 1.528
-- cấp 3: 2.226 / 2.168 / 2.034
-- cấp 4:   806 /   724 /   572
-- cấp 5:   913 /   844 /   626
-- Tổng accepted lexeme: 7.285 (query riêng)
-- lexeme_level: 7.810 rows / 7.810 lexeme
```

**Quyết định đã có:** canonical = `jlpt_link` (giữ provenance `(source_level, source_row_number)`);
`lexeme_level` chỉ tham chiếu, không ghi đè.

**Nguồn:** `staging.jlpt_entry` (đã nạp, FK), `downloads/extras/jlpt-n{1..5}.csv`.
`public.source` id 12 `jlpt-list` license = **"CẦN XÁC MINH"**; id 11 `kanji-data` cũng vậy.

**Khoảng trống:** không cần seed thêm trong DB3-A; việc còn lại là **audit/verify** và
quyết định license 2 nguồn (đề xuất: người chốt, không tự đổi). `attributes.jlpt` cấp từ chưa có nguồn
(CONTEXT §9) — giữ nguyên backlog.

### 2.4 Deck (`core.deck` / `core.deck_item`)

**Schema (024):** `deck(slug UNIQUE, title, description, language_id FK, level_label, is_published
(default false), item_count (CHECK ≥0))`; `deck_item(deck_id, anchor_sense_id FK core.sense
ON DELETE RESTRICT, concept_id FK nullable, position, PK (deck_id, anchor_sense_id))`.
FK trễ: `app.collection.cloned_from_deck_id`, `app.collection_item` đã nối ở cuối 024.

**Đo:** deck = 0, deck_item = 0. Khả thi anchor:

```sql
SELECT 'jlpt accepted lexemes' k, count(DISTINCT lexeme_id) n FROM core.jlpt_link WHERE status='accepted' AND lexeme_id IS NOT NULL
UNION ALL SELECT 'trong đó có ≥1 sense', count(DISTINCT s.lexeme_id) FROM core.sense s
  WHERE s.lexeme_id IN (SELECT lexeme_id FROM core.jlpt_link WHERE status='accepted' AND lexeme_id IS NOT NULL)
UNION ALL SELECT 'trong đó có sense is_primary', count(DISTINCT s.lexeme_id) FROM core.sense s
  WHERE s.is_primary AND s.lexeme_id IN (SELECT lexeme_id FROM core.jlpt_link WHERE status='accepted' AND lexeme_id IS NOT NULL);
-- 7.285 / 7.285 / 7.285  → 100% có sense primary (avg 2,09 sense/lexeme)
```

**Khoảng trống:** cần **chốt tiêu chí sản phẩm** trước khi seed: số deck, nhóm từ (JLPT level?),
anchor sense (đề xuất: sense `is_primary`), số item/deck, `is_published` (đề xuất: `false` đến khi review),
`concept_id` để NULL (DB4 sẽ nối).

### 2.5 Gloss sense/concept (thuộc **DB3-B**, ghi để phân ranh)

**Đo (full DB):**

```sql
SELECT 'sense_gloss' k, language_id, count(*) n, count(DISTINCT sense_id) senses FROM core.sense_gloss GROUP BY 1,2
UNION ALL SELECT 'concept_gloss', language_id, count(*), count(DISTINCT concept_id) FROM core.concept_gloss GROUP BY 1,2
UNION ALL SELECT 'concept_label', language_id, count(*), count(DISTINCT concept_id) FROM core.concept_label GROUP BY 1,2;
-- sense_gloss   | en 1 | 2.530.921 rows | 2.279.374 sense
-- concept_gloss | en 1 |   124.462     |  120.875 concept
-- concept_gloss | ja 2 |    67.071     |   57.184
-- concept_gloss | vi 3 |     5.368     |    3.533
-- concept_label | vi 3 |     5.368     |    3.533

SELECT count(*) tong, count(gloss_en) co_en, count(gloss_vi) co_vi FROM core.concept;
-- 120.875 / 120.875 / 3.533    → concept.gloss_vi phủ 2,9%
```

**Mỏ dịch JA↔VI từ Wiktionary (`core.translation_assertion`, cặp qua từ EN + align `sense_hint`):**

```sql
WITH pairs AS (
  SELECT DISTINCT j.target_text AS ja FROM core.translation_assertion j
  JOIN core.translation_assertion v ON v.source_lexeme_id = j.source_lexeme_id
    AND v.target_language_id = 3 AND v.sense_hint = j.sense_hint
  WHERE j.target_language_id = 2 AND j.sense_hint IS NOT NULL AND btrim(j.sense_hint) <> ''
)
SELECT (SELECT count(*) FROM pairs) AS text_ja_phan_biet,
       (SELECT count(DISTINCT lx.id) FROM pairs p JOIN core.lexeme lx ON lx.lemma = p.ja AND lx.language_id = 2) AS khop_lemma,
       (SELECT count(DISTINCT id) FROM (
          SELECT lx.id FROM pairs p JOIN core.lexeme lx ON lx.lemma = p.ja AND lx.language_id = 2
          UNION SELECT lx.id FROM pairs p JOIN core.lexeme lx ON lx.reading = p.ja AND lx.language_id = 2
          UNION SELECT f.lexeme_id FROM pairs p JOIN core.lexeme_form f ON f.form_text = p.ja
        ) u) AS khop_linh_hoat;
-- text ja phân biệt: 22.641 · lexeme khớp lemma: 52.239 (homograph) · khớp linh hoạt: 54.043
-- (đo trước đó theo cặp (ja,vi) dedupe: 39.551 cặp)
```

**Phủ JLPT của mỏ Wiktionary** (cùng CTE như trên, join `jlpt_link`):

| Cấp | Tổng lexeme | Được phủ | % |
| --- | --- | --- | --- |
| N1 (1) | 2.672 | 960 | 35,9 |
| N2 (2) | 1.582 | 759 | 48,0 |
| N3 (3) | 2.168 | 1.411 | 65,1 |
| N4 (4) | 724 | 545 | 75,3 |
| N5 (5) | 844 | 739 | 87,6 |

**Nguồn khác ghi nhận (chưa dùng):**
- Tatoeba: jpn 248.909 câu, vie 33.184 câu; **8.477 cặp câu jpn↔vie**.
- Wiktextract: en 1.492.836 · ja 199.484 · **vi 51.896** entry.
- OMW vi: `staging.omw_wikt_vi` 5.498; `downloads/extras/wn-wikt-vie.tab` 172 KB.
- Wikidata (đo ngoài DB bằng SPARQL 05/10, mẫu 100 concept): P5063 phủ **~21%**, phần lớn tên riêng → nguồn phụ.

### 2.6 Credits (`public.source`)

**Đo:** 16 nguồn; `license` 16/16, `attribution` 16/16, `url` 15/16, `version` 8/16.
Hai nguồn license **"CẦN XÁC MINH"**: id 11 `kanji-data`, id 12 `jlpt-list`;
`omw-ja`/`omw-en` ghi "ghi nguồn" (chưa rõ điều khoản); `omw-wikt-vi` ghi "CC BY-SA" thiếu version.

**Backend:** **chưa có endpoint/repository `/credits`** (grep `src/**` + docs không thấy) → đây là việc
riêng ngoài DB3-A; DB3-A chỉ audit dữ liệu `source`.

## 3. Chưa xác minh / cần đo thêm

- Danh sách 214 bộ đầy đủ (chưa có file), tên VI, biến thể chính xác (đối chiếu 253 parts).
- KanjiVG: version, số file, dung lượng, sha256 (chưa tải).
- Nơi lưu file media (local/object storage) và route phục vụ — chưa có thiết kế.
- License thật của `kanji-data`, `jlpt-list`, các wordnet OMW — **[chưa xác minh]** (cần người chốt).
- Wikidata coverage chỉ đo mẫu 100 concept (SPARQL), chưa quét toàn bộ 117.659 ILI.

## 4. Kết luận

1. **DB3-A (deterministic, không LLM)** làm được ngay sau duyệt: KanjiVG media (sau khi tải nguồn),
   radical 214 (sau khi chốt nguồn + tên VI), deck (sau khi chốt tiêu chí), audit JLPT/credits.
2. **DB3-B** giữ toàn bộ gloss/Ví dụ: harvest Wiktionary pivot (39.551 cặp, N5 phủ 87,6%),
   OMW/Wikidata phụ trợ, dịch máy phần thiếu bằng **OpenCode Go** (lô nhỏ + checkpoint).
3. Ba quyết định thật sự còn thiếu: **(a)** nguồn 214 bộ + tên/nghĩa VI, **(b)** tiêu chí deck,
   **(c)** nơi lưu/serving KanjiVG + license 2 nguồn "CẦN XÁC MINH".
