# FE handoff — 2026-10-13

## M4.2 — Tối ưu search một ký tự

**Trạng thái:** backend code xong local, chưa commit/push/deploy. FE chưa sửa trong đợt này.

### Hành vi search/suggestions

- Đúng một chữ Latin ASCII, không phân biệt hoa/thường: tìm từ bắt đầu bằng chữ đó. `a` có thể trả `a`, `apple`; không trả `cat` chỉ vì chứa `a`. Khi input đó sinh kana cho JA/không chọn ngôn ngữ, variants cũng dùng prefix.
- Một Kanji/kana vẫn tìm từ có chứa ký tự đó: `猫`, `山猫`, `猫舌`. Từ từ hai ký tự trở lên giữ substring hiện có.
- Không thay shape response thành công, IDs hoặc cursor v5. Dùng cursor opaque do API trả; không tự tạo/sửa cursor.
- Exact tier có thể trả ngay khi đủ trang; nếu chưa đủ thì backend chạy query đầy đủ. FE không phải phối hợp hai lượt gọi.

### Lỗi timeout cần trình bày đúng

HTTP **504**, error code **`DICTIONARY_SEARCH_TIMEOUT`**, thông báo yêu cầu nhập thêm ký tự rồi thử lại. Dùng error envelope `{code,message}` hiện có.

- Không chuyển lỗi này thành danh sách rỗng hoặc thông báo “không tìm thấy từ”.
- Suggestions: dừng trạng thái loading của request lỗi; chỉ hiển thị kết quả của query hiện tại. Không retry liên tục cho cùng một ký tự.
- Việc cancel request cũ/debounce của FE vẫn cần được giữ; backend tối ưu không thay thế việc tránh hiển thị response của query đã cũ.

### Phạm vi và kiểm tra

- BE: repository search, migration 042, Swagger 504 cho search/suggestions; không đổi phần học, AI hoặc nội dung từ điển.
- Test BE local: 437 unit pass; 30 dictionary integration pass, gồm scope, Unicode, phân trang và canonical visibility. Có một test dedup cũ ngoài hai suite này đang lệch expectation với policy nguồn hiện tại; xem report.
- Cần migration **042** trước code và smoke API thực tế trên VPS sau tích hợp; FE không dùng hành vi mới trước khi BE deploy.
- [API dictionary](../api/dictionary.md), [plan M4.2](../plans/m4.2-short-search-2026-10-13.md), [report M4.2](../reviews/m4.2-short-search-2026-10-13.md).

Git/triển khai: chưa commit/push/deploy; không có thay đổi FE trong repo backend.
