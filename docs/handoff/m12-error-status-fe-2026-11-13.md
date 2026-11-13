# M12-A20 — Mã lỗi và HTTP status để FE map theo locale

Ngày 13/11/2026. Đối chiếu source BE `4df8655` và lượt A19 tiếp nối (không đổi
mã/status). FE tra `code` trước nhánh chung cho status; dùng câu VI/EN của app,
không cần hiển thị nguyên message BE. Lỗi không biết vẫn dùng fallback an toàn.

## Các mã FE hỏi

| Code | HTTP | Hành vi FE / ý nghĩa |
|---|---|---|
| SRS_DAILY_LIMIT_REACHED | **409** | Đã đạt quota học mới/ôn của profile hôm nay; hiển thị giới hạn ngày, không nói thao tác quá nhanh. Không tự retry cùng rating |
| AUTH_SERVICE_UNAVAILABLE | **503** | Không kiểm tra được phiên đăng nhập do DB lỗi; giữ trạng thái chưa xác minh, cho thử lại. Không tự logout/xóa token như401 |
| PRIVACY_UNAVAILABLE | **503** | Chưa đọc/xác nhận được consent; không coi là đã đồng ý hoặc từ chối. Chặn hành động cần consent, cho tải lại |
| COLLECTION_READ_UNAVAILABLE | **503** | Chưa đọc được membership/display; giữ trạng thái không rõ/lỗi. Không đổi thành chưa lưu, không dùng mảng rỗng giả |
| DICTIONARY_SEARCH_TIMEOUT | **504** | Truy vấn vượt thời gian; gợi ý nhập rõ hơn/thêm ký tự hoặc thử lại. Không tự lặp liên tục cùng query |
| DB_UNAVAILABLE | **503** | Health endpoint không kết nối được DB; thông báo hệ thống tạm gián đoạn. Không phải mọi lỗi DB trên mọi route đều mang code này |
| RATE_LIMITED | **429** | Quá nhiều request trong cửa sổ thời gian. Cho chờ, tôn trọng Retry-After nếu có; không retry mutation tự động |

Nguồn: [SRS](../../src/srs/srs.service.ts), [session](../../src/sessions/sessions.service.ts),
[JWT guard](../../src/auth/guards/jwt-auth.guard.ts), [privacy](../../src/privacy/privacy.service.ts),
[membership](../../src/collections/saved-senses.service.ts), [items](../../src/collections/items.service.ts),
[search](../../src/dictionary/repositories/dictionary-search.repository.ts),
[health](../../src/health/health.service.ts), [global filter](../../src/common/filters/all-exceptions.filter.ts).

## Các mã 429/5xx nghiệp vụ khác

Đã quét AST các chỗ tạo DomainException toàn src (bỏ generated/test), rà status
số/HttpException, global filter và nhánh SSE. Danh sách theo source hiện tại:

| Code | HTTP | Hành vi FE / chi tiết |
|---|---|---|
| AI_QUOTA_EXCEEDED | **429** | Hết lượt AI hôm nay, không phải bấm nhanh; `details.limit` là giới hạn. Quota tính riêng feature chat/quiz |
| QUIZ_GENERATION_COOLDOWN | **429** | Chờ giữa hai lần tạo quiz; `details.retry_after_s` dùng cho countdown. Không tự gửi lại POST khi đếm xong; cho người dùng bấm |
| AI_PROVIDER_UNAVAILABLE | **503** | Chat/quiz tạm không hoạt động hoặc chuẩn bị quiz timeout. Có thể thử lại thủ công; không hứa request chưa tạo gì nếu chưa kiểm trạng thái |
| AUTH_OAUTH_NOT_CONFIGURED | **503** | Đăng nhập Google chưa khả dụng theo cấu hình; hiện lựa chọn khác hoặc thông báo phù hợp. Không báo sai mật khẩu |
| AUTH_OAUTH_PROVIDER_UNAVAILABLE | **503** | Dịch vụ xác minh Google/network tạm lỗi; cho thử lại. Khác token Google không hợp lệ401 |
| STORAGE_UNAVAILABLE | **503** | Không lưu được ảnh đính kèm feedback; giữ nội dung đang soạn và ảnh để người dùng thử lại. Không báo gửi thành công |
| SERVICE_UNAVAILABLE | **503** | Fallback HttpException503 không có domain code: lỗi dịch vụ chung |
| INTERNAL_ERROR | **500**, hoặc **5xx** chưa có mapping riêng | Lỗi không được bắt có cấu trúc hoặc fallback statusToCode; dùng thông báo hệ thống chung. Không hiển thị raw message, không tự retry POST |

Nguồn: [AI usage](../../src/ai/usage/ai-usage.service.ts),
[quiz cooldown/provider](../../src/ai/quiz/quiz.service.ts), [chat](../../src/ai/chat/chat.service.ts),
[Google verifier](../../src/auth/oauth/google-id-token.verifier.ts),
[Google challenge](../../src/auth/oauth/google-oauth-challenge.service.ts),
[feedback storage](../../src/feedback/feedback.service.ts), [global filter](../../src/common/filters/all-exceptions.filter.ts).

Các lỗi tại Cloudflare/Caddy có thể trả HTML/không có JSON code; giữ fallback
HTTP/network. Không gán code nghiệp vụ cho response edge không có code đó.

## Đính chính các tên FE đang map

- `AI_DAILY_REQUEST_LIMIT` và `AI_QUIZ_DAILY_LIMIT` là **tên ENV giới hạn**,
  không phải code response ở BE hiện tại. Cả chat/quiz hết quota trả429
  `AI_QUOTA_EXCEEDED`. Có thể giữ mapping cũ để tương thích nhưng không dựa vào
  hai tên ENV này để nhận biết quota.
- `AUTH_INVALID_CREDENTIALS`=401, `AUTH_EMAIL_TAKEN`=409,
  `AUTH_ACCOUNT_LOCKED`=403; không thuộc nhóm429/5xx.
- `SRS_DAILY_LIMIT_REACHED`=409 trên cả SRS review và rating trong study session.
  `QUIZ_NOT_ENOUGH_ITEMS`=409 cũng giữ inline available/required như FE đã làm.

## SSE và retry

Chat stream lỗi trước khi mở stream có thể trả HTTP JSON theo bảng. Sau khi đã
mở stream, HTTP vẫn200; FE phải xử lý `event:error` theo payload code, gồm
AI_PROVIDER_UNAVAILABLE, CHAT_STREAM_FAILED hoặc domain code khi persist lỗi.
Không chỉ dựa vào interceptor status để dịch lỗi SSE; không tự replay lượt chat
khi đã nhận delta. CHAT_STREAM_FAILED là code event, không có status5xx riêng.

Không thay status/mã BE chỉ để phù hợp nhánh fallback UI. Khi thêm code nghiệp vụ
mới có ý nghĩa riêng, đồng bộ bảng này cùng contract/handoff.
