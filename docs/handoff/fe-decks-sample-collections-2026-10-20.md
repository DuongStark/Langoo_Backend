# Handoff FE — Bộ từ mẫu tiếng Nhật (decks) · 2026-10-20

## Tóm tắt

- **13 bộ từ mẫu** tiếng Nhật đã được seed + publish trong `core.deck` (BE).
- User vào màn "Bộ từ mẫu", xem danh sách, bấm **Thêm** → chọn:
  1. **Tạo bộ mới y hệt** (clone toàn bộ bộ mẫu), hoặc
  2. **Thêm từ vào bộ đã có** (append, tự bỏ qua từ trùng).
- BE đã live: `app@6551ac1` (deploy 20/10/2026), CI 483 test xanh.

## Dữ liệu 13 bộ (lấy từ API, không hardcode)

| id | slug | Tiêu đề | Nhóm | Số từ |
| --- | --- | --- | --- | --- |
| 1 | `jlpt-n1` | Từ vựng JLPT N1 | JLPT | 2.683 |
| 2 | `jlpt-n2` | Từ vựng JLPT N2 | JLPT | 1.609 |
| 3 | `jlpt-n3` | Từ vựng JLPT N3 | JLPT | 2.067 |
| 4 | `jlpt-n4` | Từ vựng JLPT N4 | JLPT | 689 |
| 5 | `jlpt-n5` | Từ vựng JLPT N5 | JLPT | 763 |
| 6 | `starter-100` | 100 từ tiếng Nhật đầu tiên | Khởi động | 100 |
| 7 | `greetings` | Chào hỏi & giao tiếp cơ bản | Chủ đề | 44 |
| 8 | `numbers-time` | Số đếm · Giờ · Ngày tháng | Chủ đề | 68 |
| 9 | `family` | Gia đình & con người | Chủ đề | 44 |
| 10 | `food` | Đồ ăn & nhà hàng | Chủ đề | 53 |
| 11 | `transport` | Đi lại & địa điểm | Chủ đề | 55 |
| 12 | `verbs-basic` | Động từ cơ bản | Chủ đề | 100 |
| 13 | `adjectives-basic` | Tính từ cơ bản | Chủ đề | 80 |

> `item_count` có thể thay đổi khi ops cập nhật deck — **luôn đọc từ API**, không hardcode.
> `id` và `slug` ổn định. Ngôn ngữ hiện tại: **JA** (`language_id = 2`).

## API (Bearer JWT — 401 nếu thiếu token)

### 1) Danh sách bộ mẫu

```
GET /v1/collections/decks
```

**200:**
```json
{
  "data": [
    {
      "id": "6",
      "slug": "starter-100",
      "title": "100 từ tiếng Nhật đầu tiên",
      "description": "Bộ khởi động: 100 từ thông dụng nhất cho người mới (chọn tay).",
      "language_id": 2,
      "level_label": "N5",
      "item_count": 100
    }
  ]
}
```

- Sort hiện tại: `level_label NULLS LAST, id` → N1…N5 rồi nhóm phụ (`N5–N4`).
- FE nên tự nhóm hiển thị: **Khởi động & chủ đề** (slug không bắt đầu `jlpt-`) và **Theo cấp JLPT** (N5 → N1).
- Có thể cache ngắn (≈5 phút); mỗi lần mở màn nên fetch lại.

### 2) Tạo bộ mới y hệt (clone)

```
POST /v1/collections/from-deck
{
  "deck_id": "6",          // string số (KHÔNG gửi number)
  "name": "Tên tuỳ chọn",  // optional, ≤ 80 ký tự; bỏ trống = tên deck
  "profile_id": "uuid"     // optional; mặc định = active profile
}
```

**201** → `CollectionResponse`:
```json
{
  "id": "01a0dc8a-7191-7e18-93b0-32e8378986fe",
  "profile_id": "01a0dc8a-718f-7acd-a588-2cf077898399",
  "owner_id": "7",
  "name": "100 từ tiếng Nhật đầu tiên",
  "description": "Bộ khởi động: ...",
  "kind": "cloned",
  "cloned_from_deck_id": "6",
  "cloned_from_collection_id": null,
  "is_public": false,
  "item_count": 100,
  "visible_item_count": 100,
  "created_at": "2026-10-20T00:00:00.000Z",
  "updated_at": "2026-10-20T00:00:00.000Z",
  "archived_at": null
}
```

⚠️ **Không idempotent** — bấm 2 lần tạo 2 bộ. FE **disable nút khi đang gửi**.
Bộ lớn (N1 ≈ 2.683 từ) server xử lý vài giây → đặt timeout client **≥ 30–40s**, hiện loading.

### 3) Thêm từ vào bộ đã có (append)

```
POST /v1/collections/{collection_id}/from-deck
{ "deck_id": "7" }
```

**201:**
```json
{ "collection_id": "01a0dc8a-7191-7e18-93b0-32e8378986fe", "added": 44, "skipped": 0, "item_count": 144 }
```

- Thêm vào **cuối bộ**, giữ thứ tự của deck.
- **Bỏ qua từ trùng** trong cùng bộ (so theo sense); `skipped` = số từ deck đã có sẵn.
- Từ mới được tạo SRS state `new` (recognize + recall, due = now) → vào hàng đợi ôn tập theo setting của user.
- `item_count` = tổng số từ của bộ **sau khi thêm**.
- **An toàn khi retry** (từ trùng bị bỏ qua) — vẫn nên disable nút khi đang gửi.
- Trùng chỉ tính trong **cùng một bộ**; cùng từ ở bộ khác vẫn thêm được bình thường.

### Mã lỗi

| HTTP | code | Khi nào |
| --- | --- | --- |
| 401 | `UNAUTHORIZED` | Thiếu/hết hạn token |
| 404 | `DECK_NOT_FOUND` | Deck không tồn tại hoặc chưa publish |
| 404 | `COLLECTION_NOT_FOUND` | Bộ không thuộc user (kể cả đã archive) |
| 409 | `PROFILE_REQUIRED` | Clone không chỉ định profile và user chưa có profile mặc định |
| 409 | `PROFILE_NOT_FOUND` | Profile không thuộc user / không tồn tại |
| 409 | `COLLECTION_LANGUAGE_NOT_IN_PROFILE` | Profile không chứa ngôn ngữ của deck (hiện tại: JA) |
| 409 | `COLLECTION_POSITION_LIMIT_REACHED` | (gần như không xảy ra) bộ đạt giới hạn vị trí item |

Envelope lỗi theo chuẩn BE: `{ "code": "...", "message": "..." }` (+ `details` với lỗi ngôn ngữ).

## Luồng màn hình gợi ý

1. **Màn "Bộ từ mẫu"**: gọi `GET /v1/collections/decks`.
   - Card: tiêu đề, mô tả, badge `level_label`, "N từ".
   - Nhóm: *Khởi động & chủ đề* trước, *Theo cấp JLPT* sau (N5 → N1).
2. Bấm **Thêm** → bottom sheet:
   - **"Tạo bộ mới"** → gọi API (2).
   - **"Thêm vào bộ của tôi"** → chọn bộ trong danh sách bộ hiện có (`GET /v1/collections`) → gọi API (3).
3. Sau khi xong: toast *"Đã thêm 44 từ"*; nếu `skipped > 0`: *"Bỏ qua 12 từ đã có"*.
4. Bộ lớn: hiện cảnh báo "Bộ lớn (2.683 từ) — nên học dần" + ước lượng số ngày theo tốc độ từ mới/ngày của user (nếu có).

## Lưu ý kỹ thuật

- Tất cả id trong body là **string số** (`"6"`), không phải number; `collection_id` là UUID.
- `visible_item_count` chỉ khác `item_count` khi bộ có item ngoài ngôn ngữ hồ sơ.
- Danh sách deck **không** trả progress; nếu cần "đã thêm vào bộ nào" → FE tự đối chiếu theo `cloned_from_deck_id` (clone) hoặc gọi `GET /v1/collections` và so danh sách item.
- Deck do ops cập nhật; không có API admin tạo/sửa deck ở thời điểm này.

## Chưa có (đề xuất mở rộng, nói BE nếu cần)

- Thêm **một phần** deck (`limit`/`offset` hoặc chọn từng từ).
- API trả progress theo deck (số từ đã có trong bộ của user).
- Deck đa ngôn ngữ (EN/VI) — schema `language_id` đã sẵn sàng.

## Test nhanh

```bash
TOKEN=<jwt>
# danh sách
curl -s -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:3000/v1/collections/decks | jq '.data | length'
# clone
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"deck_id":"6"}' http://127.0.0.1:3000/v1/collections/from-deck | jq '.id,.item_count'
# append
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"deck_id":"7"}' \
  http://127.0.0.1:3000/v1/collections/<collection_id>/from-deck | jq
```

Swagger: các endpoint có `@ApiOperation` — xem mục **collections** trong Swagger UI.
