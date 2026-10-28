---
name: sse-stream-tester
description: >-
  Use this skill when developing, testing, or debugging Server-Sent Events (SSE) streaming endpoints in Langoo, particularly AI Chatbot and Quiz Generator.
  Covers curl stream inspection, error frame verification, and provider fallback behavior.
---

# Server-Sent Events (SSE) Stream Testing Guide

Langoo's AI Chatbot (`src/ai/chat`) and streaming quiz endpoints use **Server-Sent Events (`text/event-stream`)** to deliver real-time token streams from LLM providers (Groq, Qwen, Space Bunny).

---

## 1. Testing Endpoints with cURL

Always use `-N` (or `--no-buffer`) to ensure responses stream token-by-token:

```bash
curl -N -X POST http://localhost:3000/v1/ai/chat/stream \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{
    "message": "Giải thích ngữ pháp N3 bài 1",
    "language": "ja"
  }'
```

---

## 2. Event Format Contract

A valid Langoo stream emits chunks following standard SSE format:

```text
event: message
data: {"delta": "Chào", "done": false}

event: message
data: {"delta": " bạn!", "done": false}

event: done
data: {"delta": "", "done": true, "usage": {"prompt_tokens": 12, "completion_tokens": 5}}
```

---

## 3. Error Handling Contract

1. **Error BEFORE Stream Starts (e.g. 401 Unauthorized, 400 Bad Request, 503 Provider Down before delta):**
   - The server must respond with standard HTTP status code and JSON error payload (e.g. `{"statusCode": 503, "message": "..."}`).
2. **Error DURING Stream (after headers/first delta sent):**
   - The connection is already 200 OK. The error must be emitted as an SSE error event:
     ```text
     event: error
     data: {"error": "Stream interrupted by upstream provider", "recoverable": false}
     ```
3. **Client Abort Signal:**
   - The controller must forward `req.signal` or listen to `req.on('close')` to cancel ongoing upstream LLM requests immediately and prevent resource waste.
