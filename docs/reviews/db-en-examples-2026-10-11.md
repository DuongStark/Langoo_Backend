# Ví dụ EN: mine Tatoeba + dịch muse + AI cho từ còn lại (11/10/2026)

> Trạng thái: **ĐÃ APPLY DB** (11/10/2026). Artifact:
> `/opt/langoo/storage/examples/en-examples-2026-10-11/` (TSV, JSONL, script, SQL, APPLY-LOG).
> SQL: [`db/ops/apply-en-examples.sql`](../../db/ops/apply-en-examples.sql) ·
> [`db/ops/apply-en-ai-leftover.sql`](../../db/ops/apply-en-ai-leftover.sql)

## 1. Bối cảnh

- EN có 2,5M ví dụ trong DB nhưng **2,03M câu Tatoeba EN chưa gắn** sense; phủ ví dụ
  cho nhóm từ EN có gloss VI (nhóm hiển thị của search EN — 31.544 từ) chỉ **65,8%**.
- Ví dụ wiktextract đang hiển thị phần lớn là quote văn học cũ/đứt đoạn — không phù hợp người học.
- 23.133 cặp dịch EN↔VI của người dịch có sẵn trong DB (Tatoeba).

## 2. Pipeline

| Bước | Chi tiết | Kết quả |
|---|---|---|
| Target | EN lexeme có gloss VI, chưa có ví dụ nào (direct/link) | 10.783 từ |
| Kho câu | Export 2.036.986 câu Tatoeba EN chưa gắn (TSV 100MB) | — |
| Forms | Trích từ wiktextract EN dump (1,49M entry) cho 4.874/10.454 lemma + rule (s/es/ed/ing, y→ies, gấp đôi phụ âm) | 56.607 pattern |
| Mining | Tokenize lowercase word-boundary; lọc câu 20–130 ký tự, không `[`, `...`, `http`; top-8/từ (ưu tiên câu có VI sẵn) → chọn 2/từ | **9.948/10.783 từ (92,2%) — 19.151 câu** |
| Dịch VI | muse (kèm gloss VI làm ngữ cảnh) cho câu chưa có bản dịch người | 15.720 câu |
| Apply links | `tatoeba_en_token_v1`, mapping_run `tatoeba-en-token-20261011` | 19.151 link + VI cho **17.572 câu** (2.847 người dịch + 14.725 muse) |
| Leftover | 835 từ không có câu Tatoeba: scan dump usage sạch (bỏ quote có `ref`); AI muse sinh + verify + dịch VI | 14 wikt-usage + **799 AI (95,7%)** |
| Không đạt | 22 từ (verify fail 2 lần) — không gắn | — |

## 3. Kết quả độ phủ ví dụ (nhóm EN có gloss VI)

| Mức | Trước | Sau |
|---|---|---|
| Lexeme | 20.761/31.544 = 65,8% | **31.522/31.544 = 99,93%** |
| Sense | 22.768/38.389 = 59,3% | **32.870/38.389 = 85,6%** |

Chi phí: ~1,7k lần gọi muse ≈ **~$1**; thời gian tổng ~1h. Không cần đổi API
(getExamples đã đọc link + dedupe từ việc JA trước đó).

## 4. Dữ liệu đã ghi

- `core.mapping_run`: `tatoeba-en-token-20261011` (algorithm `tatoeba_en_token_v1`).
- `core.example_sense`: 19.151 link mới (`method='tatoeba_en_token_v1'`,
  `relation='illustrates'`, `verified=false`, evidence pattern/token).
- `core.example.translation` (jsonb): 17.572 câu EN được append
  `{lang:'vie', machine: <false nếu người dịch>/<true nếu muse>}`.
- Leftover: 14 row `external_id='wikt-usage:<sense_id>'` (source_id=8 wiktextract) +
  799 row `external_id='llm-en:<sense_id>'` (source 180 `llm-en-examples`,
  license nội bộ, `machine_generated:true`); import_batch
  `en-ai-leftover-2026-10-11` sha256 `cbf0d31d…402f2e`.

## 5. Hạn chế & ghi chú

- Gắn ở mức **lexeme → sense chính** (không đảm bảo câu minh họa đúng sense cụ thể);
  giống cách làm JA.
- 22 từ chưa có ví dụ; ~4.000 sense (trong nhóm có gloss VI) chưa có ví dụ (85,6%).
- Ví dụ wiktextract cũ đang hiển thị vẫn còn — có thể làm đợt dọn riêng (ẩn câu chứa
  `[`, `...`, quote dài) nếu muốn.
- AI examples (799) giống JA: nhãn "máy tạo" chưa expose API (cờ trong jsonb).

## 6. Rollback

```sql
DELETE FROM core.example_sense WHERE method='tatoeba_en_token_v1';   -- 19.151
DELETE FROM core.example WHERE external_id LIKE 'wikt-usage:%';      -- 14
DELETE FROM core.example WHERE external_id LIKE 'llm-en:%';          -- 799
DELETE FROM staging.import_batch WHERE source_code='llm-en-examples';
DELETE FROM public.source WHERE id=180;
```
