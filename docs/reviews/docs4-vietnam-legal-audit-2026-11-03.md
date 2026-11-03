# DOCS4 — Audit pháp lý website Langoo theo luật Việt Nam

Ngày rà soát: **03/11/2026**. Đối tượng: `https://langoo.org`, backend checkout `5404220df40ff386459d7c57c31a962677e5a337` và frontend local `3f7d325122ca9f84e44475d7eea1a1f6e311e723` (chỉ đọc). [Kế hoạch](../plans/docs4-vietnam-legal-audit-2026-11-03.md), [bằng chứng trích xuất](docs4-vietnam-legal-audit-2026-11-03/evidence.md), [URL/hash/HTTP](docs4-vietnam-legal-audit-2026-11-03/evidence.json).

Đã bổ sung [handoff khắc phục BE/FE/vận hành](../handoff/docs4-legal-remediation-be-fe-2026-11-03.md): phân công, contract đề xuất, rollout và QA; đây là trạng thái tại thời điểm audit. Sau đó đã triển khai phần BE [M12.1](m12.1-privacy-controls-2026-11-03.md), có [handoff FE hiện hành](../handoff/m12.1-privacy-fe-2026-11-03.md); các gate pháp lý/FE còn mở được ghi riêng.

**Kết quả:** 3 nhóm 🔴 cần xử lý ngay, 7 nhóm 🟡 cần cải thiện/xác minh và 3 nhóm 🟢 có bằng chứng đáp ứng một phần. Đây là đánh giá khoảng trống tuân thủ, không kết luận website vi phạm hoặc hoàn toàn tuân thủ pháp luật. Các mục chưa có hồ sơ được ghi riêng với lỗi quan sát được.

## 1. Phân loại và phạm vi

Đã chạy `bash .vn-law-check/scripts/scan.sh .`: `LEVEL=3 AI=yes FOREIGN_HOST=yes APP=no`. Rà thủ công xác định nền tảng học ngoại ngữ có tài khoản, lịch sử học, chat/quiz AI, dịch văn bản, PDF và góp ý có ảnh. Mức 3 được dùng để chọn độ sâu audit, **không phải kết luận pháp lý về quy mô lớn**.

Script bắt nhầm `COMMERCE`, `MARKETPLACE`, `PERMISSIONS` và SDK từ dữ liệu từ điển, báo cáo và backup trong `uploads/`. Không dùng các kết quả này để gọi Langoo là sàn, website thanh toán hay mobile app. Phạm vi là website/PWA; repo `LanGoo_mobile` không được audit trong lượt này.

Frontend production mới hơn local: bundle chính `index-B55iaWwM.js` nạp `LegalArticle-puk0jdG5.js`, có chính sách và điều khoản hiệu lực 03/11/2026. Vì vậy **không ghi finding thiếu trang pháp lý** dựa vào frontend local. HTTP 200 của `/privacy` và `/terms` chỉ trả SPA shell; nội dung được kiểm từ chunk JS, chưa kiểm render bằng browser.

Áp dụng: dữ liệu cá nhân, AI, an ninh mạng; điều khoản/quyền người dùng. ⚪ Chưa thấy bán hàng/đặt hàng/thu phí, sàn bên thứ ba, livestream/affiliate, quảng cáo trả tiền hoặc ký số/chứng thực: chưa có căn cứ yêu cầu logo Bộ Công Thương, quy trình hoàn tiền, đăng ký sàn hay giấy phép dịch vụ tin cậy. Nếu bổ sung thương mại, phải phân loại lại theo Luật 122/2025/QH15; dịch vụ miễn phí không tự động loại trừ mọi nghĩa vụ dữ liệu hoặc bảo vệ người tiêu dùng.

## 2. Căn cứ được đối chiếu

| Mã | Văn bản, hiệu lực và nguồn |
|---|---|
| L1 | [Luật 91/2025/QH15](https://vanban.chinhphu.vn/?docid=214590&pageid=27160), ban hành 26/06/2025, hiệu lực 01/01/2026. Đọc trực tiếp [PDF ký số](https://datafiles.chinhphu.vn/cpp/files/vbpq/2025/7/91qh.signed.pdf), trang 6, 11–14, 22–23. |
| L2 | [NĐ 356/2025/NĐ-CP](https://vanban.chinhphu.vn/?pageid=27160&docid=216387), ban hành 31/12/2025, hiệu lực 01/01/2026. Đọc trực tiếp [PDF](https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/01/356-nd.signed.pdf), trang 3–6: quyền dữ liệu và phương thức đồng ý. |
| L3 | [Luật Trẻ em 102/2016/QH13](https://vanban.chinhphu.vn/?docid=184566&pageid=27160), ban hành 05/04/2016, hiệu lực 01/06/2017; Điều 1: trẻ em là người dưới 16 tuổi. |
| L4 | [Luật AI 134/2025/QH15](https://vanban.chinhphu.vn/?docid=216334&pageid=27160), ban hành 10/12/2025, hiệu lực 01/03/2026; đọc Điều 11 tại trang 6 [PDF](https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/01/luat134.signed.pdf). [NĐ 142/2026/NĐ-CP](https://chinhphu.vn/?classid=1&docid=218029&pageid=27160), ban hành 30/04/2026, hiệu lực 01/05/2026; chi tiết phân loại/thông báo cần đối chiếu thêm khi triển khai. |
| L5 | [Luật An ninh mạng 116/2025/QH15](https://vanban.chinhphu.vn/?docid=216499&pageid=27160), ban hành 10/12/2025, hiệu lực 01/07/2026; [NĐ 333/2026/NĐ-CP](https://chinhphu.vn/?docid=219244&pageid=27160), ban hành và hiệu lực 19/08/2026. Đã xác minh thuộc tính văn bản; chưa đọc đủ toàn văn để kết luận nghĩa vụ lưu log/nội địa hóa cụ thể. |
| L6 | [Luật 19/2023/QH15](https://vanban.chinhphu.vn/?docid=208363&pageid=27160), ban hành 20/06/2023, hiệu lực 01/07/2024; Điều 25 và 31 trong [PDF](https://datafiles.chinhphu.vn/cpp/files/vbpq/2023/7/luat19_2023.pdf). Cần kiểm bản hợp nhất/sửa đổi hiện hành trước dùng làm ý kiến pháp lý cuối cùng. |
| L7 | [Luật TMĐT 122/2025/QH15](https://vanban.chinhphu.vn/?pageid=27160&docid=216503), ban hành 10/12/2025, hiệu lực 01/07/2026. Chỉ dùng cho gate phân loại khi có hoạt động thương mại. |
| L8 | [NĐ 330/2026/NĐ-CP](https://vanban.chinhphu.vn/?docid=219266&pageid=27160), ban hành 19/08/2026; không dùng số tiền phạt cụ thể vì chưa đối chiếu đầy đủ điều khoản và đối tượng áp dụng. |

**Hiệu chỉnh căn cứ của checklist:** `00-triage.md` và checklist 01 đang gọi miễn trừ doanh nghiệp nhỏ là Điều 39 và cho rằng miễn cả hồ sơ chuyển xuyên biên giới. Bản ký số L1 cho thấy **Điều 38 khoản 2–3** dẫn Điều 21, Điều 22 và khoản 2 Điều 33; không dẫn Điều 20. Điều 39 là chuyển tiếp. Không suy diễn miễn hồ sơ chuyển xuyên biên giới từ quy mô nhỏ; phải đối chiếu Điều 20 khoản 6 và quy định chi tiết. Chưa có bằng chứng về loại hình pháp nhân/quy mô của Langoo. Báo cáo này ưu tiên bản luật gốc, chưa sửa bộ checklist hoặc các bản copy của người dùng.

## 3. 🔴 Cần xử lý ngay

### R1 — Chưa có cơ chế đồng ý có thể kiểm chứng theo mục đích

- **Bằng chứng:** chunk đăng ký production `index-CZbZy3Cv.js` chỉ có tên/email/mật khẩu/xác nhận mật khẩu, gửi payload không có phiên bản thông báo hoặc sự kiện đồng ý. `src/auth/dto/register.dto.ts:14`, `src/auth/auth.service.ts:48`, `src/auth/dto/google-login.dto.ts:15` và model `User` tại `prisma/schema.prisma:29` không cho thấy consent ledger. Điều khoản production phần mở đầu gộp sử dụng dịch vụ với chấp nhận điều khoản/chính sách.
- **Khoảng trống:** có chính sách công khai chưa chứng minh người dùng đã được thông báo và đồng ý rõ ràng với từng mục đích. Chưa thấy căn cứ thay thế được ghi nhận cho từng xử lý. Không kết luận mọi xử lý đều bắt buộc checkbox: Điều 19 L1 có trường hợp không cần đồng ý, phải xác định và chứng minh riêng.
- **Căn cứ:** Điều 9 khoản 2–4 L1; Điều 6 khoản 1–4 L2: nhận biết chủ thể, thời điểm, nội dung, lưu bằng chứng, không mặc định đồng ý; thông báo khi xử lý dữ liệu nhạy cảm.
- **Khắc phục/đóng gate:** lập danh mục mục đích/căn cứ; thông báo tại đăng ký email và Google; khi cần consent thì ghi purpose, policy version, timestamp và thao tác xác nhận, hỗ trợ rút lại. AI/dịch/analytics có mục đích riêng cần xử lý tương ứng. Kiểm request không thể bỏ qua gate đã thiết kế; không coi đăng nhập Google là sự đồng ý cho mọi xử lý của Langoo.

### R2 — Cam kết xóa 30 ngày chưa phù hợp thời hạn cơ bản; quyền dữ liệu chưa đầy đủ

- **Bằng chứng:** `/privacy`, mục 7 hẹn xác nhận và xóa trong 30 ngày, backup ở chu kỳ tiếp theo; mục 8 mới nêu xem/sửa/bản sao/xóa và thu hồi Google. Chưa nêu rõ rút đồng ý với Langoo, hạn chế/phản đối xử lý, thủ tục và thời hạn từng quyền.
- **Căn cứ:** Điều 4, 10 L1; Điều 5 khoản 1–4 L2. Bản gốc quy định phản hồi **02 ngày làm việc**; xem/sửa/cung cấp **10 ngày**; rút đồng ý/hạn chế/phản đối **15 ngày**; xóa **20 ngày**. Trường hợp yêu cầu bên xử lý/bên thứ ba thực hiện có mốc riêng, ví dụ xóa 30 ngày; được gia hạn có điều kiện, lý do và thông báo. Không lấy ngoại lệ 30 ngày làm cam kết mặc định cho toàn bộ yêu cầu.
- **Khắc phục/đóng gate:** cập nhật hai ngôn ngữ, công bố thủ tục xác minh danh tính và SLA; dùng email hiện có làm đầu mối, có sổ theo dõi và người chịu trách nhiệm. Email thủ công có thể là cách thực hiện hợp lệ; không bắt buộc phải có nút xóa tự động. Diễn tập yêu cầu giả lập, bao gồm bản sao lưu và nhà cung cấp.

### R3 — Ngưỡng 13 tuổi bỏ sót người dùng 13–15 tuổi và chưa có luồng người đại diện

- **Bằng chứng:** `/terms` mục 2 cho phép từ 13 tuổi; `/privacy` mục 9 chỉ loại trẻ dưới 13. Form/payload đăng ký production không có bước phân nhóm tuổi; DTO và schema tài khoản không thể hiện đại diện/ghi nhận chấp thuận.
- **Căn cứ:** Điều 1 L3; Điều 24 L1. Người đại diện thực hiện quyền của trẻ; việc công bố/tiết lộ đời sống riêng tư, bí mật cá nhân của trẻ từ đủ 7 tuổi cần sự đồng ý của trẻ và người đại diện. Không diễn giải điều này thành yêu cầu đồng ý kép cho mọi thao tác học tập.
- **Khắc phục/đóng gate:** chọn và công bố phạm vi tuổi phù hợp; nếu phục vụ dưới 16 thì thiết kế luồng người đại diện/quyền dữ liệu và kiểm soát công bố/chia sẻ. Nếu hạn chế từ 16 tuổi thì áp dụng nhất quán cả Google và email. Kiểm nhóm dưới 13, 13–15 và từ 16; tránh thu giấy tờ/ngày sinh chi tiết vượt nhu cầu.

## 4. 🟡 Nên cải thiện hoặc cần hồ sơ xác minh

### Y1 — Danh tính bên chịu trách nhiệm dữ liệu còn mơ hồ

Production chỉ ghi “Nhóm phát triển Langoo” và email liên hệ. Cần xác định cá nhân/tổ chức chịu trách nhiệm, kênh thực hiện quyền và vai trò controller/processor; không mặc định dự án miễn phí phải thành lập doanh nghiệp. Căn cứ: Điều 9 khoản 2 điểm b L1. Đóng gate bằng thông tin chủ thể xác thực và chính sách đồng bộ.

### Y2 — Quy trình xóa thực tế, retention và backup chưa chứng minh đủ

`src/users/profile.controller.ts:92` chỉ xóa hồ sơ học; `src/ai/chat/chat.service.ts:226` archive chat bằng timestamp. `src/common/scheduler/jobs/chat-retention.job.ts:18` xóa phiên không hoạt động sau mặc định 180 ngày và cho phép tắt; cleanup lịch sử tra chỉ giữ 50 dòng/user (`search-history-cleanup.job.ts:5`). Chính sách chỉ nói lưu khi tài khoản còn hoạt động. Chưa có runbook xóa toàn bộ tài khoản/xuất dữ liệu; không đồng nghĩa tác vụ thủ công chưa tồn tại. Cascade DB không tự xóa file đĩa của `FeedbackAttachment` (`prisma/schema.prisma:746`, `src/storage/local-storage.service.ts:35`). Căn cứ: Điều 4, 10 L1; Điều 5 L2. Cần ma trận retention cho DB, ảnh, cache, log, backup và vendor; kiểm trên dữ liệu giả lập, gồm xử lý phục hồi backup tránh tái xuất hiện dữ liệu đã xóa.

### Y3 — Chuyển dữ liệu và thỏa thuận nhà cung cấp cần xác minh

Chính sách nêu Vercel, VPS, Groq, Google Translate/MyMemory. Code gửi nội dung/history và ảnh lượt hiện tại tới provider (`src/ai/chat/chat.service.ts:595`, `src/ai/providers/openai-chat.provider.ts:252`); factory hỗ trợ base URL tùy ENV, nên tên adapter `openai` không chứng minh production dùng OpenAI. Chưa đọc ENV bí mật hoặc khẳng định runtime Groq đã được xác minh. Căn cứ: Điều 20–22, 37 L1 và Điều 7 L2. Cần bản đồ dữ liệu/địa điểm/subprocessor, retention/training và hợp đồng, hồ sơ đánh giá tác động/biên nhận hoặc căn cứ miễn cụ thể. Tách việc người dùng tự chuyển dữ liệu ở Điều 20 khoản 6 điểm c khỏi việc Langoo chuyển chat server-side. Đây là gate hồ sơ chưa kiểm, không phải kết luận chưa nộp hồ sơ.

### Y4 — Cam kết PDF local cần làm rõ việc tra/dịch đoạn được chọn

Policy nói file PDF không tải lên máy chủ của Langoo; landing còn có thông điệp tệp không rời thiết bị. Bundle chính vẫn có fallback gửi văn bản qua URL query tới Google/MyMemory. Frontend local `src/components/lookup/LookupTooltip.tsx:77` và `src/hooks/use-lookup.ts:66` kích hoạt dịch khi tra chính xác không có kết quả; `src/lib/translate.ts:347` tự chuyển từ on-device sang mạng. Policy mục 5 đã nêu dịch bên thứ ba, nên không kết luận giấu toàn bộ việc chia sẻ; cần cảnh báo đúng ngay khi bôi đen/tra PDF và cho chọn chỉ xử lý local. Căn cứ: Điều 9, 20 L1. Chưa tái hiện fallback PDF production bằng browser/network; cần kiểm với văn bản giả lập, không dùng tài liệu cá nhân.

### Y5 — Analytics không cookie cần kiểm payload, không áp máy móc banner

Production có Vercel Analytics và endpoint script HTTP 200; local `src/App.tsx:27` nạp `<Analytics />` không điều kiện. Chính sách đã khai báo thống kê không cookie. [Tài liệu Vercel](https://vercel.com/docs/analytics/privacy-policy) cho phép cấu hình để tránh thông tin cá nhân trong pageview/custom event. Chưa bắt network để xác nhận URL/query/referrer thực tế, chưa thấy Google Analytics trong HTML hiện tại; dấu GA của scanner đến từ artifact cũ. Căn cứ: Điều 9 L1, Điều 4 L2 khi có dữ liệu theo dõi hành vi cá nhân. Cần kiểm payload/scrub query và đánh giá căn cứ xử lý trước quyết định consent; không kết luận thiếu banner đồng nghĩa vi phạm, không bắt consent cho mọi cookie thiết yếu.

### Y6 — Điều khoản thay đổi dịch vụ, miễn trách nhiệm và khiếu nại cần rà pháp lý

`/terms` mục 1, 7, 9 cho thay đổi/dừng dịch vụ, giới hạn trách nhiệm và coi dùng tiếp là chấp nhận thay đổi. Mục 7 có điều kiện “trong phạm vi pháp luật cho phép”, vì vậy chưa đủ cơ sở gọi toàn điều khoản vô hiệu. Email góp ý đã có, nhưng chưa thấy quy trình khiếu nại/thời hạn rõ ràng. Căn cứ: Điều 25, 31 L6 **nếu thuộc tổ chức/cá nhân kinh doanh**; Điều 31 có ngoại lệ công khai quy trình cho một số chủ thể nhỏ. Luật sư cần chốt tư cách hoạt động và quyền chấm dứt, thông báo thay đổi, quyền khiếu nại/bồi thường bắt buộc. Không suy ra miễn phí thì được loại hết trách nhiệm.

### Y7 — Hồ sơ vận hành, sự cố và phân loại AI còn thiếu gate

`docs/ops/vps-deployment.md` mô tả DB/VPS, backup và PM2; chưa đủ bằng chứng vị trí địa lý, retention log, diễn tập sự cố và phân công bảo vệ dữ liệu. Căn cứ: Điều 23, 33, 38 L1; L5; Điều 9–12 L4. Cần người chịu trách nhiệm, quy trình đánh giá sự cố và thông báo 72 giờ **khi đủ điều kiện Điều 23**, vendor escalation, hồ sơ phân loại AI theo vai trò và chức năng thực tế. Không tự coi mọi chatbot giáo dục là AI rủi ro cao; chưa kiểm danh mục/ngoại lệ/chuyển tiếp để yêu cầu chứng nhận. Không mặc định mọi doanh nghiệp phải lưu mọi log 12 tháng hoặc chuyển toàn bộ DB vào Việt Nam; xác định đối tượng và điều khoản L5 trước. Chưa có chứng cứ sự cố/rò rỉ trong lượt audit.

## 5. 🟢 Có bằng chứng đáp ứng một phần

1. **Minh bạch cơ bản:** có policy/terms tiếng Việt và tiếng Anh, ngày hiệu lực, email quyền dữ liệu, danh mục dữ liệu và bên nhận. Phù hợp hướng minh bạch tại Điều 9 L1, còn thiếu R1/R2/Y1.
2. **Nhận diện AI:** UI/i18n và bundle ghi “Trợ lý AI”; terms mục 5 cảnh báo câu trả lời/quiz/dịch có thể sai. Đáp ứng một phần Điều 11 L4, chưa đánh giá mọi ảnh AI/metadata hoặc phân loại hệ thống.
3. **Biện pháp kỹ thuật có cơ sở:** HTTPS/HSTS, nosniff và SAMEORIGIN quan sát ở frontend; backend có argon2id (`src/auth/auth.service.ts:281`), redaction body/token (`src/app.module.ts:63`), guard chat (`src/ai/chat/chat.controller.ts:45`) và ảnh chat không lưu vào lịch sử lâu dài (`chat.service.ts:603`, `:666`). Đây là bằng chứng hỗ trợ bảo vệ dữ liệu theo L1/L2; không phải kiểm thử xâm nhập hoặc nghiệm thu toàn production.

## 6. Thứ tự xử lý và kiểm chứng

| Ưu tiên | Đầu ra cần có | Tiêu chí bàn giao |
|---|---|---|
| Trước mở rộng người dùng | R1–R3, chủ thể chịu trách nhiệm Y1 | Policy/terms đồng bộ hai ngôn ngữ; consent/căn cứ theo mục đích; SLA quyền dữ liệu; luồng tuổi và đại diện được kiểm. |
| Tiếp theo | Y2–Y5 | Diễn tập xuất/xóa dữ liệu giả lập; ma trận retention; hồ sơ vendor/chuyển dữ liệu; bắt network PDF/dịch/analytics; không dùng dữ liệu thật. |
| Gate vận hành | Y6–Y7 | Luật sư rà điều khoản/tư cách; hồ sơ sự cố, nhân sự và phân loại AI; xác định đúng nghĩa vụ an ninh mạng. |

Không đưa mức phạt cụ thể: chưa xác định đầy đủ chủ thể, hành vi, ngoại lệ và điều khoản xử phạt hiện hành. NĐ 330/2026 không được dùng để suy ra website chắc chắn bị phạt.

**Kiểm tra thực hiện:** quét source theo script; đọc code/schema/tài liệu và chunk production; tải HTTP trang công khai/script analytics; đối chiếu thuộc tính luật trên Cổng Chính phủ, đọc bản scan ký số các trang nêu ở mục 2. API công khai `/v1/health` và `/v1/sources` trả 403 từ đường truy cập audit: chưa kiểm được runtime API/license qua hai endpoint này. Không coi 403 là lỗ hổng. Chưa chạy browser E2E, đăng ký, gửi AI, gọi DB hay gửi email thử quyền dữ liệu. Không chạy unit/build vì chỉ thêm tài liệu.

**Git/triển khai:** báo cáo, plan và evidence lưu local, chưa commit/push/deploy; `PROGRESS.md` được bổ sung dưới DOCS4. Giữ các WIP có sẵn và WIP xuất hiện từ phiên khác; không sửa code ứng dụng hoặc repo frontend. Kiểm tra link nội bộ và `git diff --check` được thực hiện ở bước bàn giao; kết quả ghi trong PROGRESS.

## Giới hạn & Khuyến nghị

Báo cáo là rà soát sơ bộ do AI hỗ trợ, không phải ý kiến tư vấn pháp lý chính thức. Chứng cứ chủ yếu là code, tài liệu và bundle công khai tại ngày audit; hồ sơ pháp nhân, căn cứ miễn, hợp đồng nhà cung cấp, biên nhận đánh giá tác động và cấu hình production chưa được cung cấp/kiểm đầy đủ. Xác minh văn bản còn hiệu lực và bản hợp nhất tại [vbpl.vn](https://vbpl.vn/) hoặc [Thư Viện Pháp Luật](https://thuvienphapluat.vn/) trước khi dựa vào báo cáo để quyết định. Tham vấn luật sư/chuyên gia bảo vệ dữ liệu cho kết luận cuối cùng, đặc biệt R1–R3 và hồ sơ chuyển dữ liệu.
