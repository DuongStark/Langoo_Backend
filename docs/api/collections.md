# API: Collections (sổ tay)

Tất cả endpoint cần **Bearer token**; dữ liệu giới hạn theo user (lấy từ JWT).
Bộ sưu tập gắn với một hồ sơ học (`study_profile`); nếu không gửi `profile_id`
thì dùng `user_settings.active_profile_id` → hồ sơ mặc định → nếu chưa có hồ sơ nào
thì trả `409 PROFILE_REQUIRED`.

## Collections

```bash
# Tạo bộ
curl -s -X POST localhost:3000/v1/collections -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" -d '{"name":"Bộ của tôi"}'

# Danh sách / chi tiết / đổi tên (mặc định 20, tối đa 100)
curl -s "localhost:3000/v1/collections?limit=20" -H "Authorization: Bearer <token>"
# trang sau: truyền next_cursor nguyên vẹn vào cursor
curl -s "localhost:3000/v1/collections?limit=20&cursor=<next_cursor>" -H "Authorization: Bearer <token>"
curl -s localhost:3000/v1/collections/<id> -H "Authorization: Bearer <token>"
curl -s -X PATCH localhost:3000/v1/collections/<id> -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" -d '{"name":"Tên mới"}'

# Xoá = ARCHIVE mềm (ẩn khỏi danh sách, giữ lịch sử ôn tập)
curl -s -X DELETE localhost:3000/v1/collections/<id> -H "Authorization: Bearer <token>"
# → {"id":"...","archived_at":"2026-09-27T..."}
```

## Thêm từ vào bộ (1–2 face)

Client gửi **`sense_id`**, server tự suy ra ngôn ngữ từ `core.sense → lexeme`
(không nhận `language_id` từ client). `secondary_sense_id` phải **khác ngôn ngữ**
với mặt chính và cả hai language phải nằm trong primary/secondary language của
profile gắn với bộ. BE đọc lại profile dưới user lock trước khi ghi; đổi ngôn ngữ
profile được phép thay đổi: face ngoài phạm vi được ẩn và giữ lịch ôn. Mỗi face sinh
**2 `srs_state`** (`recognize` + `recall`) trong cùng transaction.

```bash
curl -s -X POST localhost:3000/v1/collections/<id>/items \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"sense_id":"1","secondary_sense_id":"2","meaning_vi":"chạy"}'
```

```json
{
  "id": "01a0...",
  "anchor_sense_id": "1",
  "display_sense_id": "1",
  "meaning_vi": "chạy",
  "meaning_source": "user",
  "status": "learning",
  "position": 1,
  "faces": [
    { "id": "...", "sense_id": "1", "language_id": 2, "role": "primary" },
    { "id": "...", "sense_id": "2", "language_id": 1, "role": "secondary" }
  ],
  "tag_ids": []
}
```

Lỗi: `409 ITEM_ALREADY_EXISTS` (từ đã có) · `400 COLLECTION_FACE_LANGUAGE_DUPLICATE` ·
`400 COLLECTION_SENSE_PAIR_INVALID` (hai sense không phải cặp đã duyệt) ·
`400 COLLECTION_CONCEPT_INVALID` · `409 COLLECTION_LANGUAGE_NOT_IN_PROFILE`
(details có `allowed_language_ids` và `unsupported_language_ids`) ·
`404 SENSE_NOT_FOUND` / `404 TAG_NOT_FOUND`.

Đổi hồ sơ JA+EN → JA-only hoặc EN-only được phép. Item/face ngoài ngôn ngữ mới
được ẩn, không xóa; bật lại ngôn ngữ sẽ thấy từ và lịch ôn cũ. Hai item EN đang nằm
trong hồ sơ JA được giữ theo cùng quy tắc, không cần chuyển/xóa tự động.

Khi gửi hai face, server chỉ chấp nhận cặp có trong `serve.sense_pair` và cả hai
mapping có `concept.status = curated`, confidence tối thiểu `0.7`. Concept gửi
từ client (nếu có) phải đúng concept của cặp; nếu chỉ có một face thì concept
phải là mapping curated của sense đó. Sense chưa có mapping hợp lệ vẫn có thể
được lưu một face với `concept_id: null`.

## Danh sách từ (lọc + thứ tự + phân trang cursor)

```bash
curl -s "localhost:3000/v1/collections/<id>/items?language_id=2&status=learning&order=desc&limit=20" \
  -H "Authorization: Bearer <token>"
# trang sau:
curl -s "localhost:3000/v1/collections/<id>/items?language_id=2&status=learning&order=desc&limit=20&cursor=<next_cursor>" \
  -H "Authorization: Bearer <token>"
```

- Luôn lọc trước phân trang theo primary/secondary của **hồ sơ gắn với collection**.
  Chỉ trả item có ít nhất một face hợp lệ; `faces[]` cũng chỉ chứa face được phép.
- `language_id` thu hẹp phạm vi trên (mặt phụ cũng tính), không mở rộng phạm vi hồ sơ.
  Chọn language tồn tại nhưng ngoài hồ sơ trả danh sách rỗng.
- `display_sense_id` là face hiện được phép hiển thị, ưu tiên anchor nếu còn được
  phép. Dùng field này để lấy lemma/detail; `anchor_sense_id` giữ identity gốc.
  Khi PATCH một item đã bị ẩn, response có `faces: []`, `display_sense_id: null`.
- Collection response thêm `visible_item_count`: số item có face được phép;
  `item_count` vẫn là tổng lưu trong DB, gồm từ đang ẩn. Một item song ngữ chỉ tính một.
- API list collections giữ khả năng xem các hồ sơ của chủ sở hữu; màn hình học
  phải gửi `profile_id` của hồ sơ active để không trộn các bộ của hồ sơ khác.
- `order=asc|desc` (M5.2), mặc định `asc`. Sắp xếp **trước phân trang** theo
  `(position ASC, id ASC)` hoặc `(position DESC, id DESC)`, kể cả khi trùng position.
  `order=desc&limit=100` lấy tối đa 100 item có position lớn nhất ngay trang đầu.
- Đây là thứ tự position hiện tại; nếu đã chỉnh position thì không đồng nghĩa thời gian tạo.
- Cursor keyset `(position, id)` base64url là opaque; giữ nguyên `next_cursor`,
  `order`, collection và các filter ở trang sau; `next_cursor=null` khi hết.
- Đổi order/language/status/profile/collection phải tải lại trang đầu và bỏ cursor/cache cũ.
  Desc cursor dùng lại với asc (kể cả khi bỏ order) trả `400 VALIDATION_FAILED`;
  cursor legacy chưa có hướng vẫn dùng cho asc, không dùng được cho desc.
- `order` ngoài đúng hai giá trị chữ thường `asc`/`desc` trả `400 VALIDATION_FAILED`.
  Limit vẫn mặc định 20, tối đa 100; response `{ data, next_cursor }` không thêm field.

## Sửa / xoá từ

```bash
curl -s -X PATCH localhost:3000/v1/collections/<id>/items/<itemId> \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"note":"ôn trước khi ngủ","tag_ids":["5"],"status":"paused"}'

curl -s -X DELETE localhost:3000/v1/collections/<id>/items/<itemId> \
  -H "Authorization: Bearer <token>"
# → {"id":"...","deleted_at":"..."}  (xoá cascade face + srs_state, item_count giảm)
```

`tag_ids` **thay thế toàn bộ** tag của item (gửi `[]` để bỏ hết). ID lặp trong
request được khử trùng trước khi ghi. Khi sửa `meaning_vi`, `meaning_source`
được chuyển thành `user`; sửa riêng note/tag/status/position giữ nguyên nguồn.

## Tags

```bash
curl -s -X POST localhost:3000/v1/tags -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" -d '{"name":"#n5","color":"#4f46e5"}'
curl -s "localhost:3000/v1/tags?limit=20" -H "Authorization: Bearer <token>"
# trang sau:
curl -s "localhost:3000/v1/tags?limit=20&cursor=<next_cursor>" -H "Authorization: Bearer <token>"
curl -s -X DELETE localhost:3000/v1/tags/<id> -H "Authorization: Bearer <token>"
```

Tag trùng tên (không phân biệt hoa thường) → `409 TAG_ALREADY_EXISTS`.

## Clone bộ từ hệ thống

```bash
curl -s -X POST localhost:3000/v1/collections/from-deck \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"deck_id":"1"}'
# → collection kind="cloned", cloned_from_deck_id="1", item_count=11
```

Mỗi `deck_item` → 1 item (face anchor) + 2 `srs_state`; `meaning_vi` lấy gloss vi
(gloss máy chưa duyệt → `meaning_source="machine"`, còn lại `"source"`),
fallback en → lemma. Deck sai/chưa publish → `404 DECK_NOT_FOUND`; concept của
deck item không còn là mapping curated confidence ≥ 0.7 → `409 DECK_CONCEPT_INVALID`.

Các danh sách dùng keyset cursor, mặc định 20 dòng và tối đa 100 dòng/trang.
Cursor phải dùng với cùng phạm vi/bộ lọc của trang đầu; item cursor ràng buộc thêm
chiều `order`. Cursor sai hình dạng hoặc item cursor khác chiều trả `400 VALIDATION_FAILED`. UUID, bigint ngoài miền PostgreSQL,
null hoặc chuỗi chỉ có khoảng trắng đều bị từ chối bằng lỗi 4xx trước khi chạm DB.

Swagger UI: `http://localhost:3000/docs` (nhóm **collections**, **tags**).
