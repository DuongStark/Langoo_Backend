# M11.3 — Pilot chất lượng quiz từng câu và nhiễu Kanji

Ngày 2026-11-17. Phạm vi: kiểm lại chất lượng đề do engine V3 single-question
sinh thật, tập trung vào ba việc chủ dự án yêu cầu: đáp án nhiễu Kanji khó hơn,
thời gian tạo, và trạng thái đủ để chốt handoff FE/bật V3 trên VPS.

## Cách chạy

- Code: `scripts/ops/m11.3-single-quality-pilot.ts` gọi đúng
  `QuizBatchEngine` production ở chế độ `singleQuestionMode` (commit
  `9a66fb4`), không dùng harness batch cũ.
- Provider: DeepSeek `deepseek-ai/deepseek-v4.1-flash`, reasoning `low`,
  timeout 20s, model/token lấy từ runtime VPS. Request đi qua một process
  worker trên VPS (`scripts/ops/m11.3-quiz-worker.cjs`) để không đo nhầm
  thời gian khởi động SSH/Node; nhịp gửi mô phỏng gate production 300ms.
- Fixture: 20 từ công khai, ID tổng hợp, EN và JA; không đọc DB, không ghi
  DB/ENV/app, không dùng dữ liệu học viên.
- Kiểm độc lập: GLM `zai-org/glm-5.3-flash` trả lời mù từng câu (không nhận
  answer key), sau đó so với đáp án server. Đây là kiểm mẫu, không phải
  chuyên gia duyệt.
- Lệnh đã dùng (mỗi lần chạy cần thư mục output mới):
  `QUIZ_PILOT_ONLY=ja npx tsx scripts/ops/m11.3-single-quality-pilot.ts`;
  EN: thêm `QUIZ_PILOT_OUTPUT=docs/reviews/m11.3-quality-pilot-2026-11-17/en`;
  JA 500ms: thêm `QUIZ_PILOT_PACING_MS=500` và một thư mục output riêng.

## Kết quả

| Lần chạy | Đạt | Câu đầu | Câu cuối | Tổng | Call | Lỗi provider | Blind đồng ý |
|---|---:|---:|---:|---:|---:|---|---:|
| EN, 300ms | 20/20 | 6,1s | 18,5s | 18,5s | 23 | 3×429 | 20/20 |
| JA, 300ms | 19/20 | 9,9s | 39,3s | 39,3s | 28 | 5×429, 2 timeout, 2 lỗi không status | 19/19 |
| JA, 500ms | 19/20 | 6,8s | 35,6s | 37,0s | 25 | 1 TypeError, 4 timeout | 19/19 |

- Tổng latency provider (không phải wall): EN trung vị 4,5s/call; JA trung vị
  8,0–8,7s/call, đuôi 12–17s. Vì vậy câu đầu có sau 6–10s nhưng câu cuối có
  thể tới 37–39s.
- EN đạt 20/20 cả hai lượt kiểm; JA đạt 19/20 ở cả hai lần. Câu thiếu không
  phải do gate nhiễu mà do call provider timeout/lỗi; worker chỉ retry một
  lượt các slot thiếu.
- 300ms có 429; giãn 500ms hết 429 nhưng vẫn còn timeout và tổng thời gian
  gần như không giảm. Không kết luận chỉ cần đổi 300ms là đủ.

## Chất lượng nhiễu Kanji

- 13/13 câu Kanji ở mỗi lần chạy (reading + orthography) có đủ 4 lựa chọn,
  không trùng, đáp án đúng do server giữ, `source_policy=ai_distractors`.
- Nhiễu gần và khó hơn rõ rệt: `だいがく` có `たいがく/だいかく/だいがっく`;
  `せんせい` có `せんぜい/せんせ/せいせい`; `切符` có `切付/切附/切府`;
  `乗客` có `乗各/乗容/剰客`; `入口` có `人口/入田/入回`. Đa số chỉ khác
  1 ký tự và cùng độ dài.
- Không thấy nhiễu trùng đáp án, trùng cách đọc trường âm, alias hợp lệ hoặc
  nhiễu quá xa trong mẫu này. Gate hiện tại giữ được các luật đó.
- Hai điểm cần biết:
  - `でんしゃ` có nhiễu `でんしや` (や nhỏ vs lớn). Đây là lỗi kana/typography
    chứ không phải nhầm âm; người chấm mù vẫn chọn đúng và xếp câu hợp lệ.
  - 2–3 câu `context_cloze` bị chấm `too_easy` vì manh mối ngữ cảnh quá rõ
    (ví dụ `入院` làm lộ `病院`). Không phải câu sai; là giới hạn độ khó.
- Tất cả câu trong mẫu được chấm `good`; không có câu `awkward/invalid`, không
  có đáp án thứ hai được chấm là cùng đúng (EN có 1 câu `lend` bị nêu là có
  phương án khác có thể chấp nhận, nhưng người chấm vẫn chọn đáp án server).

## Kết luận

Chất lượng đủ để bật V3 dạng opt-in và chốt handoff FE, với điều kiện FE xử lý
đúng phần đang tạo: câu đầu mở sớm, câu cuối có thể tới ~40s, JA có thể chỉ có
19/20 và phải dùng `QUIZ_QUESTION_PENDING`/`accept_shorter` thay vì tự hoàn
thành đề. Chưa đủ để gọi là SLA 20 câu trong 20s, chưa phải p95/p99, chưa có
kiểm browser/FE hoặc chuyên gia ngôn ngữ.

V3 đã bật trên VPS ngày 2026-11-17: xem
[receipt](vps-enable-receipt.json) và mục cập nhật cuối trong
[handoff FE](../../handoff/m11.3-single-question-progressive-fe-2026-11-17.md).

## Artifact

- `en/`, `ja-pacing500/`: hai lần chạy bổ sung; thư mục gốc là JA 300ms.
- Mỗi thư mục có `calls.json`, `summary.json`, câu đã sinh, distractors và
  blind review.
- `quality-summary.json`: số liệu tổng hợp dùng cho quyết định.
