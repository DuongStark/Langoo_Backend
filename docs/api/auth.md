# API: Auth

Tất cả endpoint dưới prefix `/v1`. Access token là JWT HS256 sống **15 phút**;
refresh token opaque 32 byte, server chỉ lưu SHA-256 — gọi `refresh` sẽ **xoay vòng**
token (token cũ bị từ chối ngay).

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

## POST /v1/auth/login

```bash
curl -s -X POST http://localhost:3000/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{ "email": "user@example.com", "password": "matkhau12345" }'
```

Response `200` giống register (cập nhật `last_login_at`).
Lỗi: `401 AUTH_INVALID_CREDENTIALS` · `403 AUTH_ACCOUNT_LOCKED` / `AUTH_ACCOUNT_DELETED`.

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
