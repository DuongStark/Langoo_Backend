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
xong rồi gửi tiếp. Khóa tạm hết hạn sau `2 × AI_CHAT_TIMEOUT_MS + 700ms + 30s`
(mặc định **150,7 giây**) để bao trọn hai lần thử provider và phục hồi khi process dừng đột ngột;
kết quả quá hạn/bị thay thế trả `409 CHAT_REQUEST_EXPIRED` và không ghi tin.

Model gọi AI lấy từ `AI_CHAT_MODEL` hiện tại, nên phiên demo cũ vẫn dùng được sau khi
đổi provider. `session.model` ghi alias đã dùng; `assistant_message.model` ghi metadata
model thực tế provider trả về. Metadata không được dùng làm alias cho lượt sau.

Lưu ý: khi provider lỗi (503) tin nhắn **không được lưu**; quota của lượt đã gọi provider vẫn tính.

## POST /v1/chat/sessions/:id/messages/stream — SSE (M10.1)

> 🧑‍💻 **FE**: hướng dẫn triển khai đầy đủ (parser SSE + React hook + edge cases) tại
> [`docs/fe/chat-streaming.md`](../fe/chat-streaming.md).

Trả lời **dần như ChatGPT**: server đẩy từng đoạn ngay khi provider sinh ra.
Cùng quota/lease/persist với endpoint thường; khi stream lỗi giữa chừng sẽ có
`event: error` thay vì HTTP 503.

`start` được gửi ngay trước **delta có nội dung đầu tiên**; trong lúc đang chờ provider
và retry chưa có delta, server giữ khả năng trả JSON với HTTP status đúng.
Provider được thử lại tối đa một lần khi 429/5xx/timeout trước delta; mỗi lần thử có
timeout `AI_CHAT_TIMEOUT_MS`. Không retry sau khi đã phát nội dung hoặc client đã hủy.

```bash
curl -N -X POST http://localhost:3000/v1/chat/sessions/<id>/messages/stream \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{ "content": "Viết đoạn 100 từ giới thiệu Hà Nội." }'
```

Luồng sự kiện (`text/event-stream`):

```
event: start
data: {"model":"openai/gpt-oss-120b"}

event: delta
data: {"content":"Hà Nội là "}

event: delta
data: {"content":"thủ đô của Việt Nam..."}

event: done
data: { "user_message": {...}, "assistant_message": {...}, "usage": { "request_count": 3, "limit": 50 } }
```

Lỗi giữa stream:

```
event: error
data: {"code":"AI_PROVIDER_UNAVAILABLE","message":"Trợ lý AI đang bận, vui lòng thử lại sau"}
```

FE đọc bằng `fetch` + `ReadableStream` (không dùng `EventSource` vì cần header
Authorization + body):

```ts
const res = await fetch(`${API}/v1/chat/sessions/${id}/messages/stream`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ content }),
});
const reader = res.body!.getReader();
const decoder = new TextDecoder();
let buffer = '';
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  // tách block theo '\n\n'; mỗi block có 'event: <tên>' và 'data: <json>'
}
```

Lỗi **trước delta đầu** (busy/archived/quota/provider fail) vẫn trả JSON status
như endpoint thường (`409 CHAT_SESSION_BUSY`, `429 AI_QUOTA_EXCEEDED`, `503 AI_PROVIDER_UNAVAILABLE`…).

- Stream upstream phải kết thúc bằng event `[DONE]` hoàn chỉnh; EOF/malformed event
  không được coi là câu trả lời thành công. Không lưu phần chữ đã phát khi provider lỗi.
- Lỗi lưu DB sau delta trả `event: error`: `CHAT_STREAM_FAILED`, hoặc mã domain như
  `CHAT_SESSION_ARCHIVED`/`CHAT_REQUEST_EXPIRED`. Không có `done`; transaction rollback
  cả hai tin nhắn, counter và token usage. Quota đã reserve vẫn tính một lượt.
- Client hủy kết nối sẽ hủy upstream, dừng retry và giải phóng lease. Hủy được quan sát
  trước/ở trong transaction sẽ không lưu lượt chat. Nếu hủy sau khi transaction đã commit,
  dữ liệu đã lưu vẫn tồn tại dù client chưa nhận `done`; hãy tải lại lịch sử trước khi gửi lại.

## GET /v1/chat/usage

```json
{ "feature": "chat", "period": "2026-09-29", "request_count": 2, "limit": 50 }
```

`period` theo **timezone của user** (`app.user_settings.timezone`).

## M10.3 — Gửi ảnh tạm thời

Cả `POST /v1/chat/sessions/:id/messages` và `/messages/stream` nhận thêm:

```json
{
  "content": "Đọc và giải thích đoạn tiếng Nhật trong ảnh.",
  "images": ["data:image/png;base64,<BASE64>"]
}
```

- `content` vẫn bắt buộc 1–2.000 ký tự. `images` có thể bỏ qua; nếu gửi thì 1–3
  data URLs PNG/JPEG/WebP, tối đa **2 MiB decoded mỗi ảnh**; JSON tối đa **9 MiB**.
  Không nhận URL ngoài/SVG/GIF, null, mảng rỗng hoặc base64 không canonical.
- FE đọc file bằng FileReader (`readAsDataURL`), gửi cùng JSON và Bearer token;
  stream giữ SSE contract hiện có. Body lớn chỉ được bật ở hai route gửi chat.
- BE kiểm dung lượng và chữ ký định dạng trong RAM, không decode/render ảnh;
  provider có thể từ chối ảnh hỏng dù chữ ký đúng. Không tạo file, không lưu ảnh,
  data URL hay URL vào DB; lịch sử/response chỉ câu hỏi và câu trả lời.
- Ảnh chỉ có trong lượt hiện tại. Lượt hỏi sau phải gửi lại ảnh nếu cần AI xem;
  FE không hứa khôi phục ảnh sau tải lại trang. Không có API lấy ảnh lịch sử.
- Provider `openai` cần model hỗ trợ vision (Qwen đang cấu hình hỗ trợ). Stub
  trả `400 CHAT_IMAGES_UNAVAILABLE`; ảnh sai trả `400 CHAT_IMAGES_INVALID`
  (DTO sai có thể `VALIDATION_FAILED`); body quá lớn trả `413 CHAT_BODY_TOO_LARGE`.
  Validate ảnh/provider trước reserve quota, giữ auth/lease/quota hiện có.
- Log không ghi request body hay chi tiết HTTP error upstream có thể echo ảnh.
  RAM được giải phóng theo lifecycle request/GC; không cam kết xóa RAM vật lý.
  Không lưu ở Langoo không thay thế chính sách dữ liệu của provider.
- Stream ảnh yêu cầu usage cuối từ provider; khi thiếu usage, token ảnh ước lượng
  2.048/ảnh theo Qwen/Groq, không tính độ dài base64 là token văn bản. Provider
  usage thật được ưu tiên. Chưa có bảng giá tính costUsd cho model.

## Cấu hình provider

```env
# Demo, không cần key:
AI_PROVIDER=stub

# Trả lời thật qua OpenAI-compatible (OpenAI / Groq / gateway như OpenCode Zen):
AI_PROVIDER=openai
AI_API_KEY=<key>
AI_CHAT_MODEL=qwen/qwen3.8-27b
AI_BASE_URL=https://api.groq.com/openai/v1   # bỏ trống = https://api.openai.com/v1
AI_DAILY_REQUEST_LIMIT=50
# M10.1 (tuỳ chọn): timeout provider + giới hạn token + mức suy luận
AI_CHAT_TIMEOUT_MS=60000
# AI_CHAT_MAX_TOKENS=1024
# AI_CHAT_REASONING_EFFORT=low
```

- `AI_PROVIDER=openai` mà thiếu `AI_API_KEY`/`AI_CHAT_MODEL` → **app không khởi động** (fail-fast).
- `AI_PROVIDER=gemini` chưa được triển khai (dùng gateway OpenAI-compatible nếu cần Gemini qua Zen).

## Groq — Qwen cho chat (M10.2, 07/10)

```env
AI_PROVIDER=openai
AI_API_KEY=<Groq key (gsk_...)>
AI_BASE_URL=https://api.groq.com/openai/v1
AI_CHAT_MODEL=qwen/qwen3.8-27b
# Để trống nếu chưa kiểm tham số reasoning với model mới:
AI_CHAT_REASONING_EFFORT=
```

Catalog xác thực trên VPS 07/10 có `qwen/qwen3.8-27b`; cấu hình chat/quiz dùng
model này theo yêu cầu chủ dự án. Model thuộc preview theo [Groq models](https://console.groq.com/docs/models).

Số liệu cũ cho GPT-OSS (không phải Qwen), đo 05/10: **~0,6–2,2s/câu**.
Free tier: 30 req/phút · 1.000 req/ngày · 8K token/phút (model `openai/gpt-oss-120b`).
Ghi nhận cũ: Qwen có lúc lẫn tiếng Trung; cần kiểm chất lượng JA/VI khi dùng thật.
Đổi model qua env, không đổi protocol/API hay cần FE cài lại.

## OpenCode Zen — lưu ý thực tế (kiểm chứng 05/10)

- Endpoint đúng cho app: `https://opencode.ai/zen/v1` (⚠️ **không** dùng `/zen/go/v1` —
  endpoint Go bắt buộc header `x-opencode-session`, app sẽ nhận `400` → `503`).
- Các model free khác (`longcat-2.5-preview-free`, `mimo-*`, `big-pickle`…) trả
  **403 "free tier can only be used from within OpenCode"** khi gọi từ API ngoài.
- `space-bunny-free` gọi được nhưng là model suy luận: **6–22s/câu**, có lúc trả rỗng;
  nếu dùng nên đặt `AI_CHAT_REASONING_EFFORT=low` và `AI_CHAT_MAX_TOKENS` đủ lớn.
- Model trả phí cần balance/Go còn hạn (không thì `402 Insufficient account funds`).

Ngày 2026-10-03, đã đối chiếu [tài liệu Zen](https://opencode.ai/docs/zen/)
và [catalog API](https://opencode.ai/zen/v1/models). Backend không tự fallback sang model khác.

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
Xem thêm kế hoạch: [`docs/plans/m10-ai-chatbot.md`](../plans/m10-ai-chatbot.md),
[`docs/plans/m10.1-chat-streaming.md`](../plans/m10.1-chat-streaming.md).
