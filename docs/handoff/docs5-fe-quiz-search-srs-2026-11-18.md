# DOCS5 — Bàn giao FE cho Quiz, tra từ và ôn tập SRS

Ngày 18/11/2026. Dành cho LanGoo-User và consumer Admin có dùng thống kê học. BE production đang chạy `dcd1830` tại `https://api.langoo.org` và sẵn sàng để FE tích hợp.

| Phần | Trạng thái và thời điểm tích hợp |
| --- | --- |
| **M11.5 — Quiz** | BE đã deploy. DB production có migration `050` và 96.155 câu hoạt động. FE bỏ luồng jobs V3. |
| **M10.5 / M4.8 — Tra từ** | BE đã deploy. Xếp hạng đồng dạng, cursor v7 và tìm một kana có hiệu lực. Đã kiểm tra `bank`, `go` và `う` trên API production. |
| **M6.3 — SRS** | BE đã deploy và production đã áp `051`. FE User và FE Admin dùng contract SRS nhận diện và bỏ các trường XP. |

## M11.5 — Quiz

### Tạo đề và làm bài

1. Gọi `POST /v1/quizzes/eligibility` với `{ collection_id?, language_id, skills, question_count }`. Dùng `eligible_targets`, `source_policy` và `suggested_count` để hiển thị dạng câu và số câu có thể tạo. Ví dụ tiếng Anh không có dạng đọc hoặc viết Kanji.
2. Gọi `POST /v1/quizzes` với cùng cấu hình và `idempotency_key`. Response trả đề `status: "ready"` và `content_version: "m11.5-v1"`. Mở phiên bằng `POST /v1/quizzes/:quizId/start` với `{ intent: "resume" }`, giữ cả `sessionId` và `quizId`.
3. Gỡ luồng polling `/v1/quizzes/jobs*` và các trạng thái chờ sinh câu V3. Khi gặp trạng thái V3 lưu cũ trong FE, đưa người học về tạo đề mới.
4. Render `item.prompt.segments`. Nếu có `highlight`, đánh dấu từ ở giữa `before` và `after`. Nếu `highlight: null`, đặt ô trống giữa hai đoạn. Nếu `segments: null`, dùng renderer tương ứng cho câu từ đơn hoặc ghép cặp.

### Hiện đáp án, tạm thoát và làm lại

- Với `session.settings.feedback_policy: "after_answer"`, sau `POST /v1/sessions/:sessionId/answers` hiển thị `item.is_correct`, `item.correct_answer` và `item.credit` nếu có. Khóa câu đã nộp và đợi người học chọn **Tiếp tục**. Ở câu cuối, giữ phản hồi trên màn hình tới khi bấm **Xem kết quả**.
- Khi tải lại bằng `GET /v1/sessions/:sessionId`, các câu đã nộp vẫn có đáp án và phản hồi. Chọn câu tiếp theo theo `answered_at`. Câu chưa nộp có `is_correct: null` và chưa có `correct_answer`. Lựa chọn đang nhập chỉ lưu sau khi nộp.
- Quay lại hoặc đóng tab giữ phiên `in_progress`. Bản FE test đọc lại đúng phiên khi mở URL cũ, nhưng chưa có đường quay lại lượt dang dở từ danh sách. FE cần giữ đường dẫn phiên theo người dùng và hồ sơ, hiển thị **Tiếp tục lượt đang làm** khi phiên còn mở. Nếu đang có `quizId` và đề còn hạn, gọi `start` với `intent: "resume"` cũng trả lại phiên đang làm của chính đề đó.
- **Kết thúc sớm** gọi `POST /v1/sessions/:sessionId/finish`. Phiên còn câu chưa nộp chuyển sang `abandoned`. Khi kết thúc lượt, bỏ đường dẫn **Tiếp tục**. **Làm lại đề này** gọi `start` với `{ intent: "new_attempt", idempotency_key: crypto.randomUUID() }` và mở session mới.
- Báo lỗi qua `POST /v1/quizzes/:quizId/questions/:ordinal/report` với `{ reason, note?, idempotency_key }`. `reason` gồm `ambiguous`, `wrong_meaning`, `wrong_reading`, `unnatural` và `other`. Câu từ kho bị loại khỏi đề tiếp theo của người báo và bị khóa toàn cục sau hai báo cáo từ hai người. Dùng `status` và `cache_excluded` để hiển thị phản hồi.
- Quiz M11.5 trả `srs: null` và không cộng streak. API production đã bỏ `xp.amount` và `session.xp_awarded` theo M6.3.

**Nghiệm thu** — Đề mở được ngay, hiện đáp án sau câu đầu và câu cuối. Câu chưa nộp giữ kín đáp án. Rời rồi mở lại cùng phiên tiếp tục đúng câu. Kết thúc sớm đóng lượt. Làm lại giữ cùng đề và có phiên mới. Kiểm tra cả câu ghép cặp, báo lỗi và lỗi hết hạn khi làm lại.

## M10.5 — Handoff FE cho mục từ và nghĩa mặc định

BE đã push thứ tự mới cho search và suggestions. FE triển khai phần chọn và hiển thị nghĩa trong repo `LanGoo-User`. Có thể cập nhật preview trên contract production hiện tại.

### Kết quả tìm kiếm

Trong `src/components/dictionary/results/SearchResultItem.tsx`, lấy card từ `hit.preview` và hiện `gloss_vi ?? gloss_en ?? definition`, cùng badge review theo card đó. Chỉ mount `SenseGlossLine` để gọi `/v1/lexemes/:id/senses` khi preview thiếu nội dung hiển thị. Cách này bỏ được request phụ cho từng hit có preview. Có thể dùng lại logic đang dùng `preview` ở `DictionarySearchBar.tsx` và `ReverseResultsPanel.tsx`.

Trong `SearchResultsPanel.tsx`, khi mở hit đã hiện preview, truyền `hit.preview.sense_id` vào `openSenseDetail` cùng lexeme ID. Người dùng sẽ mở đúng nghĩa vừa thấy và vẫn có thể chọn các nghĩa khác.

### Chi tiết và tra nhanh

- `src/components/dictionary/detail/sense/use-sense-detail-data.ts` ưu tiên nghĩa người dùng đã chọn hoặc ID đích do nơi mở modal truyền vào. Khi mở theo lexeme ID, chọn ID đầu tiên trong `recommended_sense_ids` có card tương ứng trong `data` hoặc `sub_senses`, rồi dùng `data[0]` nếu danh sách gợi ý rỗng. Giữ luồng `pickSense` chờ chọn.
- `src/components/lookup/LookupTooltip.tsx` áp dụng quy tắc cho chính hit cuối cùng sau deinflection. Dùng preview của hit đó nếu có, rồi lấy nghĩa gợi ý từ senses grouped khi thiếu preview. Dùng cùng card cho nội dung tooltip, mở chi tiết và thêm vào sổ tay để các thao tác giữ đúng `sense_id`.
- Nếu chia sẻ logic chọn card giữa các màn hình, giữ thứ tự ID từ API và tìm cả `sub_senses`. `is_primary` biểu thị nghĩa chính theo nguồn. `view=flat` phục vụ thứ tự nguồn; màn hình dành cho người học dùng mặc định grouped.

### Search và phân trang

Trên production, các mục EN cùng lemma, mặt chữ và hạng tần suất dùng thứ hạng M10.5 còn hiệu lực. Suggestions chọn mục đại diện theo thứ tự này. FE giữ thứ tự API. `next_cursor` vẫn là chuỗi opaque. Bản BE mới trả cursor v7; nếu phân trang bằng token cũ và nhận `400 VALIDATION_FAILED`, bỏ các trang đã cache của truy vấn và tải lại trang đầu một lần. Giữ các lỗi khác theo luồng lỗi hiện có.

M4.8 giới hạn full search của một ký tự kana ở kết quả khớp chính xác. Suggestions vẫn có thể trả kết quả rộng hơn.

### Nghiệm thu

- `bank`: gợi ý, kết quả, tooltip và nghĩa mở đầu phải thống nhất “Nhà ngân hàng.” ở sense `283716`. Nghĩa nghiêng cánh máy bay vẫn có trong danh sách nghĩa.
- `go`: động từ `1154670` đứng trước danh từ `1154668`, với preview “Đi, đi đến, đi tới.”. Mở riêng danh từ vẫn hiện “Sự thử (làm gì).”.
- Hit thiếu preview vẫn hiện nghĩa từ grouped. Kiểm `book`, `water` và ít nhất một hit JA. So request trong Network tab để xác nhận hit có preview không gọi `/senses` chỉ để vẽ dòng kết quả.
- Kiểm tra bấm thẳng nghĩa phụ, mở từ tooltip sau deinflection, thêm vào sổ tay đúng ID, tải thêm trang và hồi phục khi dùng cursor v6 cũ.

## M6.3 — SRS nhận diện, chỉ giữ streak và thống kê học

Code và migration đã áp trên VPS production.

- Thẻ luôn từ Nhật/Anh → nghĩa Việt; `direction` response cố định `recognize`.
- Request review/suspend bỏ `direction` được; nếu gửi phải là `recognize` (null/recall bị từ chối).
- Mỗi face chỉ có một SRS state; không dùng composite face/direction.
- Xóa XP, level, leaderboard và huy hiệu. Các response review/session/stats không còn `xp`,
  `xp_awarded`, `xp_total`, `level`, `level_progress`, `today.xp` hoặc phần thưởng huy hiệu.
- `GET /v1/me/achievements`, `POST /v1/me/achievements/seen` đã xóa (404).
- Admin thống kê bỏ XP và metric `xp`; FE Admin consumer cần cập nhật nếu đang đọc metric cũ.
- Xóa review mồ côi mất liên kết với thẻ và receipt liên quan, kể cả lịch sử dev
  recognize không còn nguồn; đây là quyết định dọn sạch dữ liệu dev không dùng cho user thật.
- Streak/lịch hoạt động/số lượt/số từ/mục tiêu ngày giữ lại; idempotency vẫn dùng receipt.
- FE User local chỉ sửa để kiểm thử contract; không đại diện cho trạng thái tích hợp hoặc triển khai FE thật.

### Trạng thái production

Migration `051` đã áp sau khi sao lưu DB theo phê duyệt của chủ dự án. App cũ cần schema trước `051` nếu phải rollback. FE có thể tích hợp contract mới trên production. [Contract SRS](../api/srs.md) · [Phiên học](../api/sessions.md) · [Streak và thống kê](../api/gamification.md) · [Admin](../api/admin.md).

### Bàn giao cho FE thật — bắt buộc tích hợp riêng

Các thay đổi trong repo FE local `LanGoo-User` phục vụ kiểm thử. FE thật cần tích hợp và nghiệm thu theo danh sách dưới đây.

#### Các thay đổi cần thực hiện

1. Đồng bộ kiểu dữ liệu API:
   - Due card/session prompt chỉ nhận `direction: "recognize"`.
   - Request review `POST /v1/srs/reviews` và suspend `PATCH /v1/srs/cards` có thể bỏ `direction`; nếu gửi phải là `recognize`.
   - Bỏ `xp` khỏi review/answer result, `xp_awarded` khỏi session; bỏ `xp_total`,
     `level`, `level_progress`, `today.xp` khỏi stats. Không yêu cầu các field này
     trong parser/validator; không truy cập hoặc thay bằng số 0 để tiếp tục hiện UI cũ.
2. Flashcard luôn hiển thị từ Nhật/Anh phía trước, nghĩa Việt và ảnh minh họa phía sau.
   Bỏ lựa chọn đảo chiều, nhánh recall và logic giả định hai state cho mỗi face.
3. Gỡ UI, hook, query và request XP/level/leaderboard/huy hiệu nếu còn;
   không gọi `GET /v1/me/achievements` hoặc `POST /v1/me/achievements/seen` vì trả 404.
   Giữ streak, lịch hoạt động, mục tiêu ngày và thống kê học tập.
4. FE Admin: bỏ field tổng XP ở `GET /v1/admin/stats` và metric `xp` ở `GET /v1/admin/stats/timeseries`. Các metric còn lại là `signups`, `reviews`, `ai_requests`.
5. Khi chuyển backend mới, làm mới cache stats/due/session cũ để không hiển thị dữ liệu
   XP/recall đã loại bỏ. Giữ nguyên `client_review_id` khi retry cùng một review.

#### Tham chiếu bản thử local

- `src/types/api.ts`: contract nhận diện và loại field XP/level.
- `src/components/review/FlashcardPlayer.tsx`: request review bỏ direction.
- `src/components/review/FlashcardCard.tsx`: comment ảnh ở mặt sau.

Đây là các file tham khảo đã sửa local để test, không phải bản FE thật đã phát hành.

#### Checklist nghiệm thu FE thật

- [ ] Build/typecheck và lint với contract mới.
- [ ] Flashcard Nhật và Anh: từ phía trước, nghĩa Việt phía sau; không còn recall.
- [ ] Review/suspend khi bỏ direction và khi gửi recognize đều hoạt động.
- [ ] Retry cùng client_review_id không nhân đôi review/streak.
- [ ] Session, stats và lịch hoạt động render được khi response không có field XP/level.
- [ ] Không còn UI hoặc network request XP/huy hiệu; Admin không query metric xp.
- [ ] Làm mới cache cũ sau chuyển phiên bản; kiểm tra trình duyệt thực tế với backend mới.
- [ ] Ghi nhận phiên bản FE tích hợp và kết quả deploy riêng; hiện chưa xác nhận FE thật.
