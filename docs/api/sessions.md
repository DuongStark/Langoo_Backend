# API: Sessions (phiên ôn — M7)

Phiên ôn là **snapshot**: khi tạo phiên, server chọn thẻ, dựng đề và lưu vào
`study_session` + `study_session_item`. **Đáp án luôn được chấm ở server** — client không
bao giờ gửi `is_correct`/điểm (gửi lên sẽ bị `400 VALIDATION_FAILED` do whitelist DTO).

Mọi lượt trả lời đi qua **cùng một engine với `POST /v1/srs/reviews`** (`ReviewEngine`):
scheduler Anki → `review_log` → `srs_state` → burying sibling → XP thô. Khác biệt duy nhất:
`practice` được ôn trước và miễn due/daily cap; `review` áp due, learn-ahead và quota như
`/srs/due`. Cả hai loại vẫn kiểm tra lại ownership, profile, ngôn ngữ, archive/paused,
suspend và bury trong transaction khi trả lời.

## Chế độ & cách chấm

| `mode`            | Client gửi                 | Server chấm                                          | Rating quy đổi    |
| ----------------- | -------------------------- | ---------------------------------------------------- | ----------------- |
| `flashcard`       | `rating` 1–4 (tự đánh giá) | `rating ≥ 3` = đúng                                  | chính `rating`    |
| `multiple_choice` | `option_index`             | so với đáp án đúng đã sinh                           | đúng → 3, sai → 1 |
| `matching`        | `option_index`             | như MCQ (FE bày dạng ghép cặp)                       | đúng → 3, sai → 1 |
| `typing`          | `answer_text`              | chuẩn hoá `trim + lowercase`, so danh sách chấp nhận | đúng → 3, sai → 1 |

- `typing` theo chiều thẻ: **recognize** hỏi từ → gõ nghĩa; **recall** hỏi nghĩa → gõ từ
  (chấp nhận lemma, reading kana, romaji, mọi form của lexeme).
- MCQ/matching sinh `option_count` lựa chọn (mặc định 4) từ sổ tay **cùng profile đang học**
  và cùng ngôn ngữ; ưu tiên cùng collection (áp trong SQL trước `LIMIT`); thiếu câu nhiễu thì
  giảm số lựa chọn (tối thiểu 1).
- `listening` chưa hỗ trợ ở M7 → `400 VALIDATION_FAILED`.

## POST /v1/sessions

`kind`: `review` = thẻ đến hạn (tôn trọng daily limit + learn-ahead như `/srs/due`);
`practice` = **ôn trước** từ trong bộ (kể cả chưa đến hạn, không áp daily limit),
`limit` 1–50 (mặc định 20). Cả hai vẫn cập nhật lịch SRS.

Để một lượt không chứa sibling sẽ bị bury ngay khi trả lời sibling đầu, mỗi
`collection_item` đóng góp tối đa một thẻ new/review vào snapshot; learning cards
giữ nguyên. Trong `practice`, bộ candidate đọc tối đa bốn lịch mỗi item trước khi
lọc, nên vẫn có thể trả đủ `limit` item khác nhau. Các lịch SRS không bị xóa/gộp.

Phiên chốt **một** `profile_id` ngay khi tạo: thẻ, câu nhiễu và bản ghi session dùng cùng
hồ sơ đó. Đổi `active_profile_id` xen giữa (trước đây `collectDueRows` đọc lại active profile)
không còn làm session lưu profile A nhưng chứa thẻ profile B.

```bash
curl -s -X POST http://localhost:3000/v1/sessions \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"kind":"review","mode":"multiple_choice","limit":20}'
```

```json
{
  "session": {
    "id": "01a0…",
    "kind": "review",
    "mode": "multiple_choice",
    "status": "in_progress",
    "item_count": 16,
    "answered_count": 0,
    "correct_count": 0,
    "score": null,
    "xp_awarded": 0,
    "settings": { "option_count": 4 },
    "started_at": "…",
    "finished_at": null
  },
  "items": [
    {
      "id": "12",
      "ordinal": 1,
      "srs_id": "7",
      "face_id": "…",
      "prompt": {
        "kind": "multiple_choice",
        "direction": "recognize",
        "language": { "id": 2, "code": "ja", "name_vi": "Tiếng Nhật" },
        "question": { "kind": "word", "text": "走る", "reading": "はしる" },
        "options": [
          { "index": 0, "text": "chạy" },
          { "index": 1, "text": "ăn" }
        ]
      },
      "is_correct": null,
      "rating": null,
      "answered_at": null
    }
  ]
}
```

- **`correct_answer` bị ẩn** với câu chưa trả lời; chỉ hiện trong item đã trả lời. Nếu câu hỏi
  nghĩa được dùng, snapshot giữ `meaning_source` và `is_machine_generated`.
- Lỗi: `409 SESSION_NO_CARDS` (không có thẻ phù hợp) · `409 PROFILE_REQUIRED`.

## GET /v1/sessions/:id

Chi tiết phiên + tiến độ; đáp án chỉ hiện với câu **đã trả lời**. Dùng để resume sau khi
thoát app. `404 SESSION_NOT_FOUND` khi không tồn tại hoặc của user khác.

## GET /v1/sessions/:id/items?is_correct=false

Danh sách câu **đã trả lời**, kèm `correct_answer` để xem lại. Đây là màn **"câu sai"**
(`?is_correct=false`); bỏ query để xem tất cả câu đã trả lời.

## POST /v1/sessions/:id/answers

Mỗi câu trả lời được chấm và ghi cùng transaction: khóa user → item → `srs_state`, kiểm tra
eligibility/quota (đối với `review`), áp scheduler, ghi `review_log`, cập nhật tiến độ phiên
và lưu response gốc. Retry cùng `ordinal` với payload tương đương sau chuẩn hoá (typing
không phân biệt hoa thường; thứ tự cặp matching không quan trọng) → **trả đúng response của
lần đầu**, kể cả khi session/SRS đã tiến thêm; không áp lần hai, không cộng XP lần hai.
Payload khác, kể cả `elapsed_ms` khác, trả `409 SESSION_IDEMPOTENCY_CONFLICT`. Câu trả lời
đã ghi trước migration nhưng chưa có response gốc trả `409 SESSION_REPLAY_UNAVAILABLE`;
lịch sử câu trả lời vẫn đọc được.

```bash
# flashcard
curl -s -X POST http://localhost:3000/v1/sessions/<id>/answers \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"ordinal":1,"rating":3,"elapsed_ms":3200}'

# multiple_choice / matching
curl -s -X POST http://localhost:3000/v1/sessions/<id>/answers \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"ordinal":1,"option_index":2}'

# typing
curl -s -X POST http://localhost:3000/v1/sessions/<id>/answers \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"ordinal":1,"answer_text":"走る"}'
```

Response `200`:

```json
{
  "item": {
    "ordinal": 1,
    "is_correct": true,
    "rating": 3,
    "user_answer": { "option_index": 2 },
    "correct_answer": { "index": 2, "text": "chạy" },
    "answered_at": "…"
  },
  "srs": {
    "state": "learning",
    "due_at": "…",
    "interval_days": 0,
    "ease_factor": 2.5,
    "learning_step": 1
  },
  "xp": { "amount": 1 },
  "session": {
    "answered_count": 1,
    "correct_count": 1,
    "status": "in_progress"
  }
}
```

- Trả lời **câu cuối** → phiên tự `completed`, ghi `finished_at` + `score` (% đúng).
- `option_index` phải trùng một `index` có trong `prompt.options` của snapshot; index ngoài
  danh sách bị từ chối trước khi ghi câu trả lời/SRS/XP.
- Lỗi: `400 SESSION_ANSWER_INVALID` (thiếu/sai trường theo mode hoặc index không có trong
  snapshot) ·
  `404 SESSION_ITEM_NOT_FOUND` (ordinal không có) · `409 SESSION_CLOSED` (phiên đã đóng;
  replay câu đã trả lời có receipt vẫn trả `200`) · `409 SESSION_IDEMPOTENCY_CONFLICT` /
  `SESSION_REPLAY_UNAVAILABLE` · `409 SRS_ITEM_UNAVAILABLE`/`SRS_DAILY_LIMIT_REACHED` khi
  eligibility hoặc quota thay đổi · `422 SRS_ITEM_NOT_DUE` khi review chưa đến hạn và không
  đủ điều kiện learn-ahead. Câu bị chặn không được đánh dấu đã trả lời.

## POST /v1/sessions/:id/finish

Đóng phiên sớm: đã trả lời hết → `completed` + `score`; còn thiếu → `abandoned`
(`score = null`). Idempotent (phiên đã đóng trả nguyên trạng thái).

## Suspend thẻ — PATCH /v1/srs/cards

```bash
curl -s -X PATCH http://localhost:3000/v1/srs/cards \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"face_id":"<uuid>","direction":"recognize","suspended":true}'
# → {"srs_id":"7","state":"learning","suspended":true}
```

Thẻ suspended biến khỏi `/srs/due` **và** khỏi mọi phiên mới; unsuspend (`false`) đưa thẻ
trở lại đúng lịch cũ. `404 SRS_ITEM_NOT_FOUND` nếu không thuộc user.

Swagger UI: `http://localhost:3000/docs` (nhóm **sessions**, **srs**).
