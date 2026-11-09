# Image generation pause — 2026-11-09

**Trạng thái:** TẠM DỪNG theo yêu cầu chủ dự án  
**Repo:** `DuongStark/Langoo_Backend`, branch `main`

---

## 1. Tiến độ ảnh full

| Hạng mục | Số |
|---|---:|
| Target full | **9.016 ảnh** |
| Prompt full | **1.128 prompt** |
| Đã xong | **953 ảnh** |
| Prompt hoàn tất | **119 / 1.128** |
| Prompt đang dở khi dừng | 1 (có ảnh dư, chưa có result.json) |
| Style | 8, mỗi style **141 prompt** |

- Ảnh lưu local:
  `C:\Users\PC\Desktop\muse-native\full-images\<prompt_id>\<prompt_id>_XX.webp`
- Gallery live:
  `http://127.0.0.1:8766/`
  (server `gallery_server.py` vẫn chạy để xem ảnh, auto-refresh 20s)
- Full ảnh **chưa upload R2/DB**.
- Checkpoint: mỗi prompt có `result.json`; runner resume bỏ qua prompt đã đủ 8/8.

### Resume

```powershell
cd C:\Users\PC\Desktop\muse-native
.\.venv\Scripts\python.exe -u .\run_image_batch.py `
  --prompts .\full-prompts\prompts.jsonl `
  --out .\full-images --workers 6
```

Sau khi xong, upload theo batch bằng `vps_upload_sense_batch.mjs` (items/prompts/images scp lên VPS, chạy `--apply`).

---

## 2. Ảnh đã có trong DB/app

- **124 ảnh** trong `core.sense_media` / `serve.sense_image`
  - 100 pilot realistic
  - 24 validation (cartoon / watercolor / clay)
- **124/124 public R2 đã kiểm tra**: HTTP 200, `image/webp`, đúng bytes + sha256.
- API `/v1/senses/:id` trả `image.url` bình thường.
- App `langoo-api` đang chạy code Tier 0.

---

## 3. Dịch

- Muse job `ja-vi-20261108-muse`: **13.667/13.667 batch**, 273.338 sense.
- Đã apply `core.sense_gloss`, source **187**:
  - 273.338 gloss VI mới
  - `is_machine=true`, rank 1, default-accept, chưa reviewed
- Tổng VI gloss: **624.331**.
- JA coverage: **526.965 / 600.696 sense**; còn **73.731 sense chưa dịch** vì ngoài scope job ban đầu.
- EN coverage: 97.366 / 769.169 (ngoài scope JA).

---

## 4. Code / DB đã deploy

- `cd2d172` — sense-first backend (Tier 0, migration 049, docs)
- `0cbbd16` — docs deploy + pilot verification
- `1805f43` — docs Muse translation apply
- Migration `049_sense_images.sql` + backfill 100 pilot đã apply.
- `langoo-api` đã restart, online.
- `core.sense_media` + `serve.sense_image` live.

---

## 5. Việc còn lại

1. Resume full 953 → 9.016 ảnh.
2. Upload full ảnh vào R2 + `media_asset` + `sense_media`.
3. Nếu muốn full JA: lọc 73.731 sense còn thiếu, tạo job mới (~3.687 batch), bỏ ký hiệu/số/unknown/no-text.
4. 9 sense inherit root + 581 no-image giữ nguyên, không sinh ảnh.
