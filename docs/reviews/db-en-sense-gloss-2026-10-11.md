# Gloss VI cho sense EN còn thiếu (11/10/2026)

> Trạng thái: **ĐÃ APPLY DB** (11/10/2026). Artifact:
> `/opt/langoo/storage/gloss/en-sense-gloss-2026-10-11/` (TSV, script, SQL, APPLY-LOG).
> SQL: [`db/ops/apply-en-sense-glosses.sql`](../../db/ops/apply-en-sense-glosses.sql) ·
> [`db/ops/apply-en-sense-glosses-2.sql`](../../db/ops/apply-en-sense-glosses-2.sql)

## 1. Bối cảnh

- EN có 31.544 từ hiển thị (có gloss VI) nhưng **chi tiết từ VI-only**: 97.366 sense
  trong nhóm này chỉ **38.389 sense có VI (39%)** — từ thông dụng như `bank` mở ra
  chỉ thấy 1 nghĩa.
- Quyết định (người dùng duyệt): dịch sense thiếu trước (giá trị cao, chi phí nhỏ)
  thay vì mở rộng từ mới rank 50k+.

## 2. Hai vòng (phát hiện quan trọng)

| Vòng | Nguồn định nghĩa | Đối tượng | Kết quả |
|---|---|---|---|
| 1 | `core.sense_gloss` (language_id=1) | 48.043 sense | **48.036** dịch + apply |
| 2 | `core.sense.definition` (+`definition_language_id` null/1) | 10.941 sense (khối OEWN) | **10.941** dịch + apply (100%) |

> Phát hiện: sense nhập từ OEWN **không có bản ghi gloss EN** — định nghĩa nằm thẳng
> trong `core.sense.definition`. Vòng 1 bỏ sót 10.941 sense này; vòng 2 phủ nốt.
> (Bài học: khi đếm "sense có gloss EN" phải tính cả `sense.definition`.)

## 3. Kết quả

| Chỉ số | Trước | Sau |
|---|---|---|
| Sense EN có VI (trong nhóm từ đã có VI) | 38.389/97.366 = 39,4% | **97.366/97.366 = 100%** |
| `bank` (lexeme 243055) qua API | 1/10 nghĩa | **10/10 nghĩa** |
| Search EN | — | không hồi quy |

- Dịch: muse (batch 10, 8 song song, checkpoint resume); vòng 1 fail 7 sense, vòng 2 100%.
- Chi phí ~**$3**; thời gian ~1,5h.
- `serve.sense_card` là **view thường** — gloss mới hiển thị tự động, không cần refresh.

## 4. Dữ liệu đã ghi

- `public.source` id **181**: `b2-align-muse-vi-sense-1`
  (license: "Nội dung: định nghĩa EN (WordNet/Wiktionary — license gốc); dịch bởi muse (máy)").
- `core.sense_gloss`: **58.977** row mới (`language_id=3`, `is_machine=true`, `rank=1`,
  `source_id=181`); 2 import_batch: `en-sense-gloss-2026-10-11` (sha 9eb21da3…) +
  `en-sense-gloss2-2026-10-11` (sha e17d5344…).
- Guard `NOT EXISTS` VI cho sense (không đè bản đã có; nếu tương lai có bản người dịch
  thì bản máy vẫn nằm cạnh, FE ưu tiên theo `is_machine`).

## 5. Ghi chú

- Chất lượng: bản dịch văn phong từ điển, giữ "(to) …" cho động từ; đã spot-check
  ~20 mẫu (bank, piece, frost, accept, prefrontal…) — ổn.
- 2 lexeme trùng mặt chữ không có VI (vd `bank` 243056 — bản trùng từ nguồn khác,
  search đã ẩn bản không curated) — không nằm trong nhóm phủ; chấp nhận.
- Còn lại: mở rộng **từ mới** ngoài rank 50k (chưa làm, ưu tiên thấp).

## 6. Rollback

```sql
DELETE FROM core.sense_gloss WHERE source_id=181;   -- 58.977
DELETE FROM staging.import_batch WHERE source_code='b2-align-muse-vi-sense-1';
DELETE FROM public.source WHERE id=181;
```
