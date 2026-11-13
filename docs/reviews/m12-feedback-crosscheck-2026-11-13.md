# M12 — Tổng hợp đối chiếu FE mới và báo lỗi production

Ngày: 2026-11-13. Nội dung dưới ghi nhận lượt kiểm tra chỉ đọc trước khi lập plan; không sửa source FE/BE hoặc trạng thái feedback. Sau khi chủ dự án yêu cầu lập kế hoạch, bản tổng hợp được lưu vào repo và liên kết PROGRESS; chỉ thay đổi tài liệu, chưa commit/push/deploy.

[Plan BE](../plans/m12-fe-feedback-remediation-2026-11-13.md) · [Handoff FE](../handoff/m12-fe-feedback-sync-2026-11-13.md) · [Đối chiếu report FE](m12-fe-audit-crosscheck-2026-11-13.md).

## Nguồn và giới hạn

- Đã fetch FE `DuyBigPP/LanGoo-User` main tại `00f674dd6c03ee11880726d2e4efddaacca00506`; dùng git archive vào `/tmp/langoo-fe-audit-20261113.moK3CB`. Không pull/merge vào checkout FE vì có WIP, không ghi đè file đang làm.
- BE local và Git HEAD trên VPS cùng `3bc638882f3d63e2cdc60153d18074426152b6a4`; local có WIP, không chứng nhận toàn bộ source live khớp chỉ từ SHA.
- Đọc app.feedback production trong transaction READ ONLY, connection default_transaction_read_only=on, statement_timeout=10s. Tổng 27 records: 27 resolved, 0 in_progress, 0 new. 18 nội dung cụ thể (16 ngày 11/11, 2 ngày 06/11), 9 dữ liệu thử nghiệm cũ. Tất cả 18 không có admin_note. Không tải email người gửi riêng, không tải token, không ghi DB.
- Đối chiếu thêm `docs/fe/ra-soat-2026-11-12.md` và review M12 của lượt trước. Trạng thái resolved không phải bằng chứng nghiệm thu; chỉ xác nhận source trừ các probe nêu dưới. Chưa browser/E2E/Google/onboarding/PWA hai tài khoản, chưa đối chiếu SHA build FE live, chưa chạy AI hoặc reset DB.

## 1. Đủ 18 báo cáo có nội dung

Số thứ tự dùng cho review này, không phải ID mới của DB. Định danh bằng ngày + tiêu đề để người dùng tìm lại.

| # | Ngày / báo cáo | Code FE mới / kết luận | Bên làm tiếp |
|---|---|---|---|
| 1 | 11/11 — Thẻ từ hiện quá nhiều kết quả | SearchResultsPanel thu gọn còn 5; SenseDetailDialog có mở rộng nhóm nghĩa. PronunciationsSection vẫn map mọi phát âm. Có triển khai phần thu gọn; chưa nghiệm thu bằng browser. | FE nếu phần phát âm vẫn rối; BE chịu ranking/chất lượng nghĩa, không cần thêm API chỉ để thu gọn. |
| 2 | 11/11 — Đăng ký: mật khẩu, autofill | Có gợi ý chuyển sang đạt chuẩn khi đủ 8 ký tự, defaultValues rỗng và autocomplete new-password. Chưa thấy cơ chế bảo đảm trình duyệt không tự điền ô xác nhận; cần thử trình duyệt thật. | FE; chưa có bằng chứng lỗi BE. |
| 3 | 11/11 — JLPT mở trang ngoài | Sidebar có tooltip/title công cụ bên ngoài, target blank. Có triển khai cảnh báo bằng source. | FE nghiệm thu desktop/mobile; BE không cần sửa. |
| 4 | 11/11 — Sources skeleton 10 giây | FE thêm localStorage placeholder. Lần đầu trên thiết bị vẫn chờ BE; chưa sửa cold refresh ở BE. | BE M12-A11 + đo cold query; FE giữ cache UI hợp lý. |
| 5 | 11/11 — Cho dịch thử trước hỏi riêng tư | FE chuyển online translation sang bật sẵn và có nội dung tương ứng. Đây là thay đổi sản phẩm, không chứng minh tuân thủ pháp lý. | Không mở task BE chỉ để bỏ dialog; xử lý policy/consent riêng nếu có yêu cầu. |
| 6 | 11/11 — Hiện điều kiện quiz trong dialog | Đã thêm UI nhưng hardcode tối thiểu 3 từ trái BE; giới hạn câu theo item_count chưa xét matching 4 từ/câu, paused/ẩn/đồng nghĩa/đa nghĩa. | FE sửa luật hiển thị; BE có thể cung cấp eligibility/preview cùng logic generator. |
| 7 | 11/11 — Lưu 1 chạm | SenseDetailDialog đã quickSave vào sổ gần nhất hoặc sổ đầu, thiếu điều kiện thì mở dialog. Không phải còn thiếu chức năng hoàn toàn. | FE kiểm tooltip/bôi đen và chọn sổ hợp profile, không cần BE để làm nút 1 chạm. |
| 8 | 11/11 — Nút nghe/sao chép không phản hồi | SpeakButton đổi icon/trạng thái; sources copy đổi icon/chữ; thẻ từ có toast. | FE nghiệm thu, không cần BE. |
| 9 | 11/11 — Giải thích khi sang login | Có useRequireLogin và câu giải thích/return path; bản mới có pending-save. | FE nghiệm thu đủ route và onboarding; BE không cần làm điều hướng. |
| 10 | 11/11 — Nút Đã lưu không đổi | Có saved-senses localStorage theo user; chỉ nhớ thao tác máy này, giới hạn 2000; xóa 1 item làm quên trạng thái cả sổ. Chưa đáp ứng thiết bị khác/clone. | BE cung cấp membership theo user; FE dùng và invalidate thay local-only. |
| 11 | 11/11 — Từ đã lưu: 1 thay vì 4 | Nhãn VI đã đổi thành Từ đã học, vẫn dùng items_learned. Đúng lựa chọn báo cáo cho phép: nếu chỉ đếm đã học thì ghi rõ. Chưa có tổng saved thực. | Không sửa BE để ép items_learned thành saved. Nếu cần cả hai số, bổ sung count/membership riêng. |
| 12 | 11/11 — Đã ôn hôm nay 0 | FE dùng Math.max(srs.reviews_today, me.today.review_count). Hai số khác phạm vi; me.today tính cả hoạt động quiz, SRS theo profile/quota. Có thể đổi lỗi 0 thành số lẫn quiz/profile. Trang học vẫn dùng reviews_today cũ. | BE/FE thống nhất metric; dùng review_count từ activity nếu muốn toàn user, hoặc thêm tổng SRS theo profile. FE bỏ Math.max. |
| 13 | 11/11 — Lịch sử khách báo lỗi | HistoryPanel không gọi API khi guest, có lời mời đăng nhập. | Đã có sửa FE; không cần BE mở history cho khách. |
| 14 | 11/11 — Khách báo lỗi nghĩa gặp thiếu access token | ReportGlossDialog chặn mở bằng requireLogin. | Đã có sửa FE; BE giữ auth guard. |
| 15 | 11/11 — Dịch auto kẹt bước riêng tư | On-device có timeout, privacy flow đã đổi. Bản mới còn có fetch timeout 6 giây/engine. Chưa chạy browser để chứng minh nhánh auto lần đầu hết lỗi. | FE nghiệm thu; không có căn cứ chuyển bug này sang BE translation. |
| 16 | 11/11 — Quiz im lặng sau khoảng 30 giây | Dialog hiện lỗi inline theo code, API create timeout 120s. Tối thiểu 3 từ FE vẫn sai như #6. BE đã precheck trước quota/provider. | FE đồng bộ #6; nếu vẫn chậm phải lấy payload/timing/version, không thêm precheck trùng. |
| 17 | 06/11 — Đếm tin nhắn AI sai | FE chatUserMessageCount chia message_count cho 2 để đếm số tin người dùng. BE tăng 2 và lưu cặp user/assistant trong transaction, nên cách này có cơ sở nếu nhãn muốn nói lượt gửi. | Chốt nhãn số lượt gửi hay tổng tin. Không gọi là BE đếm sai nếu API đang trả tổng tin đúng. Chưa đối soát dữ liệu lịch sử. |
| 18 | 06/11 — Nút sao chép AI | ChatBubble có copy + đổi icon. | Đã có sửa FE, chỉ cần nghiệm thu. |

## 2. FE đang xử lý tạm phần thuộc BE

1. **Romaji n:** `src/lib/romaji-n.ts`, `src/api/dictionary.ts`. FE gọi thêm query có nháy rồi gộp. Query phụ cố ý không token để không ghi lịch sử, vì thế không áp scope. Filter lang_code=ja không kiểm profile EN-only. Cursor chỉ giữ query gốc nên phần kết quả phụ không phân trang đầy đủ. Sửa gốc ở BE: tạo variants trong một truy vấn/luồng ranking/scope/cursor, ghi history một lần; FE bỏ hai request/gộp sau rollout. Bản vá FE cần ngừng bỏ auth ngay khi đồng bộ.
2. **Contract reverse:** `src/api/dictionary.ts` có snakeKeys đổi lexemeId/senseHint/viaLexemeId thành snake_case. BE runtime camelCase, DTO Swagger snake_case. Đây là lỗi contract BE cần thống nhất (M12-A06). Giữ adapter FE trong giai đoạn chuyển tiếp, chỉ bỏ khi BE rollout và kiểm tương thích.
3. **Trạng thái Đã lưu:** FE tự giữ localStorage vì thiếu membership API. BE bổ sung nguồn đúng theo user/scope; FE vẫn phụ trách UI/cache/invalidate.
4. **Sources chậm:** FE giữ snapshot trên máy chỉ cải thiện lượt quay lại. BE sửa cold refresh/concurrency và đo truy vấn.
5. **Đã ôn hôm nay:** FE chọn số lớn nhất để che lệch định nghĩa. Đây không phải phép cộng đúng; hai bên phải chốt metric. BE không đổi reviews_today vì field dùng quota.

## 3. Những việc còn cần sửa sau khi gộp report 12/11

### BE ưu tiên

- M12-A11: gộp refresh sources, TTL sau hoàn tất, đo cold aggregate; không nói thiếu cache vì đã có 10 phút/warmup.
- M12-A12 + dữ liệu: reverse chọn representative đúng trước dedup; kiểm assertion nước/of/水 và ranking EN riêng.
- M12-A06: thống nhất response reverse với OpenAPI; FE đang có adapter.
- M4: tìm VI không dấu, romaji variants cùng scope/cursor/history; rà lexeme chỉ là mục romanization thay vì loại mọi chữ Latin/unknown.
- M4/M5: membership đã lưu theo user, batch/projection dữ liệu collection để giảm N+1.
- M12/ops: xác minh IP client qua Cloudflare/rate limit và headers/cache dữ liệu riêng.

### FE ưu tiên

- **Cache account/profile chưa sửa đủ:** account-reset xóa langoo-api, nhưng coi mọi dictionary query trừ history là public. Trong khi dictionary trả theo profile và query keys thiếu user/profile. Nó giữ search/sense cache lúc logout/login. langoo-dict SW cache cũng không bị xóa khi đổi account/profile; useScopeReset chỉ xóa RAM. Cần tách cache theo scope hoặc bỏ cache các response scoped, xóa cache cũ và kiểm race request đang chạy khi đổi tài khoản. Đây là kết luận source/probe, chưa phải tái hiện lộ dữ liệu riêng qua browser. Cache riêng collection/chat đã có bước dọn mới; không kết luận bản mới hoàn toàn chưa xử lý A1.
- Quiz: bỏ chặn cố định 3 từ, giải thích matching và số nguồn hợp lệ; item_count chỉ để gợi ý, BE vẫn quyết định cuối.
- Thống kê: bỏ Math.max khác nghĩa, thống nhất trang hồ sơ và học tập, phân biệt toàn user với profile và SRS với quiz.
- Thông báo lỗi: friendlyMessage xử lý auth/framework, nhưng trả serverMessage trước xét 429/5xx, nên câu Việt của BE vẫn hiện trên giao diện EN. Chỉ giữ message domain đã biết; 429/5xx phải map trước. Đây là sửa FE, i18n BE có thể bổ sung sau.
- Lưu 1 chạm: lọc sổ theo profile/language hoặc giải thích lỗi; fallback sổ đầu không bảo đảm phù hợp, hiện catch mở dialog có thể trông như nút 1 chạm hoạt động thất thường. Kiểm cả lookup bôi đen và onboarding.
- Các item trước đã có code mới: A5 privacy intro, logo WebP, cache assets Vercel, model prefetch chuyển worker, timeout dịch, pending save, session-expired toast, không retry 4xx, overview khi lỗi không hiện 0. Cần nghiệm thu thay vì giao viết lại. Không khẳng định các thay đổi đó đã deploy FE.
- Autofill form và các script e2e cũ cần kiểm riêng; archive main không có e2e scripts của báo cáo. Không coi chưa thấy scripts trong archive là scripts đã sửa/xóa.

### Chưa làm hoặc không đổi theo báo cáo hiện tại

- Không bỏ scope M6.2 chỉ vì khách tra EN nhiều hơn profile JA; cần quyết sản phẩm. Không bỏ guard auth history/gloss-report.
- Không thay reviews_today thành mọi lượt học; không ép items_learned thành số đã lưu.
- Không áp luật quiz 3 từ, không thêm precheck trùng; mixed allocation M12-A07 vẫn là lỗi khác.
- Dịch chính thức qua BE là tính năng mới cần provider/ngân sách/notice, không phải cách bắt buộc sửa treo FE.
- Không đóng issue chỉ vì DB resolved. 18 mục không có ghi chú nghiệm thu/commit ở admin_note nên chưa truy được bằng chính record ai sửa và kiểm gì.

## 4. Kiểm chứng local không sửa source

- Đọc/execute TypeScript FE bằng typescript.transpileModule + vm, mock boundary:
  - quizCountOptions(2) → []; (3) → [3]; (5) → [5].
  - clearAccountData: predicate không remove dictionary search/sense; remove history/me-stats; caches.delete chỉ gọi langoo-api.
  - searchWithRomajiVariant với original=[] và variant JA mock → trả JA dù không có profile check, next_cursor=null dù variant còn cursor. Đây là mock helper, không dùng tài khoản thật để test bypass.
- Gọi buildQuizQuestions BE thật với cat/mèo và dog/chó, multiple_choice questionCount=2 → tạo 2 câu, không gọi provider/DB. Xác nhận FE chặn một trường hợp BE cho phép.
- 7 suites/94 tests PASS là kết quả lượt review trước trong cùng phiên; không chạy lại full test hoặc browser trong lượt này.
- Kiểm git diff --check và working tree ở bàn giao; không sửa code/report/PROGRESS trong repo FE/BE. Lượt kiểm tra chỉ đọc chỉ tạo metadata fetch FE và snapshot/report tạm ngoài repo. Lượt lập plan tiếp theo lưu bản review này, plan/handoff và entry PROGRESS, không sửa runtime.
