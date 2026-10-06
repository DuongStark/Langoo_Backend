# M4.3 — Nhóm nghĩa Wiktextract và bảo toàn sense

Ngày: 2026-10-06. Nhánh tích hợp: release/m4-3-20261006; nguồn DeepSeek
46ec612 (3e9320c feature, 3cbf913 merge main). User đã cho deploy trước đó,
tạm dừng vì phiên khác, tiếp tục khi nhận handoff hoàn thành.

## Review và sửa

1. Context EN có cả JMdict/nguồn khác nên không dùng [0] để suy ra hierarchy.
   Migration 039 thêm gloss_en_is_hierarchy: reuse core.wiktextract_en_projection
   của 038, thêm definition-language/custom guard và context dài >1.
2. Không đổi definition nghĩa đầu thành ancestor: group_heading là field riêng.
   Mỗi ID có cùng meaning/card như detail; descendants giữ definition lá từ view038.
3. Chuỗi 3+ tầng không lấy câu trung gian bằng find(first different) nữa.
4. Default grouped đổi cấu trúc data, không gọi chỉ additive. Có view=flat cho consumer cũ.
5. DB3-W1: rollback wordfreq cũ xóa rank toàn ngôn ngữ; khóa trước DB connection.
   Không chạy import lại hoặc rollback wordfreq khi tích hợp.

Phạm vi: migration039, dictionary DTO/controller/repo/types/service, unit + E2E,
contract/docs, wordfreq CLI guard. Giữ source/admin/stroke API và cursor v3/canonical face
của main. Không viết lại source gloss, không AI, không xóa ID/lexeme, không suppress
nguồn/prefix theo mặt chữ; không triển khai FE hoặc gộp đa nguồn D0.3.

## Kiểm tra và rollout

- Migration039 đã áp dedicated local_test; fixture kiểm đầy đủ IDs/meaning, multi-level,
  JMdict synonyms cùng prefix, custom/reviewed/machine/gapped/source/batch/foreign-language.
- Full unit lần đầu: 353 pass + 1 fail do expected repository thiếu field mới;
  bổ sung expectation default false rồi chạy lại.
- Full lint/build pass; unit 47 suite / 354 pass. Full E2E lần đầu: 21 suite pass,
  1 suite lỗi type-check wordfreq count::int bị khai báo string; sửa thành number.
  Guard apply rank-null được recheck dưới table lock trong transaction để tránh race.
  E2E chạy lại pass 22 suite / 207 test.
- Trước publish: backup source/dist/patch runtime của phiên DeepSeek + metadata schema;
  kiểm source không đổi, áp039 trước CI deploy, push fast-forward main.
  Backup runtime SHA256 ee925d641541bd8db38e92e6aeca0d5898b793b0daf9b04ad930d43d423dc4c0;
  patch SHA256 5bdca867ded9bb085a092a16d9a5fad7eb1d145d7d484157c9781cd8f50bf55e.
  VPS039 đã áp thành công; core vẫn 2.375.240 lexeme / 2.917.954 sense.
- Rollback runtime: release code cũ trong backup (giữ cột appended039 để tương thích
  code038; không cần drop cột trên view giữa runtime). Không khôi phục DB dump
  trong lần deploy này. FE cũ có thể yêu cầu view=flat.
- Git: chưa commit/push M4.3. VPS hiện source main d861390 + grouping uncommitted
  của phiên DeepSeek; chưa deploy các sửa M4.3 ở thời điểm ghi entry này.

## Consumer FE

Theo [API dictionary](../api/dictionary.md#m43--nhóm-nghĩa-wiktextract-và-bảo-toàn-sense-2026-10-06).
Heading là nhãn hiển thị, không phải ID mới. Sense đầu vẫn là sense thật, các ID
còn lại nằm sub_senses. Render nghĩa đầu và các con khi mở; chỉ heading thì sẽ mất
nghĩa đầu. UI ưu tiên vài nghĩa thông dụng cần công việc FE/ranking tiếp theo.

## Kết quả cuối

Local unit 47 suite / 354 pass; E2E 22 suite / 207 pass; lint/build pass.
Chờ CI/deploy/smoke hoàn thành. Counts của bản DeepSeek chỉ là số lịch sử;
M4.3 có guard chặt hơn nên kiểm lại trên runtime mới, không dùng 12.703/0,85%
như thống kê mới nếu chưa audit toàn DB.
