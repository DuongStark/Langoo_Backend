# API: Quizzes (AI Quiz — M11)

Tất cả endpoint dưới `/v1`, cần Bearer token. Câu hỏi nghĩa, nối từ, nhập từ theo
gợi ý và Kanji không ngữ cảnh được dựng từ dữ liệu, **không gọi AI**. Adapter
ngữ cảnh chỉ sinh/kiểm các câu Kanji cần ngữ cảnh mới; câu đã kiểm phù hợp được tái sử dụng.

**Chống lạm dụng:** quota riêng `AI_QUIZ_DAILY_LIMIT` (mặc định **15/ngày** theo timezone user)

- cooldown `AI_QUIZ_COOLDOWN_MS` (mặc định **15s**): bấm đúp _cùng tham số_ trả lại quiz vừa tạo
  (`reused: true`, không tiêu thêm quota); _khác tham số_ trong cooldown → `429 QUIZ_GENERATION_COOLDOWN`.
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
- `question_styles`: tùy chọn, mảng không rỗng/không trùng gồm `meaning`, `kanji_reading`,
  `kanji_orthography`; chỉ dùng với `multiple_choice` hoặc `mixed`. Bỏ field mặc định
  `['meaning']`. Với mixed, chỉ các slot MC luân phiên styles theo thứ tự canonical trên;
  fill-blank/matching vẫn chạy bằng code. Không nhận null.
- `context_mode`: `none` (mặc định), `source` (câu từ điển), `source_or_generated`
  (ưu tiên câu từ điển/câu đã kiểm, sinh mới khi thiếu). Mode khác none cần Kanji style.
- Kanji chỉ lấy target và nhiễu trong scope request, resolve form/reading restrictions theo
  đúng sense Nhật. Luôn có 4 options, kể cả easy. Không đủ target + 3 nhiễu hợp lệ trả
  `409 QUIZ_NOT_ENOUGH_ITEMS` trước quota; không tự chuyển sang câu nghĩa. Difficulty không phải cấp JLPT.
- Nguồn từ vựng: item thuộc hồ sơ, collection chưa archive, item không `paused`, có `srs_state`
  thuộc đúng user/hồ sơ (**kể cả `new`**); ưu tiên `review → relearning → learning → new`.
- MC nghĩa/matching loại mọi sense của lemma có nhiều nghĩa khác nhau vì đề template chưa có
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

Ngữ cảnh có thêm `503 QUIZ_CONTEXT_UNAVAILABLE` (thiếu cấu hình model cần dùng, trước quota),
`503 QUIZ_CONTEXT_INVALID` (không tạo/kiểm được câu đúng nghĩa và một đáp án, sau provider),
`409 QUIZ_METADATA_INVALID` (metadata mới không hợp lệ khi đọc/start).

Ví dụ Kanji không gọi AI:

```bash
curl -s -X POST http://localhost:3000/v1/quizzes \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"collection_id":"<uuid>","quiz_type":"multiple_choice","question_styles":["kanji_reading","kanji_orthography"],"context_mode":"none","difficulty":"medium","question_count":10}'
```

Đổi `context_mode` thành `source_or_generated` để luyện Kanji trong câu. Cần dữ liệu
forms/restrictions được import đầy đủ; ít nhất 4 từ Nhật phân biệt được không luôn đảm bảo
đủ nhiễu nếu có aliases/homophones. Cấu hình model ở cuối tài liệu.

Nếu item nguồn bị xóa sau khi provider đã sinh câu hỏi, quiz vẫn lưu nội dung/đáp án
snapshot và đặt tham chiếu item bị xóa thành `null`. Lỗi lưu câu hỏi khác chuyển quiz
sang `failed` và trả 503. Quota đã dùng sau khi provider chạy được giữ; lỗi tạo hàng
quiz trước khi gọi provider rollback quota cùng transaction.

## GET /v1/quizzes?limit&cursor

Lịch sử quiz (mới nhất trước, keyset cursor). Response `{ data, next_cursor }`, mỗi phần tử có
thêm `latest_session` (hoặc `null`):

```json
{
  "id": "019...",
  "status": "completed",
  "item_count": 5,
  "correct_count": 4,
  "score": 80,
  "started_at": "...",
  "finished_at": "..."
}
```

## GET /v1/quizzes/:id

Meta + danh sách câu hỏi **không kèm đáp án** + tối đa 5 session gần nhất.

- MC: `options` là mảng `[{ index, text }]`.
- Từng câu có `question_style` (`meaning`, `kanji_reading`, `kanji_orthography`,
  `fill_blank`, `matching`) và `context` (null nếu không có ngữ cảnh).
- Quiz cũ không có style metadata vẫn đọc/start/chấm theo hành vi cũ.
- Matching: `options` là mảng gắn nhãn `side` (`left`/`right`) — FE tách theo `side`:

```json
[
  { "index": 0, "text": "走る", "side": "left" },
  { "index": 0, "text": "chạy", "side": "right" }
]
```

Ví dụ phần context của câu chọn Kanji (đáp án chỉ xuất hiện trong options để lựa chọn):

```json
{
  "question_style": "kanji_orthography",
  "context": {
    "sentence": "毎日、がっこうへ行きます。",
    "target": { "start": 3, "end": 7, "text": "がっこう" },
    "origin": "generated",
    "attribution": null
  }
}
```

Offsets tính theo Unicode code point, end exclusive. FE dùng `Array.from(sentence)`
để highlight; không dùng offsets này trực tiếp với UTF-16 `substring`. Origin dictionary
có attribution nguồn; generated hiển thị nhãn câu AI tạo. Response không có câu nguồn
chưa mask, evidence, model metadata hay correct answer.

## POST /v1/quizzes/:id/start

Tạo phiên học `kind='quiz'` (snapshot câu hỏi; trả về **đúng format `/sessions/:id`** của M7).
Mỗi lần start là một lượt làm mới; lịch sử giữ nguyên.

`prompt` của từng item:

```json
{ "kind": "multiple_choice", "text": "Nghĩa của 「走る」 (はしる) là gì?", "options": [{ "index": 0, "text": "chạy" }] }
{ "kind": "typing",         "text": "Điền từ còn thiếu (nghĩa: \"chạy\")" }
{ "kind": "matching",       "text": "Ghép từ với nghĩa tương ứng", "left": [...], "right": [...] }
```

Snapshot prompt còn có `question_style` và `context` giống GET detail; giữ được khi
item nguồn bị xóa. Chấm Kanji vẫn bằng `option_index`, không thêm loại grading mới.

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
  "item": {
    "ordinal": 3,
    "is_correct": true,
    "correct_answer": { "mapping": [] }
  },
  "srs": null,
  "xp": { "amount": 5 },
  "session": {
    "status": "completed",
    "correct_count": 2,
    "score": 67,
    "xp_awarded": 10
  }
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
AI_QUIZ_MODEL=qwen/qwen3.8-27b  # model sinh câu, không tự lấy AI_CHAT_MODEL
AI_QUIZ_VALIDATOR_MODEL=qwen/qwen3.8-27b  # lượt kiểm riêng, cùng model sinh
AI_QUIZ_TIMEOUT_MS=60000   # budget thời gian tổng cho sinh/kiểm một quiz
```

M10.2 (07/10): dùng Qwen trên Groq (`AI_BASE_URL=https://api.groq.com/openai/v1`),
key Groq hiện có. Hai lượt sinh/kiểm dùng cùng model không phải hai reviewer độc lập.

Ngữ cảnh chưa có evidence cần `AI_PROVIDER=openai`, `AI_API_KEY`, `AI_BASE_URL`
(OpenAI-compatible gateway) và model tương ứng. Dữ liệu/câu đã kiểm phù hợp không cần
gọi model. Model và key không cần cho quiz nghĩa/nối từ/Kanji mode none.

Chỉ tái sử dụng tối đa 25 quiz ready gần đây trong cùng user/profile, với fingerprint
đúng sense/forms/gloss/source/policy và bộ options; model đang cấu hình đổi thì cần kiểm lại.
Khi tắt transport/model vẫn tái sử dụng được evidence đã đạt policy hiện tại. Đổi thứ tự options vẫn tái sử dụng;
đổi bộ options cần kiểm lại. Câu nguồn chưa kiểm cần một lượt validator; không sinh lại câu.
Tối đa hai câu nguồn được kiểm và hai candidate mới cho mỗi slot, trong timeout tổng.
Nếu không đủ câu đạt gate, quiz failed; không publish bài thiếu câu. Kiểm AI vẫn có thể sai.

Metadata nội bộ ghi local/reused/calls/tokens; thiếu usage provider thì ghi estimated.
`app.ai_usage` cộng token đã dùng kể cả lần sinh thất bại; câu local/cache hit = 0 token.
Quota lượt quiz 15/ngày hiện tại vẫn giữ nguyên. Không có migration/dependency mới;
API chỉ đọc core/serve, snapshot ghi app. Xem [bàn giao FE](../handoff/quiz-kanji.md).

## 2026-10-08 — M6.2 — Nguồn quiz theo ngôn ngữ hiện tại

Code local: nguồn quiz chọn một face thuộc primary/secondary của hồ sơ collection,
ưu tiên anchor nếu còn phù hợp; nếu anchor EN bị ẩn nhưng có face JA thì dùng JA.
Item không còn face hợp lệ bị loại trước khi tạo quiz. Không thay đổi item, mapping
hay lịch SRS. FE hủy lượt tạo/phiên đang xem và tải lại sau khi đổi hồ sơ/ngôn ngữ;
không hiển thị tiếp snapshot quiz thuộc scope trước đó. Chưa deploy thay đổi này.

M6.2: khi thay đổi tập ngôn ngữ, quiz `ready` của hồ sơ được đánh dấu `expired`
để không reuse snapshot theo scope cũ. Câu hỏi/lịch sử vẫn được giữ; tạo quiz mới
vẫn tuân cooldown/quota. Nếu đổi hồ sơ/ngôn ngữ trong lúc AI đang tạo câu hỏi,
BE trả `409 QUIZ_SCOPE_CHANGED` và đánh dấu job failed; FE báo cần tạo lại,
không render kết quả cũ.
