# DOCS4 — Audit pháp lý website Langoo theo luật Việt Nam

- Ngày: 2026-11-03.
- Phạm vi được yêu cầu: rà soát website; lưu báo cáo và bằng chứng, không sửa chức năng sản phẩm, không commit/push/deploy.
- Checkout: `main`, làm trực tiếp; giữ các thay đổi có sẵn.

## Các bước

1. Đọc `.vn-law-check/AGENTS.md`, phân loại bằng `references/00-triage.md` và chạy `scripts/scan.sh`.
2. Xác minh bằng chứng trong backend, tài liệu vận hành và trang công khai `https://langoo.org`; loại bỏ tín hiệu giả từ dữ liệu từ điển, báo cáo, backup.
3. Đối chiếu nguồn pháp luật công khai tại ngày audit, ghi rõ phần chưa xác minh; kiểm dữ liệu cá nhân, AI, an ninh mạng, quyền người tiêu dùng và điều kiện áp dụng TMĐT/quảng cáo/giao dịch điện tử.
4. Lập báo cáo có mức ưu tiên, file:dòng/URL, căn cứ và tiêu chí khắc phục; tách thiếu bằng chứng với lỗi đã quan sát.
5. Cập nhật `PROGRESS.md`; kiểm link nội bộ, bằng chứng, `git diff --check` và working tree.

## Giới hạn và đầu ra

- Không truy xuất dữ liệu thật của người học, secret hoặc cấu hình production có bí mật.
- Không đăng ký tài khoản hay gửi nội dung sang AI trong lượt rà soát.
- Hồ sơ pháp nhân, DPIA, hợp đồng nhà cung cấp và cấu hình runtime chỉ được xác nhận khi có bằng chứng; thiếu trong repo không đồng nghĩa chưa tồn tại.
- Báo cáo: `docs/reviews/docs4-vietnam-legal-audit-2026-11-03.md`.
- Trạng thái bàn giao: đã lưu báo cáo và evidence, hoàn tất rà soát trong phạm vi source/HTTP công khai; các gate browser/runtime/hồ sơ pháp lý còn thiếu được ghi trong báo cáo. Tài liệu local chưa commit/push/deploy.
