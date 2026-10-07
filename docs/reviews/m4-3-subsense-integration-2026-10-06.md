# M4.3 — Nhóm nghĩa Wiktextract và bảo toàn sense

Ngày 2026-10-06. **Đã commit/push và deploy VPS; 46 live checks pass.**
Runtime `f700658` chứa M4.3 `9a52b68` và DB3-B2.1. Nhánh nguồn DeepSeek `46ec612`
đã merge main M4.2 trước khi tích hợp.

## Review và sửa

1. Context EN có ở mọi nguồn: migration 039 thêm `gloss_en_is_hierarchy`, dùng
   policy 038 và guard definition-language/custom; chỉ Wiktextract hợp lệ được nhóm.
2. Giữ definition thật của ID đầu nhóm; ancestor chuyển sang `group_heading` riêng.
3. Không lấy câu trung gian bằng `find(first different)` trong chuỗi ba tầng;
   mọi card giữ nghĩa lá đã được view 038 chiếu đúng.
4. Default grouped thay cấu trúc danh sách, không gọi chỉ additive.
   Có `view=flat` cho consumer cũ; flatten giữ đủ ID, thứ tự và meaning/card.
5. DB3-W1 khóa rollback wordfreq thiếu journal per-row; guard apply recheck rank-null
   dưới table lock. Không chạy import/rollback wordfreq trong lần deploy này.

Phạm vi: migration 039, dictionary controller/DTO/repository/types/service,
unit/E2E, contract/handoff/ops, wordfreq guard. Giữ sources/admin/stroke API,
cursor v3 và canonical spelling M4.2. Không AI, không backfill/delete core.

## Phối hợp deploy

- User đã cho deploy, rồi yêu cầu chờ phiên grouping. Tiếp tục khi nhận handoff hoàn thành.
- Backup runtime trước tích hợp tại `/opt/langoo/storage/db4/releases/m43-20261006`.
  Code archive SHA256 `ee925d641541bd8db38e92e6aeca0d5898b793b0daf9b04ad930d43d423dc4c0`.
- Áp 039 trước publish. Push `9a52b68`, phát hiện ba script DB3-B tiếp tục thay đổi.
  Hủy CI 37480050307 để deploy 37480283546 skipped, giữ patch thay vì reset mất code.
- User xác nhận DB3-B đã xong và cho tích hợp. Review/sửa theo
  [DB3-B2.1](db3-b2-1-partial-review-integration-2026-10-06.md), commit riêng `f700658`.
- Kiểm source và patch khớp handoff trước publish lại. Backup cuối chứa cả DB3-B:
  `runtime-final-code.tgz`, SHA256
  `3d4e5ac6d8d21a6b1e075f02ca26141ce89d88310401523e23266521a18b6904`;
  `runtime-final.patch`, SHA256
  `0483daedb1285b8f4e972ea19071db775fb755c4fdb490a7c24fc8d48842bfee`.
- Code runtime HEAD `f700658c577f7c8de6ae3a0fcc86d34a1694d295`, PM2 online,
  `/opt/langoo/app/dist/main.js`; tracked code clean, hai file .bak cũ được giữ.
  Local main đồng bộ; vẫn giữ code quiz/DOCS1/DB4-D1 chưa commit của phiên khác.

## Kiểm tra

- Local và [CI 37481567514](https://github.com/DuongStark/Langoo/actions/runs/37481567514):
  **47 suite/354 unit, 22 suite/207 E2E, 31 DB3-B2.1 tests pass**; lint/build pass.
- Unit lần đầu fail do repository expected thiếu field mới; E2E lần đầu phát hiện
  wordfreq count::int khai báo string. Sửa rồi chạy lại full pass.
- [Deploy 37481886745](https://github.com/DuongStark/Langoo/actions/runs/37481886745) success.
- [Live smoke](m4-3-live-smoke-2026-10-06.json): **46 checks pass**.
  Flat/grouped flatten bằng nhau; nghĩa đầu/later khớp detail và context/gloss lá.
  Sources 18/wordfreq 3.1.1, stroke SHA/ETag giữ, admin anonymous 401,
  cursor v3 qua tám trang không lặp ID; legacy v1/v2 và view invalid trả 400.
  JMdict 走る không bị nhóm.

| Từ/lexeme | Tổng sense | Nhóm | Con |
| --- | ---: | ---: | ---: |
| dog/998637 | 23 | 14 | 9 |
| run/1764987 | 64 | 38 | 26 |
| draw/1009311 | 138 | 6 | 132 |
| apple/694408 | 20 | 8 | 12 |

Core vẫn **2.375.240 lexeme / 2.917.954 sense**; 038/039 đã áp.
Metadata runtime lưu private tại `runtime-after.json` trong thư mục backup.
Count 12.703/0,85% của DeepSeek chưa được audit lại toàn DB dưới guard M4.3.

## Consumer và rollback

FE chưa triển khai trong release này: dùng `group_heading` làm heading không chọn
được, render sense đầu thật và các con khi mở. FE cũ lấy `view=flat` để đủ danh sách.
[Handoff FE](../handoff/db4-subsense-grouping-2026-10-06.md),
[contract API](../api/dictionary.md). Ưu tiên vài nghĩa thông dụng và gộp lexeme đa
nguồn D0.3/D0.5 vẫn là phần tiếp theo.

Rollback code từ archive rồi build/reload trong một phiên; giữ cột 039 tương thích
code 038. Không restore DB dump hoặc git clean toàn working tree. DB3-W1 rollback
wordfreq thiếu journal vẫn bị khóa. Doc nghiệm thu được commit riêng sau deploy.
