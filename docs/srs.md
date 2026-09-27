# SRS — Đặc tả thuật toán (mô hình Anki, M6)

> Nguồn tham chiếu: [Anki Manual — Deck Options](https://docs.ankiweb.net/deck-options.html)
> (Learning Steps, Lapses, Advanced) và [Studying](https://docs.ankiweb.net/studying.html)
> (Answer Buttons, Fuzz, Siblings & Burying). Langoo **bê nguyên mô hình Anki**, chỉ đổi
> đơn vị dữ liệu cho khớp schema sẵn có.

## 1. Trạng thái thẻ và cột dữ liệu

Mỗi thẻ ôn = 1 dòng `app.srs_state` = **(face, direction)**. Một `collection_item` 2 face
có tối đa **4 thẻ** (2 face × 2 chiều `recognize`/`recall`); các thẻ này là **sibling** của nhau.

| Cột | Ý nghĩa |
|---|---|
| `state` | `new` → `learning` → `review` → `relearning` (giống Anki) |
| `due_at` | Thời điểm được phép hiện lại (UTC; bước học có thể là phút) |
| `ease_factor` *(mới)* | Hệ số dễ kiểu Anki: khởi đầu **2.50**, sàn **1.30** |
| `learning_step` *(mới)* | Đang ở bước thứ mấy trong learning/relearning steps (NULL nếu ở review) |
| `introduced_at` *(mới)* | Lần đầu tiên thẻ được trả lời (state rời `new`) — dùng đếm "thẻ mới hôm nay" |
| `buried_until` *(mới)* | Ẩn nội bộ tới hết ngày (burying) |
| `reps` / `lapses` | Tổng số lần đã trả lời thẻ / số lần quên (Again khi đang review) |
| `scheduled_days` / `elapsed_days` | Khoảng dự định (ngày) / thực tế đã trôi (ngày) |
| `last_review_at`, `suspended` | Lần ôn gần nhất; tạm ẩn (API suspend thuộc M7) |

`app.review_log` là **sổ cái append-only**; có thêm `prev_state` (trạng thái trước khi trả lời —
phục vụ daily limit & thống kê) và `client_review_id` (chống retry mạng). Vì `review_log` là
**bảng partition** theo `reviewed_at`, không thể tạo unique `(user_id, client_review_id)`;
chống trùng bằng **row lock trên `srs_state` + tra cứu index** `(user_id, client_review_id)`:
request thứ hai cùng id thấy log cũ và trả lại kết quả cũ, không cập nhật lần nữa.

## 2. Luật lịch (Anki verbatim)

### 2.1 Hằng số mặc định

| Tham số | Giá trị (Anki mặc định) |
|---|---|
| Learning steps (thẻ mới) | `1m 10m` |
| Graduating interval (Good ở bước cuối) | 1 ngày |
| Easy interval (Easy khi đang học) | 4 ngày |
| Relearning steps (sau khi quên) | `10m` |
| Minimum interval | 1 ngày |
| Maximum interval | 36.500 ngày (100 năm) |
| Starting ease / sàn ease | 2.50 / 1.30 |
| Ease delta khi review | Again **−0.20** · Hard **−0.15** · Easy **+0.15** |
| Hard interval multiplier | ×1.20 |
| Easy bonus | ×1.30 |
| New interval (sau lapse) | 0.00 → interval tốt nghiệp = 1 ngày |
| Learn-ahead | 20 phút |
| Fuzz | review ±5% (rand, RNG injectable); learning cộng thêm 0–5 phút |
| Daily limits (M6, lưu ở `user_settings`) | new/ngày = 20 · review/ngày = 200 |

### 2.2 Bảng chuyển trạng thái

| State hiện tại | Again | Hard | Good | Easy |
|---|---|---|---|---|
| **new** | → learning, `+steps[0]` (1m) | → `+6m` = TB(1m,10m), ở bước 0 | → bước 1, `+10m` | **tốt nghiệp** → review `+4d` |
| **learning** bước i | về bước 0 `+1m` | i=0: như trên; i>0: lặp `+steps[i]` | i<cuối: `+steps[i+1]`; i=cuối: **tốt nghiệp** `+1d` | tốt nghiệp `+4d` |
| **review** | lapse: `lapses+1`, EF −0.20 → relearning `+10m` | `I×1.20`, EF −0.15 | `I×EF` | `I×EF×1.30`, EF +0.15 |
| **relearning** | lặp `+10m` | lặp `+10m` | **tốt nghiệp**: `I = max(1, I_cũ × 0.00) = 1d` | tốt nghiệp ngay: `I = max(1, ...)` theo Anki *(đối chiếu code Anki khi implement)* |

Ghi chú:
- `I` = interval hiện tại (ngày); mọi interval kẹp trong `[1, 36500]` (sau fuzz).
- Bước học vượt mốc ngày (nếu người dùng cấu hình steps ≥ 1d) tự quy đổi thành ngày — mặc định của mình toàn < 1d.
- EF đã ở sàn 1.30 thì Again/Hard không giảm thêm.

## 3. Hàng đợi `/srs/due`

**Thứ tự (theo Anki):** intraday learning (due gần nhất trước) → interday learning → review
(due cũ nhất trước) → new (theo `position` trong collection).

- Chỉ lấy thẻ **chưa suspend**, **chưa bị bury** (`buried_until IS NULL OR buried_until <= now`).
- **Learn-ahead:** khi ghép queue, coi thẻ learning có `due_at <= now + 20 phút` như đã đến hạn
  (thẻ `Good → +10m` sẽ quay lại ngay trong phiên khi hết thẻ khác) — mỗi lượt gọi trả về
  snapshot; FE có thể gọi lại khi queue cạn.
- **Daily limits** (Anki semantics):
  - `srs_new_per_day` giới hạn số thẻ **được giới thiệu trong ngày** (`introduced_at` trong ngày địa phương).
  - `srs_review_per_day` giới hạn **review + interday learning**; **intraday learning không bị giới hạn**
    (đang trong phiên học phải trả xong).
  - Ngày tính theo `user_settings.timezone` (ví dụ VN: mốc 00:00 +07, DB lưu UTC).
- **Lọc theo hồ sơ:** chỉ lấy thẻ thuộc `collection.profile_id = active profile` và face có
  `language_id` ∈ {primary, secondary} của hồ sơ (face ngôn ngữ khác bị "park", không xoá lịch).
- Phân trang: `limit` (mặc định 50, tối đa 100) + **cursor keyset `(due_at, srs_id)`**
  (mở rộng `src/common/pagination/cursor.ts` cho cursor dạng thời điểm).

## 4. Burying (nội bộ — không lộ cho người dùng)

Theo Anki: *khi trả lời 1 thẻ, các **sibling new/review** của cùng item bị "bury" tới hết ngày*;
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
  "data": [{
    "srs_id": "…", "face_id": "…", "item_id": "…", "collection_id": "…",
    "direction": "recall",
    "state": "learning",
    "language": { "id": 2, "code": "ja" },
    "instruction": "Nhớ lại từ tiếng Nhật",
    "prompt": { "kind": "meaning", "text": "chạy" },
    "answer": { "kind": "word", "text": "走る", "reading": "はしる", "romanization": null },
    "due_at": "2026-09-27T02:10:00.000Z"
  }],
  "next_cursor": null,
  "counts": { "due_now": 12, "learning": 3, "review": 7, "new": 2 }
}
```

### `POST /v1/srs/reviews`

Body: `{ face_id, direction, rating (1..4), elapsed_ms?, mode? (mặc định "flashcard"), client_review_id?, reviewed_at? }`

- `client_review_id`: **khuyến nghị FE luôn gửi** (uuid v7) — retry mạng trả lại **kết quả cũ**,
  không cộng log/XP lần hai.
- Thẻ chưa đến hạn (`due_at > now`, không tính learn-ahead) → `422 SRS_ITEM_NOT_DUE`.
- Thẻ suspended → `409 SRS_ITEM_SUSPENDED`. Không có thẻ / không thuộc user → `404 SRS_ITEM_NOT_FOUND`.
- Một transaction: `review_log` + cập nhật `srs_state` (theo bảng §2.2) + burying sibling
  + `xp_event` (+1 XP, `idempotency_key = "review:<review_log_id>"`).
  *Cap/streak/level/thành tựu thuộc M8 — M6 chỉ ghi XP thô theo nghiệm thu.*
- Response: `{ review_log: {…}, srs: { state, due_at, interval_days, ease_factor, learning_step }, xp: { amount } }`.

### `GET /v1/srs/stats`

`{ due_now, due_today, learning, new_introduced_today, reviews_today, accuracy_7d }`
(số liệu theo ngày địa phương; `accuracy_7d` = tỉ lệ rating ≥ 3 trên review_log 7 ngày gần nhất).

## 6. Migration 026 (chờ duyệt apply cloud — local đã chạy khi phát triển)

| Bảng | Thay đổi |
|---|---|
| `app.srs_state` | `ease_factor real NOT NULL DEFAULT 2.5 CHECK (ease_factor >= 1.3)`; `learning_step smallint CHECK (learning_step >= 0)`; `introduced_at timestamptz`; `buried_until timestamptz` |
| `app.review_log` | `client_review_id uuid`, `prev_state text CHECK (new/learning/review/relearning)`; index `(user_id, client_review_id) WHERE client_review_id IS NOT NULL` (không unique được vì bảng partition) |
| `app.user_settings` | `srs_new_per_day smallint NOT NULL DEFAULT 20 CHECK (1..9999)`; `srs_review_per_day smallint NOT NULL DEFAULT 200 CHECK (1..9999)` |

## 7. Ma trận test (unit cho scheduler thuần + e2e)

**Scheduler (unit — RNG seed cố định):**
1. New + Good → learning bước 1, `+10m`; Good lần nữa → review `+1d`, `introduced_at` set 1 lần.
2. New + Again → learning bước 0 `+1m`; Again liên tiếp vẫn `+1m` (không âm bước).
3. New + Hard → `+6m` (TB 2 bước); Hard ở bước 1 → lặp `+10m`.
4. New + Easy → review `+4d`.
5. Review + Good/Hard/Easy → công thức §2.2; EF kẹp sàn 1.3 khi Again/Hard nhiều lần.
6. Review + Again → `lapses+1`, EF −0.20, relearning `+10m`; Good → về review `+1d` (không phải 50%).
7. Interval chạm trần 36.500 ngày thì đứng yên; fuzz không đẩy ra ngoài `[1, 36500]`.
8. Fuzz: với seed cố định, interval nằm trong ±5%; learning cộng 0–5 phút.
9. Learn-ahead: thẻ learning `due_at = now+19m` được trả; `now+21m` không.
10. Bury: trả lời ja.recognize → ja.recall/en.* (new/review) bị bury tới 00:00 kế tiếp; thẻ learning không bị bury; 00:01 hôm sau tự quay lại.
11. Daily limits: chạm `srs_new_per_day` → queue không còn new; chạm `srs_review_per_day` → không còn review/interday nhưng intraday learning vẫn hiện.
12. Múi giờ: user VN 23:59 vs 00:01 — mốc ngày/`introduced_at`/bury đổi đúng lúc.
13. Idempotency: 2 request cùng `client_review_id` → 1 review_log, 1 XP, lần hai trả kết quả cũ.
14. Lọc hồ sơ: face ngôn ngữ không thuộc primary/secondary → không vào queue.

**E2E (theo nghiệm thu prompt):** ôn 1 thẻ → `due_at` đổi, `review_log +1`, XP +1; thẻ bị chặn khi ôn sớm (422); retry mạng không cộng đôi; hai chiều cùng face độc lập; stats khớp số liệu DB.

## 8. Phiên ôn dùng chung engine (M7)

`POST /v1/sessions/:id/answers` (đặc tả riêng: [`docs/api/sessions.md`](api/sessions.md)) áp
đúng luật §2 qua `ReviewEngine` — cùng `review_log`, burying và XP với `/srs/reviews`.
Phiên là **snapshot**:

- `kind=review` lấy đúng queue §3 (daily limit + learn-ahead); `kind=practice` lấy mọi thẻ
  trong bộ (ôn trước) và **không** áp daily limit.
- Trong phiên **không kiểm tra `due_at`**: thẻ đã vào phiên thì trả lời được (bao trùm tình
  huống learn-ahead của queue); endpoint review trực tiếp vẫn giữ `422 SRS_ITEM_NOT_DUE`.
- Idempotency theo `(session_id, ordinal)`: retry trả kết quả cũ, XP chỉ cộng một lần với
  khoá `session:<session_id>:<ordinal>`.
- Suspend (`PATCH /v1/srs/cards`) loại thẻ khỏi queue lẫn mọi phiên mới.
