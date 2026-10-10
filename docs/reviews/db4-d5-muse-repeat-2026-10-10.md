# DB4-D5 — Lặp Muse một lượt và đối chiếu

Ngày: 2026-10-10. Đã chạy job trên VPS, thu đủ 20 reply và đối chiếu; chưa
commit/push/deploy backend/apply DB. Quality gate vẫn chưa đạt.

## Thiết kế lượt thử

Theo yêu cầu chủ dự án: chạy Muse thêm một lần, xem kết quả có đổi không.
Chọn **đủ 20 bundle có proposal exact D3**, mỗi bundle chấm cả 5 candidate.
Một R2 mới/bundle, 8 worker; nguyên system/phase prompt v1, payload, seed và
candidate order. Fresh side-chat, không gửi verdict/lý do R1/R2 hoặc audit Codex.
Baseline so sánh chính là R2 cuối đã validated; thêm cột R1 và audit từng sense.

Đây là phép thử độ ổn định cùng model/prompt, không phải thử prompt v2 hoặc
giám khảo độc lập. R2 baseline của sense 104 (お菓子) từng được format repair;
semantic rules giữ nguyên nhưng prompt format không hoàn toàn cùng bytes.

## Kết quả

| Chỉ số                                             |       Kết quả |
| -------------------------------------------------- | ------------: |
| Dispatch mới / reply transport completed           |       20 / 20 |
| Output hợp lệ theo adapter D1                      |         17/20 |
| Giữ candidate exact duy nhất, không unresolved     |            15 |
| Chuyển sang nonexact                               |             1 |
| Mơ hồ do nhiều exact                               |             1 |
| Lỗi output                                         |             3 |
| Candidate relations giống R2 cũ trên subset hợp lệ | 67/85 = 78,8% |
| Exact duy nhất giữ lại trùng audit pass trước      |         14/15 |
| Exact duy nhất giữ lại trùng audit severe trước    |          1/15 |
| Mapping được apply                                 |             0 |

`14/15` là đối chiếu nhãn **AI audit đã có** trên subset ổn định; không là
precision expert gold, không dùng để cấp confidence/calibratedScore. Không loại
3 invalid khỏi mẫu số 20 rồi gọi cả pilot đạt. Cả repeat và baseline cùng Muse.

### Các ca đáng chú ý

| Sense                          | R1/R2 cũ             | Lượt mới                                          | Đối chiếu                                                                                                                                                    |
| ------------------------------ | -------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| アナウンサー, 1201             | exact                | **narrower**, output hợp lệ                       | Muse lần này phân biệt vai trò nghề nghiệp với bất kỳ người nào phát sóng. Audit trước deferred do thiếu chứng cứ scope; không tự coi lượt mới là nhãn gold. |
| オーバー “vượt mức”, 1962      | exact                | Raw chọn **broader**, nhưng thiếu 1/5 candidate   | Muse đã nêu được việc vượt mức không nhất thiết tốt hơn một chuẩn, phù hợp hướng audit severe trước. Output không hợp lệ, không nhận decision mới.           |
| どんな, 751                    | exact                | **exact**, output hợp lệ                          | Vẫn bỏ khác biệt scope của construction so với definition có one/some; lặp lại kết luận bị audit AI chấm severe. Ba lượt đồng ý không loại được lỗi chung.   |
| アパート “tòa nhà”, 1229       | exact duy nhất 62206 | **2 exact: 62206 và 63054**, `ambiguous_concepts` | Không chọn duy nhất được concept; v1 phải defer. Đây là ambiguity, không chứng minh nghĩa tòa nhà đã dịch/mapping sai.                                       |
| お兄さん lời gọi thân mật, 114 | exact                | Raw vẫn **exact**, nhưng thiếu 1/5 candidate      | Audit trước deferred; raw không được nhận là output validated.                                                                                               |
| お菓子, 104                    | exact                | Raw **exact**, đủ 5 candidate nhưng sai thứ tự    | D1 parser nhận đủ identity/set; adapter frozen yêu cầu đúng thứ tự nên loại. Đây là lỗi format/order, không tự chấm thành lỗi nghĩa.                         |

Các ca còn lại giữ exact duy nhất. Chi tiết đủ 20 sense, toàn bộ candidate
relations, reason và raw observations của ba output bị loại:
[report JSON](db4-d5-muse-repeat-2026-10-10.json).

## Thời gian, vận hành và lỗi runner

- Job: `langoo-db4-d5-repeat-20261010.service`, cap đúng 20 dispatch,
  timeout 600s/request; không tự resend/repair. Không chạy provider/job khác.
- 18 reply được runner thu sau **92,76s**. Hai reply còn lại đã có
  `status=completed`, `display_text_ready=true`, JSON đủ đóng nhưng chỉ 4/5
  candidate. Runner đang đợi `basic_binding` nên tiếp tục polling dù Muse đã xong.
- Đọc history để xác nhận completion, dùng read-only reconciliation thu hai raw
  reply, **0 dispatch thêm**. Không điền candidate thiếu hoặc sửa job records.
  Capture đủ 20 reply sau **441,63s (~7 phút 22 giây)** từ lúc job khởi động;
  số này gồm thời gian phát hiện/thu hồi lỗi, không là model generation time thuần.
- Sau khi response ledger bền vững, đã dừng runner, xác nhận unit inactive/dead.
  `progress.json` gốc vẫn dừng ở 18/20 vì bảo toàn ledger; trạng thái cuối đọc
  `reconciliation.json` + `comparison.json`, không chỉ đọc progress cũ.
- RAM quan sát khi đang chạy: 96.006.144 bytes (~92 MiB); không là peak benchmark.
  Native Muse không cung cấp usage telemetry, **token usage chưa biết**.

## Code, artifacts và kiểm tra

- [Prepare](../../scripts/db4/muse-repeat-prepare.ts): replay D3 từ nguồn/raw,
  freeze đủ 20 original R2 request, copy prompt nguyên bytes, kiểm denominator,
  immutable rerun. Không có audit/prior verdict trong payload mới.
- [Reconcile](../../scripts/db4/muse-review-reconcile.py): chỉ đọc history của
  dispatched jobs; yêu cầu primary assistant completed/ready và root identity
  bound. Ghi artifact mới bất biến, không generation/resend, không cấp D1-valid.
- [Compare](../../scripts/db4/muse-repeat-compare.ts): replay binding, kiểm audit
  hashes, reparse raw output so normalized validation, phân biệt exact relation
  với exact duy nhất đủ điều kiện; invalid không bị coi thành none.
- Reuse `muse-review-runner.py` và `muse-review-validate.ts` hiện có; không sửa
  prompt hoặc validator frozen để biến output lỗi thành pass.
- `node --import tsx --test scripts/db4/*.test.ts`: **65/65 pass**, không skip.
- `npx tsc -p tsconfig.db4.json`: pass.
- Scoped ESLint hai TS file mới và Prettier TS/plan/report/JSON: pass.
- Python syntax compile: pass; reconciliation thực tế thu đúng hai completed
  reply, không gọi generation. Chưa có mock/unit riêng cho reconciler.
- D4 adapter thực tế: 17 validated / 3 rejected (2 thiếu candidate, 1 sai order).
- Comparison CLI thực tế + rerun: cùng report hash/counts; JSON/link/artifact hash,
  whitespace, `git diff --check` pass; đã kiểm working tree. Không chạy DB integration.

Local root: `uploads/db4-d2-pilot/muse-d5-repeat-20261010/` (ignored).
VPS: `/opt/langoo/storage/db4-d5-repeat-20261010/`, giữ prompt/requests/manifest,
private jobs, public reconciled replies, reconciliation và comparison. Validation
normalized local: `muse-d4-v1/validated/8b5d9f042b7d/` dưới artifact root.

- Response SHA-256: `8b5d9f042b7df4468c3eac776692d2ef2169b2c59399b71133928c8f5f865e01`.
- Comparison SHA-256: `570fe839c73f8e783cc7cef4264bf31a7c080f96f13985337204782d802f8104`.
- Hai SHA trên đã đối chiếu local và VPS. Không lưu session ID/cookie vào report repo.
- Manifest repeat kế thừa thời điểm freeze pilot gốc; thời gian job mới ở
  `runner-started.json`/`reconciliation.json`, không lấy `createdAt` gốc làm ngày rerun.

## Có hướng khác không?

**Có, chưa cần chấp nhận mapping sai.** Lượt lặp đã bắt được vài bất ổn nhưng
không giải quyết hết: どんな giữ cùng kết luận bị chấm lỗi ở cả ba lượt.

Hướng tiếp theo theo thứ tự:

1. **Prompt v2 kiểm scope bằng điều kiện và phản ví dụ.** Tách definition khỏi
   nhãn; source/context nào chứng minh mỗi điều kiện hai chiều? Một trường hợp
   source cho phép nhưng concept loại trừ → nonexact. Thiếu chứng cứ qualifier
   nghề nghiệp/tuổi/construction → uncertain, không tự điền điều kiện cho exact.
   Giữ rõ khác biệt synonym gloss và các nhánh nghĩa; tránh tách mọi gloss thành
   một nghĩa mới hoặc chấm mọi mô tả khác chữ thành sai.
2. **Format không cần thêm vote semantic.** Chuẩn hóa thứ tự theo candidateKey
   có thể làm deterministic ở phiên bản adapter mới, giữ raw reply/hash và mapping
   provenance; không sửa kết quả frozen của lượt này. Candidate bị bỏ thiếu vẫn
   invalid, cần bounded repair riêng nếu được chạy, không lấy verdict cũ điền vào.
3. **Nhận completion từ transport.** Runner tương lai cần kết thúc khi primary
   assistant completed/ready rồi để D1 validator phân loại; không chờ hết timeout
   vì JSON cuối thiếu candidate. Reconciler đợt này đã tránh gọi lại model.
4. **Tự động giữ chưa map khi mơ hồ.** Không cần người dùng duyệt từng từ, cũng
   không ép mọi sense có exact. Có thể cải thiện context/retrieval cho backlog;
   không dùng vote 2/3 cùng Muse hoặc tỷ lệ nhãn 14/15 làm quyền promote batch lớn.

Chưa viết/chạy prompt v2 hoặc repair semantic mới trong đợt này. D5 toàn 100
target/Pilot B, holdout/recall/budget, D6 preflight/journal và D7 serving còn thiếu.

Git / triển khai: code/test/docs đợt này đã lưu local, **chưa commit/push**; đã
chạy và thu hồi job trên VPS, không deploy backend hoặc apply DB. Giữ nguyên
artifacts/audit cũ và các thay đổi hạng mục khác.
