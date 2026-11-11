# Muse VM CLI smoke — 2026-11-11

Muse agent đã chạy thực tế trên VM, không qua chat image tool.

## CLI

`/opt/hatch/bin/media-generation` tồn tại, executable, `--help` exit 0.

Command đã chạy thành công:

```bash
/opt/hatch/bin/media-generation \
  --media-subagent-output-type image \
  --conversation-json '[{"text":"a red apple on a white plate, simple background"}]' \
  --output-dir ~/workspace/langoo-pilot-smoke \
  --image-output-format webp \
  --orientation square \
  --timeout-secs 120
```

- Exit: 0
- Elapsed: **8 giây**
- Output: 1600×1600 WebP, **202.804 bytes (~198 KB)**
- Không cần login, không qua chat, stderr trống, không lỗi quota/auth.
- Prompt phải nằm trong `--conversation-json`, không truyền positional prompt.

## Nén về 512

```bash
ffmpeg -y -i <output-1600.webp> \
  -vf scale=512:512 \
  -c:v libwebp -quality 75 \
  ~/workspace/langoo-pilot-smoke/smoke-512.webp
```

- ffmpeg `/usr/bin/ffmpeg` 8.1.2, có libwebp.
- Exit: 0, elapsed 0.08s
- Output: 512×512 WebP, **7.232 bytes** (ảnh apple đơn giản; ảnh thật có thể ~20 KB).

## Batch capability — đã test

- CLI **không có** flag `--num`, `--count`, `--batch`, `--max-images`; help ghi rõ output là **single final media file**.
- `--conversation-json` là mảng hội thoại nhiều lượt, **không phải batch**.
- Test 4 text entries (apple, cup, book, ball) trong một call: exit 0, 9s, nhưng chỉ sinh **1 file**; `media_paths` có 1 phần tử.
- Kết luận: **1 call = 1 ảnh**. Song song bằng N process CLI, không có batch 4 ảnh/call.

## Kết luận cho driver

1. Gọi CLI **một lần / sense**, output 1600 rồi ffmpeg 512×512 q75.
2. Rename theo `sense_id.webp`; lưu hash, CLI version, prompt hash.
3. Checkpoint sau generate; upload R2/DB sau đó.
4. 8s/ảnh trên mẫu đơn giản; phải đo lại với ảnh JLPT thật và 2–4 process song song trước khi scale.
5. CLI không cần auth trong shell; uploader vẫn cần Secure Vault cho R2/DB.
