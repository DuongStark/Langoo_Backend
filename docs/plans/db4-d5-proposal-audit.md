# DB4-D5 — Audit chất lượng proposal exact

Ngày: 2026-10-10. Tiếp tục theo yêu cầu chủ dự án; vận hành tự động, không yêu
cầu người dùng biết JA hoặc duyệt từng dòng.

## Phạm vi đợt này

- Audit đủ 20 exact proposals của DB4-D3 bằng context JMdict/OEWN/OMW đã đóng
  băng. Reviewer là Codex trong phiên, ghi `reviewerKind=llm`; không giả reviewer
  human, API R2 hoặc ground truth đã được chuyên gia xác nhận.
- Mỗi dòng đọc toàn bộ EN gloss, raw POS/info/field/restrictions, định nghĩa và
  nhãn concept, bốn candidate khác. Không lấy VI, rank hoặc confidence làm nhãn.
- Lưu MappingAudit D1 có hash candidate/input/R1/R2/decision; pass/fail/deferred,
  severity và lý do. R1/R2/decision gốc bất biến.
- Tạo CLI `scripts/db4/mapping-audit.ts`: tái xác minh D3 từ raw nguồn, kiểm
  đầy đủ/unique/binding 20 audit, xuất report và subset pass bất biến. Có regression
  cho thiếu/foreign/stale audit, verdict mâu thuẫn, rule tự pass, immutable rerun.
- Cập nhật PROGRESS và report gồm số đúng/lỗi/thiếu chứng cứ và gate còn thiếu.

## Giới hạn và bước tiếp

Đây là **audit positive proposals**, chưa phải toàn bộ Pilot A 100 target hoặc
Pilot B ≥100 positive + ≥50 hard-negative. Công cụ không cấp gate production,
không ghi DB, không tự gọi Muse, không thay prompt để sửa output cũ. Pass rate
là đánh giá của AI trên mẫu chọn theo consensus, không là accuracy toàn 15k sense.

Sau audit: sửa prompt/context theo lỗi thật trong run/version mới; audit toàn
100 target (kể cả no_candidates/incomplete) và thu thêm positive trong cohort có
cap. D6/D7 vẫn cần gate/journal/serving. Một severe trong audit dừng promotion
đợt; subset pass chỉ là input để kiểm tiếp, không là giấy phép apply.

## CLI và consumer

```bash
npx tsx scripts/db4/mapping-audit.ts ARTIFACT_ROOT D3_MANIFEST AUDIT_JSONL
```

D3_MANIFEST tương đối dưới root; AUDIT_JSONL là file local, có thể nằm trong repo.
Tối đa 64 MiB/file và 500 target/generation theo D3. Tool tái chạy binder D3;
chỉ reuse output có đúng hash, không gọi mạng/DB. Hash audit bytes và D3 manifest
định danh run. Output `muse-d5-v1/<runKey>/`: audit copy, passed-proposals,
report và manifest; manifest ghi cuối. Các flag `promotionReady`, `apply`,
`fullPilotGatePassed` luôn false trong phạm vi này. Không dùng số pass làm
`calibratedScore`/link confidence. Handoff chi tiết ở report đợt này.

Exit 0 chỉ nghĩa integrity/ghi artifact thành công; consumer đọc report/flags,
không lấy exit code làm quality gate.

Kết quả thực hiện: [report 20 proposal](../reviews/db4-d5-proposal-audit-2026-10-10.md).

## 2026-10-10 — DB4-D5 — Lặp Muse một lượt và đối chiếu

Chủ dự án yêu cầu chạy Muse thêm một lần. Chọn đủ 20 bundle đã được D3 đề xuất
exact; một lượt R2 mới/bundle, vẫn chấm cả 5 candidate. Dùng nguyên prompt v1,
payload/seed/render/order nguồn, fresh side-chat và không gửi verdict/lý do audit
hay kết quả R1/R2. Đây là phép đo độ ổn định, chưa phải thử prompt cải tiến.

- `muse-repeat-prepare.ts` bind/replay D3 trước freeze subset; artifacts riêng
  `muse-d5-repeat-20261010`, không ghi đè run cũ.
- VPS `/opt/langoo/storage/db4-d5-repeat-20261010/`, 8 worker, timeout 600s/request,
  cap đúng 20 dispatch, không tự resend/repair sau intent. systemd job độc lập,
  không deploy app hoặc sửa DB; account lock dùng runner hiện có.
- D1 validate output mới rồi so relation exact/none/nonexact/uncertain, selected
  candidate và coverage với R1/R2 trước. Report đủ 20, giữ invalid/unknown riêng.
- Đối chiếu cả với audit Codex, ghi rõ đó là AI labels. Agreement không bằng
  accuracy; hai lượt lặp cùng Muse có thể lặp lỗi. Baseline R2 của お菓子 có một
  format repair; report riêng yếu tố này, không nhận là lần đầu đều cùng bytes.
- Ghi thời gian thực tế và usage nếu transport có; không ước lượng token
  chính xác khi Muse không cung cấp telemetry.

Kết quả: [report lần lặp](../reviews/db4-d5-muse-repeat-2026-10-10.md). Thu đủ
20 reply, 17 output validated; 15 exact duy nhất giữ lại, 1 nonexact, 1 ambiguity,
3 lỗi output. Đã thu hồi hai completed reply thiếu candidate bằng read-only
reconciliation và dừng polling, không thêm dispatch. Quality gate chưa đạt.
