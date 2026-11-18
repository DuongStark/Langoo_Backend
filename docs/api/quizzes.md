# API: Quizzes (AI Quiz — M11)

> M11.5 local ngày 18/11: đã xóa source Quiz V3, ENV AI_QUIZ_V3_* và luồng
> progressive/polling. Contract hiện tại là ngân hàng Quiz M11.5 ở cuối tài liệu.
> Không hỗ trợ tiếp tục phiên `m11.3-v3` theo giao thức cũ; FE tạo đề mới M11.5.
> Chưa deploy thay đổi dọn V3 lên VPS.

Tất cả endpoint dưới `/v1`, cần Bearer token. Người dùng chỉ chọn **dạng câu hỏi
(checkbox)**; câu hỏi được dựng từ dữ liệu, **không gọi AI** ngoại trừ câu ngữ cảnh
Kanji. Adapter ngữ cảnh sinh/kiểm câu Kanji và **tự fallback về từ đơn lẻ** khi
không có — quiz không fail vì thiếu ngữ cảnh.

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
    "question_count": 5,
    "question_types": ["multiple_choice", "fill_blank", "matching"]
  }'
```

- `question_types`: mảng con **không rỗng/không trùng** của `multiple_choice`,
  `fill_blank`, `matching`. Field cũ (`quiz_type`, `question_styles`, `context_mode`,
  `difficulty`) không còn được nhận → `400 VALIDATION_FAILED`.
- `collection_id`: UUID tùy chọn; bỏ field để dùng mọi collection trong hồ sơ hiện tại.
  `null` không hợp lệ. Collection phải thuộc hồ sơ hiện tại và chưa archive, kể cả khi dedup.
- Phân bổ: câu hỏi **luân phiên** các dạng đã chọn (tỉ lệ đều); **mỗi từ tối đa 1 câu**,
  một câu matching dùng 4 từ. Yêu cầu vượt số từ khả dụng → `409 QUIZ_NOT_ENOUGH_ITEMS`
  kèm `available`/`required` (không lặp câu).
- Trắc nghiệm tự trộn 3 dạng con `nghĩa → đọc Kanji → chọn chữ Kanji`; từ không đủ dữ
  liệu Kanji (kana-only/thiếu cặp/thiếu nhiễu) tự fallback câu nghĩa, không cần chọn.
- Kanji dùng target + nhiễu trong scope request, resolve form/reading restrictions theo
  đúng sense Nhật; MC 4 phương án khi đủ nhiễu, matching 4 cặp, fill-blank nhận
  lemma/reading/romaji. Không còn khái niệm độ khó.
- Nguồn từ vựng: item thuộc hồ sơ, collection chưa archive, item không `paused`, có `srs_state`
  thuộc đúng user/hồ sơ (**kể cả `new`**); ưu tiên `review → relearning → learning → new`,
  xáo trong cùng nhóm trạng thái giữa các lần tạo.
- Ngữ cảnh Kanji tự động: câu đã kiểm (cache) → câu từ điển có nguồn → AI sinh mới;
  hết cách thì hiển thị từ đơn lẻ (`context = null`). Không còn các lỗi
  `QUIZ_CONTEXT_UNAVAILABLE`/`QUIZ_CONTEXT_INVALID` — ngữ cảnh không chặn tạo quiz.
- Từ mục tiêu trong câu ngữ cảnh được bọc **【 】** (`context.sentence`, vd
  `毎日、【学校】へ行きます。`); `context.target` trỏ span bên trong dấu cho FE tự tô khung.
- MC nghĩa/matching loại mọi sense của lemma có nhiều nghĩa khác nhau vì đề template chưa có
  ngữ cảnh phân biệt. Sau lọc vẫn cần ≥2 từ khác nghĩa; nếu thiếu trả
  `409 QUIZ_NOT_ENOUGH_ITEMS` trước khi tiêu quota. Fill-blank vẫn dùng các sense này.

Response `201`:

```json
{
  "id": "019...",
  "collection_id": null,
  "quiz_type": "mixed",
  "question_count": 5,
  "status": "ready",
  "created_at": "2026-09-30T10:00:00.000Z",
  "expires_at": "2026-10-07T10:00:00.000Z",
  "reused": false
}
```

Lỗi: `409 QUIZ_NOT_ENOUGH_ITEMS` (không đủ từ cho kế hoạch câu hỏi) ·
`429 QUIZ_GENERATION_COOLDOWN` · `429 AI_QUOTA_EXCEEDED` · `404 COLLECTION_NOT_FOUND` ·
`400 VALIDATION_FAILED` · `503 AI_PROVIDER_UNAVAILABLE` (prepare transaction P2028 hết thời gian, lỗi provider hoặc lưu câu hỏi) ·
`409 QUIZ_METADATA_INVALID` (metadata mới không hợp lệ khi đọc/start).

Ví dụ trắc nghiệm thuần (Kanji vẫn tự trộn, không cần chọn style):

```bash
curl -s -X POST http://localhost:3000/v1/quizzes \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"collection_id":"<uuid>","question_count":10,"question_types":["multiple_choice"]}'
```

Kanji cần dữ liệu forms/restrictions được import đầy đủ; ít nhất 4 từ Nhật phân biệt được
không luôn đảm bảo đủ nhiễu nếu có aliases/homophones — từ thiếu dữ liệu tự fallback câu nghĩa.
Cấu hình model ở cuối tài liệu.

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
  "session": {
    "status": "completed",
    "correct_count": 2,
    "score": 67
  }
}
```

- **M8.3/M6.3:** XP đã bị xóa hoàn toàn; câu đúng và sai vẫn tính streak/activity
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

2026-10-13 — transport riêng cho quiz: quiz ngữ cảnh đọc `AI_QUIZ_API_KEY` /
`AI_QUIZ_BASE_URL` trước, thiếu mới fallback `AI_API_KEY` / `AI_BASE_URL` (chat).
VPS dùng Qwen/Groq riêng cho quiz trong khi chat vẫn Space Bunny.

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


## 2026-11-06 — M11.1: model và ngân sách chờ

- Production: chat `deepseek-ai/deepseek-v4.1-flash`/`none`; quiz generator **và** validator `zai-org/glm-5.3-flash`/`low`. Không gọi GLM cho câu dựng hoàn toàn từ dữ liệu. Đây là cấu hình triển khai, không phải model cố định trong code.
- `AI_QUIZ_TIMEOUT_MS=60000`: tổng budget sinh/kiểm ngữ cảnh. Hết budget fallback câu từ đơn lẻ theo cơ chế hiện có; không bỏ câu hỏi/quota hoặc thay dạng quiz.
- FE chỉ đặt timeout **120000ms** ở `POST /v1/quizzes`; các API khác giữ timeout cũ. Không tự động POST lại khi timeout: request có thể đã hoàn thành ở server. Kiểm tra danh sách/chi tiết quiz trước khi đề nghị tạo lại.
- Bản sửa BE local: P2028 ở prepare trả `503 AI_PROVIDER_UNAVAILABLE`, transaction rollback trước khi gọi AI; không gọi cleanup hoặc tự retry. Business error giữ mã/status cũ. Lỗi final persistence vẫn theo contract cũ (claim failed, lượt sau khi gọi provider giữ nguyên).
- Hai transaction có timeout 15s và maxWait 10s mỗi lần; cộng provider 60s là budget danh nghĩa 110s. Cleanup/usage, tải hệ thống, mạng/proxy có thể ảnh hưởng tổng; 120s không là SLA. Nếu chờ dài vẫn tái diễn, cân nhắc job async/poll riêng.
- Trạng thái triển khai và gate thực tế: [report M11.1](../reviews/m11.1-quiz-reliability-2026-11-06.md).

## M11.5 — Ngân hàng câu hỏi Quiz dùng chung và tạo đề tức thời (2026-11-18 — Code local)

`M11.5` thay thế toàn bộ cơ chế sinh câu trực tiếp/progressive của `M11.3` bằng
**Ngân hàng câu hỏi dùng chung (`app.quiz_question_bank`)** và một API đồng bộ duy nhất
`POST /v1/quizzes` trả đề `status = "ready"` từ kho sẵn có (**0 lệnh gọi AI lúc bấm tạo đề**,
**0 ghi `app.ai_usage`**, **0 cộng Streak / XP**).

- **Gỡ bỏ các route polling cũ:** `POST /v1/quizzes/jobs`, `GET /v1/quizzes/jobs/:id`,
  `POST /v1/quizzes/jobs/:id/actions` đã gỡ khỏi module (`404 Not Found`).
- **Tài liệu liên quan:** [Thiết kế M11.5](../design/m11.5-quiz-shared-question-bank-2026-11-18.md),
  [Kế hoạch M11.5](../plans/m11.5-quiz-shared-question-bank-2026-11-18.md),
  [Handoff FE M11.5](../handoff/m11.5-quiz-shared-bank-fe-2026-11-18.md),
  [Báo cáo thực thi M11.5](../reviews/m11.5-implementation-2026-11-18.md).

### 1. Kiểm tra điều kiện — `POST /v1/quizzes/eligibility` (`200 OK`)

Giữ cùng đường dẫn và request body `{ collection_id?, language_id, skills, question_count }`:

- `kanji_reading`, `kanji_orthography` trên bộ tiếng Anh hoặc bộ 0 từ Kanji trả `source_policy = "unavailable"` và `eligible_targets = 0`.
- `usage` (Đợt 2) và `paraphrase` (Đợt 2) trả `source_policy = "unavailable"`.
- `feasible` và `suggested_count` tính trên khả năng ghép thực tế **bao gồm cả fallback 0ms về `meaning`** nhưng **khử trùng theo `(sense_id, effective_skill)`** (ví dụ sổ tay 5 từ khi kho chưa có câu mẫu yêu cầu 10 câu ở 2 skill sẽ trả `feasible = false, suggested_count = 5`, không bao giờ sinh 2 câu `meaning` trùng hệt một từ).

### 2. Tạo đề đồng bộ tức thời — `POST /v1/quizzes` (`201 Created`)

```json
{
  "collection_id": "01900000-0000-7000-8000-000000000001",
  "language_id": 2,
  "skills": ["meaning", "context_meaning", "kanji_reading", "kanji_orthography", "context_cloze"],
  "question_count": 10,
  "idempotency_key": "01900000-0000-7000-8000-000000000099"
}
```

- Trả ngay `201 Created` với `status: "ready"`, `content_version: "m11.5-v1"`, `reused: boolean`.
- Cùng `(user, profile, idempotency_key)` trên đề `ready` còn hạn trả lại đúng đề cũ (`reused: true`).
- **Quy tắc chọn nhiễu & hạ bậc 0ms:**
  - `context_cloze`: cả từ đích lẫn 3 phương án nhiễu **bắt buộc thuộc sổ tay đang chọn của người học** (`collection_only`), cùng `pos_bucket` (`en:noun`, `ja:adj-i` tách biệt `ja:adj-na`...), khác `sense_id`/`concept_id`/`meaningVi`/`glossEn`, và không thuộc `excluded_words` của câu mẫu. Nếu thiếu đủ 3 nhiễu hợp lệ → hạ sang `context_meaning` → `meaning`.
  - Mục từ mà người học tự sửa `meaning_vi` lệch hẳn `serve.sense_card.gloss_vi` (`hasCustomMeaningOverride = true`) tự bỏ qua `context_cloze`/`context_meaning` từ kho chung để tránh lệch nghĩa cá nhân.
  - Tự động ưu tiên biến thể `variant_no` chưa xuất hiện trong 5 đề `m11.5-v1` gần nhất và loại bỏ mọi câu đã bị người học này báo lỗi; các `sense_id` chưa có câu trong kho được đẩy nền bất đồng bộ vào `app.quiz_bank_generation_job`.
- Payload legacy chỉ gửi `question_types` (không gửi `skills`) vẫn được giữ nhánh tương thích không gọi LLM trực tiếp.

### 3. Cấu trúc câu `segments` (`Cách A`) trên `GET /v1/quizzes/:id` & `POST /v1/quizzes/:id/start`

Mọi câu hỏi có ngữ cảnh trả trường `segments: { before: string; highlight: string | null; after: string } | null`:

- `kanji_reading` / `kanji_orthography` / `context_meaning`: `highlight !== null` (FE render gạch chân + tô đỏ nổi bật từ đích giữa `before` và `after`).
- `context_cloze`: `highlight === null` và `context === null` (FE render ô gạch chân trống ngay giữa `before` và `after`, tuyệt đối không lộ đáp án trước khi hoàn tất phiên).
- `meaning` / `matching`: `segments === null`.

### 4. Làm bài, Làm lại đề (`Retake`) & Gamification

- `POST /v1/quizzes/:id/start` nhận `{ intent?: "resume" | "new_attempt", idempotency_key?: UUID }`:
  - `resume` (mặc định): trả lại phiên `in_progress` đang làm dở.
  - `new_attempt`: sau khi phiên trước đã hoàn tất, tạo `StudySession` mới trên cùng `quiz_id` để luyện lại đề cũ (nếu còn phiên `in_progress` trả `409 QUIZ_ATTEMPT_IN_PROGRESS`).
- M11.5 trả `feedback_policy: "after_answer"`. Ngay khi ghi câu trả lời thành công, `POST /v1/sessions/:id/answers` trả `item.is_correct`, `item.correct_answer` và `item.credit` nếu có. `GET /v1/sessions/:id` cũng hiện phản hồi của các câu đã làm khi mở lại phiên. Câu chưa làm giữ `is_correct: null` và chưa có `correct_answer`.
- Phiên M11.5 mở trước thay đổi cũng dùng chính sách mới. Khi retry receipt cũ, server đọc kết quả câu đã lưu, giữ nguyên bài làm. Quiz V3 và chính sách feedback trì hoãn đã được gỡ khỏi code local.
- **Không cộng Streak (`app.streak_day`) và không cộng XP** trên phiên `m11.5-v1` (XP đã bị xóa ở M6.3).

### 5. Báo lỗi câu hỏi & Tự cách ly — `POST /v1/quizzes/:quiz_id/questions/:ordinal/report` (`202 Accepted`)

- Body `{ reason, note?, idempotency_key }`.
- **1 người báo lỗi:** trả `{ report_id, status: "recorded", cache_excluded: true }`, ẩn ngay câu hỏi kho đó khỏi mọi đề mới của người báo cáo (`reporter_hash`).
- **Từ 2 người học khác nhau báo lỗi cùng 1 câu kho (`report_count >= 2`):** tự chuyển `app.quiz_question_bank.status = "quarantined"` trên toàn hệ thống, trả `{ report_id, status: "quarantined", cache_excluded: true }` và tự đẩy tối đa `1` chu kỳ sinh bù (`replenish_cycles < 1`).

### 6. Biến môi trường Worker nền 24/7 (`DeepSeek` + `GLM`)

```env
QUIZ_BANK_WORKER_ENABLED=false
QUIZ_BANK_GENERATOR_BASE_URL=
QUIZ_BANK_GENERATOR_API_KEY=
QUIZ_BANK_GENERATOR_MODEL=
QUIZ_BANK_VALIDATOR_BASE_URL=
QUIZ_BANK_VALIDATOR_API_KEY=
QUIZ_BANK_VALIDATOR_MODEL=
```

Khi `QUIZ_BANK_WORKER_ENABLED=true`, `env.schema.ts` bắt buộc khai báo đủ 6 biến trên và
`QUIZ_BANK_GENERATOR_MODEL !== QUIZ_BANK_VALIDATOR_MODEL` để đảm bảo sinh (`DeepSeek`) và chấm mù (`GLM`) hoàn toàn độc lập. Hook lưu từ ở `ItemsService.add` đẩy `sense_id` mới vào hàng đợi không chặn (tối đa `30` sense `priority = 10`/user/ngày UTC, vượt ngưỡng hạ về `priority = 50`).

### Phản hồi ngay sau từng câu M11.5

Gửi đáp án với `POST /v1/sessions/:id/answers`. Response chứa `item.is_correct`, `item.correct_answer` và `item.credit` nếu có điểm thành phần. `GET /v1/sessions/:id` chỉ có đáp án cho các câu đã nộp. `session.settings.feedback_policy` có giá trị `after_answer`. Các trường tương thích `xp.amount` và `session.xp_awarded` vẫn có trước rollout M6.3, với Quiz M11.5 bằng 0.
