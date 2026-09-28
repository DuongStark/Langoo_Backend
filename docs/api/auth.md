# API: Auth

Tất cả endpoint dưới prefix `/v1`. Access token là JWT HS256 sống **15 phút**;
refresh token opaque 32 byte, server chỉ lưu SHA-256 — gọi `refresh` sẽ **xoay vòng**
token (token cũ bị từ chối ngay). Nếu nhiều request đồng thời dùng cùng một token,
chỉ một request thành công; các request còn lại nhận `AUTH_INVALID_REFRESH_TOKEN`.

## POST /v1/auth/register

Đăng ký tài khoản mới (tự đăng nhập luôn). Trả về user + cặp token.

```bash
curl -s -X POST http://localhost:3000/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "matkhau12345",
    "display_name": "An",
    "device": { "platform": "android", "app_version": "1.0.0" }
  }'
```

Response `201`:

```json
{
  "user": {
    "id": "5",
    "email": "user@example.com",
    "display_name": "An",
    "avatar_url": null,
    "status": "active",
    "created_at": "2026-09-26T12:00:00.000Z",
    "last_login_at": null
  },
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "8xQ0...",
  "expires_in": 900
}
```

Lỗi: `409 AUTH_EMAIL_TAKEN` (email đã đăng ký) · `400 VALIDATION_FAILED`.
`device` nếu gửi phải là object có `platform` (`ios`, `android` hoặc `web`) và tùy chọn
`app_version`.

## POST /v1/auth/login

```bash
curl -s -X POST http://localhost:3000/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{ "email": "user@example.com", "password": "matkhau12345" }'
```

Response `200` giống register (cập nhật `last_login_at`).
Lỗi: `401 AUTH_INVALID_CREDENTIALS` · `403 AUTH_ACCOUNT_LOCKED` / `AUTH_ACCOUNT_DELETED` ·
`400 VALIDATION_FAILED` nếu `device` không phải object hợp lệ.

## POST /v1/auth/oauth/google

Đăng nhập/đăng ký bằng **Google ID token** (OAuth2). Client lấy ID token từ Google Sign-In SDK
(web: Google Identity Services; Android/iOS: Google Sign-In), backend xác minh chữ ký JWKS
(`iss`/`aud`/`exp`) rồi cấp cặp token nội bộ như login.

```bash
curl -s -X POST http://localhost:3000/v1/auth/oauth/google \
  -H "Content-Type: application/json" \
  -d '{
    "id_token": "eyJhbGciOiJSUzI1NiIs...",
    "nonce": "nonce-da-dung-khi-lay-token",
    "device": { "platform": "android", "app_version": "1.0.0" }
  }'
```

Response `200` giống login (`user` + `access_token` + `refresh_token` + `expires_in`).

- Lần đầu với `sub` mới → tạo user + `user_settings` mặc định (+ `user_identity` provider `google`).
- Email Google **đã xác thực** trùng tài khoản password có sẵn → **tự động liên kết** vào cùng user
  (cả hai cách đăng nhập đều vào một tài khoản).
- `nonce`: nếu ID token chứa claim `nonce` thì request **bắt buộc** gửi `nonce` khớp (chống replay).
- Cấu hình: `GOOGLE_OAUTH_CLIENT_IDS` — các client id được chấp nhận (web/iOS/Android, cách nhau
  dấu phẩy). Bỏ trống → endpoint trả `503`.

Lỗi: `401 AUTH_OAUTH_TOKEN_INVALID` (token/nonce không hợp lệ) · `403 AUTH_OAUTH_EMAIL_UNVERIFIED` ·
`403 AUTH_ACCOUNT_LOCKED` / `AUTH_ACCOUNT_DELETED` · `409 AUTH_OAUTH_CONFLICT` (đua ghi, hiếm) ·
`503 AUTH_OAUTH_NOT_CONFIGURED` · `400 VALIDATION_FAILED`.

## POST /v1/auth/refresh

```bash
curl -s -X POST http://localhost:3000/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{ "refresh_token": "<refresh_token>" }'
```

Response `200`: `{ "access_token": "...", "refresh_token": "...", "expires_in": 900 }`.
Lỗi: `401 AUTH_INVALID_REFRESH_TOKEN` (token sai/đã xoay/đã thu hồi) · `401 AUTH_REFRESH_TOKEN_EXPIRED`.

## POST /v1/auth/logout

Thu hồi session hiện tại (refresh token của session bị vô hiệu ngay).

```bash
curl -s -X POST http://localhost:3000/v1/auth/logout \
  -H "Authorization: Bearer <access_token>"
```

Response `200`: `{ "id": "<session_id>", "revoked_at": "2026-09-26T12:05:00.000Z" }`.
Lỗi: `401 AUTH_TOKEN_MISSING` / `AUTH_TOKEN_INVALID`.

## GET /v1/auth/me

```bash
curl -s http://localhost:3000/v1/auth/me \
  -H "Authorization: Bearer <access_token>"
```

Response `200`: `{ "id": "5", "email": "...", "display_name": "...", "avatar_url": null, "status": "active", "created_at": "...", "last_login_at": "..." }`.
Lỗi: `401 AUTH_TOKEN_MISSING` / `AUTH_TOKEN_INVALID`.

> Ghi chú: `id` là bigint nên trả dạng **chuỗi** (JSON không có bigint). Sau logout,
> access token cũ vẫn dùng được tới khi hết hạn (tối đa 15 phút) — đúng thiết kế
> "access ngắn hạn, không tra DB mỗi request".

Swagger UI: `http://localhost:3000/docs` (nhóm **auth**).
