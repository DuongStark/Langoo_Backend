# Prompt phiên B — DeepSeek V4 Flash

Bạn làm trong `/media/duongstark/Du lieu/code/Langoo-worktrees/deepseek-data`,
branch `parallel/deepseek-db3`. Không làm trong thư mục `Langoo` chính.

## Nhiệm vụ đợt đầu

Kiểm kê phần còn thiếu của DB3 và viết **kế hoạch DB3-A có thể duyệt**.
Chưa triển khai seed ghi dữ liệu hoặc migration: `PROMPT-BACKEND.md` yêu cầu kế hoạch
được duyệt trước code milestone mới. Người dùng đang giao chuẩn bị/chia việc song song.

Đọc `CONTEXT-DU-AN.md`, `PROMPT-BACKEND.md`, `PROGRESS.md`, `CSDL-THAM-CHIEU.md`,
migrations liên quan, repository dictionary/credits và `docs/ops/vps-deployment.md`.
Nguồn tham khảo chỉ đọc ở `/media/duongstark/Du lieu/code/data-Langoo`, đặc biệt
`scripts/seed_metadata.py`, `scripts/run_mapping.py`, `downloads/README.md` và manifest.
Thư mục dữ liệu này không có Git; không sửa trực tiếp trong đó.

## Các quyết định đã có

- JLPT canonical là `core.jlpt_link`, giữ provenance `(source_level, source_row_number)`
  theo schema thật; `lexeme_level` chỉ tham chiếu, không dùng ghi đè.
- Data LLM dự kiến OpenCode Zen `space-bunny-free`, lô nhỏ + checkpoint.
  Chat runtime đang dùng Groq, không sửa cấu hình chat. Chưa gọi LLM trong đợt chuẩn bị.
- Bộ thủ Kangxi 214 khác 253 cấu kiện KRADFILE; không suy mapping chỉ từ chuỗi bộ phận.
- Core/serve/public/staging read-only đối với API. Seed dữ liệu là công cụ vận hành riêng,
  cần plan được duyệt nêu rõ bảng nào được ghi; không tự mở ngoại lệ cho runtime API.
- Không tự curated gloss/concept máy, không mất provenance, không tự đổi nguồn/license.

## Đầu ra bắt buộc

1. `docs/reviews/db3-inventory-2026-10-05.md`: đối chiếu schema/source/script hiện có cho
   radical, KanjiVG/media, JLPT, deck, gloss sense/concept và credits. Phân biệt demo/full DB;
   số lượng phải có query và nơi đo, hoặc ghi chưa xác minh. Không chạy write query.
2. `docs/plans/db3-a-foundation.md`: chia DB3-A deterministic seed với DB3-B gloss/LLM.
   DB3-A cần file, nguồn/version/license, join key/upsert key/FK, idempotency,
   dry-run, test local, xác minh sau chạy, rollback theo lô và rủi ro của từng bảng.
   Ưu tiên nguồn đã có; nêu rõ nguồn chưa có, dữ liệu mơ hồ và quyết định thật sự còn thiếu.
3. Bảng phần nào có thể làm ngay sau duyệt, phần nào cần chọn nguồn/tải dữ liệu/quyền ghi.
   Không gộp triển khai DB4 hoặc M14 vào DB3-A.

Ghi query kiểm kê read-only trong báo cáo, không tạo schema/view/tables tạm.
Nếu chưa được cấp kết nối DB full local, tiếp tục kiểm kê file/source và ghi phần số liệu
còn thiếu. Không lấy `.env` production hay tự SSH vào VPS để đo/ghi.

## Sau khi DB3-A được duyệt

Chỉ triển khai đúng phần duyệt trong `scripts/db3/**` cùng fixtures/test đi kèm,
bằng Node/TypeScript và dependencies sẵn có; không thêm Python/psql dependency cho backend.
Mặc định dry-run, cho phép thử ghi duy nhất trên DB local riêng, có bảo vệ đích và
transaction/upsert kiểm thử hai lần không tạo bản sao. Thiết kế apply DB thật là bước
vận hành riêng chỉ người tích hợp chạy sau duyệt; không cấm tên DB thật trong thiết kế
rồi vô tình làm tool không dùng được cho đích dự kiến.

Không sửa `src/**`, Prisma, migrations cũ, dependencies, env chung, `PROGRESS.md`.
Nếu cần migration/dependency, đề xuất người tích hợp chốt một lần; không tự cấp số migration.

## Môi trường và bàn giao

`.env` local riêng: `langoo_parallel_deepseek_test`, AI stub, port 3102.
Chạy `nvm use` theo `.nvmrc` (Node 22) trước các lệnh npm; shell mặc định hiện là Node 25.
DB này là fixture demo, không đại diện coverage của dữ liệu đầy đủ.
Không reset DB của GPT hoặc worktree chính; không in/commit URL có credentials/API key.

Chốt báo cáo và plan vào commit cục bộ riêng, gửi hash + những quyết định còn cần duyệt.
Không push, merge, deploy, apply migration production hoặc chạy batch LLM thực tế.
Chờ duyệt DB3-A trước code seed; trong lúc chờ có thể hoàn thiện kiểm kê nguồn/read-only.
