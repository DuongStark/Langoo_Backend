# DB3-B2.1 — Tích hợp partial apply và bảo toàn review

Ngày2026-10-06. Chủ dự án xác nhận phiên DB3-B trên VPS đã xong và cho kiểm tra/tích hợp.
Nhận patch `_gloss-types.ts`, `gloss-apply.ts`, `gloss-judge.ts` từ VPS; bản đủ3file
SHA256 ddcf36085a50abb24d59348261ca23a55c52b36be85c1d8e48e3a8fae98365b4,
lưu storage/db4/releases/m43-20261006/concurrent-db3b-complete.patch.

## Review và sửa

- Partial bỏ gateUNREVIEWED: khôi phục kiểm reviewer cho mọi output trong cohort.
- Active filter bỏ semantic rejected làm resume mismatch review: dùng cohort ổn định
  gồm validation passed; translation rejected/failed validation được bỏ qua.
- Judge cũ đổi fail/minor thành pass: giữ verdict nguyên vẹn trong review artifact.
- Chặn sửa review fail cho dòng đã đăng ký child và sửa rejected thành pass.
- Default gate pilot đủ100/98pass/0severe giữ nguyên. Partial là mode opt-in để lấy
  output đạt review riêng, không gọi batch/model đạt tiêu chí pilot.
- mapping_run lưu mode/hash/count review; rejected giữ reason. Thêm flag boolean guard.
- Không chạy judge/API AI hoặc apply/rollback gloss production trong lần tích hợp này.

## Phạm vi

4script code,3test script, CI job regressions, schema v1 note/README/PROGRESS.
Deploy chung release cóM4.3, commit riêng DB3-B2.1. Source/rank/batch/history/ID các
run đã apply không thay qua migration hoặc script này. Artifacts review đã tạo bằng
judge cũ có thể đã promote fail/minor; cần đối chiếu judge-details trước run tiếp theo,
không tự sửa artifact hoặc seed lại như một phần deploy.

## Kiểm tra

- Node contract/judge/apply tests:31/31pass; private UUID DB, không reset DB full/VPS.
- Cases: default98/100 và severe gate, partial semantic reject/resume, UNREVIEWED,
  tampered/omitted outputs, registered-child reclassification, minor verdict giữfail,
  thực apply/retry/rollback và fail-only không ghi gloss.
- Lần đầu test-fixture context mismatch và test thứ tự làm lệch baseline history/count;
  sửa fixture đúng ownership, chuyển partial test cuối suite; không sửa expected dữ liệu
  để che lỗi. CI bổ sung chạy3script tests sau E2E.
- Lint pass. Chuẩn bị commit/push riêng; CI/deployment pending.
