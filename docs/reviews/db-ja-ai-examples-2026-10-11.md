# Ví dụ AI (muse) cho từ JA không còn nguồn ví dụ thật (11/10/2026)

> Trạng thái: **ĐÃ APPLY DB** (11/10/2026). Artifact:
> `/opt/langoo/storage/examples/ai-examples-2026-10-11/` (TSV, SQL, script, output, APPLY-LOG).
> SQL: [`db/ops/apply-ai-examples.sql`](../../db/ops/apply-ai-examples.sql)

## 1. Bối cảnh

Sau khi gắn hết ví dụ **thật** (Tatoeba 2 kho câu, wiktextract, jmdict, omw-ja),
còn **40.123 từ** BCCWJ không có ví dụ nào — các nguồn thật đã khảo sát cạn.
Người dùng duyệt cơ chế: pilot 200 từ → chấm → duyệt chạy full với điều kiện
**gắn nhãn + kiểm định nghiêm**.

## 2. Pipeline

| Bước | Chi tiết |
|---|---|
| Export | 40.123 từ (lemma, reading, sense chính, gloss JA/EN/VI top-3 làm ngữ cảnh) |
| Lọc | Bỏ 150 lemma ký hiệu/số (Θ, ３Ｐ, 〼...) → chạy **39.973** |
| Sinh | muse, batch 10, 8 song song: câu 8–30 ký tự, đúng từ + đúng nghĩa (grounded) |
| Presence | lemma xuất hiện trong câu (kể cả dạng chia: `lemma[:-1]`) — phần lớn từ ghép bị Janome tách nên dùng substring, không token |
| Verify + dịch VI | cùng 1 lần gọi muse: tự nhiên? đúng nghĩa (chống đồng âm)? → `ok/reason/vi` |
| Retry | fail → **sinh lại 1 lần kèm lý do lỗi** → verify lại |
| Checkpoint | theo sóng 500 từ — crash resume được |

## 3. Kết quả

| Chỉ số | Giá trị |
|---|---|
| Pilot (200 từ) | 175/200 = 87,5% (1 vòng) |
| **Full** | **38.660/39.973 = 96,7%** (nhờ retry kèm phản hồi lỗi) |
| Có bản dịch VI | 38.660/38.660 (100% câu đạt) |
| Không đạt (1.313 từ) | fail verify 2 lần — **không gắn**, chấp nhận |
| Thời gian | ~1h15 (80 sóng × ~53s) |
| Chi phí | ~9,9k lần gọi muse ≈ ~$6 |

Verifier bắt lỗi thật tốt (mẫu fail: `独り言つ` sai ngữ pháp, `本身` sai cách
đọc/nghĩa, `落とし主が交番に届けた` sai nghĩa, `御座る` sai kính ngữ).

## 4. Dữ liệu đã ghi

- `public.source` id **179**: `code='llm-ja-examples'`, license `nội bộ`
  (theo convention `llm-vi`), attribution "Sinh bởi mô hình, chưa kiểm duyệt".
- `staging.import_batch`: source_code `llm-ja-examples`, file
  `ai-examples-full-2026-10-11`, sha256 `0a4c41ee…e6bdc`, 38.660 rows.
- `core.example`: **38.660** row mới — `language_id=2`, `sense_id` = sense chính,
  `external_id='llm-ja:<sense_id>'`, `source_id=179`,
  `translation = {"sentences":[{"lang":"vie","text":…,"machine":true}],"machine_generated":true}`.
- Chỉ gắn vào sense **chưa có ví dụ nào** (direct hoặc link) — guard `NOT EXISTS` trong SQL.
- Độ phủ ví dụ từ phổ thông BCCWJ: **39,2% → 97,8%** (64.578/66.041 từ).
- Sense JA có ví dụ: 137.961 → **176.621**.

## 5. Hiển thị & nhãn

- Ví dụ AI tự xuất hiện qua `GET /v1/senses/:id` (nhánh direct — không cần đổi API).
- **Lưu ý FE**: câu AI không có "bản gốc thật" để đối chiếu (khác Tatoeba/bản dịch máy).
  Đề xuất nhãn riêng "Ví dụ máy tạo"; cờ `machine_generated` nằm trong
  `core.example.translation` jsonb — **chưa expose qua API**; nếu FE cần badge,
  báo backend bổ sung field (vd `generated: true` trong example item).

## 6. Rollback

```sql
DELETE FROM core.example WHERE external_id LIKE 'llm-ja:%';   -- 38.660
DELETE FROM staging.import_batch WHERE source_code='llm-ja-examples';
DELETE FROM public.source WHERE id=179;
```

## 7. Hạn chế đã biết

- Từ rất hiếm: câu thường đơn giản, đôi khi hơi cứng (khó tránh) — nhưng đúng
  ngữ pháp và đúng nghĩa theo verify.
- Không có furigana/attribution người viết; khác hoàn toàn ví dụ CC-BY.
- 1.313 từ vẫn không có ví dụ (có thể thử lại model khác sau nếu muốn).
