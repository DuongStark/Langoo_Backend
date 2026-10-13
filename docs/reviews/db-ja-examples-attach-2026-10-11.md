# Gắn ví dụ Tatoeba + dịch máy cho sense JA thiếu ví dụ (11/10/2026)

> Trạng thái: **ĐÃ APPLY DB + DEPLOY API** (11/10/2026). Artifact:
> `/opt/langoo/storage/examples/tatoeba-attach-2026-10-11/` (TSV, SQL, script, APPLY-LOG).
> Code: [`sense-content.repository.ts`](../../src/dictionary/repositories/sense-content.repository.ts) ·
> SQL: [`db/ops/apply-tatoeba-examples.sql`](../../db/ops/apply-tatoeba-examples.sql)

## 1. Mục tiêu

- Bổ sung **câu ví dụ thật** (Tatoeba, có credit CC-BY) cho ~49,3k từ phổ thông
  BCCWJ **chưa có ví dụ** — vì Tatoeba còn 457k câu JA trong DB.
- Dịch câu ví dụ JA→VI bằng **muse** (nguồn VI không có sẵn: vi.wiktionary JA
  chỉ có 213 câu), lấy **EN sẵn có làm ngữ cảnh** khi dịch.
- Không sinh câu bằng AI — chỉ gắn **câu thật**; bản dịch VI gắn nhãn
  `"machine": true` trong jsonb.

## 2. Quy trình

| Bước | Việc | Kết quả |
|---|---|---|
| 1 | Export 49.330 từ BCCWJ chưa ví dụ (lemma/reading/sense chính) | `ja-targets.tsv` |
| 2 | Quét 249k câu chưa-gắn bằng dict-lookup lemma (48.969 mẫu) | 237.357 câu ứng viên |
| 3 | Tách từ Janome (4 tiến trình), validate token | +5.262 từ / 7.930 câu |
| 4 | Quét tiếp 208k câu đã-gắn-sense (kho linked) | +6.958 từ / 10.653 câu |
| 5 | Gộp, chọn tối đa 2 câu/từ (ưu tiên câu ngắn, dedupe) | **9.207 từ / 14.608 câu** |
| 6 | Lấy EN context từ DB (link + jsonb eng) | 4.484 câu |
| 7 | Dịch muse JA→VI (8 song song, retry muse→longcat) | **13.204/13.204 câu (100%)** |
| 8 | Apply: mapping_run 329 + 14.608 link `example_sense` + append VI/EN vào jsonb câu | ✅ |

**Matching (v4 — token-level):** lemma phải xuất hiện đúng **token** (khớp
`surface` hoặc `base_form` của Janome, không dùng reading); lọc ca kata-stem
(`フラ` trong `フラれる`) và câu 5–45 ký tự. Không khớp qua reading để tránh
cắt ngang từ/đồng âm.

**Vì sao kết quả thấp hơn pilot (30,5% → ~19%)?** Pilot random 200 từ trúng
nhiều từ **phổ biến vốn đã có ví dụ** (61/61 từ khớp đều ổn); nhóm "đang thiếu"
toàn từ hiếm hơn → Tatoeba phủ ít hơn. Kết quả thực: **+9.207 từ**, độ phủ ví
dụ từ phổ thông **25,3% → 39,2%** (25.918/66.041 từ có ví dụ).

## 3. Nguồn đã khảo sát (cạn)

| Nguồn | Kết luận |
|---|---|
| Tatoeba unlinked 249k + linked 208k | ✅ đã khai thác (trên) |
| wiktextract JA dump | Dump 22.228 ví dụ — DB đã import 22.178 → **hết dư địa** |
| jmdict (32k) + omw-ja (154k) | Đã dùng hết từ trước |
| vi.wiktionary JA | 213 câu — quá nhỏ |
| **Còn ~40k từ không có nguồn ví dụ thật** | Muốn phủ tiếp phải **AI sinh** (synthetic) — chưa làm |

## 4. Thay đổi API (đã deploy)

`getExamples(senseId)` giờ gộp **2 nguồn**:

1. Ví dụ gắn trực tiếp (`core.example.sense_id`), như cũ.
2. Ví dụ **gắn thêm** qua `core.example_sense` (relation `illustrates` — gồm
   14.608 link mới method `tatoeba_token_v1` và 32.284 link cũ `jmdict_tatoeba_id`).

**Dedupe hiển thị:** `DISTINCT ON (display_text, language_id)` với
`display_text = jpn(sentences jsonb) ?? text` (vì row JMdict lưu `text` = từ,
câu nằm trong jsonb — cùng câu với row Tatoeba thuần). Ưu tiên bản có
`translation.sentences`, giữ `id` nhỏ. Đã kiểm chứng:
- 発条 → 1 ví dụ (bản jmdict có EN), không lặp bản Tatoeba cùng câu.
- 1.287 cặp link mới trùng text (2 kho chứa cùng câu) → API trả 1 dòng, chọn bản có VI.
- EN/JA search không hồi quy; 49 test pass; build + `pm2 restart langoo-api` OK.
- Backup: `sense-content.repository.ts.bak-20261011`.

## 5. Dữ liệu đã ghi

- `core.mapping_run` id **329** — `run_key='tatoeba-token-match-20261011'`,
  algorithm `tatoeba_token_v1`, parameters gồm `translator=muse-spark-1.3-contributor`.
- `core.example_sense`: **14.608** link mới (`method='tatoeba_token_v1'`,
  `relation='illustrates'`, `verified=false`, evidence jsonb pattern/token).
- `core.example.translation` (jsonb): **13.204** câu được append
  `[{lang:'eng' nếu có},{lang:'vie',machine:true}]`.
- Độ phủ: BCCWJ có ví dụ **16.711 → 25.918 / 66.041 (39,2%)**;
  sense JA có ví dụ (union): **137.961**.

## 6. Rollback

```sql
DELETE FROM core.example_sense WHERE method='tatoeba_token_v1';  -- 14.608 link
DELETE FROM core.mapping_run WHERE id=329;
-- bản dịch trong jsonb vô hại nếu giữ; gỡ chính xác:
-- UPDATE theo danh sách staging.tmp_example_tr (còn trong archive) nếu cần.
```

API: `cp sense-content.repository.ts.bak-20261011` + `npm run build` +
`pm2 restart langoo-api`.

## 7. Chi phí & thời gian

- Dịch muse: 13.204 câu (~1.321 lô × 10) — ước **~$1–2**, ~25 phút.
- Matching local: quét 25s + tokenize 4–5 phút/kho (4 nhân).
- Apply DB: vài giây (một transaction).

## Cập nhật 13/10 — nâng cấp bản dịch VI người cho ví dụ đã gắn

- Kiểm tra nguồn: câu JA Tatoeba có **232.771 bản dịch EN người** nhưng chỉ **6.115 câu có bản dịch VI người** (~2,5%).
- Trong 13.204 câu JA đã gắn ví dụ: tìm được bản **VI người** cho **242 câu** — 134 trực tiếp (Tatoeba link)
  + 108 qua bắc cầu JA→EN→VI — đã thay bản muse bằng bản người (`machine:false`).
  (108 câu bắc cầu có thể lệch nhẹ do dịch chuyển tiếp — ghi nhận; vẫn là văn bản người dịch Tatoeba.)
- Còn lại ~12.962 câu giữ bản muse (`machine:true`) — nguồn VI người không có thêm.
