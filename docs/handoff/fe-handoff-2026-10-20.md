# M4.3 — FE liên kết Anh–Nhật ít từ, có nghĩa Việt và tìm được khi search

Ngày: 2026-10-20. BE **đã commit local `41ed9eb` (dependency M4.2 `71eb828`), chưa push/deploy**. Không có thay đổi source FE trong repo này. [Report và gate deploy](../reviews/m4.3-searchable-links-implementation-2026-10-20.md).

## Contract

`GET /v1/senses/:id/links` giữ các field cũ (`sense_id`, `language_id`, `lemma`, `reading`, `romanization`, `confidence`, `concept_id`), `next_cursor: null`. `data` có **0–3 từ khác nhau**, áp dụng cả Nhật → Anh và Anh → Nhật. BE chỉ chọn mapped target có nghĩa Việt của chính sense và xuất hiện đúng lexeme ID trong trang search mặc định đầu tiên; không có field gloss Việt mới trong response links.

## FE cần làm

1. Gọi links của **sense đang chọn**. Không cộng kết quả của tất cả sense của từ thành một danh sách.
2. Giữ thứ tự BE, render tối đa 3 chip; JA hiển thị thêm reading nếu có. Không thêm các mục ẩn/biến thể từ cache cũ để lấp đủ 3.
3. `data: []` thì ẩn cả tiêu đề và khối liên kết. Khi request lỗi, không dùng lại links của sense trước.
4. Click đi theo `sense_id` trả về: lấy sense detail, resolve đúng lexeme và chọn đúng sense (có thể trong `sub_senses`). Không search lại lemma rồi lấy mục/sense đầu tiên.
5. Query cache phải gồm sense ID và scope hồ sơ; khi đổi sense/hồ sơ ngôn ngữ phải cancel/ignore response cũ. Invalidate cache links khi BE mới deploy để không giữ danh sách hàng chục từ cũ.
6. Nếu cần tooltip/nghĩa Việt, đọc gloss của đúng target sense từ detail; không lấy gloss đầu tiên của toàn lexeme. BE không tạo/dịch thêm nghĩa trong request links.

## Kiểm tra sau tích hợp

- `agony`, sense 261514: dữ liệu hiện tại kỳ vọng 苦痛 くつう rồi 重苦 じゅうく; không còn hàng loạt OMW-JA. Đây là dự kiến từ probe SQL, **chưa phải response runtime đã deploy**.
- Nhật → Anh cũng tối đa 3 từ khác nhãn; không lặp `agony`/`Agony` do nguồn/case/POS.
- Hồ sơ đơn ngôn ngữ không hiện liên kết sang ngôn ngữ ngoài hồ sơ.
- Đổi sense nhanh, back/forward và đổi hồ sơ không lẫn link. Click và gõ nhãn trong search mở đúng identity; target có nghĩa Việt.
- FE smoke trên browser và kiểm cache chưa thực hiện; chờ BE tích hợp/deploy và source FE.

## 2026-10-20 — M4.3 phát hành trên VPS

Migration index search khi tích hợp đổi tên thành **044_dictionary_short_search_indexes.sql**, vì042 đã thuộc M14 trên production. Xem [report deploy](../reviews/m4.3-searchable-links-deploy-2026-10-20.md) để biết trạng thái và kết quả live; số liệu/tên042 trong bản kiểm tra local ngày13/10 là lịch sử.

### Kết quả triển khai 2026-10-20 — M4.2 / M4.3

Đã tích hợp trên bản VPS mới nhất, push/deploy release **48b8507**, migration **044** đã áp; CI và Deploy đều success. Full local491 unit/231 E2E, lint/build pass; live32 HTTPS requests pass. 以下 135465 trả một `following`; agony 261514 trả 苦痛/重苦, target có VI và đúng ID search. Exact search batch sau index 14,825 ms. Các trạng thái “chưa deploy” phía trên là bản ghi trước phát hành; gate tích hợp/index đã đóng, còn FE/browser cache. [Report deploy](../reviews/m4.3-searchable-links-deploy-2026-10-20.md).
