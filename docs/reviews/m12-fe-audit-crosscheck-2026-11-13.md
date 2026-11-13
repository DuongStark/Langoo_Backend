# M12 — Đối chiếu trách nhiệm BE trong rà soát FE ngày 12/11

Ngày: 2026-11-13. Trạng thái: **đã kiểm source và unit local; chưa sửa runtime**.

Nguồn yêu cầu: `docs/fe/ra-soat-2026-11-12.md` (nguồn FE local), đặc biệt phần 10.
Baseline: checkout `main`, HEAD `3bc6388`, có nhiều WIP từ trước.

Sau đối chiếu FE mới và 18 feedback, đã bổ sung [review tổng hợp](m12-feedback-crosscheck-2026-11-13.md),
[plan sửa BE](../plans/m12-fe-feedback-remediation-2026-11-13.md) và
[handoff FE](../handoff/m12-fe-feedback-sync-2026-11-13.md). Các bản sửa mới
vẫn ở trạng thái kế hoạch; không dùng review này để thông báo BE đã triển khai.

Đã đọc quy tắc/bối cảnh, contract và các plan M6.2, M12-A03/A11/A12 liên quan.
Lượt này không đăng nhập, không gọi AI, không ghi DB, không kiểm lại production/FE browser.
Các con số HTTP 7,8–8,3 giây, 43 request và kết quả từ cụ thể là bằng chứng
do FE báo; không được coi là số đo mới của lượt này.

## 1. Kết luận đủ 12 mục gửi BE

| Mục phần 10 | Kết luận đối chiếu | Trách nhiệm / việc nên làm |
|---|---|---|
| 1 — A2: profile JA tra EN/VI | **Đúng hiện tượng, nhưng việc ẩn EN đúng contract hiện tại.** `DictionaryService.search` truyền `allowedLanguageIds`; `reverseLookup` giao `to` với ngôn ngữ profile. Không có token thì không scope. `lang=en` cũng không vượt scope. VI là ngôn ngữ giải nghĩa, không tự trở thành tập từ đang học. | M6.2: muốn cho tra mọi ngôn ngữ cần đổi yêu cầu sản phẩm và đồng bộ search/suggest/detail/links/kanji, cursor, cache FE; không chỉ bỏ một filter. Phần kết quả phiên âm rời rạc nên BE/data rà riêng, xem mục 2. |
| 2 — A3: API batch/enrich collection | **BE hỗ trợ hợp lý; chưa phải bằng chứng API hiện tại sai.** Items list chỉ có `meaning_vi`, ID nghĩa và faces; chưa có lemma/reading/âm Hán–Việt đầy đủ. Chỉ dùng payload này không đáp ứng mọi nội dung FE đang hiển thị. Không thấy route batch senses/kanji trong controller hiện tại. | M5/M4: FE giảm request trùng, retry 404, tải chi tiết khi cần; BE bổ sung projection hoặc batch có giới hạn theo nhu cầu. Giữ kiểm ownership/language như endpoint đơn. Không tăng rate limit để thay việc này. Còn vấn đề IP proxy riêng, xem mục 3. |
| 3 — B5: sources chậm | **Đúng là việc BE, nhưng đề xuất “thêm cache” thiếu bối cảnh.** Đã cache 10 phút và warm nền khi boot. Cache hết hạn vẫn chờ 8 repository calls, trong đó 7 aggregate; các request đồng thời chưa gộp. Probe local 10 request lạnh → 80 calls; request tiếp theo không thêm calls. | M12-A11 đã có plan: gộp refresh đang chạy, TTL từ lúc hoàn tất. Đo query/DB khi lạnh để xử lý độ trễ 8 giây; việc gộp request không tự bảo đảm một request lạnh nhanh. HTTP cache là lớp khác. |
| 4 — A4: ngôn ngữ lỗi | **Đúng: BE chưa xử lý Accept-Language**, validation details giữ tiếng Anh, filter giữ message 404 từ framework. Nhưng hiện nguyên văn trên UI chủ yếu do FE. | FE map theo `code`/locale trước. BE có thể chuẩn hóa 404, details và i18n nếu chốt contract; không bắt buộc dịch mọi lỗi ở BE để sửa toast. `Cannot GET /…` lặp lại đường dẫn request, chưa đủ gọi là lộ secret/nội bộ DB. |
| 5 — B6: reverse ranking | **Có cơ sở BE/data cần sửa.** SQL ưu tiên tần suất EN trước mức phù hợp nghĩa; mapper JA loại trùng trước xếp `exactSense`, có thể mất ứng viên tốt. | M12-A12 xử lý chọn representative trước dedup. Nhưng plan đó không tự sửa assertion “nước → of”, thứ tự EN hoặc bảo đảm 水 vào top. Cần đọc assertion/hint của ví dụ thực tế, phân biệt data sai và scoring sai. EN rỗng ở profile JA là scope mục 1. |
| 6 — B7: tiếng Việt không dấu | **Đúng là khoảng thiếu ở BE.** Reverse exact chỉ so chuỗi/lowercase; suggestions reverse dùng `f_unaccent`. Hai endpoint khác chính sách nên có gợi ý nhưng Enter không ra là hợp logic code hiện tại. | M4: thêm fallback không dấu cho reverse, ưu tiên có dấu/exact trước và kiểm hiệu năng. Không biến mọi tìm kiếm EN/JA thành unaccent; từ VI có dấu vẫn phải đi đúng reverse ở FE. Đây là cải thiện tính năng, chưa thấy cam kết cũ rằng exact đã hỗ trợ. |
| 7 — BE-4: backend dịch chính thức | **Đề xuất tính năng mới, không phải lỗi BE đang triển khai.** Treo do fetch FE thiếu timeout theo báo cáo. | FE sửa timeout/cancel/retry trước. Chỉ xây BE translation khi đã chốt provider, ngân sách, quota, cache và notice/recipient. Lượt này không xác minh pháp lý hay chọn vendor. |
| 8 — reviews_today / items_learned | **Chưa có căn cứ kết luận BE đếm sai.** `reviews_today` chỉ đếm queue trước lượt ôn là `review` hoặc `interday_learning`; dùng cả cho daily cap. `new` và learning trong ngày không thuộc chỉ số này. `items_learned` là số `item_id` phân biệt có ít nhất một SRS `introduced_at`, toàn user, không phải số từ đã thuộc. | M6/M8: FE cần chọn đúng chỉ số/nhãn. `/me/activity` có `days[].review_count` đếm mọi review_log trong ngày theo timezone, nhưng phạm vi toàn user khác stats SRS theo profile. Không đổi reviews_today thành tổng lượt vì sẽ đổi quota. Nếu cần tổng theo profile thì thêm field riêng. |
| 9 — saved_collection_ids | **Có nhu cầu BE thật, là bổ sung contract.** Sense detail hiện không trả membership; items API phải đọc từng collection/phân trang, không có filter sense trong list query. Local state FE không phản ánh thiết bị khác. | M4/M5: thêm membership theo user/định nghĩa scope, hoặc API tra nhiều sense một lần. Phải tính face phụ, collection archive và profile; guest trả trạng thái khách rõ. FE invalidate sau add/delete/logout; dữ liệu này không được cache public. Không bắt buộc tên field đúng `saved_collection_ids`. |
| 10 — kiểm trước AI, tối thiểu 3 từ | **Yêu cầu kiểm trước AI đã có; luật 3 từ không đúng code/contract.** `buildQuizQuestions` chạy trước reserve quota và `provider.generate`. Sàn là 2 item hợp lệ sau lọc, mỗi matching cần 4; số câu/dạng còn quyết định số từ cần. | M11.1: FE xử lý `409 QUIZ_NOT_ENOUGH_ITEMS` và details `available/required`. Nếu vẫn thấy chờ AI khi thiếu từ phải có request/payload/version/timing để tái hiện. Lỗi phân bổ mixed đã có plan M12-A07 riêng, không đồng nghĩa thiếu precheck. |
| 11 — romaji n | **Đúng là BE nên hỗ trợ biến thể nếu nhận cách gõ bỏ dấu phân cách.** Converter hiện chỉ thêm một kana variant: `honyaku → ほにゃく`, `hon'yaku → ほんやく`; `genin → げにん`, `gen'in → げんいん`. | M4: giữ truy vấn gốc và thêm biến thể có kiểm soát; ưu tiên exact. Không thay mọi `ni/nya` bằng `んい/んや`, vì có cách đọc hợp lệ khác. Việc converter khác kỳ vọng chưa tự chứng minh từ biến mất: SQL còn tìm romanization gốc, cần fixture DB trước/sau. |
| 12 — headers/cache | **BE + vận hành, đề xuất hợp lý nhưng phải tách từng lớp.** Bootstrap chưa tắt Express signature hay thêm nosniff/HSTS; controller sources chưa đặt Cache-Control. Chưa kiểm lại header qua edge trong lượt này. | M12: tắt X-Powered-By/nosniff tại app/proxy; HSTS ở HTTPS edge theo policy domain. Sources/manifest có thể cache khi xác nhận độc lập người dùng. Kanji JSON nhận optional auth và kiểm scope nên không áp public cache hàng loạt. Stroke SVG đã có public/private + Vary Authorization. |

## 2. A2: phiên âm thành mục từ riêng cần xử lý khác với mở scope

Repository ưu tiên JMdict nhưng vẫn cho nguồn khác vào kết quả. Chưa thấy rule
loại lexeme chỉ là mục romanization. Điều này phù hợp khả năng FE nhìn thấy
`awateru`, song chưa đọc row DB nên chưa xác nhận nguồn/tag/relation cụ thể.

BE/data nên kiểm lexeme/sense nguồn và liên kết về từ gốc, rồi loại mục chỉ dùng
làm tham chiếu khỏi catalog learner hoặc hợp nhất vào mục chuẩn. Giữ alias tìm
kiếm để romaji vẫn ra từ Nhật. Không loại mọi từ chữ Latin hay mọi `pos=unknown`:
chúng không phải tiêu chí đủ để kết luận mục từ rác. Việc profile JA không nhận
VI reverse như báo cáo cũng cần tách khỏi search thường: search không tìm trên
assertion VI; reverse vẫn cho JA qua cầu EN theo contract.

## 3. Việc ngoài danh sách 12 mục vẫn cần lưu ý

- **A1 — cache chéo tài khoản:** lỗi chính ở service worker FE. BE nên thêm
  `Cache-Control: private, no-store` cho phản hồi cá nhân phù hợp, nhưng header
  không tự bảo đảm Workbox ngừng cache; FE phải bỏ route cache dữ liệu riêng,
  xóa cache cũ và test hai tài khoản trên preview/production. `Vary: Authorization`
  đơn độc không sửa cache URL-only do FE tự quản lý.
- **A3 — rate limit/IP:** config hiện là 120/phút và Express trust loopback.
  [Runbook](../ops/vps-deployment.md) ghi gate Cloudflare có thể làm nhiều client
  chung bucket edge; [M12-A03](../plans/m12-fe-feedback-remediation-2026-11-13.md)
  đã có hướng xử lý. Vì vậy không quy toàn bộ 429 cho người dùng chung IP hoặc
  FE gọi nhiều. Phải kiểm topology/IP thật trước khi kết luận production.
- **BE-1/2/3/5/6:** tiền tố BE là người gửi góp ý, không phải bên phải sửa.
  Model viết tay, ảnh logo, cache asset Vercel, nhãn kết quả cũ và tiếp tục lưu
  sau đăng nhập thuộc FE theo phần 9. Không cần thêm BE chỉ để làm các mục đó.

## 4. Thứ tự khuyến nghị

1. FE xử lý A1 và BE rà cache dữ liệu cá nhân; BE/ops xác minh IP rate limit M12-A03.
2. Sửa cache refresh M12-A11; xử lý reverse ranking M12-A12 cùng kiểm dữ liệu B6;
   rà mục romanization rời rạc A2.
3. Hỗ trợ tìm không dấu/romaji; phối hợp batch/projection cho collection và membership.
4. Chốt thay đổi scope tra từ nếu muốn khác M6.2; i18n BE và translation chính thức
   là các đầu việc riêng theo yêu cầu sản phẩm.

Không lập hạng mục sửa đếm hoặc thêm quiz precheck chỉ từ báo cáo hiện tại.
Danh sách này phân công kỹ thuật, không đóng các gate của audit M12 cũ.

## 5. Bằng chứng source

- [Scope service](../../src/users/study-language-scope.service.ts),
  [dictionary service](../../src/dictionary/dictionary.service.ts) — search/reverse/mapReverseHits/getSearchQueryVariants,
  [contract scope](../api/dictionary.md), [plan M6.2](../plans/m6.2-srs-new-word-visibility.md).
- [Search repository](../../src/dictionary/repositories/dictionary-search.repository.ts),
  [reverse repository](../../src/dictionary/repositories/reverse-lookup.repository.ts),
  [M12-A12](../plans/m12-fe-feedback-remediation-2026-11-13.md).
- [Sources service](../../src/sources/sources.service.ts),
  [repository](../../src/sources/sources.repository.ts),
  [M12-A11](../plans/m12-fe-feedback-remediation-2026-11-13.md).
- [Items types](../../src/collections/types/collections.types.ts),
  [items query](../../src/collections/dto/list-items-query.dto.ts),
  [dictionary controllers](../../src/dictionary/dictionary.controller.ts).
- [SRS daily counts](../../src/srs/repositories/due.repository.ts),
  [SRS service](../../src/srs/srs.service.ts),
  [gamification](../../src/gamification/gamification.service.ts).
- [Quiz service](../../src/ai/quiz/quiz.service.ts),
  [generator](../../src/ai/quiz/quiz-generator.ts), [contract](../api/quizzes.md).
- [Exception filter](../../src/common/filters/all-exceptions.filter.ts),
  [bootstrap](../../src/main.ts), [proxy config](../../src/config/http-proxy.ts).

## 6. Kiểm tra và trạng thái bàn giao

- Node `v24.22.2`. Chạy `npm test -- --runInBand --runTestsByPath` với 7 file:
  `src/dictionary/dictionary.service.spec.ts`, `src/sources/sources.service.spec.ts`,
  `src/ai/quiz/quiz.service.spec.ts`, `src/ai/quiz/quiz-generator.spec.ts`,
  `src/users/study-language-scope.service.spec.ts`, `src/srs/srs.service.spec.ts`,
  `src/common/filters/all-exceptions.filter.spec.ts`: **7 suites / 94 tests PASS**.
  Warn trong quiz tests là nhánh lỗi giả lập. Không coi các test này chứng minh
  ranking/dữ liệu production đúng hoặc stampede đã được sửa.
- Probe `tsx -e` import `SourcesService` thật, mock 8 method repo trả `[]` sau
  10 ms: `Promise.all` 10 lần `list()` → `repositoryCalls=80`; thêm một `list()`
  sau hoàn tất vẫn 80. Không kết nối DB. Đây là tái hiện lỗi còn tồn tại.
- Probe `node -e` gọi `wanakana.toHiragana` đã cài: kết quả như mục 11.
- Gate còn thiếu: DB/HTTP với phiên bản production, browser/account transition,
  query plan/cold latency, assertion của “nước/of/水”, metadata `awateru`, fixture
  romaji, headers/IP edge. Không chạy build/lint/full suite/E2E vì không sửa runtime.
- File thay đổi trong lượt: report này và entry `PROGRESS.md`; giữ nguyên file
  rà soát FE và WIP khác. Docs local chưa commit/push/deploy; không thay ENV/DB.
- Kiểm link local, `git diff --check` và working tree ở bước bàn giao.
