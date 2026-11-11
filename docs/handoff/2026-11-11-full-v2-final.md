# Full image v2 — operational handoff (2026-11-11)

## Trạng thái ảnh

- **9.015 / 9.016 ảnh** local, **1.127 / 1.128 prompt full**.
- **1 sense bị loại có chủ đích:** `full2-ja-0633` / `たまたま` (sense `103463`) bị gloss máy `"testicles"` sai/không phù hợp; model từ chối 0/1 sau 303s. Giữ **7 ảnh đúng item 2–8**, sense này dùng fallback concept hoặc bỏ trống.
- `full2-ja-0096` bản result cũ 0/8 chỉ là duplicate; bản trong shard đã 8/8.
- `full2-ja-0360` từng bị model trả item 2–8 (lệch 1 vị trí); đã sinh bù item 1 `姿勢` và remap.
- **Ảnh full v2 ĐÃ upload R2/DB ngày 2026-11-11.**
  - `media_asset`: **9.015**
  - `sense_media` source `vocab-batch-2026-11-11-full-v2`: **9.015** rows, **9.015 unique sense**, tất cả approved/primary.
  - Tổng `sense_media` DB: **9.139** (124 ảnh cũ + 9.015 ảnh mới), tất cả approved/primary.
  - 8 lỗi transient `fetch failed`/timeout đã retry **8/8** thành công.

## Nơi lưu

| Thứ | Đường dẫn trên máy hiện tại |
|---|---|
| Runner | `C:\Users\PC\Desktop\muse-native\run_image_batch.py` |
| Prompts | `C:\Users\PC\Desktop\muse-native\full-prompts-v2\` |
| Ảnh acc1 | `full-images-v2-acc1-shard\` |
| Ảnh acc2 | `full-images-v2-acc2-shard\` |
| Ảnh cũ/pilot | `full-images-v2\` |
| Missing4 | `full-images-v2-acc2-missing4\` |
| Manifest hoàn tất | `full-prompts-v2\completed-manifest.json` |
| Skip list | `full-prompts-v2\completed-prompt-ids.txt` |

Prompts/scripts đã copy vào repo tại `scripts/muse-native/` và `scripts/muse-native/prompts/`. Không commit ảnh, cookie hoặc `.env`.

## Không tạo lại ảnh cũ

Runner đã hỗ trợ `--skip-file`:

```powershell
.\.venv\Scripts\python.exe -u .\run_image_batch.py `
  --prompts .\prompts\acc2-shard.jsonl `
  --out .\out `
  --workers 2 `
  --skip-file .\prompts\completed-prompt-ids.txt
```

- `completed-prompt-ids.txt` chứa **toàn bộ 1.128 prompt** đã xử lý/loại có chủ đích.
- Chỉ dùng skip list khi ảnh/DB đã có nguồn; nếu ảnh local chưa copy sang máy mới, skip sẽ không tạo ảnh nhưng cũng không sinh lại.
- Nếu có `result.json` local, runner tự bỏ qua prompt đã `got == expected` kể cả không dùng skip list.
- **Không chạy lại** các prompt đã có `result.json` full; **không xóa** `full-images-v2*` cũ.

## Lệnh chạy / resume

```powershell
cd C:\Users\PC\Desktop\muse-native
$env:PYTHONPATH = $PWD

# Acc2: wake trước, chỉ dùng 2–4 luồng; 8 luồng dễ 502/4-8
.\.venv\Scripts\python.exe .\wake_acc2.py
$env:MUSE_COOKIE_FILE = 'C:\Users\PC\Desktop\muse-native\cookies-acc2.json'
.\.venv\Scripts\python.exe -u .\run_image_batch.py `
  --prompts .\full-prompts-v2\acc2-shard.jsonl `
  --out .\full-images-v2-acc2-shard --workers 2
```

Acc1 dùng cookies mặc định, bỏ `MUSE_COOKIE_FILE`, chạy 6 luồng.

## Quy tắc vận hành quan trọng

1. **4/8 không phải hết quota**: model trả 4 ảnh đầu, 4 ảnh còn lại pending/timeout ~305s.
2. Với prompt 4/8, sinh bù **4 item cuối** bằng `acc2-missing4.jsonl`; không retry full 8.
3. Acc2 502 do VM sleep/gateway; chạy `wake_acc2.py`, sau đó 2–4 luồng.
4. Luôn kiểm tra label ↔ sense trước upload. Đã gặp 1 ca lệch do model bỏ item đầu (`full2-ja-0360`).
5. Upload chỉ dùng `completed-manifest.json` (9.015 rows), không dùng kết quả `full2-ja-0096` cũ 0/8.
6. `full2-ja-0633` có `excluded_senses`; không tạo ảnh cho sense `103463` nếu gloss chưa sửa.

## Upload R2/DB — ĐÃ HOÀN TẤT 2026-11-11

- Ảnh: `/tmp/sense-batch-images` trên VPS.
- Items/prompts: `/tmp/sense-batch-items.json`, `/tmp/sense-batch-prompts.jsonl`.
- Prompt version: `vocab-square-512-webp75-full-v2-20261111`.
- Source DB: `vocab-batch-2026-11-11-full-v2`.
- Uploader: `/tmp/vps_upload_parallel.mjs` chạy 4 shard, sau đó retry 8 item fail.
- Kết quả: **9.015 asset / 9.015 sense_media unique / 0 fail**.
- Tổng DB: **9.139 sense_media** approved/primary.

## Kiểm tra cuối trước upload

- `completed-manifest.json`: 9.015 rows / 9.015 unique sense id.
- 1 excluded sense: `103463` / `たまたま`.
- Label check: 6.432 same, 2.574 uncertain do label romaji/ngắn, 9 flag do synonym; **không còn true swap** sau khi fix `0360`/`0633`.
- `full2-ja-0096`: chọn bản 8/8 trong shard, bỏ bản 0/8 ở `full-images-v2`.
