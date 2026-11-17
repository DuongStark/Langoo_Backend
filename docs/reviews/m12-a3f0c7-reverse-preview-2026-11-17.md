# M12-A06.1/A12 — Xử lý feedback A3F0C7: preview và định danh Nhật khi tra ngược

Ngày17/11/2026. Trạng thái: **đã push/deploy production `ac5dccf`, kiểm live PASS**.

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
- Git/CI/deploy và public HTTP smoke đã PASS như ledger dưới; FE cần tích hợp và QA UI.
- Không sửa assertion sai nước/of hoặc đóng mọi lỗi dữ liệu bằng thay đổi này.
- Không dùng tài khoản/JWT giả hoặc tạo dữ liệu thử ở production.
- Không tự đổi feedback thành resolved khi chưa có QA FE sử dụng ID/preview mới.
- Git code đã commit/push/deploy; docs/receipt sau rollout chốt riêng, không gom WIP khác.

## Ledger production17/11/2026

- Code ac5dccfb1706c59b5cd9a76e971d865f091e6478 đã push/deploy, CI43994798246
  PASS77suite/686unit,35suite/306E2E,31DB3; lint/build PASS. Deploy43995190301
  success, Git server đúngSHA và trackedclean, PM2 onlineNode22.23.3.
- 4 file dictionary sourcehash khớp local/VPS. Không lẫn2file quiz WIP vào commit.
- Public reverse và suggestions/reverse q=cây200: 植物 có lexeme140202/sense148381,
  VI đúng “cây, thực vật; thảm thực vật”; plant previewEN sense2722346. Aliases
  JA khớp, tất cả hit có preview field, no-store, Swagger nullable/shared schema,
  healthDB OK. HTTP mẫu1.650/671ms gồmnetwork, không phải P95.
- [HTTP smoke](m12-a3f0c7-2026-11-17/http-smoke.json),
  [release receipt](m12-a3f0c7-2026-11-17/release-receipt.json).
- Feedback chưa đổi status hoặc ghi admin_note; FE cần tích hợp các trường mới
  và QA trước khi resolved. Không ghi dữ liệu hoặc dùng tài khoản giả ở production.
- Docker test container của lượt này đã dừng sau kiểm tra; DB test có tên riêng,
  không dừng/reset dịch vụ của công việc khác. Docs/link/JSON/diff/status kiểm
  trước chốt commit tài liệu sau rollout.
