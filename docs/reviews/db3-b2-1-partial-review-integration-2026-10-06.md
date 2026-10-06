# DB3-B2.1 — Tích hợp partial apply và bảo toàn review

Ngày 2026-10-06. Chủ dự án xác nhận phiên DB3-B trên VPS đã xong và cho tích hợp.
Commit `f700658` đã push main và deploy VPS cùng M4.3.

## Review và sửa

Nhận patch `_gloss-types.ts`, `gloss-apply.ts`, `gloss-judge.ts` từ VPS. Bản đủ ba file
lưu tại `storage/db4/releases/m43-20261006/concurrent-db3b-complete.patch`, SHA256
`ddcf36085a50abb24d59348261ca23a55c52b36be85c1d8e48e3a8fae98365b4`.

- Partial bỏ kiểm tra `UNREVIEWED`: khôi phục kiểm reviewer cho mọi output trong cohort.
- Lọc bỏ semantic rejected làm resume lệch review: giữ cohort gồm validation passed;
  translation rejected/failed validation được bỏ qua.
- Judge đổi fail/minor thành pass: giữ verdict gốc trong review artifact.
- Chặn sửa review thành fail cho dòng đã đăng ký child và sửa rejected thành pass.
- Mặc định giữ pilot đủ 100 output, ≥98 pass, 0 severe. Partial là opt-in để lấy
  output đạt review riêng, không tuyên bố batch/model đạt tiêu chí pilot.
- `mapping_run.parameters` lưu mode/hash/count review; rejected giữ reason.
  Boolean flag guard và schemaVersion 1 giữ nguyên.

Phạm vi: bốn script code, ba script test, CI regression job, schema/README/PROGRESS.
Không gọi judge/AI API hoặc apply/rollback gloss production trong lần tích hợp này.
Gloss máy vẫn chưa curation; không ghi `reviewed_by`/quality như người duyệt.

## Kiểm tra

- Local và CI: **31/31 node tests pass**, trên UUID test DB riêng, không reset DB full/VPS.
- Bao phủ default 98/100 và severe gate, partial reject/resume, UNREVIEWED,
  tampered/omitted output, registered-child reclassification, minor verdict giữ fail,
  apply → retry → rollback thực, fail-only không ghi gloss.
- Lần đầu fixture sai context ownership và vị trí test làm lệch baseline history/count;
  sửa fixture đúng nguồn và chuyển partial test cuối suite, rồi chạy lại pass.
- Lint pass. CI 37481567514 cũng pass 354 unit / 207 E2E và build.
  Deploy 37481886745 success; runtime tracked code clean, hai file .bak untracked được giữ.

## Việc còn lại

Artifact được tạo bằng judge cũ có thể đã promote fail/minor: đối chiếu
`judge-details` trước lần apply tiếp theo. Deploy code không sửa các artifact cũ.
[Report deploy/smoke M4.3](m4-3-subsense-integration-2026-10-06.md).
