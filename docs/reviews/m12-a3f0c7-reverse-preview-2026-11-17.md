# M12-A06.1/A12 — Xử lý feedback A3F0C7: preview và định danh Nhật khi tra ngược

Ngày17/11/2026. Trạng thái: code và kiểm tra local, đang chốt release.

## Vấn đề và thay đổi

FE báo thiếu nghĩa Việt ở kết quả reverse và không có ID Nhật để mở chi tiết.
Đã thêm preview cùng SenseCardDto của search ở EN/JA, JA lexeme_id/sense_id
nullable trên cả reverse và suggestions/reverse; giữ alias/payload/order cũ.

Repository giữ assertion/source_sense_id của winner hiện có. Resolver đọc theo
batch, kiểm ngôn ngữ/lexeme, accepted target, hint, exact verified curated mapping,
form restrictions và singleton. Không tin pending, không lấy sense đầu khi mơ hồ.
Khi chỉ định danh lexeme được thì trả lexeme_id và để sense_id/preview=null.

Một lần resolver + một lần hydrate sense cards cho cả trang khi cần; không gọi
AI hoặc search lại từng dòng. JA-only không bổ sung preview EN ngoài scope.
Giữ nguyên những trường trung gian cũ, trong đó via_lexeme_id vẫn là EN.

## Phạm vi file

- src/dictionary/repositories/reverse-lookup.repository.ts
- src/dictionary/dictionary.service.ts/.spec.ts
- src/dictionary/types/dictionary.types.ts và dto/dictionary-response.dto.ts
- test/m12-reverse-preview.e2e-spec.ts
- API docs, plan/handoff/report, PROGRESS.

Không sửa FE/schema/ENV/data. WIP quiz-batch-engine.ts/spec đang thay đổi bởi công
việc khác được giữ ngoài commit; kết quả unit local có chứa WIP đó nên CI của
commit phát hành là gate cho đúng source đã đóng gói.

## Kiểm tra và lỗi bắt được

- Unitdictionary52test PASS, fulllocal77suite/689test PASS (193,941s).
- Integration đầu42pass/1fail: resolver dùng nhầm tên cột form.form. Đã đối chiếu
  CSDL và sửa thành form_text, thêm điều kiện kind để tận dụng lookup index.
  Không đưa bản lỗi lên app production; probe chỉ đọc dùng file riêng ngoài app.
- Chạy lại3suite/43HTTPDB PASS (52,568s): reverse, suggestions/reverse, scope,
  canonical/legacy contract và dictionary hồi quy. Mở rộng riêng8test PASS (39s)
  gồm accepted vs pending, curated mapping downgrade và sense/form restriction.
- Full build và lint0warning local PASS; test DB mới langoo_a3f0c7_test trong
  PostgreSQL17 Docker riêng tại loopback55439; không reset DB người dùng/prod.
- Production READ ONLY repo probe: cây assertion251219 source sense2722346;
  植物 assertion251216. Resolver trả JMdict lexeme140202/sense148381, evidence
  singleton; candidate hiện có pending không dùng làm bằng chứng accepted.
  98ms là một mẫu2reference, không phải HTTP latency/P95.

## Gate và bàn giao

- [Handoff FE](../handoff/m12-a3f0c7-reverse-preview-fe-2026-11-17.md),
  [plan](../plans/m12-a3f0c7-reverse-preview-2026-11-17.md).
- Chốt Git/CI/deploy và public HTTP smoke trước khi nói contract mới có trên live.
- Không sửa assertion sai nước/of hoặc đóng mọi lỗi dữ liệu bằng thay đổi này.
- Không dùng tài khoản/JWT giả hoặc tạo dữ liệu thử ở production.
- Không tự đổi feedback thành resolved khi chưa có QA FE sử dụng ID/preview mới.
- Git lúc ghi: code/docs mới chưa commit/push; không gom WIP khác.
