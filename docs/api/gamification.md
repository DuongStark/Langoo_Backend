# M8.3 — API streak và hoạt động học

> M8.3 đã deploy VPS release `7a33958`; xem [handoff FE](../handoff/m8.3-streak-activity-2026-10-27.md)
> để tích hợp và kiểm tra dữ liệu tài khoản thật.

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

## M6.3 — Xóa XP (local, chưa deploy)

XP và level được xóa hoàn toàn: không trả `xp_total`, `level`, `level_progress`,
`today.xp`, `xp_awarded`, `xp.amount`, `xp_reward`. DB bỏ `xp_event`, `xp_rule`,
`leaderboard_snapshot` và các cột XP/level liên quan. Không giữ field giả bằng 0.

`GET /v1/me/stats` trả streak, ngày học cuối, số item đã học, `reviews_total`,
`today: {day, review_count, met_goal, goal}`. `reviews_total` chỉ tính SRS;
hoạt động quiz legacy còn hợp lệ vẫn tính mục tiêu/streak; Quiz M11.3 V3/M11.5
không tính streak theo contract riêng. API huy hiệu `GET /me/achievements` và `POST /me/achievements/seen`
đã bị xóa (404); bảng achievement/user_achievement cũng bị xóa. Retry SRS/session dùng receipt và khóa user,
không nhân đôi hoạt động khi gửi lại.

Migration M6.3 tính lại lịch/streak/stats sau khi xóa recall,
nhóm timestamp theo timezone hiện tại của user. Các API hoạt động tiếp tục như trên.
Swagger: `/docs`, nhóm `gamification`.
