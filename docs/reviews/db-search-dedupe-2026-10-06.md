# DB Search — dedupe kết quả trùng nguồn (EN/JA) · 2026-10-06

> Branch: `parallel/deepseek-search-fix` (commit `aca3516`) · File: `src/dictionary/repositories/dictionary-search.repository.ts`
> Đã deploy VPS `/opt/langoo/app` (build lại + `pm2 restart langoo-api`), backup file gốc: `dictionary-search.repository.ts.bak-20261006`.

## 1. Vấn đề

`serve.dictionary_search` xuất 1 dòng/`lemma` + 1 dòng/mỗi `lexeme_form`, và DB nhập nhiều nguồn:

- **EN**: wiktextract (có gloss) + oewn + omw-en — oewn/omw-en là **cùng WordNet** (cùng synset, khác tiền tố external_id) và **0 gloss**.
- **JA**: jmdict (chuẩn, có reading/gloss) + wiktextract-JA + omw-ja — hai nguồn sau thường không reading/gloss.
- Hệ quả: cùng một từ hiện 2–8 dòng ("chữ hán" + "từ gốc" của cùng lexeme; bản wordnet trùng; nhãn "đồng âm N" gây hiểu nhầm).

## 2. Policy dedupe (deterministic, chỉ ở tầng search — không đổi dữ liệu)

1. **1 dòng/lexeme**: gộp lemma + form cùng lexeme; ưu tiên dòng khớp đúng mặt chữ query, rồi form (kanji/kana) trước lemma.
2. **Ẩn nguồn phụ khi có nguồn từ điển ưu tiên cùng mặt chữ** (`source_priority`: JA jmdict=0, wikt-JA=1; EN wikt=0; oewn=2; omw-*=3).
3. **Ẩn bản không reading khi đã có bản cùng mặt chữ + POS có reading ưu tiên hơn** (JA jmdict vs wikt-JA/omw-ja).
4. **1 dòng/(ngôn ngữ, mặt chữ, POS, reading)** — gộp các bản cùng nhóm (vd 4 bản wikt "bank noun" → 1).

Từ khác reading vẫn hiện riêng (猫 ねこ vs 猫 ねこま) — không gộp đồng âm thật.

## 3. Kết quả (VPS, sau deploy)

| Query | Trước | Sau |
| --- | --- | --- |
| 猫 | 8 dòng (156837 ×2 lemma/kanji, wikt ×3, omw-ja, ...) | **156837 猫/ねこ + 156838 猫/ねこま** + 1 VI (lang khác) |
| ねこ | 156837 hiện "猫", wikt ねこ trùng | **156837 hiện "ねこ"**, ẩn wikt 2199894 |
| apple | 3 dòng (oewn, omw-en, wikt) | **694408 noun + 694409 verb** (wikt) |
| bank | 15 dòng (6 wordnet + 7 wikt + ...) | **733730 noun + 733734 verb** |
| run | nhiều bản wordnet | **3 dòng EN** (adj/noun/verb, wikt) + VI |
| 明白 | trùng | jmdict めいはく/あからさま + VI |

Kiểm tra thêm: cursor `q=走 lang=ja limit=1` 2 trang không trùng; `q=走る` có surface 走る; health `db_latency_ms 26`.

## 4. Kiểm chứng & giới hạn

- `npm run build` OK; `jest src/dictionary` 5 suite/27 test pass; eslint 0.
- Verify local (full DB 55433) bằng script tạm trước khi deploy; VPS smoke qua API thật.
- **Chưa xử lý (để DB5)**: gloss cha lặp trong sense lồng của wiktextract ("apple" 13 sense cùng mở đầu một gloss — đúng dữ liệu nguồn); hợp nhất lexeme wordnet trong DB; UI "đồng âm" chuyên biệt.
- Bản ghi wordnet (oewn/omw-en/omw-ja) vẫn trong DB, chỉ ẩn khỏi **search**; vẫn dùng cho concept linking (DB4).

## 4b. Lọc nhiễu EN (bổ sung 2026-10-06, deploy VPS)

Phát hiện khi tra `cat`: DB **không có frequency_rank** (0/2,37M lexeme — wordfreq import 0 row), nên các bản prefix xếp theo độ dài + id import → viết tắt rác (`CATI`, `CATL`, `CATV`, `CatCF`, `"Cat 5"`, `cat-`) chèn trước từ thật.

Đã thêm vào `WHERE` (chỉ `language_id = 1`, không áp dụng khi `exact_rank = 0`):
- bỏ bản toàn hoa / CamelCase / có số / khoảng trắng / hậu tố `-` khi **không khớp chính xác**;
- query chữ thường → chỉ gợi ý bản chữ thường (ẩn tên riêng Title-case); query có chữ hoa giữ Title-case.

Kết quả `q=cat (en)`: `cat×3 (adj/noun/verb)` → `cate, cath, cats, catch, cater…` (trước: `CATI, CATL, Cato, Caty, Catz, "Cat 5", CatCF…`).
Gõ đúng `CATI`, `Cato`, `cat-` vẫn ra chính xác; cursor phân trang OK; JA/VI không đổi.

**Việc lớn hơn (chưa làm):** import `wordfreq` vào `frequency_rank` (source 15 hiện 0 row) để ranking gợi ý theo tần suất thật thay vì độ dài/id.


## 5. Rollback

```bash
cd /opt/langoo/app
cp src/dictionary/repositories/dictionary-search.repository.ts.bak-20261006 src/dictionary/repositories/dictionary-search.repository.ts
chown langoo:langoo src/dictionary/repositories/dictionary-search.repository.ts
su - langoo -c "cd /opt/langoo/app && npm run build && pm2 restart langoo-api"
```
