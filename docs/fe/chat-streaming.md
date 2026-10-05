# FE — Chat streaming (SSE) · M10.1

> Tài liệu cho **LLM/dev làm Frontend**. Backend đã xong: endpoint trả lời dần hoạt động trên
> production `https://langoo-api.pixpress.art`. Mục tiêu: chat hiện chữ dần như ChatGPT.
> Đọc kèm: [`docs/api/chat.md`](../api/chat.md).

## 1. TL;DR

- Gọi `POST {API}/v1/chat/sessions/:id/messages/stream` với `fetch` + `Authorization: Bearer <token>`.
- Response là `text/event-stream`; đọc `response.body.getReader()`, tách block theo `\n\n`.
- Sự kiện: `start` → `delta`* → `done` (hoặc `error`). Mỗi `delta` có `content` — **append ngay vào bong bóng chat**.
- `done` trả về **đúng payload như endpoint cũ** (`user_message`, `assistant_message`, `usage`) — dùng nó để thay thế trạng thái tạm (lấy id thật từ server).
- Không dùng `EventSource` (không gửi được POST + header Authorization).
- Endpoint cũ `POST .../messages` vẫn còn — dùng làm fallback.

## 2. Kết nối & xác thực

| | |
| --- | --- |
| API base (prod) | `https://langoo-api.pixpress.art` |
| Đăng nhập | `POST /v1/auth/login` `{ email, password }` → `access_token` (Bearer) |
| Tài khoản demo để test | `admin@langoo.local` / `Langoo-Admin-2026!` (tài khoản mock trên DB demo) |
| CORS | đang mở `*` — gọi từ mọi origin trong lúc dev |

```bash
TOKEN=$(curl -s -X POST https://langoo-api.pixpress.art/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@langoo.local","password":"Langoo-Admin-2026!"}' | jq -r .access_token)

SID=$(curl -s -X POST https://langoo-api.pixpress.art/v1/chat/sessions \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"language_id":2,"scenario":"general"}' | jq -r .id)
```

## 3. Contract

### Request

```http
POST /v1/chat/sessions/{sessionId}/messages/stream
Authorization: Bearer <access_token>
Content-Type: application/json
```

```json
{ "content": "Viết 3 câu giới thiệu Hà Nội.", "ref_sense_id": "1" }
```

- `content`: 1–2.000 ký tự (trim trước khi lưu). `ref_sense_id` tuỳ chọn (đính ngữ cảnh nghĩa từ điển).

### Response — `text/event-stream`

```
event: start
data: {"model":"openai/gpt-oss-120b"}

event: delta
data: {"content":"Hà Nội là "}

event: delta
data: {"content":"thủ đô của Việt Nam..."}

event: done
data: { "user_message": { "id":"75", "role":"user", "content":"...", "ref_sense_id":null, "tokens_in":null, "tokens_out":null, "cost_usd":null, "model":null, "created_at":"..." },
        "assistant_message": { "id":"76", "role":"assistant", "content":"...", "tokens_in":138, "tokens_out":138, "cost_usd":"0", "model":"openai/gpt-oss-120b", "created_at":"..." },
        "usage": { "request_count": 3, "limit": 50 } }
```

Sự kiện khác:

```
event: error
data: {"code":"AI_PROVIDER_UNAVAILABLE","message":"Trợ lý AI đang bận, vui lòng thử lại sau"}
```

- Server có thể chèn comment giữ nhịp `: ping` mỗi 15s — **bỏ qua** (dòng bắt đầu bằng `:`).
- Event lạ → bỏ qua để tương lai không vỡ client.

### Lỗi trả JSON (trước khi stream bắt đầu)

| HTTP | code | Nghĩa / cách xử lý |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED` | content rỗng/quá dài, cursor lỗi… |
| 404 | `CHAT_SESSION_NOT_FOUND` / `SENSE_NOT_FOUND` | phiên/ref sense không tồn tại |
| 409 | `CHAT_SESSION_ARCHIVED` | phiên đã archive — mở phiên khác |
| 409 | `CHAT_SESSION_BUSY` | đang có 1 lượt chạy trong phiên — **đợi rồi gửi lại** (FE không nên gửi khi `streaming=true`) |
| 429 | `AI_QUOTA_EXCEEDED` | hết quota AI trong ngày (kèm `usage` trong response) |
| 503 | `AI_PROVIDER_UNAVAILABLE` | provider lỗi/429/timeout — hiện nút "Thử lại" |

> Phân biệt: lỗi **giữa stream** (đã có delta) sẽ là `event: error` trên HTTP 200, không phải JSON status.

## 4. Quy tắc UX

1. **Optimistic**: hiện tin nhắn user ngay khi gửi (id tạm `local-*`).
2. Trong lúc stream: hiện bong bóng assistant đang gõ chữ dần từ `delta`; **disable nút gửi** + hiện nút **Dừng**.
3. Khi nhận `done`: thay toàn bộ tin nhắn `local-*` bằng `user_message` + `assistant_message` từ server (id thật), cập nhật `usage` (quota còn lại).
4. Khi `error` giữa stream: giữ phần chữ đã hiện + hiện lỗi + nút "Thử lại" (gửi lại cùng nội dung).
5. Hủy (nút Dừng): `abort()` fetch → backend cũng dừng gọi provider; tin nhắn **không** được lưu (giống lỗi); **quota vẫn tính** cho lượt đó (đúng thiết kế backend).
6. Sau `done`/`error`: refresh danh sách tin nhắn nếu cần (`GET .../messages`) — thường không cần vì `done` đã trả đủ.

## 5. Reference implementation (copy-paste)

### 5.1 Parser + gọi API (framework-agnostic, TypeScript)

```ts
export type ChatStreamEvent =
  | { type: 'start'; model: string }
  | { type: 'delta'; content: string }
  | { type: 'done'; response: SendMessageResponse }
  | { type: 'error'; code: string; message: string };

export interface SendMessageResponse {
  user_message: ChatMessage;
  assistant_message: ChatMessage;
  usage: { request_count: number; limit: number };
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  ref_sense_id: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: string | null;
  model: string | null;
  created_at: string;
}

export class ChatApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ChatApiError';
  }
}

export async function* streamChatMessage(
  apiBaseUrl: string,
  accessToken: string,
  sessionId: string,
  body: { content: string; ref_sense_id?: string },
  signal?: AbortSignal,
): AsyncGenerator<ChatStreamEvent> {
  const response = await fetch(
    `${apiBaseUrl}/v1/chat/sessions/${sessionId}/messages/stream`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
      signal,
    },
  );

  const contentType = response.headers.get('content-type') ?? '';
  if (!response.ok || !contentType.includes('text/event-stream')) {
    const payload = (await response.json().catch(() => null)) as {
      code?: string;
      message?: string;
    } | null;
    throw new ChatApiError(
      response.status,
      payload?.code ?? 'UNKNOWN',
      payload?.message ?? `HTTP ${response.status}`,
    );
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let index = buffer.indexOf('\n\n');
    while (index >= 0) {
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const event = parseSseBlock(block);
      if (event) yield event;
      index = buffer.indexOf('\n\n');
    }
  }
}

function parseSseBlock(block: string): ChatStreamEvent | null {
  let eventName = 'message';
  const dataLines: string[] = [];
  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.startsWith(':')) continue; // heartbeat ": ping"
    if (line.startsWith('event:')) eventName = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;

  const data = JSON.parse(dataLines.join('\n')) as Record<string, unknown>;
  switch (eventName) {
    case 'start':
      return { type: 'start', model: String(data.model ?? '') };
    case 'delta':
      return { type: 'delta', content: String(data.content ?? '') };
    case 'done':
      return { type: 'done', response: data as unknown as SendMessageResponse };
    case 'error':
      return {
        type: 'error',
        code: String(data.code ?? 'UNKNOWN'),
        message: String(data.message ?? 'Lỗi không xác định'),
      };
    default:
      return null; // event lạ: bỏ qua
  }
}
```

### 5.2 React hook (minh hoạ)

```tsx
import { useRef, useState } from 'react';

interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export function useChatStream(
  apiBaseUrl: string,
  token: string,
  sessionId: string,
  onUsage?: (usage: { request_count: number; limit: number }) => void,
) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [draft, setDraft] = useState(''); // nội dung assistant đang chảy
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function send(content: string, refSenseId?: string): Promise<void> {
    if (streaming || content.trim() === '') return;
    setError(null);
    setStreaming(true);
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, role: 'user', content },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;
    let partial = '';

    try {
      for await (const event of streamChatMessage(
        apiBaseUrl,
        token,
        sessionId,
        { content, ref_sense_id: refSenseId },
        controller.signal,
      )) {
        if (event.type === 'delta') {
          partial += event.content;
          setDraft(partial);
        } else if (event.type === 'done') {
          setMessages((prev) => [
            ...prev.filter((m) => !m.id.startsWith('local-')),
            event.response.user_message as UiMessage,
            event.response.assistant_message as UiMessage,
          ]);
          setDraft('');
          onUsage?.(event.response.usage);
        } else if (event.type === 'error') {
          throw new ChatApiError(200, event.code, event.message);
        }
      }
    } catch (err) {
      if (controller.signal.aborted) {
        // Người dùng bấm Dừng: giữ tin user (local), cho phép gửi lại.
        return;
      }
      setError(err instanceof Error ? err.message : 'Lỗi không xác định');
      if (partial !== '') {
        // Giữ phần đã stream để người dùng thấy, kèm nút "Thử lại".
        setMessages((prev) => [
          ...prev,
          { id: `partial-${Date.now()}`, role: 'assistant', content: partial },
        ]);
        setDraft('');
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function cancel(): void {
    abortRef.current?.abort();
  }

  return { messages, draft, streaming, error, send, cancel, setMessages };
}
```

## 6. Test nhanh (không cần UI)

```bash
# Xem event chảy dần theo thời gian:
curl -N -s -X POST "https://langoo-api.pixpress.art/v1/chat/sessions/$SID/messages/stream" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"content":"Viết 3 câu ngắn giới thiệu Hà Nội."}'
```

Kỳ vọng (đo thực tế 05/10, ~2,2s tổng):

```
event: start   (~0,9s)
event: delta ... (chữ chảy dần)
event: done    (~2,2s)  ← payload đầy đủ
```

## 7. Xử lý sự cố

| Hiện tượng | Nguyên nhân thường gặp | Cách sửa |
| --- | --- | --- |
| Không có delta nào, chờ mãi | Dùng `EventSource` (không gửi được POST/Auth) hoặc proxy dev buffer | Dùng `fetch` + reader; gọi thẳng API hoặc tắt nén/buffer ở proxy dev |
| `response.json()` báo lỗi | Đang đọc stream bằng json | Kiểm tra `content-type` trước; stream thì đọc reader |
| Chữ tiếng Việt vỡ | `TextDecoder` thiếu `{ stream: true }` hoặc decode từng mảnh rời | Dùng đúng snippet mục 5.1 (buffer + decoder streaming) |
| Nhận `409 CHAT_SESSION_BUSY` | Bấm gửi 2 lần / tab khác đang stream cùng phiên | Disable nút khi `streaming`; gặp 409 thì đợi 1–2s rồi thử lại |
| Gặp `event: error` giữa chừng | Provider 429/quá tải | Hiện lỗi + nút "Thử lại" (backend đã tự retry 1 lần trước delta) |
| Mất quota dù bấm Dừng | Thiết kế: đã gọi provider là tính 1 lượt | Ghi rõ trong UI (tooltip) nếu cần |

## 8. Liên kết

- Contract backend đầy đủ + endpoint cũ: [`docs/api/chat.md`](../api/chat.md)
- Kế hoạch M10.1: [`docs/plans/m10.1-chat-streaming.md`](../plans/m10.1-chat-streaming.md)
- Vận hành VPS: [`docs/ops/vps-deployment.md`](../ops/vps-deployment.md)
