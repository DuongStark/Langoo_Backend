# API: Quizzes (AI Quiz — M11)

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
  "xp": { "amount": 0 },
  "session": {
    "status": "completed",
    "correct_count": 2,
    "score": 67,
    "xp_awarded": 0
  }
}
```

- **M8.3:** XP mới tạm dừng; câu đúng và sai vẫn tính streak/activity
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

## M11.3 — Contract V3 opt-in (local, 2026-11-16)

Chưa deploy; `AI_QUIZ_V3_ENABLED=false` mặc định. Legacy `POST /quizzes` không đổi. [Handoff FE mục10](../handoff/m11.3-quiz-en-ja-fe-2026-11-16.md) là hướng dẫn consumer đầy đủ, [report](../reviews/m11.3-implementation-2026-11-16.md) ghi trạng thái kiểm chứng/gate. Không gửi các skill sau vào enum create legacy.

### Eligibility — POST /quizzes/eligibility → 200

```json
{
  "collection_id": "01900000-0000-7000-8000-000000000001",
  "language_id": 1,
  "skills": ["meaning", "context_cloze"],
  "question_count": 20
}
```

`collection_id` có thể bỏ trống để dùng profile hiện tại, không chấp nhận null. `language_id` phải thuộc profile; skills không trùng,1–8giá trị; question_count1–50. Thứ tự skill quyết định phân bố đều và phần dư. Một target tối đa hai kỹ năng; target+skill không lặp, matching cần bốn target/câu. Eligibility xét overlap các pool, không tính đơn giản số từ nhân số dạng.

Response:

```json
{
  "feasible": true,
  "eligible_target_count": 10,
  "requested_count": 20,
  "suggested_count": 20,
  "by_skill": [
    {"skill":"meaning","requested":10,"eligible_targets":10,"source_policy":"collection_only"},
    {"skill":"context_cloze","requested":10,"eligible_targets":10,"source_policy":"collection_only"}
  ],
  "reasons": [],
  "source_complete": true,
  "level_filter_supported": false,
  "sample_sources_supported": false
}
```

Đây là ví dụ dữ liệu đủ điều kiện, không phải cam kết AI sinh đủ. Không gọi model hoặc reserve quota khi preflight. Đọc tối đa501item, dùng cửa sổ500; source_complete false thì capacity là kết quả cửa sổ hữu hạn, không phải toàn bộ profile. suggested_count là số đã tìm được khả thi trong giới hạn số câu đang yêu cầu, có thể null.

Có code local: meaning/matching/kanji_reading/kanji_orthography/context_cloze/context_meaning/usage. Paraphrase chưa bật, reason `CURATED_PARAPHRASE_SOURCE_NOT_READY`. Bộ mẫu và cấp JLPT chưa bật: client phải tôn trọng capability false. Meaning/context/matching/orthography hiện chỉ dùng từ trong bộ; reading dùng nhiễu cách đọc theo quy tắc, usage tạo bốn câu cùng từ. Context cần metadata POS/ứng viên và model phù hợp, thiếu thì không tự hạ dạng.

Reasons khác: `AI_MODELS_NOT_CONFIGURED`, `INSUFFICIENT_ELIGIBLE_SOURCE`, `SOURCE_WINDOW_LIMIT_REACHED`. Ngôn ngữ sai profile/collection không sở hữu trả domain error thay vì source của người khác.

### Tác vụ — POST /quizzes/jobs → 202; GET /quizzes/jobs/:quiz_id → 200

Create body = eligibility body + `idempotency_key` UUID. Một ý định tạo đề dùng một key; retry mạng giữ key/payload. Receipt được tìm theo user/key trước đọc nguồn, request y hệt vẫn trả receipt gốc sau sửa/xóa nguồn. Cùng key/payload khác trả409`QUIZ_IDEMPOTENCY_CONFLICT`. Poll kiểm user và profile hiện tại; FE phải bỏ response cũ khi scope đổi.

```json
{
  "quiz_id":"01900000-0000-7000-8000-000000000002",
  "state":"running",
  "phase":"generate",
  "requested_count":20,
  "validated_count":8,
  "by_skill":[
    {"skill":"meaning","requested":10,"validated":4},
    {"skill":"context_cloze","requested":10,"validated":4}
  ],
  "allowed_actions":["cancel"],
  "reason":null,
  "usage_uncertain":false
}
```

State queued/running/needs_action/ready/failed/cancelled; phase queued/prepare/generate/audit/complete/waiting/terminal. Không có source/câu hỏi/đáp án trong progress. validated_count có thể giảm sau audit toàn đề; không suy ready từ count. Needs_action có thể còn nội dung chưa audit, chỉ cho nhận đề ngắn nếu allowed_actions có accept_shorter.

Một job active trong cùng user/profile/ngôn ngữ;409`QUIZ_JOB_ALREADY_ACTIVE` kèm `details.quiz_id` để tiếp tục/hủy. Reserve một lượt daily quota khi claim tạo job, không thêm lượt cho retry/recovery; token/cost vẫn ghi từng call. Không hoàn lượt tự động khi cancel/fail. Tối đa ba round, mỗi round theo `AI_QUIZ_V3_BUDGET_MS`, và90call intents/job; không phải SLA thời gian tạo đủ câu. Job TTL7ngày.

### Hành động — POST /quizzes/jobs/:quiz_id/actions → 200

Body `{"action":"retry"}` hoặc accept_shorter/cancel; trả cùng QuizJobResponse. Cancel/replay accept_shorter/retry đã được nhận xử lý theo trạng thái/idempotency, không hứa trạng thái có thể đảo ngược. Backend CAS và xác minh lại precondition. Chỉ nhận đề ngắn đã audit, có ít nhất một câu và nguồn còn hợp lệ. Ready thì dùng GET quiz/detail và start hiện có; không cắt câu client-side.

`QUIZ_SOURCE_CHANGED` khiến nội dung không còn được dùng; chỉ cancel rồi kiểm điều kiện mới. Không tự thay số câu, dạng, ngôn ngữ hoặc mở rộng sang bộ mẫu. Lỗi hết hạn/action không hợp lệ dùng domain error; flag tắt trả503`QUIZ_V3_DISABLED`. Privacy guard trước mỗi external call; lỗi privacy không được biến thành câu local.

### Làm bài và feedback V3

`POST /quizzes/:id/start` nhận body tùy chọn `{intent:'resume'}` hoặc `{intent:'new_attempt',idempotency_key:UUID}`. Resume V3 trả lượt đang dở; new attempt cần key, replay key trả cùng lượt, đang có lượt dở thì409`QUIZ_ATTEMPT_IN_PROGRESS`. Legacy giữ hành vi cũ. V3 kiểm profile trước tạo/làm tiếp.

Quiz V3 thêm `list.data[].content_version` / `detail.quiz.content_version` bằng `m11.3-v3`. Question/detail/session prompt V3 thêm `skill`, `quality_flags`; question_type vẫn multiple_choice/matching. Cloze là choice và không trả context.target chứa đáp án. Context đọc/chọn chữ dùng span Unicode code points. Rubric được snapshot theo version.

Settings có quiz_version/feedback_policy/target_count/attempt_key. Trong lượt đang làm, API sessions và quiz summaries che đúng/sai, rating, correct_answer, credit và score; correct_count tạm0. Query filter is_correct trả409`QUIZ_FEEDBACK_DEFERRED`. Sau completion refetch session để xem đáp án: receipt answer cũ giữ response gốc, không tự thay.

Matching V3 có credit earned/possible sau completion; correct_count vẫn câu đúng toàn bộ, score trung bình phần credit từng câu. Session detail có skill_summary theo kỹ năng và unique_target_count trên session; chưa hoàn thành summary rỗng. V3 không gọi gamification/SRS, trường XP compat bằng0, không cần UI XP. Không thêm giải thích dài; report lưu pending/cách ly cache qua route bên dưới, không gọi AI.

Triển khai/kiểm chứng: xem report M11.3; chưa có pilot model thật, chưa browser FE/độ khó JLPT/bộ mẫu, chưa commit/push/deploy. Không coi schema Swagger đã có code local là API production đã bật.

### Báo câu hỏi V3 — POST /quizzes/:id/questions/:ordinal/report → 202

Body `{reason,note?,idempotency_key}`; reason ambiguous/wrong_meaning/wrong_reading/unnatural/other, note tối đa500ký tự và không nhận null; ordinal1–50 phải tồn tại trong đề ready của user/profile hiện tại. Response `{report_id,status:'pending',cache_excluded:true}`.

Một pending/câu. Replay key/payload cùng receipt; đổi payload với key cũ409`QUIZ_IDEMPOTENCY_CONFLICT`; câu đã pending với key khác409`QUIZ_REPORT_NOT_AVAILABLE`. Không gọi model hoặc thêm usage/quota. Cách ly cache key trong cùng user/profile/language, kể cả bản copy ở các quiz khác; không sửa lịch sử/điểm. Question metadata có quality flag reported_pending. Pending là phản hồi chưa thẩm định, không phải kết luận câu sai. Chưa có API tự sửa/moderation UI.
