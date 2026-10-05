# API: Quizzes (AI Quiz — M11)

Tất cả endpoint dưới `/v1`, cần Bearer token. Provider sinh câu hỏi hiện là **stub
deterministic** (không tốn token AI); adapter LLM thật nằm trong backlog.

**Chống lạm dụng:** quota riêng `AI_QUIZ_DAILY_LIMIT` (mặc định **15/ngày** theo timezone user)
+ cooldown `AI_QUIZ_COOLDOWN_MS` (mặc định **15s**): bấm đúp *cùng tham số* trả lại quiz vừa tạo
(`reused: true`, không tiêu thêm quota); *khác tham số* trong cooldown → `429 QUIZ_GENERATION_COOLDOWN`.
Dedup chỉ áp dụng quiz `ready` còn hạn, cùng hồ sơ đang hoạt động và phiên bản generator
hiện tại. Request khi quiz đang `generating` trả `429 QUIZ_GENERATION_COOLDOWN`;
retry sau khi hoàn tất có thể nhận `reused: true`. Khóa PostgreSQL phối hợp request
giữa các tiến trình, quota và hàng quiz được tạo trong cùng transaction.

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
- `collection_id`: UUID tùy chọn; bỏ field để dùng mọi collection trong hồ sơ hiện tại.
  `null` không hợp lệ. Collection phải thuộc hồ sơ hiện tại và chưa archive, kể cả khi dedup.
- `difficulty`: `easy` | `medium` | `hard` (stub: MC 3/4/4 phương án; fill-blank easy-medium nhận
  thêm romaji; matching K = 3/4/4 cặp).
- Nguồn từ vựng: item thuộc hồ sơ, collection chưa archive, item không `paused`, có `srs_state`
  thuộc đúng user/hồ sơ (**kể cả `new`**); ưu tiên `review → relearning → learning → new`.
- MC/matching loại mọi sense của lemma có nhiều nghĩa khác nhau vì đề stub chưa có
  ngữ cảnh phân biệt. Sau lọc vẫn cần ≥2 từ khác nghĩa; nếu thiếu trả
  `409 QUIZ_NOT_ENOUGH_ITEMS` trước khi tiêu quota. Fill-blank vẫn dùng các sense này.

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
`429 AI_QUOTA_EXCEEDED` · `404 COLLECTION_NOT_FOUND` · `400 VALIDATION_FAILED` ·
`503 AI_PROVIDER_UNAVAILABLE` (lỗi provider hoặc lưu câu hỏi).

Nếu item nguồn bị xóa sau khi provider đã sinh câu hỏi, quiz vẫn lưu nội dung/đáp án
snapshot và đặt tham chiếu item bị xóa thành `null`. Lỗi lưu câu hỏi khác chuyển quiz
sang `failed` và trả 503. Quota đã dùng sau khi provider chạy được giữ; lỗi tạo hàng
quiz trước khi gọi provider rollback quota cùng transaction.

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

- **XP:** rule `quiz_correct` (+5, cap 200) **chỉ khi đúng**; câu sai vẫn tính streak/activity
  (mục tiêu ngày) nhưng **không** cộng `user_stats.reviews_total`/`reviews_1000` — hai bộ đếm
  này chỉ dành cho lượt ôn SRS.
- Với câu multiple choice, `option_index` phải có trong `prompt.options` của snapshot; index
  không hợp lệ trả `400 SESSION_ANSWER_INVALID` và không ghi activity.
- Matching phải ghép đủ các index trong `prompt.left/right`, mỗi index dùng đúng một lần.
  Index ngoài snapshot, thiếu cặp hoặc trùng left/right trả `400 SESSION_ANSWER_INVALID`,
  không ghi answer/receipt/activity; vẫn có thể gửi đáp án hợp lệ sau đó.
- Màn "câu sai": `GET /v1/sessions/:id/items?is_correct=false`.
- Retry cùng payload ở `ordinal` đã trả lời trả nguyên response ban đầu; payload khác trả
  `409 SESSION_IDEMPOTENCY_CONFLICT`. Câu cũ chưa có receipt trả
  `409 SESSION_REPLAY_UNAVAILABLE`. Không cộng XP lần hai.

## Biến môi trường

```env
AI_QUIZ_DAILY_LIMIT=15      # quota sinh quiz/ngày (mặc định 15)
AI_QUIZ_COOLDOWN_MS=15000   # cooldown giữa 2 lần sinh (mặc định 15000)
```
