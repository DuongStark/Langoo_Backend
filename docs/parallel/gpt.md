# Prompt phiên A — GPT Sol High / Luna Max

Bạn làm trong `/media/duongstark/Du lieu/code/Langoo-worktrees/gpt-backend`,
branch `parallel/gpt-m10-stream`. Không làm trong thư mục `Langoo` chính.

## Nhiệm vụ

Review độc lập M10.1 chat streaming; sửa lỗi có bằng chứng trong chức năng đã triển khai,
kèm test hồi quy và commit cục bộ. Không xây milestone mới.

Đọc `CONTEXT-DU-AN.md`, `PROMPT-BACKEND.md`, `PROGRESS.md`,
`docs/plans/m10.1-chat-streaming.md`, `docs/api/chat.md`, tài liệu FE streaming,
`docs/ops/vps-deployment.md` và code/test chat. Tài liệu trạng thái có ghi chú lịch sử;
đối chiếu code thay vì suy rằng checkbox chưa tick nghĩa là chưa có tính năng.

Worktree GPT đã fast-forward lên base `4d43752` ngày 2026-10-05 sau khi bản sửa M13
được commit/push main. Không sửa hoặc commit thay các file M13.

## Những luồng phải kiểm tra

- Parser SSE: UTF-8/chunk cắt giữa dòng, CRLF, nhiều `data:` line, `[DONE]`, EOF,
  usage-only frame, bỏ reasoning, malformed payload và response rỗng.
- Trước delta đầu: JSON error/status đúng contract; sau delta: một event error rồi kết thúc.
  Không để headers đã gửi dẫn đến exception/connection treo.
- Retry 429/5xx/timeout chỉ trước delta, tối đa theo thiết kế; không retry khi client abort.
  Timeout/abort hủy upstream và giải phóng reader/listener/lease đúng lúc.
- Client disconnect ở các giai đoạn; lease/quota/ai_usage/persist có hành vi đúng quyết định D2,
  không ghi tin thành công cho stream thất bại và không phát done khi transaction thất bại.
- Endpoint thường giữ hành vi cũ; ownership, archived session, quota timezone,
  hai request đồng thời và khi provider không hỗ trợ stream.
- Không lộ provider credentials/prompt trong log hoặc lỗi trả client.

Đây là danh sách kiểm tra, không khẳng định code đang có từng lỗi.
Mỗi finding phải có vị trí code, tác động và ca tái hiện/test.

## Phạm vi file

Được sửa `src/ai/chat/**`, provider chat và test tương ứng trong `src/ai/providers/`,
`test/chat-stream*.e2e-spec.ts`, `docs/api/chat.md` nếu cần đồng bộ contract đã có,
`docs/reviews/m10-stream-review-2026-10-05.md`.

Không sửa quiz, admin, feedback, storage, auth, pagination helper, config schema,
`src/ai/ai.module.ts`, migrations, Prisma, dependencies, `.env.example`, `PROGRESS.md`.
Nếu phát hiện vấn đề cần file ngoài scope, ghi đề xuất cụ thể vào báo cáo cho người tích hợp.
Không thêm dependency hoặc đổi contract/kiến trúc lớn; trường hợp đó viết plan và chờ duyệt.

## Môi trường và nghiệm thu

`.env` đã chuẩn bị cho local DB `langoo_parallel_gpt_test`, AI stub, port 3101.
Chạy `nvm use` theo `.nvmrc` (Node 22) trước các lệnh npm; shell mặc định hiện là Node 25.
Không ghi/in `.env` hay secrets. Không gọi AI thật, deploy hoặc ghi DB production.
Nếu reset DB, xác minh cả TEST_DATABASE_URL/TEST_DIRECT_URL đúng DB của phiên này.

1. Review, tái hiện, sửa từng lỗi trong scope; test async/DB có ý nghĩa.
2. Chạy build, lint và unit; E2E chat chạy DB local riêng. Nếu không đủ môi trường,
   báo rõ gate chưa chạy, không tuyên bố pass.
3. Báo cáo severity, thay đổi, test, giới hạn và backlog ngoài scope vào file review riêng.
4. Kiểm tra `git diff --check`, commit theo đơn vị logic; không push/merge main.
   Base M13 đã nhận; chỉ rebase khi người tích hợp cung cấp base mới. Gửi hash và tóm tắt để tích hợp.
