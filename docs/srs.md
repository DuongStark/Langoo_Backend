# SRS — Đặc tả thuật toán (mô hình Anki, M6.1)

> Nguồn tham chiếu: [Anki Manual — Deck Options](https://docs.ankiweb.net/deck-options.html)
> (Learning Steps, Lapses, Advanced) và [Studying](https://docs.ankiweb.net/studying.html)
> (Answer Buttons, Fuzz, Siblings & Burying). Phần review interval được đối chiếu với
> Anki commit `539054c34dccf8b89ca7ea9c9c40ecaf172de759`; Langoo giữ mốc ngày địa phương
> 00:00 và schema hiện có.

## 1. Trạng thái thẻ và cột dữ liệu

Mỗi thẻ ôn = 1 dòng `app.srs_state` = **(face, direction)**. Một `collection_item` 2 face
có tối đa **4 thẻ** (2 face × 2 chiều `recognize`/`recall`); các thẻ này là **sibling** của nhau.

| Cột                               | Ý nghĩa                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `state`                           | `new` → `learning` → `review` → `relearning` (giống Anki)                    |
| `due_at`                          | Thời điểm được phép hiện lại (UTC; bước học có thể là phút)                  |
| `ease_factor` _(mới)_             | Hệ số dễ kiểu Anki: khởi đầu **2.50**, sàn **1.30**                          |
| `learning_step` _(mới)_           | Đang ở bước thứ mấy trong learning/relearning steps (NULL nếu ở review)      |
| `learning_is_interday` _(M6.1)_   | Bước learning/relearning đã được lập lịch qua ngày địa phương kế tiếp        |
| `introduced_at` _(mới)_           | Lần đầu tiên thẻ được trả lời (state rời `new`) — dùng đếm "thẻ mới hôm nay" |
| `buried_until` _(mới)_            | Ẩn nội bộ tới hết ngày (burying)                                             |
| `reps` / `lapses`                 | Tổng số lần đã trả lời thẻ / số lần quên (Again khi đang review)             |
| `scheduled_days` / `elapsed_days` | Khoảng dự định (ngày) / thực tế đã trôi (ngày)                               |
| `last_review_at`, `suspended`     | Lần ôn gần nhất; tạm ẩn (API suspend thuộc M7)                               |

`app.review_log` là **sổ cái append-only**; có thêm `prev_state`, `profile_id`,
`queue_kind_before` và `client_review_id`. `queue_kind_before` là `new`,
`intraday_learning`, `interday_learning` hoặc `review`, được chụp trước khi lập lịch.
Vì `review_log` là bảng partition, receipt riêng `app.srs_review_receipt` giữ unique
`(user_id, client_review_id)` và response snapshot. Cùng key + payload chuẩn hóa trả snapshot cũ;
cùng key + payload khác trả `409 SRS_IDEMPOTENCY_CONFLICT`.

## 2. Luật lịch (Anki verbatim)

### 2.1 Hằng số mặc định

| Tham số                                  | Giá trị (Anki mặc định)                                                                                           |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Learning steps (thẻ mới)                 | `1m 10m`                                                                                                          |
| Graduating interval (Good ở bước cuối)   | 1 ngày                                                                                                            |
| Easy interval (Easy khi đang học)        | 4 ngày                                                                                                            |
| Relearning steps (sau khi quên)          | `10m`                                                                                                             |
| Minimum interval                         | 1 ngày                                                                                                            |
| Maximum interval                         | 36.500 ngày (100 năm)                                                                                             |
| Starting ease / sàn ease                 | 2.50 / 1.30                                                                                                       |
| Ease delta khi review                    | Again **−0.20** · Hard **−0.15** · Easy **+0.15**                                                                 |
| Hard interval multiplier                 | ×1.20                                                                                                             |
| Easy bonus                               | ×1.30                                                                                                             |
| New interval (sau lapse)                 | 0.00 → interval tốt nghiệp = 1 ngày                                                                               |
| Learn-ahead                              | 20 phút                                                                                                           |
| Fuzz                                     | review theo ba khoảng Anki (2.5–7: 15%, 7–20: 10%, >20: 5% + 1 ngày; RNG injectable); learning cộng thêm 0–5 phút |
| Daily limits (M6, lưu ở `user_settings`) | new/ngày = 20 · review/ngày = 200                                                                                 |

### 2.2 Bảng chuyển trạng thái

| State hiện tại      | Again                                           | Hard                                | Good                                                | Easy                                 |
| ------------------- | ----------------------------------------------- | ----------------------------------- | --------------------------------------------------- | ------------------------------------ |
| **new**             | → learning, `+steps[0]` (1m)                    | → `+6m` = TB(1m,10m), ở bước 0      | → bước 1, `+10m`                                    | **tốt nghiệp** → review `+4d`        |
| **learning** bước i | về bước 0 `+1m`                                 | i=0: như trên; i>0: lặp `+steps[i]` | i<cuối: `+steps[i+1]`; i=cuối: **tốt nghiệp** `+1d` | tốt nghiệp `+4d`                     |
| **review**          | lapse: `lapses+1`, EF −0.20 → relearning `+10m` | `I×1.20`, EF −0.15                  | `I×EF`                                              | `I×EF×1.30`, EF +0.15                |
| **relearning**      | lặp `+10m`                                      | lặp `+10m`                          | **tốt nghiệp** `+1d`                                | tốt nghiệp ngay `max(1d, I_cũ + 1d)` |

Ghi chú:

- `I` = interval hiện tại (ngày); mọi interval kẹp trong `[1, 36500]` (sau fuzz).
- Bước học vượt mốc ngày (nếu người dùng cấu hình steps ≥ 1d) tự quy đổi thành ngày — mặc định của mình toàn < 1d.
- EF đã ở sàn 1.30 thì Again/Hard không giảm thêm.

## 3. Hàng đợi `/srs/due`

**Thứ tự (theo Anki):** intraday learning (due gần nhất trước) → interday learning → review
(due cũ nhất trước) → new (theo `position` trong collection).

- Chỉ lấy thẻ **chưa suspend**, **chưa bị bury** (`buried_until IS NULL OR buried_until <= now`).
- **Learn-ahead:** chỉ khi không còn thẻ thường đủ điều kiện trong toàn phạm vi trước cursor,
  mới coi learning/relearning intraday có `due_at <= now + 20 phút` như đã đến hạn. GET và
  POST dùng cùng quy tắc; review bình thường không được trả lời sớm.
- **Daily limits** (Anki semantics):
  - `srs_new_per_day` giới hạn số thẻ **được giới thiệu trong ngày** (`introduced_at` trong ngày địa phương).
  - `srs_review_per_day` giới hạn **review + interday learning**; **intraday learning không bị giới hạn**
    (đang trong phiên học phải trả xong).
  - Counter lấy từ `review_log` theo `(user_id, profile_id)`; ngày tính theo
    `user_settings.timezone` (ví dụ VN: mốc 00:00 +07, DB lưu UTC).
- **Lọc theo hồ sơ:** chỉ lấy thẻ thuộc `collection.profile_id = active profile` và face có
  `language_id` ∈ {primary, secondary} của hồ sơ (face ngôn ngữ khác bị "park", không xoá lịch).
- Phân trang: `limit` (mặc định 50, tối đa 100) + cursor version 1 giữ bucket, khóa sắp xếp,
  microsecond UTC, profile, collection filter, ngày học và phase regular/ahead. Đổi context
  hoặc qua ngày trả `400 VALIDATION_FAILED`.

## 4. Burying (nội bộ — không lộ cho người dùng)

Theo Anki: _khi trả lời 1 thẻ, các **sibling new/review** của cùng item bị "bury" tới hết ngày_;
thẻ learning không bị bury; ngược lại, đang học 1 thẻ learning cũng bury các sibling new/review.

- Cài đặt cho Langoo: **bật cho cả new + review siblings**; thực hiện ngầm trong transaction
  review (set `buried_until` = mốc 00:00 kế tiếp theo timezone user).
- **Không** thêm API unbury, **không** trả số thẻ bị bury trong response người dùng
  (chỉ số tổng hợp có thể hiện ở admin M13 nếu cần).
- Thẻ hết hạn bury tự quay lại queue ở request kế tiếp sau mốc ngày.

## 5. API M6 (dự kiến)

### `GET /v1/srs/due?limit=&collection_id=&cursor=`

```json
{
  "data": [
    {
      "srs_id": "…",
      "face_id": "…",
      "item_id": "…",
      "collection_id": "…",
      "direction": "recall",
      "state": "learning",
      "language": { "id": 2, "code": "ja" },
      "instruction": "Nhớ lại từ tiếng Nhật",
      "prompt": { "kind": "meaning", "text": "chạy" },
      "answer": {
        "kind": "word",
        "text": "走る",
        "reading": "はしる",
        "romanization": null
      },
      "due_at": "2026-09-27T02:10:00.000Z"
    }
  ],
  "next_cursor": null,
  "counts": { "learning": 3, "review": 7, "new": 2 }
}
```

`prompt` và `answer` của nghĩa luôn có `meaning_source` (`user`, `source`, `machine`, `llm`)
và `is_machine_generated`; cờ chỉ phản ánh nguồn dữ liệu, không hàm ý đã kiểm duyệt.

### `POST /v1/srs/reviews`

Body: `{ face_id, direction, rating (1..4), elapsed_ms?, mode? (mặc định "flashcard"), client_review_id?, collection_id? }`

- `client_review_id`: cùng key + payload chuẩn hóa trả kết quả cũ, không cộng log/XP lần hai;
  cùng key + payload khác → `409 SRS_IDEMPOTENCY_CONFLICT`.
- `collection_id` giữ cùng scope với GET `/srs/due`; bỏ qua nghĩa là toàn profile.
- Thẻ chưa đến hạn (`due_at > now`) → `422 SRS_ITEM_NOT_DUE`, trừ learning/relearning intraday
  trong 20 phút khi queue thường trong scope đã cạn.
- Thẻ suspended/buried/paused/archive/profile khác → `409 SRS_ITEM_UNAVAILABLE`;
  `client_review_id: null` và `reviewed_at` đều bị từ chối `400 VALIDATION_FAILED`.
- Một transaction: `review_log` + cập nhật `srs_state` (theo bảng §2.2) + burying sibling
  - `xp_event` (+1 XP, `idempotency_key = "review:<review_log_id>"`).
    _Cap/streak/level/thành tựu thuộc M8 — M6 chỉ ghi XP thô theo nghiệm thu._
- Server luôn ghi `reviewed_at`; client không được gửi thời điểm để backdate.
- Response: `{ review_log: {…}, srs: { state, due_at, interval_days, ease_factor, learning_step }, xp: { amount } }`.

### `GET /v1/srs/stats`

`{ due_now, due_today, learning, new_introduced_today, reviews_today, accuracy_7d }`
(số liệu theo ngày địa phương; `accuracy_7d` = tỉ lệ rating ≥ 3 trên review_log 7 ngày gần nhất).

## 6. Migration 026 + 027 (đã có trên local và cloud)

Đã xác minh schema cloud chỉ đọc ngày 2026-09-29. Implementation M6/M6.1 đã pass
30/30 ca audit sau bản sửa; giới hạn smoke test runtime/pool production thuộc M12.
Chi tiết regression nằm trong [báo cáo kiểm tra lại](reviews/m6-recheck-2026-09-29.md).

| Bảng                | Thay đổi                                                                                                                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.srs_state`     | `ease_factor double precision NOT NULL DEFAULT 2.5 CHECK (ease_factor >= 1.3)`; `learning_step smallint CHECK (learning_step >= 0)`; `introduced_at timestamptz`; `buried_until timestamptz`    |
| `app.review_log`    | `client_review_id uuid`, `prev_state text CHECK (new/learning/review/relearning)`; index `(user_id, client_review_id) WHERE client_review_id IS NOT NULL` (không unique được vì bảng partition) |
| `app.user_settings` | `srs_new_per_day smallint NOT NULL DEFAULT 20 CHECK (1..9999)`; `srs_review_per_day smallint NOT NULL DEFAULT 200 CHECK (1..9999)`                                                              |

Migration **027_srs_review_integrity.sql** bổ sung cho M6.1:

| Bảng                     | Thay đổi                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `app.srs_state`          | `ease_factor double precision` với sàn 1.3; `learning_is_interday boolean` để giữ loại bước learning qua ngày                         |
| `app.review_log`         | `profile_id`, `queue_kind_before` (`new`, `intraday_learning`, `interday_learning`, `review`) và index counter theo user/profile/ngày |
| `app.srs_review_receipt` | Receipt unique theo `(user_id, client_review_id)`, lưu canonical request và response snapshot version 1                               |

## 7. Ma trận test (unit cho scheduler thuần + e2e)

**Scheduler (unit — RNG seed cố định):**

1. New + Good → learning bước 1, `+10m`; Good lần nữa → review `+1d`, `introduced_at` set 1 lần.
2. New + Again → learning bước 0 `+1m`; Again liên tiếp vẫn `+1m` (không âm bước).
3. New + Hard → `+6m` (TB 2 bước); Hard ở bước 1 → lặp `+10m`.
4. New + Easy → review `+4d`.
5. Review + Good/Hard/Easy → công thức §2.2; EF kẹp sàn 1.3 khi Again/Hard nhiều lần.
6. Review + Again → `lapses+1`, EF −0.20, relearning `+10m`; Good → về review `+1d` (không phải 50%).
7. Interval chạm trần 36.500 ngày thì đứng yên; fuzz không đẩy ra ngoài `[1, 36500]`.
8. Fuzz: với seed cố định, interval nằm trong các biên ba khoảng Anki và không vượt
   `[1, 36500]`; learning cộng 0–5 phút.
9. Learn-ahead: thẻ learning `due_at = now+19m` được trả; `now+21m` không.
10. Bury: trả lời ja.recognize → ja.recall/en.* (new/review) bị bury tới 00:00 kế tiếp; thẻ learning không bị bury; 00:01 hôm sau tự quay lại.
11. Daily limits: chạm `srs_new_per_day` → queue không còn new; chạm `srs_review_per_day` → không còn review/interday nhưng intraday learning vẫn hiện.
12. Múi giờ: user VN 23:59 vs 00:01 — mốc ngày/`introduced_at`/bury đổi đúng lúc.
13. Idempotency: 2 request cùng `client_review_id` → 1 review_log, 1 XP, lần hai trả kết quả cũ.
14. Lọc hồ sơ: face ngôn ngữ không thuộc primary/secondary → không vào queue.

**E2E (theo nghiệm thu prompt):** ôn 1 thẻ → `due_at` đổi, `review_log +1`, XP +1; review sớm
ngoài learn-ahead hoặc còn queue thường → `422`, còn intraday trong 20 phút khi queue cạn được
nhận; retry cùng payload không cộng đôi và khác payload trả 409; hai chiều cùng face độc lập;
stats khớp số liệu DB.

## 8. Phiên ôn dùng chung engine (M7)

`POST /v1/sessions/:id/answers` (đặc tả riêng: [`docs/api/sessions.md`](api/sessions.md)) áp
đúng luật §2 qua `ReviewEngine` — cùng `review_log`, burying và XP với `/srs/reviews`.
Phiên là snapshot nội dung, còn quyền ôn được kiểm tra lại lúc trả lời:

- `kind=review` lấy đúng queue §3 (daily limit + learn-ahead) và kiểm tra lại due/ahead + quota
  trong transaction; `kind=practice` lấy mọi thẻ trong bộ (ôn trước) và **chỉ** miễn due/cap.
- Cả hai loại vẫn kiểm tra ownership, profile, ngôn ngữ, archive/paused, suspend và bury tại
  thời điểm trả lời; thay đổi eligibility trả 409 và không đánh dấu câu đã trả lời.
- Idempotency theo `(session_id, ordinal)`: retry trả kết quả cũ, XP chỉ cộng một lần với
  khoá `session:<session_id>:<ordinal>`.
- Suspend (`PATCH /v1/srs/cards`) loại thẻ khỏi queue lẫn mọi phiên mới.
- XP/streak/thành tích (M8) cập nhật trong cùng transaction qua `GamificationService`:
  XP theo `xp_rule` + daily cap, bonus ngày học, level, achievement — xem
  [`docs/api/gamification.md`](api/gamification.md).
