# API: SRS (ôn tập ngắt quãng)

Thuật toán: **Anki verbatim** — đặc tả đầy đủ [`docs/srs.md`](../srs.md).
Tất cả endpoint cần **Bearer token**; số liệu "ngày" tính theo `user_settings.timezone`.

## GET /v1/srs/due

Hàng đợi hôm nay: thứ tự **intraday learning → interday learning → review → new**; có
**learn-ahead 20 phút** chỉ khi toàn bộ queue thường trong phạm vi đã cạn; tôn trọng **daily
limit** (`srs_new_per_day` / `srs_review_per_day` trong `/me/settings`); lọc theo hồ sơ đang
hoạt động; **thẻ anh em (sibling) đang bị "bury" trong ngày sẽ tự ẩn**. Trong cùng
`collection_item`, queue chọn tối đa một thẻ new/review đại diện. Nếu item có learning
đến hạn, các sibling new/review của item không vào queue vì trả lời learning sẽ bury chúng.
Learning cards giữ lịch độc lập. Không xóa hay gộp SRS state.

```bash
curl -s "http://localhost:3000/v1/srs/due?limit=20" -H "Authorization: Bearer <token>"
```

```json
{
  "data": [
    {
      "srs_id": "7",
      "face_id": "…",
      "item_id": "…",
      "collection_id": "…",
      "direction": "recall",
      "state": "learning",
      "language": { "id": 2, "code": "ja", "name_vi": "Tiếng Nhật" },
      "instruction": "Nhớ lại từ Tiếng Nhật",
      "prompt": {
        "kind": "meaning",
        "text": "chạy",
        "meaning_source": "machine",
        "is_machine_generated": true
      },
      "answer": {
        "kind": "word",
        "text": "走る",
        "reading": "はしる",
        "romanization": null,
        "pos": "verb"
      },
      "due_at": "2026-09-27T02:10:00.000Z"
    }
  ],
  "next_cursor": null,
  "counts": { "learning": 3, "review": 7, "new": 2 }
}
```

- `prompt.kind`: `word` khi **recognize** (nhìn từ → nhớ nghĩa) / `meaning` khi **recall**
  (nhìn nghĩa → nhớ từ; FE hiện nhãn ngôn ngữ đích từ `language` + `instruction`).
- Nội dung `kind: "word"` luôn có `pos: string | null` (từ loại gốc từ DB,
  không chuẩn hoá/phiên dịch; `null` khi thiếu). Recognize dùng `prompt.pos`,
  recall dùng `answer.pos`; nội dung `kind: "meaning"` không có trường này.
  FE ẩn nhãn khi null và chấp nhận mã chưa biết. Xem [handoff M6](../handoff/m6-flashcard-pos-2026-10-28.md).
- Nghĩa luôn có `meaning_source` (`user`, `source`, `machine`, `llm`) và
  `is_machine_generated`; cờ chỉ phản ánh nguồn dữ liệu, không hàm ý đã kiểm duyệt.
- Phân trang: `?limit` (mặc định 50, tối đa 100) + cursor version 1 bind với profile,
  collection, ngày địa phương, phase và microsecond UTC. Đổi context hoặc qua ngày trả 400.
- `counts` là tổng sau filter, bỏ sibling sẽ bị bury và áp cap, trước `limit`/cursor;
  intraday learning không tiêu review quota, còn interday learning tiêu quota review.
- Lỗi: `409 PROFILE_REQUIRED` (chưa có hồ sơ học) · `400 VALIDATION_FAILED` (cursor/limit sai).

## POST /v1/srs/reviews

```bash
curl -s -X POST http://localhost:3000/v1/srs/reviews \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"face_id":"<uuid>","direction":"recall","rating":3,"elapsed_ms":3200,"client_review_id":"<uuid-v7>"}'
```

- `rating`: `1=Again, 2=Hard, 3=Good, 4=Easy`.
- `client_review_id` (khuyến nghị): cùng key + payload chuẩn hóa sẽ **trả snapshot cũ**, không cộng
  log/XP lần hai; cùng key + payload khác trả `409 SRS_IDEMPOTENCY_CONFLICT`. `null` bị từ chối 400.
- UUID được canonicalize trước khi lưu/so sánh; retry chỉ có log legacy nhưng không có receipt trả
  `409 SRS_REPLAY_UNAVAILABLE` và không tạo lượt ôn mới.
- `collection_id` tùy chọn giữ cùng phạm vi với GET `/srs/due`; bỏ qua nghĩa là toàn profile.
- Không nhận `reviewed_at`; server luôn lấy thời điểm sau khi giữ lock user.
- Một transaction: `review_log` + cập nhật `srs_state` (Anki: steps/EF/interval) + **burying nội bộ**
  sibling new/review của cùng item + streak, `user_stats`, thành tích. M8.3 tạm dừng XP mới
  — xem [API gamification](gamification.md).

Response `200`:

```json
{
  "review_log": {
    "id": "42",
    "rating": 3,
    "mode": "flashcard",
    "prev_state": "new",
    "reviewed_at": "…"
  },
  "srs": {
    "state": "learning",
    "due_at": "2026-09-27T02:15:00.000Z",
    "interval_days": 0,
    "ease_factor": 2.5,
    "learning_step": 1
  },
  "xp": { "amount": 0 }
}
```

Lỗi: `404 SRS_ITEM_NOT_FOUND` · `409 SRS_ITEM_UNAVAILABLE`/`SRS_ITEM_SUSPENDED`/`SRS_DAILY_LIMIT_REACHED`
· `422 SRS_ITEM_NOT_DUE`. Learn-ahead chỉ áp dụng cho learning/relearning trong 20 phút khi
queue thường đã cạn; **replay** cùng `client_review_id` không bị kiểm tra lại eligibility.

## GET /v1/srs/stats

```bash
curl -s http://localhost:3000/v1/srs/stats -H "Authorization: Bearer <token>"
# → {"due_now":12,"due_today":18,"learning":3,"new_introduced_today":5,
#    "reviews_today":30,"accuracy_7d":88}
```

`accuracy_7d` = % rating ≥ 3 trên 7 ngày gần nhất (`null` nếu chưa có lượt nào).

## PATCH /v1/srs/cards

Bật/tắt **suspend** một thẻ (face + direction). Thẻ suspended bị loại khỏi `/srs/due`
và khỏi thẻ nguồn của phiên ôn; unsuspend không đổi `due_at`.

```bash
curl -s -X PATCH http://localhost:3000/v1/srs/cards \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"face_id":"<uuid>","direction":"recognize","suspended":true}'
# → {"srs_id":"7","state":"learning","suspended":true}
```

Lỗi: `404 SRS_ITEM_NOT_FOUND` (không có thẻ của user) · `400 VALIDATION_FAILED`.

Swagger UI: `http://localhost:3000/docs` (nhóm **srs**).

## M14.3 — Ảnh minh hoạ trên thẻ (code local, chưa deploy)

`GET /v1/srs/due`: mỗi `data[i]` thêm `image: {url, mime, width, height} | null`.
Ảnh chọn theo `face.sense_id`, hydrate theo batch sau khi chọn queue; không đổi IDs,
counts, thứ tự hoặc cursor, không nhân bản thẻ khi một nghĩa có nhiều ảnh/mapping.
Width/height nullable; ảnh không hợp lệ hoặc fallback chưa rõ nghĩa trả null.
Field này không được thêm vào `/sessions` snapshot. FE kiểm thời điểm reveal ảnh để
không gợi đáp án sớm ở chiều recall. [Handoff M14.3](../handoff/m14.3-image-delivery-api-2026-11-01.md).
