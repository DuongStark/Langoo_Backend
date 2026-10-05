# API: Chat AI (M10)

Tất cả endpoint dưới `/v1`, cần Bearer token. Provider mặc định `stub` (trả lời demo,
không cần key) — xem cấu hình thật ở cuối trang.

## POST /v1/chat/sessions

Tạo phiên chat. `scenario`: `general` | `vocabulary` | `grammar` | `conversation`.

```bash
curl -s -X POST http://localhost:3000/v1/chat/sessions \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{ "language_id": 2, "scenario": "vocabulary", "title": "Học từ vựng N5" }'
```

Response `201`:

```json
{
  "id": "019...",
  "language_id": 2,
  "scenario": "vocabulary",
  "title": "Học từ vựng N5",
  "model": "stub-v1",
  "prompt_version": "m10-v1",
  "message_count": 0,
  "last_message_at": null,
  "created_at": "2026-09-29T10:00:00.000Z",
  "archived_at": null
}
```

## GET /v1/chat/sessions?limit&cursor

Danh sách phiên (ẩn phiên đã archive), keyset cursor theo `created_at,id`.
Response `{ data, next_cursor }`.

## GET · PATCH · DELETE /v1/chat/sessions/:id

- `GET` — chi tiết (kể cả phiên archived).
- `PATCH` `{ title?, scenario? }` — đổi tên/kịch bản; phiên archived → `409 CHAT_SESSION_ARCHIVED`.
- `DELETE` — **archive mềm**, idempotent (gọi lại trả cùng `archived_at`).
- Nếu archive khi AI đang xử lý, kết quả của lượt đó bị hủy, không lưu thêm tin;
  POST đang chờ trả `409 CHAT_SESSION_ARCHIVED`. Lượt đã gọi provider vẫn tính quota.
- Field optional chỉ được bỏ qua khi không gửi; `null` trả `400 VALIDATION_FAILED`.

## GET /v1/chat/sessions/:id/messages?limit&cursor

Lịch sử tin nhắn theo thời gian tăng dần (`limit` mặc định 50, tối đa 100).

## POST /v1/chat/sessions/:id/messages

```bash
curl -s -X POST http://localhost:3000/v1/chat/sessions/<id>/messages \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{ "content": "走る nghĩa là gì?", "ref_sense_id": "1" }'
```

- `content`: 1–2.000 ký tự (trim trước khi lưu).
- `ref_sense_id` (tuỳ chọn): gửi kèm ngữ cảnh nghĩa từ điển (`serve.sense_card`) cho lượt hỏi;
  sai id → `404 SENSE_NOT_FOUND` và **không** tiêu quota.

Response `200`:

```json
{
  "user_message": {
    "id": "101",
    "role": "user",
    "content": "走る nghĩa là gì?",
    "ref_sense_id": "1",
    "...": "..."
  },
  "assistant_message": {
    "id": "102",
    "role": "assistant",
    "content": "[stub] 走る (はしる): chạy...",
    "...": "..."
  },
  "usage": { "request_count": 2, "limit": 50 }
}
```

Lỗi: `404 CHAT_SESSION_NOT_FOUND` · `409 CHAT_SESSION_ARCHIVED` ·
`429 AI_QUOTA_EXCEEDED` (hết lượt AI trong ngày) · `503 AI_PROVIDER_UNAVAILABLE` ·
`409 CHAT_SESSION_BUSY` · `409 CHAT_REQUEST_EXPIRED` ·
`404 SENSE_NOT_FOUND` · `400 VALIDATION_FAILED`.

Mỗi phiên chỉ xử lý một lượt gửi tại một thời điểm, kể cả khi API chạy nhiều process.
Gửi thêm khi đang chờ → `409 CHAT_SESSION_BUSY`, không tiêu quota; đợi lượt hiện tại
xong rồi gửi tiếp. Khóa tạm hết hạn sau 60 giây để phục hồi khi process dừng đột ngột;
kết quả quá hạn/bị thay thế trả `409 CHAT_REQUEST_EXPIRED` và không ghi tin.

Model gọi AI lấy từ `AI_CHAT_MODEL` hiện tại, nên phiên demo cũ vẫn dùng được sau khi
đổi provider. `session.model` ghi alias đã dùng; `assistant_message.model` ghi metadata
model thực tế provider trả về. Metadata không được dùng làm alias cho lượt sau.

Lưu ý: khi provider lỗi (503) tin nhắn **không được lưu**; quota của lượt đã gọi provider vẫn tính.

## GET /v1/chat/usage

```json
{ "feature": "chat", "period": "2026-09-29", "request_count": 2, "limit": 50 }
```

`period` theo **timezone của user** (`app.user_settings.timezone`).

## Cấu hình provider

```env
# Demo, không cần key:
AI_PROVIDER=stub

# Trả lời thật qua OpenAI-compatible (OpenAI hoặc gateway như OpenCode Zen):
AI_PROVIDER=openai
AI_API_KEY=<key>
AI_CHAT_MODEL=<model-id>
AI_BASE_URL=https://opencode.ai/zen/v1   # bỏ trống = https://api.openai.com/v1
AI_DAILY_REQUEST_LIMIT=50
```

- `AI_PROVIDER=openai` mà thiếu `AI_API_KEY`/`AI_CHAT_MODEL` → **app không khởi động** (fail-fast).
- `AI_PROVIDER=gemini` chưa được triển khai (dùng gateway OpenAI-compatible nếu cần Gemini qua Zen).

## OpenCode Zen — model miễn phí

Cấu hình backend dùng adapter OpenAI-compatible:

```env
AI_PROVIDER=openai
AI_API_KEY=<OpenCode-Zen-API-key>
AI_BASE_URL=https://opencode.ai/zen/v1
AI_CHAT_MODEL=space-bunny-free
AI_DAILY_REQUEST_LIMIT=50
```

API gọi `https://opencode.ai/zen/v1/chat/completions`. Gửi model ID trực tiếp
(`space-bunny-free`), không dùng tên cấu hình CLI `opencode/space-bunny-free`.

Ngày 2026-10-03, đã đối chiếu [tài liệu Zen](https://opencode.ai/docs/zen/)
và [catalog API](https://opencode.ai/zen/v1/models): `space-bunny-free`,
`longcat-2.5-preview-free`, `mimo-v2.6-flash-free` đều có trong catalog và được
tài liệu ghi miễn phí qua endpoint chat/completions. Model miễn phí có thể thay đổi;
kiểm tra lại catalog và bảng giá khi đổi model. Backend không tự fallback sang model khác.

Lấy danh sách trước khi chọn:

```bash
curl -fsS https://opencode.ai/zen/v1/models
```

Thử gọi trực tiếp sau khi bạn có key (biến `OPENCODE_API_KEY` do bạn thiết lập):

```bash
curl -sS https://opencode.ai/zen/v1/chat/completions \
  -H "Authorization: Bearer $OPENCODE_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"space-bunny-free","messages":[{"role":"user","content":"Giải thích ngắn từ hello bằng tiếng Việt."}]}'
```

Trước khi chạy bản sửa, apply migration **037_chat_request_lease.sql** qua
`npm run db:migrate`, rồi `npm run prisma:generate` và `npm run build`.
Lệnh migration dùng `DIRECT_URL` trong môi trường bạn đang triển khai.
