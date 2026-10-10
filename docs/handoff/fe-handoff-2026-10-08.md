# Handoff FE — phiên làm việc 2026-10-08

File mới của ngày để tổng hợp gửi FE cuối ngày. **BE code local; chưa deploy.
Chưa sửa source FE trong phiên này.**

## M6.2 — Phạm vi ngôn ngữ hồ sơ và hàng đợi SRS

Căn cứ: [plan M6.2](../plans/m6.2-srs-new-word-visibility.md),
[collections API](../api/collections.md), [dictionary API](../api/dictionary.md),
[SRS API](../api/srs.md), [profiles/settings](../api/profiles-settings.md).

### 1. Quy tắc sản phẩm đã chốt với chủ dự án

| Cấu hình hồ sơ                  | Entry/từ hiển thị và được phép thêm mới |
| ------------------------------- | --------------------------------------- |
| EN + JA (bất kể ngôn ngữ chính) | Cả EN và JA                             |
| Chỉ JA                          | Chỉ JA                                  |
| Chỉ EN                          | Chỉ EN                                  |

Collection tạo lúc song ngữ có một từ EN và một từ JA: khi **sửa chính hồ sơ đó**
sang JA-only, chỉ thấy từ JA; sang EN-only chỉ thấy từ EN. Bật lại song ngữ thấy
cả hai, IDs và lịch SRS giữ nguyên. Không xóa từ, không reset lịch, không chuyển
collection sang hồ sơ khác. Không còn gate `PROFILE_LANGUAGE_IN_USE`.

Profile của collection là cố định. Khi **chọn một hồ sơ khác** làm active,
FE tải `/collections?profile_id=<active_profile_id>` để chỉ hiển thị các bộ của
hồ sơ đang học. Dictionary/queue theo hồ sơ active; API đọc collection trực tiếp
vẫn theo hồ sơ gắn với bộ. Không dùng ngôn ngữ chính để loại secondary trong chế độ song ngữ.

### 2. Tích hợp contract BE local

1. Item list đã lọc item và `faces[]` theo primary/secondary **trước limit**.
   Dùng **`display_sense_id`** để tải lemma/detail; không dùng anchor EN đã bị ẩn
   để render khi chỉ còn mặt JA. `anchor_sense_id` chỉ giữ identity gốc.
   PATCH một item đang ẩn có thể trả `display_sense_id: null`, `faces: []`:
   bỏ nó khỏi list, không fetch detail anchor để hiện lại.
2. Collection response có **`visible_item_count`** cho số từ đang hiện;
   `item_count` là tổng đã lưu, bao gồm từ ẩn. Một item hai face vẫn tính một.
3. Gửi Bearer trên **search, suggestions, reverse, lexeme senses, sense detail/links,
   Kanji**, không chỉ search. Không token/chưa có profile giữ catalog công khai.
   SVG qua `<img src>` không tự gửi Bearer: nếu cần scope, fetch có token rồi dùng blob.
4. Với đơn ngữ, ẩn lựa chọn ngôn ngữ không được phép; song ngữ cho phép cả hai,
   mặc định tra cả hai nếu chưa chọn filter. `lang`/`language_id` chỉ thu hẹp scope.
   Direct detail ngoài scope trả 404; không retry bằng API anonymous.
5. Reverse JA-only trả `en: []`, `viaLemma: ''`; không hiện ô EN trống hoặc nhãn
   cầu nối Anh. `matched` chỉ tính kết quả thật sự được phép hiển thị.
6. Add/clone/secondary face sai language trả `409 COLLECTION_LANGUAGE_NOT_IN_PROFILE`
   với `allowed_language_ids`, `unsupported_language_ids`; hướng dẫn chọn bộ phù hợp.
7. Scope lọc entry cần học. EN gloss làm ngữ cảnh của một sense JA, attribution,
   note tự nhập vẫn có thể chứa tiếng Anh; FE ưu tiên gloss VI khi có.

8. Đổi tập language sẽ expire quiz ready theo scope cũ; không reuse quiz đó.
   Đổi scope trong khi AI đang tạo trả `409 QUIZ_SCOPE_CHANGED`: báo hồ sơ đã
   thay đổi, tạo lại khi cooldown cho phép. Câu hỏi/lịch sử vẫn giữ nguyên.

### 3. Reset sau đổi hồ sơ hoặc language

Sau PATCH primary/secondary hoặc PATCH active_profile_id thành công:

- Query key gồm profile ID **và tập primary/secondary**, không chỉ profile ID.
  Dùng cùng key scope cho dictionary, suggestions, items, stats, queue, quiz.
- Hủy request đang chạy để response scope cũ không ghi đè kết quả mới.
- Xóa kết quả/gợi ý/chi tiết đang mở; reset filter language không còn hợp lệ.
- Reset cursor, trang collection, index flashcard, queue/session/quiz đang học.
  Không tiếp tục snapshot tạo trước đổi scope; tải lại trang đầu.
- Invalidates và refetch profiles/settings → collections/items → queue/stats.
  Dictionary cursor cũ sai scope trả 400: bắt đầu lại, không retry mãi.
- Lịch sử tra từ là lịch sử query cũ, không phải tập từ được phép học. Không dùng
  recent queries đã cache như autocomplete vocabulary để lộ entry scope cũ.

### 4. Sửa flashcard phân trang và số liệu (findings audit trước đó)

- Helper `/srs/due` phải nhận/gửi `cursor`, giữ collection/limit, đọc `data`,
  `next_cursor`, `counts`. Hết một trang 20 thẻ chưa có nghĩa hết lượt học.
- Chỉ dùng cursor nối snapshot chưa bị review thay đổi. Sau rating thành công,
  refetch eligibility từ trang đầu theo state/quota mới; xử lý Again/learn-ahead
  theo server. Không giữ sibling cũ chờ từng `SRS_ITEM_UNAVAILABLE` mới skip.
- BE local chọn tối đa một new/review sibling/item trước cap/limit, giữ các
  learning/relearning độc lập; practice cũng lọc sibling và giữ đúng limit.
  FE không tự gộp lịch SRS hoặc gộp các item có mặt chữ giống nhau.
- Add/remove/pause/suspend phải invalidate queue và stats, không chỉ list items.
- `new_introduced_today` = **Đã học mới hôm nay**; `due_now` không bao gồm `new`.
  `counts` sau filter/cap trước limit/cursor, không phải số lemma hoặc tổng tồn kho.
- Học bộ thuộc profile khác: chuyển đúng profile và tải queue mới; không hiển thị
  rỗng như thể người dùng chưa thêm từ.

### 5. Phần chưa có contract, FE chưa bật

- Metadata phân biệt hết quota, new chờ học, archived/paused và lý do empty đầy đủ.
- Học đích danh item vừa thêm: `/sessions` hiện chỉ có collection filter, chưa
  nhận item IDs; practice vẫn cập nhật lịch/XP. Không tự giả định preview miễn ghi.

### 6. Ca nghiệm thu FE

1. Song ngữ EN+JA lưu được cả hai, bất kể chọn EN hay JA làm chính.
2. Với cùng collection hai từ: JA-only thấy JA; EN-only thấy EN; bật song ngữ
   thấy lại cả hai, lịch ôn không reset.
3. Một item có anchor EN + secondary JA: JA-only render JA qua display_sense_id.
4. Gợi ý/search/reverse/detail không đưa entry ngoài scope, kể cả khi gõ filter cũ.
5. Đổi scope khi request/flashcard/quiz đang mở không hiện kết quả scope trước.
6. Add/clone sai language báo lỗi; item/face/SRS không được tạo một phần.
7. Bộ trên 20 thẻ có thể học tiếp; sau rating không đi qua sibling đã bị bury.
8. Counts/nhãn đúng; add refresh queue/stats; không dùng cache của profile khác.

### 7. Kiểm tra và trạng thái

- Ngày/mã: 2026-10-08 / **M6.2**. Thay đổi BE đã lưu trong repo cùng plan/API docs.
- Kiểm tra: build pass; regression 11 suite/146 test pass, sau sửa race quiz/profile có follow-up 3 suite/30 test pass; ESLint phạm vi sửa + format/diff pass; 10 truy vấn smoke VPS chỉ đọc pass.
- Chưa chạy E2E ghi vì DB test local không kết nối; VPS chỉ chạy truy vấn đọc.
- Gate: tích hợp/test source FE, E2E HTTP và deploy BE+FE phối hợp.
- Git/triển khai: **chưa commit/push/deploy M6.2**; không sửa dữ liệu production.
