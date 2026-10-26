# DB4-D4 — Prompt semantic match v2

Ngày: 2026-10-10. Trạng thái: đã lưu prompt và hỗ trợ chọn v2 ở bước prepare;
sau đó đã [chạy sample 30 sense](../reviews/db4-d5-muse-v2-sample30-2026-10-10.md)
trên VPS: 59/60 output valid, 1 proposal exact, quality gate chưa đạt.
Contract DB4-D1 giữ nguyên. Entry kiểm prompt bên dưới ghi trạng thái khi sửa prompt.

Follow-up theo batch rollout: [DB4-D4 prompt v2.1](../reviews/db4-d4-prompt-v2.1-2026-10-10.md)
đã được chuẩn bị riêng theo lỗi quan sát ở sample30. Bytes v1/v2 không bị sửa;
v2.1 chưa được gọi Muse và chưa có kết luận quality.

Kế hoạch triển khai kế tiếp: [DB4-D4/D5 — Mapping tự động theo batch có checkpoint](db4-d4-d5-automated-batch-rollout.md).
Chốt cohort đại diện và conditional R2; prompt v2.1 là file/version mới dự kiến,
không sửa output hoặc bytes prompt v2 đã thử. Lịch batch trong plan mới thay cho
yêu cầu chạy lại full pilot cũ trước khi thu shadow batch.

## 1. Đầu ra dùng trực tiếp

| File                                                        | Vai trò                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------- |
| [System v2](../prompts/db4-d4-semantic-match-v2.system.txt) | Quy trình xác định nghĩa, điều kiện, hai chiều phạm vi, coverage và JSON  |
| [R1 v2](../prompts/db4-d4-semantic-match-v2.r1.txt)         | Xác định nghĩa source trước, rồi so từng candidate                        |
| [R2 v2](../prompts/db4-d4-semantic-match-v2.r2.txt)         | Đọc definition target trước, kiểm tra các trường hợp ngoài phạm vi        |
| [Prepare](../../scripts/db4/muse-review-prepare.ts)         | Chọn `v1`, `v2` hoặc `v2.1`, đóng băng prompt/hash/request/manifest riêng |

Version: `db4-d4-semantic-match-v2-r1` / `db4-d4-semantic-match-v2-r2`.
System viết bằng tiếng Anh; giải thích trả về bằng tiếng Việt. Tổng ba file
3.603 từ / 25.298 byte lúc kiểm. Mỗi request dùng system + **một** phase + payload;
đây không phải số token hay billing thực tế.

## 2. Vì sao sửa

[Lượt lặp v1](../reviews/db4-d5-muse-repeat-2026-10-10.md) đã thu 20 reply,
nhưng chỉ 17 hợp lệ theo adapter. Trong 15 proposal giữ unique exact, vẫn có
`どんな` đã bị AI audit đánh severe. `オーバー` đổi sang broader nhưng thiếu
candidate; `お兄さん` cũng thiếu candidate; `お菓子` sai thứ tự. Vì vậy:

- Thêm một lượt giống hệt không giải quyết được lỗi phạm vi nghĩa có hệ thống.
- V1 **đã có** yêu cầu hai chiều và đầy đủ candidate. V2 cụ thể hóa thao tác
  và ví dụ đối chiếu; không coi quy tắc cũ là hoàn toàn thiếu.
- Không coi audit của GPT là human/expert gold hoặc đo độ chính xác từ mức đồng thuận.

## 3. Thay đổi trọng tâm

1. **Xác định source trước khi tìm match:** loại thực thể/sự kiện, vai trò,
   nghĩa lõi, điều kiện, construction và điểm chưa rõ. Không suy ngược nghĩa
   source từ definition target có vẻ hợp.
2. **Xử lý nhiều EN gloss:** phân biệt synonym, mô tả bổ sung và usage thực sự
   khác; không lấy nghĩa chung mơ hồ hoặc nhập mọi nghĩa tiếng Anh của một gloss.
3. **Điều kiện có ảnh hưởng hay chỉ là cách nói:** giữ tuổi, quan hệ thân thuộc,
   nghề nghiệp, lượng từ, sắc thái đánh giá; cho phép polite/honorific khác cách
   diễn đạt khi cùng denotation. Không tự thêm điều kiện để đẩy mọi thứ vào uncertain.
4. **Hai phép bao hàm riêng:** mỗi chiều phải có căn cứ, phản ví dụ được hỗ trợ
   hoặc điểm chưa xác định. Một chiều sai không đủ để đoán broader/narrower;
   mọi row covered cũng không đủ để exact.
5. **Sáu cặp đối chiếu:** vượt mức so với tốt hơn; free-choice so với existential;
   nghề nghiệp so với hoạt động; kinship/politeness/vocative; tòa nhà so với căn hộ;
   synonym so với union usage. Có cả ví dụ được phép exact để hạn chế over-defer.
   Đây là ví dụ giả định về nguyên tắc, không blacklist lemma hay nhét verdict audit.
6. **Trả đủ candidate:** lập đủ N vị trí theo candidate order của payload hiện tại,
   copy đủ hash/ID, giữ cả none/uncertain. Không dừng sau match đầu hoặc sort theo ID.
7. **Tự động giữ unresolved:** không ép winner, không yêu cầu người chọn từng dòng,
   không suy ra được quyền promote từ câu trả lời của LLM.

Các bước kiểm tra diễn ra nội bộ. Output chỉ chứa JSON D1 hiện có, không thêm
semantic frame, witness, reasoning trace hoặc confidence tự tạo. D1/adapter
vẫn kiểm count, identity, evidence, coverage và thứ tự; prompt không thay validator.

## 4. Cách chuẩn bị và gửi

Tại repo root, với artifact root đã chứa D2 generation hợp lệ:

```sh
npx tsx scripts/db4/muse-review-prepare.ts uploads/db4-d2-pilot generation/manifest.json v2
```

Đây chỉ là **prepare**, không gọi Muse, đọc DB hay apply. Generation hiện có
69 bundle sẽ tạo 138 request R1/R2, không phải chỉ 20 request của lượt repeat.
Manifest/prompt/requests nằm ở `muse-d4-v2/`; ghi bất biến, không ghi đè output v1.
Default khi bỏ tham số cuối vẫn là v1. Tham số khác v1/v2 bị từ chối trước ghi file.

Giữ seed shuffle v1 để thử nghiệm có cùng thứ tự candidate theo phase và cùng
context nguồn; thay version khiến rendered payload hash khác. Request ID vẫn là
`bundleKey:phase`, nên luôn bind theo manifest/prompt/render hash và không trộn
response giữa v1/v2 chỉ theo request ID.

Transport dùng `system` + đúng `phases.r1` hoặc `phases.r2` từ prompt artifact,
kèm payload nguyên vẹn từ request đã đóng băng. Muse web không có system role
riêng thì ghép như native runner hiện có. Fresh side-chat mỗi request, không gửi
verdict R1, audit, expected answer hoặc output cũ vào R2. Hai phase cùng Muse
không phải hai judge độc lập.

Consumer còn các quy ước legacy cần biết:

- Lượt v2 cũ đã ghi validation dưới `muse-d4-v1/validated/` theo quy ước legacy.
  Validator hiện lưu run mới theo revision thật (`muse-d4-v2.1/validated/` cho
  v2.1); không di chuyển hoặc đổi provenance của artifact lịch sử.
- `muse-review-prepare-repairs.ts` hiện hardcode prompt version v1-repair1.
  Đã được cập nhật ở [DB4-D4 v2.1 review](../reviews/db4-d4-prompt-v2.1-2026-10-10.md):
  repair lấy version theo manifest, cho phép một lần và validator lưu theo đúng
  prompt revision.
- Runner vẫn có thể chờ lâu với completed reply thiếu candidate; v2 chỉ nhằm giảm
  lỗi output, không sửa cơ chế polling. Đã có read-only reconciler để lưu raw reply;
  reply sai contract vẫn invalid, không tự biến thành exact hợp lệ.

## 5. Đợt kiểm tra tiếp theo

Phiên sửa prompt ban đầu chưa dispatch. Đợt tiếp theo theo yêu cầu chủ dự án đã
chạy 30 sense ngoài lemma nhóm audit cũ, giữ đủ shortlist/2 phase; xem report trên.
Full 69 bundle và mẫu mới ngoài D2 cohort chưa chạy bằng v2. Kế hoạch full pilot:

1. Chạy cùng 69 bundle để đối chiếu cả 20 proposal cũ và 49 bundle còn lại;
   giữ 31 no-candidate trong denominator D2, không gửi shortlist rỗng cho LLM.
2. Đo đầy đủ transport reply, D1-valid, thiếu candidate, sai order, timeout,
   relations, unique exact, ambiguous/defer và số trường hợp thay đổi so với v1.
3. Kiểm lại nhóm severe/deferred cũ và các exact rõ ràng để phát hiện việc sửa
   false exact nhưng làm mất các match đúng. Case audit không được đưa vào input.
4. Kiểm mẫu mới ngoài nhóm lỗi đã dùng thiết kế prompt; không tuyên bố đạt chất
   lượng từ riêng các case quen hoặc số exact giảm. D5 automation dùng AI review
   phải ghi rõ reviewer là LLM và không gọi đó là human gold.
5. D3 quyết định tự động theo evidence/contract/consensus hiện có. Mismatch,
   incomplete hoặc unresolved giữ defer; hết budget không ép match. D5 quality,
   D6 apply/journal và D7 serving là các gate riêng, không được bỏ qua vì prompt dài.

Nếu một counterexample có thể kiểm bằng dữ liệu cụ thể, ưu tiên bổ sung dữ liệu
nguồn hoặc validator thích hợp hơn việc tiếp tục lặp prompt giống hệt. Không đặt
regex blacklist cho lemma hoặc buộc model chọn verdict đã audit sẵn.

## 6. Nhật ký kiểm tra và trạng thái

### 2026-10-10 — DB4-D4 — Prompt semantic match v2

- Thay đổi / lý do: ba prompt v2 riêng; selector v1/v2 trong prepare để sử dụng
  thực tế mà vẫn giữ input/source contract và default v1.
- File / phạm vi: ba TXT ở `docs/prompts/`, prepare TS, plan này, liên kết plan v1
  và entry `PROGRESS.md`. Không sửa prompt v1, D1, source data hoặc runtime VPS.
- Kiểm tra / kết quả:
  - `npx tsc -p tsconfig.db4.json`: pass.
  - `npx eslint scripts/db4/muse-review-prepare.ts --max-warnings 0`: pass.
  - `node --import tsx` smoke bằng script inline và thư mục OS temp: copy đúng
    manifest/bundles D2, prepare default v1 và explicit v2, kiểm hash tất cả file,
    replay render từng request, so prompt v1 với artifact frozen cũ. Pass 69 bundle /
    138 request mỗi version; cùng context/candidate order, khác rendered hash.
    Invalid revision và ghi đè v2 bị từ chối. Xóa thư mục temp của smoke sau kiểm.
  - Adapter nhận manifest v2 với 138 response giả lập `not_dispatched`: ghi đúng
    0 validated / 138 unresolved, không tạo semantic verdict hay gọi Muse. Đây là
    kiểm binding/consumer, không phải kiểm độ chính xác dịch/mapping.
  - Input v2 lớn nhất 147.670 byte, nhỏ nhất 62.208 byte; tổng 12.775.609 byte
    cho 138 request (v1: 11.405.269 byte, tăng khoảng 12%). Không đo token thực.
  - Prettier scoped, 5 link nội bộ, whitespace file mới và `git diff --check`
    cho phạm vi v2: pass. Kiểm toàn working tree báo trailing whitespace có sẵn
    trong thay đổi `docs/handoff/fe-handoff-2026-10-08.md:3` của phiên khác;
    giữ nguyên file đó, không ghi toàn repo là pass.
- Gate còn thiếu: chưa dispatch Muse v2, chưa đo semantic accuracy/độ trễ/token;
  chưa đạt full D5/D6/D7. Không đảm bảo prompt loại hết false exact.
- Git / triển khai: thay đổi v2 local, chưa commit/push/deploy trong phiên này;
  giữ các thay đổi của phiên khác trong working tree.
