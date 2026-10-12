# AI hỏi đáp chuyển sang Space Bunny (12/10/2026)

## Phạm vi
- Đổi provider AI chat (M10) từ Groq/qwen3.8-27b sang **Space Bunny** (`space-bunny-alpha`
  qua `https://spacebunnymodel.com/api/v1`) — theo yêu cầu "cho space bunny vào phần hỏi đáp AI".
- Không sửa code: dùng `AI_PROVIDER=openai` (OpenAI-compatible) + env. Backup:
  `/opt/langoo/app/.env.bak-20261012-ai-spacebunny`.

## Thay đổi env (VPS)
```
AI_BASE_URL=https://spacebunnymodel.com/api/v1
AI_API_KEY=<Space Bunny sb_live key>
AI_CHAT_MODEL=space-bunny-alpha
AI_QUIZ_MODEL=space-bunny-alpha
AI_QUIZ_VALIDATOR_MODEL=space-bunny-alpha
AI_CHAT_MAX_TOKENS=4000   # reasoning model cần đủ token
```
(Giữ AI_PROVIDER=openai, timeout 60s, daily limit 50.)

## Kiểm chứng (sau restart)
- Node fetch từ VPS tới Space Bunny OK (200, ~2,7s), kể cả **streaming SSE** — không dính
  chặn Cloudflare như client Python (UA mặc định).
- **Chat non-stream**: session tạo OK, reply có nội dung; message lưu
  `model=minimax/minimax-m3`, tokens (644, 239).
- **Chat stream** (`/v1/chat/sessions/:id/messages/stream`): `event: start`
  `{"model":"space-bunny-alpha"}` + delta tiếng Việt trôi đúng (đếm 1–5 kèm giải thích kanji).
- Search/dictionary không hồi quy (smoke 200).

## Lưu ý
- **Ảnh trong chat (M10.3)**: chưa smoke — `space-bunny-alpha` (minimax-m3) khả năng
  không nhận `image_url`; nếu FE dùng ảnh cần test riêng hoặc tách model ảnh.
- **Quiz** dùng chung base URL → cũng chạy `space-bunny-alpha`; smoke tạo quiz bị chặn
  bởi dữ liệu (user test chưa có collection phù hợp — `QUIZ_NOT_ENOUGH_ITEMS`), không
  phải lỗi model.
- Dữ liệu chat đi qua **router của Space Bunny** (bên thứ ba) — cần lưu ý privacy
  trước khi dùng chính thức cho người dùng thật.
- Reasoning model: hiếm khi trả content rỗng (toàn token vào thinking) → service báo
  "bận"; nếu gặp thường xuyên tăng `AI_CHAT_MAX_TOKENS`.

## Rollback
```bash
cp /opt/langoo/app/.env.bak-20261012-ai-spacebunny /opt/langoo/app/.env
su - langoo -c "pm2 restart langoo-api"
```
