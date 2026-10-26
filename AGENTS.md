# Langoo — Quy tắc làm việc cho agent

Áp dụng cho toàn bộ repo, từ 06/10/2026. Đọc file này trước khi sửa; đối chiếu
`PROGRESS.md`, `PROMPT-BACKEND.md`, `CONTEXT-DU-AN.md` và plan của hạng mục đang làm.
Yêu cầu trực tiếp của chủ dự án và phạm vi đã được duyệt trong phiên là căn cứ thực hiện.

**Checkout duy nhất (chốt 26/10/2026):** làm trực tiếp tại repo `Langoo` trên
`main`; không tự tạo worktree mới. Chỉ dùng lại worktree khi chủ dự án yêu cầu
rõ ràng. Dữ liệu sao lưu hợp nhất ở `uploads/consolidation-20261026/` là local,
không commit cấu hình bí mật hoặc artifact lớn trong đó.

## 1. Mọi công việc phải có mã và tên cụ thể

- Xác định mã và tên trước khi làm; giữ cùng mã trong plan, report, handoff,
  `PROGRESS.md` và báo cáo cuối. Tên phải mô tả đầu ra/chức năng thật.
- Backend dùng mã hiện có `M10`, `M10.1`, `M11.1`…; việc thuộc milestone đã có
  giữ mã đó. Hạng mục mới hoặc đợt mở rộng độc lập dùng mã con tiếp theo chưa dùng.
- DB dùng mã đầy đủ gồm phase và chặng: `DB3-B0`, `DB3-B2`, `DB4-D1`…
  Không gọi trống `B2`/`D1` vì có thể nhầm với chặng của milestone khác.
- Công việc riêng về quy trình/tài liệu dùng `DOCS1`, `DOCS2`… và đăng ký trong
  `PROGRESS.md`. Nếu tài liệu thuộc một milestone thì dùng mã milestone đó.
- Ví dụ: **M11.1 — Quiz Kanji và ngữ cảnh**, **DB4-D1 — Contract mapping v1**,
  **DOCS1 — Quy ước đặt mã và lưu thay đổi**.
- Sửa nhỏ/review/fix trong hạng mục đã có phải ghi thành entry có ngày và mô tả
  cụ thể dưới mã đó; không cần tạo milestone mới cho từng file hoặc từng dòng sửa.
- Trạng thái phải chính xác: đang làm / code xong local / đã kiểm tra / đã commit /
  đã push / đã deploy / còn thiếu gate. Không gọi toàn milestone hoàn tất chỉ vì
  một chặng đã code xong; không báo deploy nếu mới kiểm tra local.

## 2. Mọi thay đổi code phải được lưu và có dấu vết trong repo

Áp dụng cả feature, bugfix, refactor, script, test, SQL, migration, dependencies
và cấu hình. Không chỉ kể lại trong chat rồi bỏ qua tài liệu.

Trước khi kết thúc lượt có thay đổi code:

1. Lưu code/test/config thực tế vào file trong repo.
2. Cập nhật `PROGRESS.md` dưới đúng mã: đầu ra, trạng thái và link tài liệu liên quan.
3. Cập nhật hoặc tạo tài liệu theo mã trong `docs/plans/`, `docs/reviews/`,
   `docs/handoff/` hoặc tài liệu module phù hợp. Có thể dùng một file hiện có;
   không bắt buộc tạo report mới cho mỗi sửa nhỏ.
4. Ghi tối thiểu: ngày; mã + tên; thay đổi gì và vì sao; các file/phạm vi bị ảnh hưởng;
   kiểm tra đã chạy và kết quả; phần chưa kiểm tra/gate còn thiếu; trạng thái Git
   (chưa commit hoặc commit hash, đã/chưa push) và môi trường triển khai nếu có.
5. Contract/API/ENV/ops thay đổi thì đồng bộ tài liệu consumer tương ứng để người
   tiếp theo có thể sử dụng đúng. Không ghi secret, API key hoặc connection string.
6. Báo cáo cuối bắt đầu bằng mã + tên cụ thể, tóm tắt kết quả và dẫn tài liệu đã lưu.

Commit là trạng thái riêng với việc lưu code/tài liệu. Khi được yêu cầu commit,
gom code + test + docs của cùng việc thành đơn vị logic; mô tả commit có mã hạng mục
(ví dụ `feat(db4): DB4-D1 mapping contract v1`). Không gom thay đổi của việc/agent khác.
Không tự push/deploy nếu chưa được yêu cầu hoặc chưa có quyền trong phiên.

## 3. Quy tắc nghiệm thu

- Chạy kiểm tra phù hợp với thay đổi; ghi đúng lệnh/kết quả, không báo pass cho
  test chưa chạy hoặc skip. Chỉ docs thì kiểm link/format/diff, không cần reset DB.
- Trước báo xong, kiểm `git diff --check` và trạng thái working tree.
- Nếu bị gián đoạn hoặc thiếu gate, vẫn lưu phần đã làm và ghi việc còn lại dưới
  đúng mã để phiên sau tiếp tục; không biến thiếu gate thành hoàn thành.
- Việc đã được chủ dự án cho làm thì tiếp tục trong phạm vi đã duyệt. Quy tắc
  đặt mã/lưu tài liệu không tạo thêm bước xin duyệt cho công việc đã được cho phép.

Mẫu entry có thể ghi vào tài liệu hiện có:

```markdown
### YYYY-MM-DD — <Mã> — <Tên thay đổi cụ thể>

- Thay đổi / lý do:
- File / phạm vi:
- Kiểm tra / kết quả:
- Gate còn thiếu / việc tiếp theo:
- Git / triển khai:
```
