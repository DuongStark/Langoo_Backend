# API: Profile & Settings

Tất cả endpoint cần **Bearer access token** (xem `docs/api/auth.md` để lấy token).
Mọi thao tác chỉ áp dụng trên dữ liệu của user đang đăng nhập (lấy từ JWT, client không gửi `user_id`).

## GET /v1/profiles

```bash
curl -s http://localhost:3000/v1/profiles -H "Authorization: Bearer <token>"
```

```json
{
  "data": [
    {
      "id": "01a0dc8a-7191-7e18-93b0-32e8378986fe",
      "name": "Nhật–Việt",
      "primary_language_id": 2,
      "secondary_language_id": 1,
      "support_language_id": 3,
      "is_default": true,
      "created_at": "2026-09-27T00:00:00.000Z",
      "updated_at": "2026-09-27T00:00:00.000Z"
    }
  ]
}
```

## POST /v1/profiles

```bash
curl -s -X POST http://localhost:3000/v1/profiles \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{
    "name": "Nhật–Việt",
    "primary_language_id": 2,
    "secondary_language_id": 1,
    "support_language_id": 3
  }'
```

- Hồ sơ **đầu tiên** luôn tự động `is_default: true` và được set làm `active_profile_id`, kể cả khi request gửi `"is_default": false`.
- Gửi `"is_default": true` → hồ sơ khác bị hạ default (mỗi user chỉ 1 default).
- Id ngôn ngữ cố định: `1=en, 2=ja, 3=vi, 4=zh-Hans`.
- `name` được trim và không được rỗng; các field không nullable không nhận `null`.
- Lỗi: `400 PROFILE_LANGUAGES_CONFLICT` (3 ngôn ngữ trùng) · `400 LANGUAGE_NOT_FOUND` · `400 VALIDATION_FAILED`.

## GET / PATCH / DELETE /v1/profiles/:id

```bash
curl -s -X PATCH http://localhost:3000/v1/profiles/<id> \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"name": "Nhật–Việt (chính)", "is_default": true}'

curl -s -X DELETE http://localhost:3000/v1/profiles/<id> -H "Authorization: Bearer <token>"
```

- Hồ sơ của user khác hoặc không tồn tại → `404 PROFILE_NOT_FOUND`.
- `:id` phải là UUID hợp lệ; UUID sai định dạng → `400 VALIDATION_FAILED`.
- `DELETE` trả `{ "id": "...", "deleted_at": "..." }`.
  - Không xoá hồ sơ **đang mặc định** khi còn hồ sơ khác → `409 PROFILE_IS_DEFAULT` (đặt hồ sơ khác làm mặc định trước).
  - Không xoá hồ sơ **duy nhất** → `409 PROFILE_LAST_CANNOT_DELETE` (tránh xoá cascade collection/SRS).
- `PATCH` với `"is_default": false` trên hồ sơ đang mặc định → `409 PROFILE_IS_DEFAULT`.
- M6.2: cho phép đổi JA+EN → JA-only/EN-only dù collection đã có từ của cả hai.
  Item/face/SRS ngoài phạm vi được ẩn khỏi collection và queue, không bị xóa hoặc
  đổi lịch. Bật lại ngôn ngữ sẽ hiển thị lại dữ liệu cũ. Không có lỗi
  `PROFILE_LANGUAGE_IN_USE` cho thao tác này.
- Add/clone vẫn kiểm tra ngôn ngữ mới theo hồ sơ hiện tại. Sửa profile và add dùng
  cùng user lock để tránh kiểm tra trên cấu hình cũ.
- FE sau PATCH primary/secondary hoặc đổi active_profile_id phải reset cache,
  cursor, thẻ/session đang học và tải lại collection/dictionary/queue/stats.

## GET /v1/me/settings

```bash
curl -s http://localhost:3000/v1/me/settings -H "Authorization: Bearer <token>"
```

```json
{
  "timezone": "Asia/Ho_Chi_Minh",
  "ui_language_id": null,
  "daily_goal": 20,
  "notify": {},
  "active_profile_id": "01a0dc8a-...",
  "updated_at": "2026-09-27T00:00:00.000Z"
}
```

User cũ chưa có row settings → trả giá trị mặc định với `"updated_at": null`; nếu đã có hồ sơ default,
`active_profile_id` trả về id của hồ sơ đó.

## PATCH /v1/me/settings

```bash
curl -s -X PATCH http://localhost:3000/v1/me/settings \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"timezone": "Asia/Tokyo", "ui_language_id": 3, "daily_goal": 30, "notify": {"review_reminder": true}}'
```

- Validate: `timezone` phải là tên múi giờ IANA hợp lệ, không phải numeric offset (`400 SETTINGS_TIMEZONE_INVALID`); `daily_goal` 1–500;
  `notify` phải là object; `ui_language_id`/`active_profile_id` phải tồn tại (`400 LANGUAGE_NOT_FOUND`,
  `400 SETTINGS_ACTIVE_PROFILE_INVALID`).
- Các field không gửi được giữ nguyên; user chưa có settings sẽ được tạo với mặc định, và active profile mặc định
  được giữ lại nếu có.

Swagger UI: `http://localhost:3000/docs` (nhóm **profiles**, **settings**).

M6.2: khi thay đổi tập ngôn ngữ, quiz `ready` của hồ sơ được đánh dấu `expired`
để không reuse snapshot theo scope cũ. Câu hỏi/lịch sử vẫn được giữ; tạo quiz mới
vẫn tuân cooldown/quota. Nếu đổi hồ sơ/ngôn ngữ trong lúc AI đang tạo câu hỏi,
BE trả `409 QUIZ_SCOPE_CHANGED` và đánh dấu job failed; FE báo cần tạo lại,
không render kết quả cũ.
