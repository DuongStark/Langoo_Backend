# API: Auth

Tất cả endpoint dưới prefix `/v1`. Access token là JWT HS256 sống mặc định **15 phút**;
refresh token opaque 32 byte, server chỉ lưu SHA-256 — gọi `refresh` sẽ **xoay vòng**
token (token cũ bị từ chối ngay). Nếu nhiều request đồng thời dùng cùng một token,
chỉ một request thành công; các request còn lại nhận `AUTH_INVALID_REFRESH_TOKEN`.

Từ **M2.5 (2026-11-03)**, mỗi request có access token còn phải có session tồn tại,
đúng user, chưa bị thu hồi, chưa hết hạn và user đang active. Logout vô hiệu ngay
access token của session ở các request mới. Kiểm tra session thất bại do DB trả
`503 AUTH_SERVICE_UNAVAILABLE`; token/session không hợp lệ trả `401 AUTH_TOKEN_INVALID`.
API cho guest vẫn nhận request không có Authorization, nhưng không bỏ qua token sai.

Từ **M2.3 B (2026-11-19)**, khôi phục mật khẩu dùng hai endpoint `password/forgot`
và `password/reset`. Tính năng chỉ bật khi BE đủ cấu hình email; thiếu cấu hình thì
cả hai trả `503 AUTH_PASSWORD_RESET_UNAVAILABLE`. Link trong email dùng fragment
`#token=...`, hạn 15 phút, chỉ áp dụng identity mật khẩu hiện có. Reset thành công
thu hồi mọi phiên và không tự đăng nhập.

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

## POST /v1/auth/password/forgot

Gửi hướng dẫn đặt lại mật khẩu qua email. Response **luôn** cùng một nội dung cho
email tồn tại, email lạ, tài khoản Google-only, tài khoản bị khóa và địa chỉ đang bị
giới hạn tần suất, nên không dùng endpoint để dò tài khoản.

```bash
curl -s -X POST http://localhost:3000/v1/auth/password/forgot \
  -H "Content-Type: application/json" \
  -d '{ "email": "user@example.com" }'
```

Response `202`:

```json
{
  "message": "Nếu email tồn tại, hướng dẫn đặt lại mật khẩu đã được gửi"
}
```

Email được xếp gửi sau response (`setImmediate`); việc tra tài khoản và gửi mail
không nằm trên đường phản hồi HTTP. Chỉ identity `provider=password` đang active,
có hash mật khẩu và email hiện tại khớp email lúc phát token mới nhận mail. Giới hạn
theo địa chỉ: 1 lần/phút và 5 lần/giờ; gửi lại không vô hiệu link cũ còn hạn.

Lỗi: `400 VALIDATION_FAILED` (email sai/không có) · `429 RATE_LIMITED`
(20 lần/giờ/IP) · `503 AUTH_PASSWORD_RESET_UNAVAILABLE` (BE chưa cấu hình đủ email).
Khi có `503`, endpoint không đọc DB và không gửi mail.

## POST /v1/auth/password/reset

Đặt mật khẩu mới bằng token một lần trong email. Token đúng 43 ký tự base64url;
`new_password` dùng cùng policy đăng ký (8–128 ký tự).

```bash
curl -s -X POST http://localhost:3000/v1/auth/password/reset \
  -H "Content-Type: application/json" \
  -d '{ "token": "<43 ký tự base64url>", "new_password": "matkhau-moi-123" }'
```

Response `200`:

```json
{
  "user_id": "5",
  "sessions_revoked": 2,
  "next_action": "login"
}
```

Token hết hạn sau **15 phút**, chỉ dùng một lần, DB chỉ lưu SHA-256. Thành công sẽ:
đánh dấu mọi challenge chưa dùng của identity là đã dùng, cập nhật mật khẩu và
`email_verified_at`, thu hồi **tất cả** session chưa revoke của user. Endpoint không
tạo access/refresh token mới; FE phải xóa phiên local và đưa người dùng về đăng nhập.
Login đã kiểm mật khẩu cũ trước khi reset cũng không tạo được phiên sau reset.

Lỗi: `400 AUTH_CHALLENGE_INVALID` (token sai, đã dùng, hết hạn hoặc identity/địa chỉ/
trạng thái user đã đổi) · `429 RATE_LIMITED` (10 lần/phút/IP) ·
`503 AUTH_PASSWORD_RESET_UNAVAILABLE` (BE chưa cấu hình đủ email).

Link email dùng URL FE cố định từ `AUTH_PASSWORD_RESET_URL` và đặt token trong
fragment: `https://app.langoo.org/reset-password#token=<token>`. Token không nằm trong
query string nên không tới web server của FE. Mở link không tiêu thụ token; chỉ gọi
`reset` mới đổi trạng thái. BE chỉ bật khi đủ `AUTH_PASSWORD_RESET_URL`,
`RESEND_API_KEY`, `AUTH_PASSWORD_RESET_FROM`; sender phải được Resend xác minh và
migration `052_password_reset_challenges.sql` phải được áp trước khi bật.

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
- Email Google **đã xác thực** trùng tài khoản đã có → trả `409 AUTH_OAUTH_LINK_REQUIRED`,
  không tự động liên kết và không tạo session mới.
- Liên kết chủ động dùng `POST /v1/auth/oauth/google/link` sau khi đăng nhập tài khoản password;
  endpoint yêu cầu access token, mật khẩu hiện tại và ID token Google có cùng email.
- `nonce`: nếu ID token chứa claim `nonce` thì request **bắt buộc** gửi `nonce` khớp với lượt
  SDK đã khởi tạo. Mặc định backend vẫn dùng mô hình bearer của đợt A. Client có thể dùng
  challenge dùng một lần bên dưới; chỉ khi bật `GOOGLE_OAUTH_REQUIRE_CHALLENGE=true` thì
  `challenge_id` và `binding_secret` mới bắt buộc.
- Cấu hình: `GOOGLE_OAUTH_CLIENT_IDS` — các client id được chấp nhận (web/iOS/Android, cách nhau
  dấu phẩy). Bỏ trống → endpoint trả `503`.

Lỗi: `401 AUTH_OAUTH_TOKEN_INVALID` (token/nonce không hợp lệ) · `403 AUTH_OAUTH_EMAIL_UNVERIFIED` ·
`403 AUTH_ACCOUNT_LOCKED` / `AUTH_ACCOUNT_DELETED` · `409 AUTH_OAUTH_LINK_REQUIRED` ·
`409 AUTH_OAUTH_CONFLICT` (đua ghi, hiếm) · `503 AUTH_OAUTH_NOT_CONFIGURED` ·
`503 AUTH_OAUTH_PROVIDER_UNAVAILABLE` · `401 AUTH_OAUTH_CHALLENGE_INVALID` ·
`400 VALIDATION_FAILED`.

## POST /v1/auth/oauth/google/challenge

Tạo challenge dùng một lần trong PostgreSQL. Với `purpose=login`, endpoint công khai; với
`purpose=link`, phải gửi access token của phiên hiện tại. Client dùng `nonce` để khởi tạo
Google Sign-In SDK và giữ `binding_secret` để gửi lại backend. Hai giá trị bí mật chỉ xuất hiện
trong response này.

```bash
curl -s -X POST http://localhost:3000/v1/auth/oauth/google/challenge \
  -H "Content-Type: application/json" \
  -d '{ "purpose": "login" }'
```

Response `200`:

```json
{
  "challenge_id": "019...",
  "nonce": "nonce-ngau-nhien",
  "binding_secret": "secret-ngau-nhien",
  "expires_in": 300
}
```

Khi gửi `POST /oauth/google` hoặc `/oauth/google/link`, thêm `challenge_id` và
`binding_secret`. Challenge được consume cùng transaction với session/identity; dùng lại,
hết hạn, sai purpose, sai user/session hoặc sai binding đều trả `401 AUTH_OAUTH_CHALLENGE_INVALID`.
Khi đã dùng challenge, client **không bắt buộc** gửi lại `nonce` (token nonce được đối chiếu
với challenge); nếu vẫn gửi thì phải khớp token.
Bật bắt buộc sau khi mọi client đã tích hợp bằng `GOOGLE_OAUTH_REQUIRE_CHALLENGE=true`.
Nếu `GOOGLE_OAUTH_CLIENT_IDS` trống, endpoint trả `503 AUTH_OAUTH_NOT_CONFIGURED`.

## POST /v1/auth/oauth/google/link

Liên kết Google vào tài khoản hiện tại. Request phải dùng access token của phiên password,
mật khẩu hiện tại và ID token Google có email trùng tài khoản. Endpoint không tạo session mới.

```bash
curl -s -X POST http://localhost:3000/v1/auth/oauth/google/link \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "id_token": "eyJhbGciOiJSUzI1NiIs...",
    "nonce": "nonce-da-dung-khi-lay-token",
    "password": "matkhau12345"
  }'
```

Response `200`: `{ "provider": "google", "linked_at": "..." }`.
Lỗi: `401 AUTH_TOKEN_INVALID` / `AUTH_INVALID_CREDENTIALS` · `403 AUTH_ACCOUNT_LOCKED` /
`AUTH_ACCOUNT_DELETED` / `AUTH_OAUTH_EMAIL_UNVERIFIED` · `409 AUTH_OAUTH_EMAIL_MISMATCH` /
`AUTH_OAUTH_IDENTITY_TAKEN` / `AUTH_OAUTH_LINK_PASSWORD_REQUIRED` ·
`401 AUTH_OAUTH_CHALLENGE_INVALID`.

## POST /v1/auth/refresh

```bash
curl -s -X POST http://localhost:3000/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{ "refresh_token": "<refresh_token>" }'
```

Response `200`: `{ "access_token": "...", "refresh_token": "...", "expires_in": 900 }`.
Lỗi: `401 AUTH_INVALID_REFRESH_TOKEN` (token sai/đã xoay/đã thu hồi) · `401 AUTH_REFRESH_TOKEN_EXPIRED`.

## POST /v1/auth/logout

Thu hồi **mọi access token và refresh token của session hiện tại**, bao gồm access
token cũ trước lần refresh. Các session đăng nhập khác của cùng tài khoản không bị ảnh hưởng.
Server giữ bản ghi session với `revoked_at`, không xóa cứng dữ liệu.

```bash
curl -s -X POST http://localhost:3000/v1/auth/logout \
  -H "Authorization: Bearer <access_token>"
```

Response `200`: `{ "id": "<session_id>", "revoked_at": "2026-09-26T12:05:00.000Z" }`.
Lỗi: `401 AUTH_TOKEN_MISSING` / `AUTH_TOKEN_INVALID`.

Gọi lại logout bằng cùng JWT **chưa hết hạn** vẫn trả 200 và cùng `revoked_at`,
kể cả nhiều request logout đồng thời. JWT hết hạn/sai chữ ký hoặc sid không thuộc
user vẫn bị từ chối. Logout là ngoại lệ duy nhất cho phép token của session đã revoke
đi vào handler để retry; token đó không truy cập được API bảo vệ khác.

FE phải gửi logout trước khi xóa token local. Nếu mất mạng/5xx, chưa xác nhận được
server đã thu hồi session; xử lý retry và thông báo rõ. Xem
[handoff M2.5](../handoff/m2.5-immediate-logout-revocation-fe-2026-11-03.md).

## GET /v1/auth/me

```bash
curl -s http://localhost:3000/v1/auth/me \
  -H "Authorization: Bearer <access_token>"
```

Response `200`: `{ "id": "5", "email": "...", "display_name": "...", "avatar_url": null, "status": "active", "created_at": "...", "last_login_at": "..." }`.
Lỗi: `401 AUTH_TOKEN_MISSING` / `AUTH_TOKEN_INVALID`.

> Ghi chú: user `id` là bigint nên trả dạng **chuỗi** (JSON không có bigint); session
> `id` là UUID. M2.5 thay thế thiết kế stateless cũ: sau khi logout trả 200, request
> mới dùng token của session đó nhận 401. Không hủy HTTP/SSE đã qua bước xác thực
> trước khi session bị thu hồi; FE cần abort luồng và xóa thông tin đăng nhập/cache.

Swagger UI: `http://localhost:3000/docs` (nhóm **auth**).

## Handoff FE — quên / đặt lại mật khẩu

Xem [M2.3 B — Handoff FE](../handoff/m2.3-password-recovery-fe-2026-11-19.md) để biết
luồng UI, cách đọc token từ fragment, i18n và checklist nghiệm thu.
