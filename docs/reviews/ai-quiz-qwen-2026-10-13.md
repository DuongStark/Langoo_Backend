# Quiz ngữ cảnh chuyển sang Qwen/Groq (13/10/2026)

## Thay đổi

- **Transport riêng cho quiz**: quiz ngữ cảnh đọc `AI_QUIZ_API_KEY` /
  `AI_QUIZ_BASE_URL` trước, thiếu mới fallback `AI_API_KEY` / `AI_BASE_URL`
  (chat). Nhờ đó quiz dùng Qwen/Groq trong khi chat vẫn Space Bunny.
- Model: `qwen/qwen3.8-27b` trên Groq (catalog M10.2 còn hiệu lực; requests
  1000/giờ, tokens 8000/phút).
- VPS env đã áp: `AI_QUIZ_MODEL` = `AI_QUIZ_VALIDATOR_MODEL` =
  `qwen/qwen3.8-27b`; `AI_QUIZ_BASE_URL=https://api.groq.com/openai/v1`;
  `AI_QUIZ_API_KEY` = key Groq (từ backup M10.2).
  Backup env: `/opt/langoo/storage/config-backups/m11.3-quiz-qwen-20261013103428.env`.
- Ba lớp bền hoá provider ngữ cảnh (phát hiện khi test Qwen thật):
  1. **Không tin offset của model** — `render` tự tìm đúng một occurrence của
     mặt chữ và tự tính offset code-point (Qwen lệch ~nửa số câu trước fix).
  2. **Dung thứ JSON bọc ```json** (Qwen hay trả fenced).
  3. **Retry 429/5xx** backoff 2/4/6s trong deadline tổng (burst 10+ call dễ
     chạm trần 8k TPM của Groq).
- Ngữ cảnh quiz giờ **không chặn tạo quiz**: không sinh/kiểm được → trả câu từ
  đơn lẻ thay vì 503 (gộp cùng đợt quiz v2).

## Số đo

- Groq/Qwen: **0,2-0,6s/call** (space-bunny-alpha trước: 2-75s tuỳ lúc).
- Pilot thật trên VPS (dist + env production), 8 từ Kanji: **8/8 câu** sinh +
  kiểm đạt; câu tự nhiên (電車が遅れています。/ 犬が公園を走っている。/ 水 →
  今日は喉が渇いたので水を飲んだ。), options 4 + highlight đúng code point.

## Rollback

```bash
sudo cp /opt/langoo/storage/config-backups/m11.3-quiz-qwen-20261013103428.env \
        /opt/langoo/app/.env
sudo -u langoo bash -lc 'cd /opt/langoo/app && pm2 reload langoo-api'
```
Hoặc chỉ cần xoá `AI_QUIZ_BASE_URL` / `AI_QUIZ_API_KEY` để quiz quay về transport
chung với chat (Space Bunny). Code fallback tự nhiên, không cần revert code.
