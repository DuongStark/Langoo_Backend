# API: Quizzes (AI Quiz — M11)

Tất cả endpoint dưới `/v1`, cần Bearer token. Provider sinh câu hỏi hiện là **stub
deterministic** (không tốn token AI); adapter LLM thật nằm trong backlog.

**Chống lạm dụng:** quota riêng `AI_QUIZ_DAILY_LIMIT` (mặc định **15/ngày** theo timezone user)
+ cooldown `AI_QUIZ_COOLDOWN_MS` (mặc định **15s**): bấm đúp *cùng tham số* trả lại quiz vừa tạo
(`reused: true`, không tiêu thêm quota); *khác tham số* trong cooldown → `429 QUIZ_GENERATION_COOLDOWN`.

## POST /v1/quizzes

```bash
curl -s -X POST http://localhost:3000/v1/quizzes \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "collection_id": "<uuid, tuỳ chọn>",
    "quiz_type": "mixed",
    "difficulty": "medium",
    "question_count": 5
  }'
```

- `quiz_type`: `multiple_choice` | `fill_blank` | `matching` | `mixed` (trộn MC → FB → matching).
- `difficulty`: `easy` | `medium` | `hard` (stub: MC 3/4/4 phương án; fill-blank easy-medium nhận
  thêm romaji; matching K = 3/4/4 cặp).
- Nguồn từ vựng: item thuộc hồ sơ, collection chưa archive, item không `paused`, có `srs_state`
  (**kể cả `new`**); ưu tiên `review → relearning → learning → new`.

Response `201`:

```json
{
  "id": "019...",
  "collection_id": null,
  "quiz_type": "mixed",
  "difficulty": "medium",
  "question_count": 5,
  "status": "ready",
  "created_at": "2026-09-30T10:00:00.000Z",
  "expires_at": "2026-10-07T10:00:00.000Z",
  "reused": false
}
```

Lỗi: `409 QUIZ_NOT_ENOUGH_ITEMS` (cần ≥2 từ) · `429 QUIZ_GENERATION_COOLDOWN` ·
`429 AI_QUOTA_EXCEEDED` · `404 COLLECTION_NOT_FOUND` · `400 VALIDATION_FAILED`.

## GET /v1/quizzes?limit&cursor

Lịch sử quiz (mới nhất trước, keyset cursor). Response `{ data, next_cursor }`, mỗi phần tử có
thêm `latest_session` (hoặc `null`):

```json
{ "id": "019...", "status": "completed", "item_count": 5, "correct_count": 4, "score": 80,
  "started_at": "...", "finished_at": "..." }
```

## GET /v1/quizzes/:id

Meta + danh sách câu hỏi **không kèm đáp án** + tối đa 5 session gần nhất.

- MC: `options` là mảng `[{ index, text }]`.
- Matching: `options` là mảng gắn nhãn `side` (`left`/`right`) — FE tách theo `side`:

```json
[
  { "index": 0, "text": "走る", "side": "left" },
  { "index": 0, "text": "chạy", "side": "right" }
]
```

## POST /v1/quizzes/:id/start

Tạo phiên học `kind='quiz'` (snapshot câu hỏi; trả về **đúng format `/sessions/:id`** của M7).
Mỗi lần start là một lượt làm mới; lịch sử giữ nguyên.

`prompt` của từng item:

```json
{ "kind": "multiple_choice", "text": "Nghĩa của 「走る」 (はしる) là gì?", "options": [{ "index": 0, "text": "chạy" }] }
{ "kind": "typing",         "text": "Điền từ còn thiếu (nghĩa: \"chạy\")" }
{ "kind": "matching",       "text": "Ghép từ với nghĩa tương ứng", "left": [...], "right": [...] }
```

Lỗi: `404 QUIZ_NOT_FOUND` · `409 QUIZ_NOT_READY` · `409 QUIZ_EXPIRED` (quiz sống 7 ngày).

## POST /v1/sessions/:id/answers

Dùng chung endpoint M7; với phiên quiz trả `srs: null`:

```bash
# trắc nghiệm
-d '{ "ordinal": 1, "option_index": 2 }'
# điền từ (chấp nhận lemma / reading / romaji tuỳ difficulty)
-d '{ "ordinal": 2, "answer_text": "走る" }'
# ghép cặp — đúng cả bộ mới tính đúng
-d '{ "ordinal": 3, "pairs": [ { "left_index": 0, "right_index": 2 }, { "left_index": 1, "right_index": 0 } ] }'
```

Response `200`:

```json
{
  "item": { "ordinal": 3, "is_correct": true, "correct_answer": { "mapping": [] } },
  "srs": null,
  "xp": { "amount": 5 },
  "session": { "status": "completed", "correct_count": 2, "score": 67, "xp_awarded": 10 }
}
```

- **XP:** rule `quiz_correct` (+5, cap 200) **chỉ khi đúng**; câu sai vẫn tính streak/activity.
- Màn "câu sai": `GET /v1/sessions/:id/items?is_correct=false`.
- Retry cùng `ordinal` trả nguyên kết quả cũ, không cộng XP lần hai (idempotent).

## Biến môi trường

```env
AI_QUIZ_DAILY_LIMIT=15      # quota sinh quiz/ngày (mặc định 15)
AI_QUIZ_COOLDOWN_MS=15000   # cooldown giữa 2 lần sinh (mặc định 15000)
```
