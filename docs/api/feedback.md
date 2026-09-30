# API: Feedback (M13)

Feedback người dùng: text + tối đa **3 ảnh** (JPEG/PNG/WebP, ≤5MB, kiểm magic bytes).
Ảnh lưu qua `StorageService` (`STORAGE_PROVIDER=local` dev / `s3` production — adapter S3 backlog);
DB chỉ giữ metadata. Giới hạn gửi: **10 lần/giờ/user**.

## POST /v1/feedback

`Content-Type: multipart/form-data`:

| Field | Bắt buộc | Ghi chú |
| --- | --- | --- |
| `category` | ✅ | `bug` ｜ `feature` ｜ `content` ｜ `other` |
| `content` | ✅ | 10..4000 ký tự |
| `files` | — | tối đa 3 tệp, ≤5MB/tệp, chỉ JPEG/PNG/WebP thật (magic bytes) |

```bash
curl -s -X POST http://localhost:3000/v1/feedback \
  -H "Authorization: Bearer <access_token>" \
  -F 'category=bug' \
  -F 'content=Nút ôn tập bị lệch trên màn hình nhỏ' \
  -F 'files=@screenshot.png'
```

Response `201`:

```json
{
  "id": "019...", "category": "bug", "content": "...", "status": "new",
  "admin_note": null,
  "attachments": [{ "id": "019...", "mime": "image/png", "size_bytes": 2048 }],
  "created_at": "...", "updated_at": "..."
}
```

Lỗi: `400 ATTACHMENT_INVALID` (sai magic bytes/rỗng/quá 3 tệp) · `413 PAYLOAD_TOO_LARGE`
(>5MB) · `503 STORAGE_UNAVAILABLE` (lưu tệp lỗi — đã dọn tệp dở) · `429 RATE_LIMITED` · `400 VALIDATION_FAILED`.

## GET /v1/me/feedback?limit&cursor

Feedback của chính mình (mới nhất trước) + `status` + `admin_note` để theo dõi xử lý.

> Admin xử lý hàng chờ tại [docs/api/admin.md](admin.md).
