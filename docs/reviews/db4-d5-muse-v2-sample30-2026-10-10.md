# DB4-D5 — Thử prompt v2 trên 30 cặp mới

Ngày: 2026-10-10. Trạng thái: đã chạy và kiểm trên VPS/local, job inactive/dead.
**1/30 sense đủ rule proposal exact; chưa apply DB hoặc đạt production quality gate.**

## Thiết kế

- 30 sense JA–concept shortlist, ngoài **mọi lemma** của nhóm 20 proposal đã audit.
  Đây là 30 sense thuộc **15 lemma**, không phải 30 từ khác nhau. Mỗi sense giữ
  đủ 5 candidate; 150 sense–concept pairs được chấm ở R1 và R2.
- Chọn bằng hash seed cố định từ tập đủ điều kiện của pilot D2, không xem verdict
  v1 để chọn mẫu. Đây là mẫu mới với đợt audit/prompt design; vẫn thuộc pilot D2
  đã chạy v1, không gọi là corpus hoàn toàn chưa từng gửi Muse.
- 60 request, 8 worker, fresh side-chat, system/R1/R2 v2 đã freeze; không gửi
  audit hay verdict cũ vào input. Không auto-resend/repair hoặc apply DB.
- [Prepare sample](../../scripts/db4/muse-v2-sample-prepare.ts) kiểm render/hash,
  exclusion và denominator; native runner/validator D1 hiện có.
- [Scope audit trước xem reply](db4-d5-muse-v2-sample30-scope-audit-2026-10-10.json)
  đủ 30 sense, ghi reviewerKind=llm. Chỉ đánh giá eligibility exact, không là gold
  cho cả sáu relation. AI audit không là human gold; độ đồng thuận không chứng minh
  độ chính xác. Nhãn unclear không được cộng vào số exact được audit xác nhận.

## Kết quả và thời gian

| Chỉ số                                           |                             Kết quả |
| ------------------------------------------------ | ----------------------------------: |
| Sense / lemma / candidate pairs                  |                       30 / 15 / 150 |
| Dispatch / transport replies                     |                             60 / 60 |
| D1 adapter valid                                 |                       59/60 (98,3%) |
| Sense có cả hai phase valid                      |                               29/30 |
| Proposal exact theo pure D3 policy               |                               **1** |
| Deferred / all-none shortlist / incomplete       |                          27 / 1 / 1 |
| Proposal exact v1 trên cùng 30 sense             |                                   0 |
| Relation R1/R2 giống nhau, trên 29 paired bundle |                     113/145 (77,9%) |
| Mapping apply                                    |                               **0** |
| Wall time, 8 worker                              |        **386,71s ≈ 6 phút 27 giây** |
| Latency/request min / median / p95 / max         | 16,71 / 42,09 / 96,96 / 129,19 giây |

`1/30` là yield proposal đủ rule, không là accuracy. Một proposal được scope audit
AI hỗ trợ không đủ để suy ra precision toàn corpus. V1 trên cùng mẫu có 60 output
valid, 29 deferred và 1 all-none; vì vậy **không kết luận v2 đã cải thiện schema
hoặc quality từ việc so với repeat 17/20 trên mẫu khác**.

Proposal duy nhất là `お出でになる` sense 72 “to go” → concept 31419 “go or proceed
from one point to another”. Cả hai phase giữ unique exact, không unresolved;
scope audit hỗ trợ. Kính ngữ không bị biến thành nghĩa khác.

RAM quan sát khi chạy: 127.598.592 byte (~122 MiB), không là peak benchmark.
CPU time systemd ghi 12,425s. Không chạy browser mới trên VPS. Tổng input compact
system + phase + payload khoảng 5.816.244 byte/60 request, chưa tính wrapper native;
đây **không phải token usage**. Transport không trả telemetry token.

## Lỗi và những ca cần chú ý

| Sense                                               | Kết quả                                      | Nhận xét                                                                                                                                                                                                                                               |
| --------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| お巡りさん 135, police officer                      | R1/R2 raw cùng chọn 108895; R1 invalid       | R1 thêm field `missingBranches2` vào một review. Strict schema loại toàn output; sense incomplete, không được tính thành proposal thứ hai.                                                                                                             |
| アルコール 1303, hand sanitizer                     | R1 related, R2 **exact sai scope** với 71363 | Rubbing alcohol dùng ngoài không đồng nhất toàn bộ sản phẩm sát khuẩn tay. R2 còn tự thêm expansion アルコール消毒液 không có trong raw source. Bất đồng bị D3 defer; không apply lỗi này.                                                             |
| お宅 154, your husband                              | Hai phase narrower với husband 107247        | Có dấu hiệu over-restriction: biến “your” để gọi kính trọng thành một concept chỉ gồm chồng của người nghe. Scope audit hỗ trợ cùng denotation husband; cần quy tắc rõ về tham chiếu ngữ cảnh và vai trò thân thuộc.                                   |
| お宅 155, your organization                         | R1 exact, R2 narrower với 94754              | Cùng vấn đề đại từ/tham chiếu; R2 loại tổ chức của bên thứ ba khỏi scope và khiến match bị treo.                                                                                                                                                       |
| すっと 477, quietly/gently/softly                   | Hai phase broader với gentle manner          | Có dấu hiệu mở rộng gloss tiếng Anh thành các usage âm lượng/lực riêng, dùng ví dụ máy chạy êm. Scope audit ban đầu đọc các gloss như paraphrase trong context; cần thêm source usage/context để phân định, không coi audit AI là kết luận chuyên gia. |
| お子さん 129, お手洗い 134, 迚も 707/708            | Nhiều exact, `ambiguous_concepts`            | Có nhiều definition tương đương/gần tương đương trong shortlist. Giữ ambiguity là đúng cơ chế; không chọn ID tùy ý để tăng yield.                                                                                                                      |
| 居らっしゃる 58, お宅 153                           | Không exact                                  | Một source sense có nhiều usage; một concept riêng không bao phủ toàn bộ. Prompt không thể tạo ra concept còn thiếu.                                                                                                                                   |
| お出でになる 71, アルコール 1301, アクセサリー 1086 | Không exact có căn cứ                        | Shortlist thiếu physical come, chemical alcohol và general jewelry tương ứng; candidate có cùng nhãn tiếng Anh nhưng khác sense hoặc chỉ là subtype.                                                                                                   |
| 咖哩 2309                                           | R1 broader, R2 exact                         | Khác cách đọc East Indian cookery như điều kiện vùng/công thức hay domain mô tả. Scope audit đã ghi unclear trước xem reply; D3 giữ defer.                                                                                                             |

Trong **28 exact claims của output valid**: blind scope labels hỗ trợ 21, unclear 6,
loại 1 (hand sanitizer R2). Các số là claim/phase, không là 28 cặp độc lập và không
là precision gold. Tất cả unclear/claim sai ở trên không thành unique proposal
được accept trong lượt này.

Scope audit AI cũng cần được đọc có giới hạn: ban đầu hỗ trợ concept 38466 cho
お見舞い 119 “giáng đòn”. Sau xem lý do Muse, definition “either with the hand or
with an instrument” cho thấy cần xét thêm cú đánh bằng chân/đầu; không được coi
nhãn supported ban đầu là chứng minh toàn scope. Concept 38526 “sharp blow” cũng
đã được audit ghi unclear. Hai phase không tạo unique proposal cho sense này;
giữ nguyên audit trước xem reply và ghi nhận điều chỉnh nhận định ở đây.

Chi tiết đủ 30 sense, definitions, branch coverage, reasons, raw-validation error,
pure D3 decisions và baseline relations: [report JSON](db4-d5-muse-v2-sample30-2026-10-10.json).

## Hướng tiếp theo

**Chưa nên chạy lớn rồi tự apply.** V2 có một match mới đủ rule so với v1, nhưng
yield còn thấp và vẫn có false exact ở một phase.

1. Sửa lỗi output thêm field bằng bước format có cap/provenance riêng nếu chạy
   repair; không tự xóa field trong raw hoặc gọi output cũ hợp lệ.
2. Làm rõ trong prompt lần tới: đại từ your/my và cách gọi kính trọng không tự
   tạo một concept mới theo chủ sở hữu; giữ ràng buộc quan hệ thực như tuổi, giới,
   nghề nghiệp và construction. Không mở rộng chữ viết tắt khi source không cho.
3. Kiểm context/retrieval cho compound sense, từ EN đa nghĩa và field chem. Khi
   shortlist không có concept đúng, thêm vote không thể tạo được exact hợp lệ.
4. Kiểm canonical identity/source lineage cho các concept có definition tương
   đương; không phá tie bằng ID/rank. Cần thêm dữ liệu để giải được ambiguity thật.
5. Thử một mẫu riêng có positive rõ và hard negatives sau thay đổi; không tối ưu
   để chỉ khớp 30 mẫu này. Defer tự động giữ nguyên; không cần người dùng duyệt
   từng dòng, nhưng D5 quality/D6 apply journal/D7 serving vẫn phải đạt gate.

## Chạy và artifacts

Local root: `uploads/db4-d2-pilot/muse-d5-v2-sample30-20261010/` (ignored).
VPS root: `/opt/langoo/storage/db4-d5-v2-sample30-20261010/`.
Unit: `langoo-db4-d5-v2-sample30-20261010.service`, **success, inactive/dead**.

```sh
npx tsx scripts/db4/muse-review-prepare.ts uploads/db4-d2-pilot generation/manifest.json v2
npx tsx scripts/db4/muse-v2-sample-prepare.ts uploads/db4-d2-pilot muse-d4-v2/manifest.json docs/reviews/db4-d5-exact-audit-2026-10-10.jsonl muse-d5-v2-sample30-20261010
npx tsx scripts/db4/muse-review-validate.ts uploads/db4-d2-pilot muse-d5-v2-sample30-20261010/manifest.json muse-d5-v2-sample30-20261010/responses.jsonl
npx tsx scripts/db4/muse-v2-sample-report.ts uploads/db4-d2-pilot muse-d5-v2-sample30-20261010 muse-d4-v1/validated/ea6f3ec47bc9/summary.json docs/reviews/db4-d5-muse-v2-sample30-scope-audit-2026-10-10.json muse-d4-v1/validated/1b03b68ea623/summary.json
```

Prepare full v2 là một lần ghi bất biến, không chạy lại để ghi đè. Sample prepare
và report CLI cùng input rerun cho cùng hash. Validation folder mang prefix v1
legacy, nhưng `pilotManifest`/hash bind đúng v2 sample. Đây là subset trial dùng
**pure `decideMappingBundle` policy**, chưa chạy full D3 generation adapter vì
generation nguồn có 100 target/69 bundle còn sample chỉ có 30; không tuyên bố
subset đạt full pilot gate.

- Sample manifest SHA: `425b12f9c9d08bd969f9dc24f07c73eb72898c28cda6b7976e4697a718480379`.
- Responses SHA: `ea6f3ec47bc9df6f018f36bd02e3f4bb80785638fd7ad61950cbe67274a6f2cc`.
- Comparison SHA: `1ddf8cdb6675ba635508805b828345ea9b561c643175ee8e71694f2250b8a0b9`.
- Scope audit/compact input + comparison copy cũng lưu ở VPS; không đưa cookie
  hoặc private session ID vào repo report. Không dùng reconciler/resend ở lượt này.

## Kiểm tra

- `npx tsc -p tsconfig.db4.json`: pass sau sửa report binding full candidates.
- Scoped ESLint/Prettier hai script và report JSON/Markdown: pass.
- `node --import tsx --test scripts/db4/decisions.test.ts`: **14/14 pass**, không skip.
- Sample prepare rerun: cùng manifest SHA, đúng 30/60/150, 32 bundle đủ điều kiện.
- D1 adapter thực tế: 59 valid / 1 rejected; response SHA local/VPS khớp.
- `node --import tsx` smoke report inline: replay raw/normalized/render/source
  candidate binding, cùng report SHA; duplicate audit và foreign concept bị từ
  chối, sanitizer sai không accept, police invalid thành incomplete. **0 call Muse**.
- Link/JSON/whitespace/diff-check phạm vi task pass. Toàn tree vẫn có trailing
  whitespace ở FE handoff của phiên khác; giữ nguyên, không ghi toàn repo pass.
- Chưa có expert gold, full Pilot B/production D5 gate hoặc DB integration/apply.

## Nhật ký

### 2026-10-10 — DB4-D5 — Thử prompt v2 trên 30 cặp mới

- Thay đổi / lý do: freeze subset riêng để kiểm prompt v2 ngoài nhóm lỗi dùng thiết kế.
- File / phạm vi: sample prepare/report TS, Markdown/JSON kết quả, blind scope audit
  JSON và entry `PROGRESS.md`; artifacts riêng local/VPS, không sửa raw run trước.
- Kiểm tra / kết quả: đã thu 60 reply, D1 valid 59, pure policy 1 exact / 27 deferred /
  1 all-none / 1 incomplete, AI scope assessment đủ 30; checks ghi trên.
- Gate còn thiếu: chưa chứng minh full semantic precision/recall; D5/D6/D7 còn thiếu.
- Git / triển khai: local chưa commit/push; đã chạy job được yêu cầu trên VPS,
  không deploy app hoặc apply mapping vào DB; giữ các thay đổi phiên khác.
