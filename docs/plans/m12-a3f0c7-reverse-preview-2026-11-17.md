# M12-A06.1/A12 — Nghĩa xem trước và định danh Nhật khi tra ngược (A3F0C7)

Ngày17/11/2026. Theo yêu cầu xử lý feedbackA3F0C7. Chỉ mở rộng contract hai route
reverse và suggestions/reverse, giữ trường/aliases, thứ tự và scope hiện có.

1. Giữ assertion/source sense của các kết quả đã chọn; thêm resolver đọc theo
   batch để xác định đúng EN sense và JA lexeme/sense, không gọi search/AI từng dòng.
2. Ưu tiên bằng chứng: EN source_sense_id hợp lệ; JA target accepted, gloss/hint
   khớp, mapping exact/curated và trường hợp mục chỉ có một nghĩa. Mặt chữ trùng
   đơn thuần chỉ dùng mở lexeme khi rõ định danh; không chọn nghĩa đầu khi mơ hồ.
3. Thêm preview cùng SenseCardDto của search (giữ cờ machine/reviewed); JA thêm
   lexeme_id/sense_id nullable. Không đủ bằng chứng thì null, không lấy ID EN
   trung gian làm ID Nhật. FE giữ fallback cũ khi null.
4. Unit và HTTP/DB test: đúng sense khác sense đầu, cây→植物, ambiguity/null,
   alias/order cũ, JA-only, không N+1, Swagger; build/lint và kiểm docs.
5. Lưu report/handoff, PROGRESS, test thực tế và trạng thái Git/deploy. Không sửa
   FE, dữ liệu dictionary hoặc tự đóng feedback trước khi nghiệm thu tương ứng.

Baseline đọc production17/11: cây→plant assertion251219 source sense2722346;
植物 assertion251216 cùng source sense. Nhật có nhiều nguồn; JMdict lexeme140202
có một sense148381 và VI “cây, thực vật; thảm thực vật”. Candidate hiện có chỉ
pending nên không dùng nó như accepted. Các ID ở đây là dictionary công khai.
