# DOCS3 — Thử 20 ảnh Muse từ bộ Ẩm thực & Nhà hàng

Ngày 2026-10-30. Chủ dự án yêu cầu trực tiếp thử khoảng 20 ảnh để đo tốc độ và tiêu thụ.
Đây là spike vận hành được phép trong phiên, không phải triển khai API sản phẩm.

- Cohort: 20 anchor sense thật từ deck `en-restaurant-dining`, đọc DB bằng transaction READ ONLY.
- Dùng tài khoản Muse web hiện có, không chuyển sang paid Model API hoặc OpenAI ImageGen.
- Giới hạn 20 ảnh mới, không tự tạo lại ảnh lỗi. Prompt nghĩa nguồn, một ảnh riêng mỗi nghĩa,
  cùng phong cách, không chữ/logo, không ảnh tìm kiếm. Có checkpoint trước khi gửi, không resend mù.
- Đo wall clock từ gửi đến có output, tải/kiểm ảnh và tổng bytes. Lấy usage UI/endpoint nếu có;
  số Muse tự kể không được coi là số đo quota. Phân biệt một yêu cầu agent với số lần tạo ảnh.
- Artifacts local ở `uploads/docs3-muse-images-20261030/` (gitignored). Chỉ dùng VPS làm browser/client;
  không sửa app/DB, không lưu kho ảnh lên VPS. Browser/display được bật tạm để khôi phục phiên;
  hoàn nguyên về inactive khi xong và kiểm health.
- File lưu: script spike khi cần, report DOCS3, PROGRESS và cohort/timing/prompt/ảnh local.
- Kiểm tra: xác minh đúng cohort 20, ảnh thật có kích thước/hash, báo đúng số thành công;
  `git diff --check` và Git status. Không cần test ứng dụng cho spike này.
- Native pin cũ lỗi `DecodeError` sau đăng nhập lại; dùng browser hiện có làm fallback.

## Lô 2 — 20 nghĩa mới, cảnh đời thường và nhiều cách thể hiện

Chủ dự án yêu cầu trực tiếp thêm 20 ảnh trong cùng bộ, ưu tiên đời thường và đa dạng hơn,
giảm cảm giác AI slop sau khi xem lô 1. Tiếp tục mã DOCS3, không cần duyệt thêm cho spike này.

- Chọn 20 anchor sense khác lô 1; giữ đúng nghĩa của `grill` (dụng cụ), `steam` (hơi nước),
  `slice` (lát mỏng), không tự chuyển thành động từ để hợp cảnh bếp.
- Brief từng từ: 14 ảnh chụp sinh hoạt với nhiều góc/bối cảnh/ánh sáng, 2 tranh mực đời thường,
  1 chì màu, 2 cắt giấy theo cảnh, 1 comic vị chua. Không lặp nền kem/chủ thể chính giữa.
- Một ảnh/ nghĩa, cap 20, không reroll hoặc sửa ảnh tự động. Dùng Muse web hiện có.
- Prompt riêng và marker `DOCS3-IMAGES-20261030-BATCH2`; mở rộng script spike để nhận prompt file
  và marker tùy chọn, giữ hành vi lô 1 khi không truyền. Ghi nhãn file UI khi tải để đối chiếu.
- Lưu riêng `uploads/docs3-muse-images-20261030-batch2/`; không ghi đè ảnh/manifest lô 1.
- Trạng thái trước lô 2: browser/display/bridge đều active; giữ nguyên trạng thái này sau thử,
  không tự dừng browser có sẵn từ trước lô.
- Đo thời gian/dung lượng và kiểm đủ file/hash/nhãn/ảnh trực quan. Quota vẫn chưa có meter đáng tin;
  không quy đổi hoặc báo số tiêu thụ giả. Không sửa app/DB/ENV hoặc publish/upload kho ảnh.

## Lô 3 — Prompt ảnh điện thoại, 8 ảnh thử để tiết kiệm

Chủ dự án muốn giảm độ nét/cảm giác dàn dựng, gần ảnh điện thoại hoặc máy ảnh bình thường;
yêu cầu thử thêm và cho phép tìm nguồn trên mạng. Đây là spike đã được yêu cầu trực tiếp.

- Tra nguồn gốc về độ nét cảm nhận/Clarity và realism; phân biệt nguồn ảnh đẹp với ảnh sinh hoạt.
- Chọn 4 từ có ảnh kiểu chụp ở lô 2: breakfast, fry, spicy, picnic. Dùng A từ ảnh cũ làm tham chiếu,
  chỉ tạo B/C mới (8 ảnh), không tạo lại 4 ảnh A. B/C cùng nghĩa và mô tả cảnh cốt lõi.
- B: prompt tiếng Anh ngắn kiểu ảnh điện thoại trong nhóm gia đình. C: thêm ràng buộc camera
  thông thường, ánh sáng sinh hoạt, chi tiết mềm, tương phản thấp hơn và hậu cảnh còn nhận ra.
- Không thêm từ nâng thẩm mỹ kiểu cinematic/macro/editorial/ultra-detailed. Không làm mờ hoặc nén
  ảnh cũ để giả kết quả prompt. Chỉ tạo ảnh mới qua Muse, mỗi sample 1 ảnh, cap 8, không reroll.
- Script spike cho custom prompt nhận 1..20 sample, khóa duy nhất theo `sample_id` khi cùng nghĩa
  có nhiều variant; prompt mặc định lô 1 vẫn bắt buộc 20 nghĩa khác nhau. Marker/checkpoint riêng.
- Artifact `uploads/docs3-muse-images-20261030-batch3/`; preview A/B/C, prompt nguyên văn,
  manifest/hash/timing, ZIP có 8 ảnh mới + 4 tham chiếu. Giữ nguyên các lô trước.
- Không có seed cố định/log tool-level: đây là so sánh khám phá, chưa chứng minh quan hệ nhân quả
  hoặc prompt tối ưu toàn cục. Chưa có meter quota nên không bịa số token tiết kiệm.
- Dịch vụ VPS trước lô đều active; giữ nguyên trạng thái, kiểm health; không sửa app/DB/ENV.
