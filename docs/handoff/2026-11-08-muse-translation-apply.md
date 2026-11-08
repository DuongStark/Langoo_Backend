# Muse translation apply — ja-vi-20261108-muse

**Ngày:** 2026-11-08  
**Trạng thái:** Đã apply vào `core.sense_gloss`  
**Job:** `ja-vi-20261108-muse`, model `muse-native-1`, prompt `ja-vi-sense-v1`

---

## 1. Kết quả

- Job gốc: **13.667 batch / 273.338 sense**
- Upload incoming: **13.667/13.667 file**
- Apply DB: **273.338 gloss VI** mới
- Source mới: `public.source.id = 187`
  - code: `llm-sense-vi-v2-muse-native-20261108`
  - name: Gloss VI theo sense — Muse native (ja-vi-20261108-muse)
  - máy dịch, chưa duyệt; `default-accept`
- Tổng VI gloss sau apply: **624.331**
- Sample `sense_id 736617`:
  - `gloss_vi`: “thách thức (ai đó) thực hiện lời tuyên bố”
  - `gloss_vi_machine = true`, `gloss_vi_reviewed = false`
  - `source_id = 187`, `rank = 1`
  - API `/v1/senses/736617` trả đúng gloss.

---

## 2. Kiểm tra trước khi apply

Dry-run trên toàn bộ 13.667 file:

```text
files: 13667
items: 273338
duplicate ids: 0
missing senses: 0
exact text already exists: 0
any VI gloss already exists: 0
```

Vì vậy toàn bộ được insert rank 1, không overwrite gloss cũ.

---

## 3. Quy tắc apply

- Đọc `incoming/<batch>.json`.
- Chỉ nhận:
  - `jobId = ja-vi-20261108-muse`
  - `language = vi`
  - `items[].id` là sense_id số
  - `items[].vi` không rỗng
- Dedupe theo sense_id.
- Stage vào temp table.
- Insert `core.sense_gloss`:
  - `language_id = 3`
  - `is_machine = true`
  - `quality = NULL`
  - `reviewed = NULL`
  - `rank = max(existing VI rank) + 1`; nếu chưa có thì rank 1
  - `source_id = 187`
  - `batch_id = NULL`
  - `detail = 'sense-vi-1 | model=muse-native-1 | job=ja-vi-20261108-muse | batch=<key> | default-accept'`
- `ON CONFLICT (sense_id, language_id, rank) DO NOTHING`.
- Idempotent: rerun bỏ qua text đã có.

---

## 4. Lưu ý

- Đây là **machine gloss**, không curated/reviewed.
- Không sửa definition gốc, mapping sense/concept hay dữ liệu nguồn.
- Nếu cần review, dùng `reviewed_by/reviewed_at` và `app.gloss_report`.
- Source 187 có thể filter để audit/revert:
  - `SELECT * FROM core.sense_gloss WHERE source_id = 187;`
  - Không xoá source 187 trước khi xử lý gloss tham chiếu.
- Job data vẫn giữ tại:
  `/opt/langoo/storage/ja-muse-jobs/ja-vi-20261108-muse/incoming/`

---

## 5. Trạng thái tổng

- **Dịch Muse: xong + đã apply DB**
- **100 ảnh sense-level pilot: đã apply DB + deploy**
- **Style test 64 ảnh: xong**
- Tiếp theo: full 9.044 ảnh direct còn lại với 8 style random.
