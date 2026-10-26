# DOCS1 — Hợp nhất checkout và dọn worktree

Ngày: 2026-10-26. Chủ dự án yêu cầu đồng bộ toàn bộ về một checkout và xóa worktree phụ; không dùng worktree cho các phiên tiếp theo.

## Phạm vi và cách thực hiện

1. Kiểm kê 14 worktree records (main + 11 worktree phụ còn trên đĩa + 2 record /tmp đã mất). Kiểm commit chưa có trên origin/main, tracked/untracked/ignored và liên kết dependencies.
2. Sao lưu patch, untracked, trạng thái từng worktree; giữ cấu hình riêng trong vùng local được ignore. Chuyển 2,3 GB uploads của deepseek-data về checkout chính trước khi xóa.
3. Stash WIP main, fast-forward 97 commit từ `56f17fb` đến `origin/main` `7efeacd`; tích hợp commit riêng M10.1 và khôi phục WIP theo three-way merge.
4. Xóa các worktree phụ sau khi đã lưu thay đổi; prune hai record mất đường dẫn. Chốt chỉ dùng checkout chính và kiểm tra kết quả.

## Những phần được hợp nhất

- **M10.1 — Chat SSE:** `gpt-backend` có commit riêng `9b8c6b5`, chưa được merge hoặc cherry-pick tương đương vào origin/main. Đã cherry-pick thành `13d59cb`; xử lý conflict ở chat service và OpenAI provider, giữ gửi ảnh hiện tại cùng abort/retry/parser/token validation của bản sửa. Có các unit/E2E regression đi kèm commit gốc.
- **M11/DB4-D2 — WIP code main:** retrieval streaming và quiz-source giống code remote; transaction timeout quiz đã có trong bản mới. Stash apply không tạo delta code ở ba file này; giữ các thay đổi mới của main.
- **DB4-D4/D5 — Fixture typecheck:** TS2790 có sẵn trên main tại `batch-prepare.test.ts:675` do xóa property bắt buộc của fixture. Dùng `Reflect.deleteProperty` để tạo output thiếu confidence như chủ đích test; typecheck sau sửa và 3/3 tests pass.
- **DB4-D4/D5 — Prompt v2 và mẫu audit:** giữ các file plan/review/scripts chưa commit, không chạy lại job/provider hoặc apply DB. Đây là artifact/tooling lịch sử được gom về, không mở lại gate pipeline đã thay thế.
- **M10 — Devora:** giữ khảo sát và toàn bộ report/JSON/JSONL/CSV ngày 12–13/10; kiểm pattern secret trên file mới không có match. Không gọi provider trong lượt hợp nhất.
- **M4.2 — Handoff release:** ghi chú chưa commit trong worktree m4-2-release đã có cùng section trong report mới trên main; patch gốc được sao lưu để đối chiếu, không ghi đè report mới.
- **DOCS1 — Tài liệu:** hòa giải PROGRESS để giữ cả timeline remote và WIP local; giữ report tiến độ đầu phiên. Báo cáo tiến độ trước hợp nhất là snapshot lịch sử, các con số lệch checkout/WIP ở đó không phải trạng thái sau dọn.
- **Dependencies:** origin/main đã track nhầm `node_modules` dạng symlink trỏ vào deepseek-data. Đã chuyển directory dependency về main, bỏ symlink khỏi Git index; `.gitignore` đã bỏ qua `node_modules/`. Không còn phụ thuộc worktree để chạy lệnh.
- **AGENTS.md:** ghi lựa chọn checkout duy nhất theo yêu cầu trực tiếp của chủ dự án.

## Sao lưu local

`uploads/consolidation-20261026/manifest.json` ghi đường dẫn, HEAD, branch và backup của từng worktree. Mỗi backup có tracked.patch/status.txt/untracked.tar; cấu hình riêng có quyền 0600 trong thư mục backup 0700. Uploads deepseek nằm tại `uploads/consolidation-20261026/deepseek-data/uploads/`. Không đưa vùng backup vào Git.

Stash `DOCS1 pre-consolidation main WIP 2026-10-26` giữ làm mốc phục hồi; không còn là nơi duy nhất chứa WIP, các file đã được khôi phục/hòa giải trên main. Các branch lịch sử được giữ, không còn checkout phụ.

## Kiểm tra / Git / triển khai

- Node 22.22.2: `npm run build` pass; `npm test -- --runInBand` pass **60 suites / 524 tests**, 89,464s. Giữ test ảnh chat và các test SSE từ nhánh nhập về.
- `tsc -p tsconfig.db4.json --noEmit`: ban đầu fail TS2790 có sẵn; sau sửa fixture pass. `node --import tsx --test scripts/db4/batch-prepare.test.ts`: **3/3 pass**, 9,199s.
- Lint toàn repo lần đầu chỉ báo một lỗi Prettier ở provider sau hòa giải; đã format đúng file; `npm run lint` lần cuối **pass** toàn repo (0 errors/warnings).
- Parse 22 JSON/JSONL mới pass; secret-pattern scan file mới không match; liên kết hai report DOCS1 tồn tại. CSV M10 chuẩn hóa CRLF sang LF; whitespace cũ của handoff 08/10 đã dọn.
- `git worktree list --porcelain` chỉ còn main; mọi đường dẫn worktree phụ trong manifest đã mất, dependencies là directory thật trong main, backup artifact tồn tại. `git diff --check` sạch trước stage cuối.
- Commit local: M10.1 `13d59cb`, M10 artifacts `cb5e080`, DB4-D4/D5 `eda6001`; thay đổi quy tắc/tài liệu/dependency cleanup lưu cùng commit DOCS1 cuối. Chưa push; origin/main vẫn `7efeacd`.
- Build/test/lint lần trước bị ngắt giữa phiên không được dùng làm bằng chứng pass; các lần chạy lại ghi log `/tmp/langoo-consolidation-*.log`. Test trước khi dọn từng thấy collision package trong worktree lồng; lần 524-test sau khi xóa worktree không còn cảnh báo này.
- Không chạy DB reset, migration, inference, push hoặc deploy trong lượt hợp nhất.
