# API: Admin (M13)

Tất cả endpoint dưới `/v1/admin/*`, yêu cầu Bearer token của user có `role='admin'`
(`AdminGuard` đọc DB mỗi request — thu hồi quyền hiệu lực ngay). User thường → `403 ADMIN_REQUIRED`.

> **Quyền riêng tư:** admin chỉ xem **số liệu tổng hợp**; chi tiết duy nhất là dữ liệu
> người dùng **chủ động gửi** (`gloss_report`, `feedback`). Không có endpoint đọc
> collection/item/chat cá nhân. Mọi thao tác ghi của admin đều vào `app.admin_audit_log`.

## Bootstrap admin (một lần)

```sql
UPDATE app.users SET role = 'admin' WHERE lower(email) = 'you@example.com';
```

## GET /v1/admin/stats

Snapshot tổng hợp (UTC): user theo status, đăng ký/quay lại 7–30 ngày; học tập
(lượt ôn, phân bố streak, collection/item, quiz, backlog SRS đến hạn);
nội dung (gloss_report theo status/issue, concept theo status, gloss máy vs đã duyệt,
độ phủ `sense_pair`); AI 30 ngày (request/token/chi phí theo feature, số user chạm quota hôm nay).

- `ai.users_at_quota_today`: so ngày quota với ngày địa phương của từng user;
  một user chạm quota cả chat và quiz được đếm một lần.
- `learning.srs_due_now`: state đến hạn có profile/face phù hợp, collection còn hoạt động,
  item không paused, state không suspended/buried còn hạn; tổng tất cả profile,
  chưa áp hạn ôn hàng ngày của từng user.

## GET /v1/admin/stats/timeseries?metric=signups|reviews|ai_requests&days=30

`days` 1..180. Response `{ metric, days, points: [{ date, value }] }` (ngày UTC).

## Hộp thư feedback

| Endpoint | Mô tả |
| --- | --- |
| `GET /v1/admin/feedback?status=&category=&limit&cursor` | hàng chờ (kèm user gửi) |
| `GET /v1/admin/feedback/:id` | chi tiết + metadata ảnh |
| `GET /v1/admin/feedback/:id/attachments/:attachmentId` | tải ảnh (guard admin, không public URL) |
| `PATCH /v1/admin/feedback/:id` | `{status: new｜in_progress｜resolved, admin_note?}` → audit |

Audit `feedback.update` giữ `status` cùng `before`/`after` gồm `status` và
`admin_note`. Bỏ `admin_note` để giữ ghi chú cũ; gửi chuỗi rỗng để xóa ghi chú.

## Báo lỗi gloss

| Endpoint | Mô tả |
| --- | --- |
| `GET /v1/admin/gloss-reports?status=&issue=&target_kind=&limit&cursor` | hàng chờ |
| `PATCH /v1/admin/gloss-reports/:id` | `{status: triaged｜fixed｜rejected}` — `fixed/rejected` set `resolved_at`; audit |

## Khoá/mở người học

```bash
curl -s -X PATCH http://localhost:3000/v1/admin/users/42 \
  -H "Authorization: Bearer <admin_token>" -H 'Content-Type: application/json' \
  -d '{ "status": "locked" }'
```

- Chỉ `active`/`locked` (không xoá cứng, không hồi sinh tài khoản `deleted`).
- Không tự đổi trạng thái chính mình, không đổi trạng thái tài khoản admin → `409 USER_STATUS_INVALID`.
- Lock có hiệu lực ngay với login/refresh (`403 AUTH_ACCOUNT_LOCKED`).

## GET /v1/admin/audit-log?limit&cursor

Nhật ký thao tác admin (mới nhất trước): `action`, `target_kind`, `target_id`, `payload`, admin email.
Các queue feedback/gloss-report/audit dùng cursor opaque timestamp/id đủ
microsecond; truyền nguyên `next_cursor` để lấy trang kế tiếp.

## M14 — Curation ghi `core` (sửa gloss + nối nghĩa)

Chính sách 15/10: nội dung máy (gloss VI, mapping LLM) **mặc định OK** — user báo sai
(`gloss_report` có sẵn) → admin sửa sau. Mọi mutation ghi audit trong `app.admin_audit_log`;
đổi mapping/concept kích hoạt refresh `serve.sense_pair` **chạy nền** (concurrently, không chặn request).

| Endpoint | Mô tả |
| --- | --- |
| `GET /v1/admin/curation/senses?q=&lang=ja&limit=` | tìm sense (lemma/kana/romaji ILIKE hoặc `external_id` chính xác) |
| `GET /v1/admin/curation/senses/:id` | chi tiết sense: gloss VI/EN, nối nghĩa (concept + confidence + status), 10 report gần nhất |
| `GET /v1/admin/curation/glosses/:id` | tra gloss theo id (nối từ `gloss_report.target_id`) + sense chứa nó |
| `GET /v1/admin/curation/concepts?q=&limit=` | tìm concept (gloss_en/vi hoặc id) để chọn khi thêm nối nghĩa |
| `PATCH /v1/admin/curation/glosses/:id` | `{text?, reviewed?, quality?}` — sửa tay tự bỏ cờ máy dịch; `reviewed` set/bỏ `reviewed_by`; `quality` 0..100 |
| `POST /v1/admin/curation/senses/:id/glosses` | `{text}` — thêm gloss VI (rank kế tiếp, đánh dấu admin duyệt) |
| `DELETE /v1/admin/curation/glosses/:id` | xoá gloss (audit giữ nội dung cũ) |
| `POST /v1/admin/curation/senses/:id/mappings` | `{concept_id, relation?}` — thêm nối nghĩa (method `admin`, verified) |
| `DELETE /v1/admin/curation/senses/:id/mappings/:conceptId` | xoá nối nghĩa sai |
| `PATCH /v1/admin/curation/concepts/:id` | `{status: draft｜review｜curated｜rejected}` |
| `POST /v1/admin/curation/serve/refresh` | refresh `serve.sense_pair` ngay (thường đã tự chạy nền ~vài giây sau mutation) |

Lỗi: `404 SENSE_NOT_FOUND｜GLOSS_NOT_FOUND｜CONCEPT_NOT_FOUND｜MAPPING_NOT_FOUND` · `409 MAPPING_EXISTS` · `400 NO_CHANGES｜VALIDATION_FAILED`.
Audit actions: `curation.gloss.update|create|delete`, `curation.mapping.create|delete`, `curation.concept.status`.
