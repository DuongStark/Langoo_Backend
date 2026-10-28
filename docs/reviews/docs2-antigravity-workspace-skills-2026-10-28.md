# DOCS2 — Báo cáo thiết lập Workspace Skills cho Antigravity

- **Ngày thực hiện:** 2026-10-28
- **Mã hạng mục:** `DOCS2 — Thiết lập Workspace Skills cho Antigravity`
- **Mục đích:** Bổ sung các Workspace Skills theo đặc tả Antigravity (`.agents/skills/`) để các agent khi vào làm việc trong repo Langoo tự động nắm bắt và tuân thủ các quy tắc cốt lõi về quy trình (`AGENTS.md`), thiết kế API NestJS, quản trị CSDL Prisma/Postgres và kiểm thử streaming SSE.

---

## 1. Các skill đã tạo trong `.agents/skills/`

1. **`langoo-workflow` (`.agents/skills/langoo-workflow/SKILL.md`):**
   - Ràng buộc quy tắc làm việc duy nhất trên `main`, tuyệt đối không tạo worktree mới.
   - Nhắc nhở quy trình 5 bước: Kế hoạch → Duyệt → Code → Kiểm tra → Báo cáo.
   - Ràng buộc các bất biến domain: Không có bảng `cards`, liên kết Anh-Nhật ở cấp `concept`, client gửi `sense_id`/`face_id`, dữ liệu hiển thị phải đạt `curated`.
   - Cung cấp sẵn mẫu ghi chép cho `PROGRESS.md`.

2. **`nestjs-swagger-contract` (`.agents/skills/nestjs-swagger-contract/SKILL.md`):**
   - Hướng dẫn cấu trúc Controller, DTO, validation (`class-validator`, `class-transformer`).
   - Đảm bảo độ phủ 100% schema Swagger cho các response code.
   - Chuẩn hóa mã phản hồi HTTP và xử lý lỗi qua filter.

3. **`prisma-db-inspector` (`.agents/skills/prisma-db-inspector/SKILL.md`):**
   - Bản đồ 5 schema (`app`, `dict_en`, `dict_ja`, `dict_vi`, `dict_shared`) và 92 bảng.
   - Tra cứu nhanh cấu trúc bảng qua `prisma/schema.prisma` và `CSDL-THAM-CHIEU.md`.
   - Quy tắc bất biến migration: migration tuần tự, migration tiếp theo là `033`, không sửa migration cũ đã chạy (`001`–`027`, `029`–`032`).

4. **`sse-stream-tester` (`.agents/skills/sse-stream-tester/SKILL.md`):**
   - Hướng dẫn test luồng Server-Sent Events (SSE) của AI Chatbot và Quiz bằng `curl -N`.
   - Chuẩn hóa cấu trúc chunk JSON, done token, và xử lý ngắt kết nối (abort signal).

---

## 2. Kiểm tra & Nghiệm thu

- `git diff --check`: Pass, không có lỗi whitespace.
- Format file: Đầy đủ YAML frontmatter (`name`, `description`) và tài liệu Markdown chuẩn.
- Tích hợp Antigravity: Đặt đúng chuẩn thư mục `.agents/skills/` để Antigravity tự động phát hiện theo cơ chế Progressive Disclosure.
