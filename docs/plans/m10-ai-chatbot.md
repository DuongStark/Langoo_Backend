# Kế hoạch M10 — AI Chatbot

> Trạng thái: **đã triển khai local (chờ review)**. Ngày: 2026-09-29.
> Chốt với chủ dự án qua thảo luận trực tiếp (D1–D7 theo đề xuất) + bổ sung `AI_BASE_URL`
> để cắm gateway OpenAI-compatible (OpenCode Zen/Go, OpenAI, proxy…).
>
> Bản sửa sau review 2026-10-03: env trống, model alias, gửi đồng thời,
> archive trong lúc gửi, null DTO và ngày cursor. Thêm migration **037** cho
> khóa tạm của phiên; xem [recheck](../reviews/m10-recheck-2026-10-03.md).

## 1. Mục tiêu & phạm vi

- Chatbot hỏi đáp học ngoại ngữ: tạo phiên, gửi tin, lịch sử, xoá mềm.
- Provider trừu tượng: `stub` (mặc định, không cần key) + `openai` (OpenAI-compatible, base URL cấu hình được) + `gemini` (chưa triển khai — chọn sẽ fail-fast khi boot).
- Quota theo ngày địa phương + thống kê `ai_usage` (request/token/chi phí) — dùng chung cho M11 quiz.
- Bảng gốc có từ 023; bản sửa 2026-10-03 thêm migration **037_chat_request_lease.sql**.

**Ngoài phạm vi (backlog):** streaming SSE; nén `summary`; adapter Gemini riêng; tool-calling;
idempotency tin nhắn (retry mạng có thể gửi trùng);
bảng giá token để tính `cost_usd` thật.

Retention 180 ngày đã được triển khai trong scheduler M12.

## 2. Quyết định đã chốt

| # | Nội dung | Chốt |
| --- | --- | --- |
| D1 | `scenario` | whitelist `general｜vocabulary｜grammar｜conversation`, default `general` |
| D2 | Provider thiếu key | fail-fast lúc boot khi `AI_PROVIDER=openai` thiếu `AI_API_KEY`/`AI_CHAT_MODEL`; `gemini` báo "chưa triển khai" |
| D3 | Quota | `AI_DAILY_REQUEST_LIMIT` default **50/ngày**, theo ngày địa phương user, vượt → `429 AI_QUOTA_EXCEEDED` |
| D4 | Giới hạn | 2.000 ký tự/tin; history gửi provider 20 tin gần nhất |
| D5 | Xoá phiên | archive mềm (`archived_at`), idempotent; phiên archived không gửi tin (`409`) |
| D6 | Idempotency tin nhắn | backlog (M12) |
| D7 | `GET /v1/chat/usage` | có |
| — | Gateway | thêm `AI_BASE_URL` (mặc định `https://api.openai.com/v1`) — dùng được OpenCode Zen (`https://opencode.ai/zen/v1`) |

**Lệch nhỏ so với bản thảo:** list phiên sắp theo `created_at DESC, id DESC` (không dùng
`last_message_at`) để keyset cursor không vướng NULL — đơn giản, ổn định.

## 3. API

| Endpoint | Mô tả |
| --- | --- |
| `POST /v1/chat/sessions` | tạo phiên `{language_id, scenario?, title?, profile_id?}` → 201 |
| `GET /v1/chat/sessions?limit&cursor` | danh sách (ẩn archived), keyset |
| `GET /v1/chat/sessions/:id` | chi tiết |
| `PATCH /v1/chat/sessions/:id` | đổi `title`/`scenario` |
| `DELETE /v1/chat/sessions/:id` | archive mềm, idempotent |
| `GET /v1/chat/sessions/:id/messages?limit&cursor` | lịch sử tin (tăng dần) |
| `POST /v1/chat/sessions/:id/messages` | `{content, ref_sense_id?}` → user+assistant+usage |
| `GET /v1/chat/usage` | quota hôm nay |

Lỗi: `404 CHAT_SESSION_NOT_FOUND` (kể cả phiên người khác) · `409 CHAT_SESSION_ARCHIVED` ·
`429 AI_QUOTA_EXCEEDED` · `503 AI_PROVIDER_UNAVAILABLE` · `404 SENSE_NOT_FOUND` (ref sense sai) ·
`400 VALIDATION_FAILED`.

Luồng gửi tin: xác thực phiên → claim khóa tạm DB (bận → `409 CHAT_SESSION_BUSY`,
không tiêu quota) → validate/ref sense → **reserve quota nguyên tử** →
gọi provider (ngoài transaction) → transaction lưu 2 tin + cập nhật `chat_session` +
cộng `ai_usage`. Provider lỗi → 503, không lưu tin (quota đã tính vì đã gọi provider).
Transaction chỉ lưu nếu token khóa còn đúng, chưa hết hạn và phiên chưa archived;
archive hủy token, kết quả đang chờ bị từ chối 409. Model request dùng cấu hình hiện tại;
model trả về lưu trên tin assistant làm metadata.

## 4. Quota (nguyên tử, chống race)

```sql
INSERT INTO app.ai_usage (user_id, period, feature, request_count)
VALUES ($1, $2, 'chat', 1)
ON CONFLICT (user_id, period, feature) DO UPDATE
  SET request_count = app.ai_usage.request_count + 1
  WHERE app.ai_usage.request_count < $limit
RETURNING request_count
```
`period` = ngày địa phương (`localDateString`, timezone user — đúng quy tắc streak M6.1).

## 5. Prompt & context

- System prompt tiếng Việt theo `scenario` (4 mẫu), nêu ngôn ngữ đích.
- Chèn block ngữ cảnh sense (lemma/reading/pos/gloss + cờ `is_machine` + ví dụ) khi có `ref_sense_id`.
- History: 20 tin gần nhất, thứ tự thời gian tăng dần. `prompt_version = 'm10-v1'`.
- Không gửi dữ liệu riêng khác của user (privacy — khớp chính sách M13).

## 6. File & test

- `src/ai/providers/*` (interface, stub, openai-compatible, factory) + spec.
- `src/ai/usage/ai-usage.service.ts` + spec.
- `src/ai/chat/*` (controller, service, cursor, context-builder, dto) + spec.
- `test/chat.e2e-spec.ts`: tạo phiên/gửi tin/lịch sử, ref sense, quota 429, archive 409, cách ly user,
  validation biên; `AI_DAILY_REQUEST_LIMIT=3` cho test.
- Env: thêm `AI_BASE_URL`; `.env.example`; docs `docs/api/chat.md`; PROGRESS.
