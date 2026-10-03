# M7.1/M8.1 — Kế hoạch và kết quả sửa Sessions, Gamification

Ngày lập: 2026-10-02. Trạng thái: **đã triển khai và nghiệm thu local; migration cloud chưa apply**.
Căn cứ: [review M7/M8 ngày 2026-10-01](../reviews/m7-m8-review-2026-10-01.md),
`docs/api/sessions.md`, `docs/api/gamification.md`, `docs/plans/m6.1-srs-fixes.md`.
Code M7/M8 đối chiếu ở `b75fc8d`. Khi lập kế hoạch, migration DB2 mới nhất là 033;
trước triển khai đã kiểm tra lại và xác nhận migration mới nhất là 035, dành số 034
cho receipt của session.

## 1. Mục tiêu và phạm vi

Sửa đủ bốn finding P2: M7-01 (replay sai snapshot), M7-02 (index ngoài lựa chọn làm
biến đổi SRS), M8-01 (achievement quiz mở khoá chậm) và M8-02 (`codes:null` trả 500).
Giữ các route, bốn mode M7, ReviewEngine dùng chung, quy tắc practice/review, XP cap
và giao thức khóa user hiện có. Nhánh quiz M11 dùng lại grader M7 nên regression của
index và achievement phải phủ cả quiz.

Kết quả mong muốn: mỗi câu trả lời hợp lệ được ghi đúng một lần trong transaction;
retry cùng payload nhận **đúng response đã trả ở lần đầu**, kể cả sau khi session tiến
thêm hoặc SRS đổi; input sai bị từ chối trước mọi ghi; achievement quiz phản ánh câu
vừa trả lời trong cùng transaction.

## 2. Chốt hợp đồng trước khi sửa

| Tình huống                                                              | Hành vi dự kiến                                                                                                                    |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `ordinal` đã trả lời, cùng payload chuẩn hoá                            | `200` với nguyên response lần đầu; không tạo log/XP/streak/stats lần hai.                                                          |
| `ordinal` đã trả lời, payload khác (đáp án hoặc `elapsed_ms`)           | `409 SESSION_IDEMPOTENCY_CONFLICT`; không ghi gì. Đây là thay đổi có chủ đích so với test cũ đang chấp nhận đổi rating khi replay. |
| Câu đã trả lời trước migration, không có snapshot                       | `409 SESSION_REPLAY_UNAVAILABLE`; `GET /sessions/:id` và lịch sử câu trả lời vẫn đọc được. Không bịa response từ SRS hiện tại.     |
| MCQ/matching M7 hoặc MCQ quiz gửi index không có trong `prompt.options` | `400 SESSION_ANSWER_INVALID`; item giữ chưa trả lời, log/SRS/XP/stats giữ nguyên.                                                  |
| `codes` vắng mặt hoặc `[]`                                              | Giữ hành vi hiện tại: đánh dấu tất cả achievement đã mở khoá/chưa xem.                                                             |
| `codes:null` hoặc không phải mảng string                                | `400 VALIDATION_FAILED`; không đánh dấu achievement nào.                                                                           |

Payload retry chỉ gồm các trường có ý nghĩa cho loại câu hỏi (`rating`,
`option_index`, `answer_text` hoặc `pairs`) cùng `elapsed_ms` đã chuẩn hoá (`null` khi
bỏ qua). Từ chối trường đáp án không đúng mode ở lượt mới. Với quiz matching, sắp
`pairs` theo `left_index` khi so retry để thứ tự gửi không tạo conflict giả.

## 3. Thứ tự triển khai

### Bước 1 — Regression tái hiện trước sửa

- M7-01: cùng thẻ được trả lời ở hai session; SRS sau lượt thứ hai khác lượt đầu;
  retry session đầu phải giữ `item`, `srs`, `xp`, `session` của lần đầu. Thêm ca
  session đã tiến thêm câu và ca XP thực nhận bằng 0 do cap.
- M7-02: option hợp lệ đúng/sai vẫn được chấm; `-1`, `options.length`, `999`
  và index không có trong snapshot trả 400 qua HTTP. So trực tiếp số
  `review_log`, `srs_state.reps`, `xp_event`, `streak_day.review_count` và trạng thái
  item trước/sau. Phủ M7 MCQ/matching và quiz MCQ.
- M8-01: achievement kiểm thử `quiz_correct >= 1` mở ngay ở câu đúng đầu tiên;
  câu sai không tăng metric; replay không cộng thêm; XP thưởng thành tích đúng một
  lần. Sau test xoá achievement/user riêng, không đổi rule seeded toàn cục.
- M8-02: `{}`, `[]`, danh sách code hợp lệ, `null`, string, phần tử không phải string;
  xác nhận HTTP và số bản ghi được đánh dấu.

Các test phải kiểm hành vi sản phẩm và trạng thái DB sau commit/rollback, không chỉ
mock hàm thuần. Dùng DB local `_test` và fixture riêng; không phụ thuộc thứ tự suite.

### Bước 2 — Migration tối thiểu cho replay M7-01

- Khi triển khai, kiểm tra lại số migration mới nhất; migration DB2 đang dùng số 033,
  nên hiện dự kiến **`db/migrations/034_session_answer_receipt.sql`**. Thêm cột nullable
  `answer_receipt jsonb` vào `app.study_session_item`, có CHECK chỉ nhận JSON object.
  Dùng một object versioned `{version:1, request, response}`; không sửa migration 020
  đã chạy. Không cần bảng/unique mới vì `(session_id, ordinal)` đã unique.
- Map cột vào `prisma/schema.prisma`, chạy `npm run prisma:generate`, cập nhật tài liệu
  schema bằng script của repo. Để nullable vì bản ghi lịch sử không có snapshot.
- Preflight chỉ đọc: đếm item đã trả lời chưa có receipt; ghi số lượng và kiểm tra
  phiên còn mở. Không backfill từ `srs_state` hoặc `xp_event`: chúng không chứa đủ
  response gốc, đặc biệt khi XP của lượt là 0 hoặc session đã tiến thêm.
- Thứ tự rollout: DB có cột trước khi app mới ghi; không chạy đồng thời app cũ và app
  mới trên đường answer sau migration vì app cũ tạo thêm bản ghi không có receipt.
  Cloud migration chỉ apply sau khi được duyệt theo `PROMPT-BACKEND.md` §3/§6–7.

### Bước 3 — Ghi và đọc receipt trong transaction

- Trong `SessionsService.answer`, sau khi khóa user và item, phân nhánh replay trước
  kiểm tra session còn mở/eligibility như hiện tại. Nếu receipt có version hợp lệ,
  so canonical payload rồi trả bản `response` đã lưu; nếu thiếu, trả
  `SESSION_REPLAY_UNAVAILABLE`. Không đọc SRS hiện tại để dựng replay.
- Với câu mới, sau chấm/SRS/XP và cập nhật item/session, dựng
  `AnswerResultResponse` bằng các giá trị vừa ghi, rồi lưu receipt trên chính item
  **trong cùng transaction**. Áp dụng cho cả review/practice và quiz; lưu response
  khi XP bằng 0 và câu quiz sai. Chỉ trả 200 sau khi transaction commit.
- Giữ một thứ tự lock `user → session item → SRS` cho answer/finish/direct review.
  Hai request đồng thời vào cùng ordinal chỉ một request chấm; request còn lại đọc
  receipt sau lock và theo quy tắc retry ở §2.
- Đọc receipt bằng parser kiểm version/shape trước khi cast; dữ liệu hỏng trả lỗi
  domain có kiểm soát, không rơi vào 500. Các row legacy giữ nguyên để đọc lịch sử.

### Bước 4 — Chặn input sai trước mọi mutation (M7-02, M8-02)

- Khi chấm MCQ/matching, kiểm `option_index` là một `index` có thật trong
  `freshItem.prompt.options`, thay vì chỉ kiểm `>=0` hoặc so với đáp án đúng.
  Dùng cùng helper cho quiz MCQ (đang tái dùng `gradeAnswer`). Kiểm trước
  `ReviewEngine.applyRating()`/`GamificationService.applyActivity()`.
- DTO `MarkAchievementsSeenDto`: thay `@IsOptional()` bằng điều kiện chỉ bỏ qua
  `undefined`, để `null` đi qua `@IsArray()` và trả 400. Service cũng guard input
  trước khi đọc `.length` để không có 500 nếu được gọi ngoài controller.
- Bổ sung mã lỗi/giới hạn index và chính sách `codes:null` vào Swagger + API docs.

### Bước 5 — Tính achievement quiz sau khi ghi câu trả lời (M8-01)

- Trong nhánh `kind='quiz'`, ghi `study_session_item.is_correct`, `user_answer`,
  `answered_at` trước khi gọi `GamificationService.applyActivity()`; vẫn nằm trong
  **cùng transaction**. `countQuizCorrect()` lúc đó nhìn thấy cả câu vừa chấm.
- Sau gamification mới tăng `session.correct_count`, `xp_awarded`, tự complete và lưu
  receipt. Nếu XP/achievement/session update lỗi, transaction rollback cả item quiz.
- Không thay đổi công thức XP/streak ở đợt vá này. Kiểm `quiz_100` ở biên 99→100 bằng
  fixture phù hợp; achievement/progress/XP phải cập nhật ở chính lượt thứ 100.

### Bước 6 — Đồng bộ tài liệu và nghiệm thu local

- Cập nhật `docs/api/sessions.md`, `docs/api/gamification.md`, `docs/api/quizzes.md`,
  Swagger, `CSDL-THAM-CHIEU.md`, `README.md` và `PROGRESS.md`. Ghi rõ legacy replay
  409 và thay đổi payload conflict; sửa test cũ đang mong replay khác rating vẫn 200.
- Chạy `npm run db:test:reset` trên DB local `_test` (công cụ này tự apply migration
  mới), `npm run prisma:generate`, `npm run build`, `npm run lint`,
  `npm test -- --runInBand`, `npm run test:e2e -- --runInBand`.
- Kiểm rollback có chủ đích ở bước XP/achievement và race hai answer cùng ordinal;
  so `study_session_item`, `study_session`, `review_log`, `srs_state`, `xp_event`,
  `streak_day`, `user_stats`, `user_achievement`. Không có ghi một nửa hoặc cộng đôi.
- Báo số test thực chạy, tình trạng local/cloud riêng. Chỉ đóng M7/M8 khi bốn finding
  đều có test đỏ trước sửa và xanh sau sửa, full gate đạt, migration local thành công.

### Kết quả thực hiện — 2026-10-02

- Đã sửa đủ M7-01, M7-02, M8-01, M8-02; regression tests kiểm replay sau khi SRS đổi và
  session tiến thêm, payload conflict, index âm/hết range/999, quiz achievement, null,
  hai answer đồng thời, legacy row và rollback giữa gamification với receipt.
- `npm run prisma:generate`, `npm run build`, `npm run lint` đều pass.
- `npm test -- --runInBand`: **45 suite, 300 test pass**.
- `npm run test:e2e -- --runInBand`: **16 suite, 150 test pass**.
- `npm run db:test:reset` chỉ chạy trên `127.0.0.1/langoo_test`; migration 034 và
  migration search 035 đều có trong ledger. Postflight: **0 câu đã trả lời thiếu
  receipt**. Không apply migration lên cloud.
- Ca rollback tạo lỗi có chủ đích ở bước ghi receipt sau activity; kiểm tra xác nhận
  answer, XP, streak, achievement và session cùng rollback. Đây là log 500 được test
  mong đợi, không phải lỗi còn tồn tại trong luồng bình thường.
- Báo cáo kiểm chứng: [M7/M8 recheck ngày 2026-10-02](../reviews/m7-m8-recheck-2026-10-02.md).

## 4. Việc theo dõi sau bản vá — đã xử lý ngày 2026-10-03 (M7.2/M8.2)

Hai điểm dưới đây đã được chốt và sửa; ghi lại để không mất ngữ cảnh:

### M8.2 — tách bộ đếm quiz khỏi "review"

Chốt semantics (chủ dự án, 2026-10-03): **quiz là hoạt động học trong ngày** (tính
`streak_day.review_count`/`met_goal`/XP), nhưng **`user_stats.reviews_total` và achievement
`reviews_1000` chỉ tính lượt ôn SRS**. Cách làm:

- `GamificationService.applyActivity` nhận `countsAsReview`; `ReviewEngine` truyền `true`,
  nhánh quiz truyền `false`. `streak_day`/`met_goal` giữ nguyên (đếm mọi hoạt động).
- Migration `036_gamification_reviews_total_srs.sql` rebuild `reviews_total` từ `app.review_log`
  cho user cũ. Không thu hồi achievement đã mở khoá (progress chỉ tiến).
- Regression: quiz sai + đúng → `reviews_total = 0`, `streak_day.review_count = 2`.

### M7.2 — một profileId xuyên suốt + distractor theo profile

- `SrsService.collectDueRows(userId, profile, options)` nhận profile đã resolve từ
  `SessionsService.create`; không đọc lại active profile. Session, thẻ và distractor dùng
  chung một `profile_id`.
- `SessionSourceRepository` lọc `c.profile_id` và đưa ưu tiên collection vào `ORDER BY` **trước**
  `LIMIT` (trước đây `LIMIT` chạy trước rồi mới ưu tiên trong JS).
- Regression: DB active = B nhưng session resolve A → mọi item thuộc A; `findDistractors` với
  `limit=1` + preferred trả đúng collection ưu tiên và không lẫn collection profile B.

Trạng thái: build/lint/unit/e2e local pass; **migration 034 và 036 chưa apply cloud**.
