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
