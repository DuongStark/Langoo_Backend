# API: SRS (ôn tập ngắt quãng)

Thuật toán: **Anki verbatim** — đặc tả đầy đủ [`docs/srs.md`](../srs.md).
Tất cả endpoint cần **Bearer token**; số liệu "ngày" tính theo `user_settings.timezone`.

## GET /v1/srs/due

Hàng đợi hôm nay: thứ tự **learning → review → new**; có **learn-ahead 20 phút** (thẻ đang học
sẽ quay lại ngay trong phiên khi tới hạn); tôn trọng **daily limit** (`srs_new_per_day` /
`srs_review_per_day` trong `/me/settings`); lọc theo hồ sơ đang hoạt động; **thẻ anh em (sibling)
đang bị "bury" trong ngày sẽ tự ẩn**.

```bash
curl -s "http://localhost:3000/v1/srs/due?limit=20" -H "Authorization: Bearer <token>"
```

```json
{
  "data": [{
    "srs_id": "7", "face_id": "…", "item_id": "…", "collection_id": "…",
    "direction": "recall", "state": "learning",
    "language": { "id": 2, "code": "ja", "name_vi": "Tiếng Nhật" },
    "instruction": "Nhớ lại từ Tiếng Nhật",
    "prompt": { "kind": "meaning", "text": "chạy" },
    "answer": { "kind": "word", "text": "走る", "reading": "はしる", "romanization": null },
    "due_at": "2026-09-27T02:10:00.000Z"
  }],
  "next_cursor": null,
  "counts": { "learning": 3, "review": 7, "new": 2 }
}
```

- `prompt.kind`: `word` khi **recognize** (nhìn từ → nhớ nghĩa) / `meaning` khi **recall**
  (nhìn nghĩa → nhớ từ; FE hiện nhãn ngôn ngữ đích từ `language` + `instruction`).
- Phân trang: `?limit` (mặc định 50, tối đa 100) + `?cursor` (keyset `due_at, srs_id`).
- Lỗi: `409 PROFILE_REQUIRED` (chưa có hồ sơ học) · `400 VALIDATION_FAILED` (cursor/limit sai).

## POST /v1/srs/reviews

```bash
curl -s -X POST http://localhost:3000/v1/srs/reviews \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"face_id":"<uuid>","direction":"recall","rating":3,"elapsed_ms":3200,"client_review_id":"<uuid-v7>"}'
```

- `rating`: `1=Again, 2=Hard, 3=Good, 4=Easy`.
- `client_review_id` (khuyến nghị): retry mạng cùng id sẽ **trả kết quả cũ**, không cộng log/XP lần hai.
- Một transaction: `review_log` + cập nhật `srs_state` (Anki: steps/EF/interval) + **burying nội bộ**
  sibling new/review của cùng item + `xp_event` (+1 XP, idempotent — cap/streak/level thuộc M8).

Response `200`:

```json
{
  "review_log": { "id": "42", "rating": 3, "mode": "flashcard", "prev_state": "new", "reviewed_at": "…" },
  "srs": { "state": "learning", "due_at": "2026-09-27T02:15:00.000Z", "interval_days": 0,
           "ease_factor": 2.5, "learning_step": 1 },
  "xp": { "amount": 1 }
}
```

Lỗi: `404 SRS_ITEM_NOT_FOUND` · `409 SRS_ITEM_SUSPENDED` · `422 SRS_ITEM_NOT_DUE`
(ôn sớm; **replay** cùng `client_review_id` không bị lỗi này).

## GET /v1/srs/stats

```bash
curl -s http://localhost:3000/v1/srs/stats -H "Authorization: Bearer <token>"
# → {"due_now":12,"due_today":18,"learning":3,"new_introduced_today":5,
#    "reviews_today":30,"accuracy_7d":88}
```

`accuracy_7d` = % rating ≥ 3 trên 7 ngày gần nhất (`null` nếu chưa có lượt nào).

Swagger UI: `http://localhost:3000/docs` (nhóm **srs**).
