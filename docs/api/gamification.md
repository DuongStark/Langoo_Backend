# M8.3 — API streak và hoạt động học

> M8.3 đã kiểm tra local, chưa deploy; xem [handoff FE](../handoff/m8.3-streak-activity-2026-10-27.md)
> để biết trạng thái triển khai trước khi tích hợp.

## GET /v1/me/activity

Bearer token. Query `year` tùy chọn từ 2000 đến 2100; mặc định năm hiện tại
theo `user_settings.timezone`. Trả toàn bộ 365/366 ngày, kể cả ngày chưa có
hoạt động và ngày tương lai. `today` là ngày hiện tại theo timezone user.

```http
GET /v1/me/activity?year=2026
Authorization: Bearer <access_token>
```

```json
{
  "year": 2026,
  "timezone": "Asia/Ho_Chi_Minh",
  "today": "2026-10-27",
  "streak_current": 3,
  "streak_longest": 7,
  "days": [
    {"date":"2026-01-01","activity_count":0,"review_count":0,"distinct_words":0,"unresolved_review_count":0},
    {"date":"2026-01-02","activity_count":5,"review_count":4,"distinct_words":3,"unresolved_review_count":0}
  ]
}
```

Ví dụ rút gọn hai ngày; response thực trả cả năm.

- `activity_count`: số lượt ôn SRS và câu quiz trong ngày, cùng định nghĩa
  `streak_day.review_count` và mục tiêu ngày hiện có.
- `review_count`: số lượt ôn SRS (kể cả session), không bao gồm câu quiz.
- `distinct_words`: số lexeme khác nhau nhận diện được từ các lượt ôn SRS;
  cùng từ nhiều sense, mặt, chiều hoặc collection chỉ tính một lần. Không tính
  quiz vì một số câu không giữ đủ ID của mọi từ.
- `unresolved_review_count`: số lượt ôn không còn nối được face/sense. Khi lớn
  hơn 0, `distinct_words` là **số tối thiểu**, không khẳng định là tổng đầy đủ.
- Streak hiện tại giữ khi học hôm nay/hôm qua; nếu lần học cuối trước hôm qua,
  API trả 0 ngay, không cần chờ lượt học tiếp theo. Streak dài nhất giữ lịch sử.
- `streak_day.day` được lưu theo timezone lúc học; review log chỉ lưu thời điểm
  UTC và được nhóm theo timezone hiện tại. Nếu người dùng đổi timezone sau khi
  đã học, số hoạt động và số lượt ôn cũ có thể nằm ở hai ngày khác nhau.
- HTTP 401 khi thiếu/sai token; 400 khi year sai kiểu hoặc ngoài khoảng.

## XP và API cũ

Từ M8.3, ôn SRS, quiz, streak và thành tích không cộng XP mới. Dữ liệu XP/level
cũ vẫn giữ nguyên. Các response cũ vẫn giữ field `xp_total`, `level`,
`level_progress`, `today.xp`, `xp_awarded` và `xp.amount` để client cũ đọc được;
lượt mới nhận `xp.amount = 0`, `xp_reward` trả 0. FE ẩn XP và level.

`GET /v1/me/stats` tiếp tục trả streak, số item đã học, `reviews_total`,
`today.review_count` và mục tiêu. `reviews_total` chỉ tính SRS; `today.review_count`
tính cả quiz. `GET /v1/me/achievements` và `POST /v1/me/achievements/seen` vẫn
có contract cũ, phần thưởng XP trả 0. Retry SRS/session dùng receipt tương ứng,
không nhân đôi hoạt động khi gửi lại.

Swagger: `/docs`, nhóm `gamification`.
