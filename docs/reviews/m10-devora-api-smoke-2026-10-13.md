# M10 — Kiểm tra thực tế API Devora

Ngày: **2026-10-13**. Phạm vi: kiểm key/model catalog và smoke inference giới hạn; không tích hợp runtime hoặc deploy. Key do chủ dự án cung cấp chỉ dùng trong bộ nhớ tiến trình, không lưu trong repo/report.

## Kết quả

| Kiểm tra | Kết quả | Thời gian |
|---|---|---|
| GET `https://api.devora.my.id/v1/models` | HTTP 200; có hai model do chủ dự án chỉ định | 0,944 giây |
| Space Bunny text | HTTP 403 `plan_required`: account STANDARD, model yêu cầu SUBSCRIPTION | 1,298 giây |
| DeepSeek V4.1 Flash text | HTTP 200; JSON hợp lệ, đúng 6/6 tình huống tổng hợp đơn giản | 67,120 giây |
| Space Bunny ảnh | Không chạy vì model đã từ chối quyền truy cập text | Chưa kiểm tra |

- Catalog authenticated: DeepSeek input/output 400/1.000 credits trên một triệu token; Space Bunny 0/0 nhưng vẫn yêu cầu plan qua inference. Như vậy giá token 0 không bảo đảm account STANDARD được dùng miễn phí.
- Chủ dự án cho phép **một lượt DeepSeek, tối đa 1 credit**. Request dùng `max_tokens=384`; ước tính bảo thủ trước gửi 0,8816 credit, dựa trên input UTF-8 bytes + framing reserve và giá catalog. Đây là giới hạn client theo giá niêm yết, không phải ngân sách tài khoản cưỡng chế phía provider.
- DeepSeek báo 311 prompt tokens, 308 completion tokens, tổng 619; `finish_reason=stop`. Giá quy đổi danh nghĩa **0,4324 credit**, dưới mức được phép. Response không có billing/cost field; chưa biết credit thực bị trừ hay event miễn phí đã áp dụng. Completion usage lớn hơn phần content hiển thị; response không cung cấp chi tiết reasoning để giải thích chênh lệch.
- Không retry inference, không bật nhiều luồng, không đổi Qwen/Muse, không gửi dữ liệu người học hoặc dữ liệu DB thật.

## Mẫu kiểm tra và giới hạn kết luận

Sáu tình huống tự soạn: ngân hàng tài chính/bờ sông; vẽ/kéo; nhà máy/thực vật; học sinh/giáo viên; một trường hợp không có candidate phù hợp. Expected answer được định trước khi gọi. JSON đáp ứng đủ key và lựa chọn đúng cả sáu.

Đây chỉ là smoke test; không dùng làm tỉ lệ chính xác DB4 hoặc bằng chứng auto-approve. Một request không đủ đánh giá throughput, concurrency, latency ổn định hoặc upstream identity. Thời gian trên là tới response đầy đủ với `stream=false`, không phải time to first token.

## File, kiểm tra và trạng thái

- Artifact đã loại secret: [JSON kết quả](m10-devora-api-smoke-2026-10-13.json).
- Phạm vi thay đổi: report này, artifact JSON, bổ sung khảo sát M10 và `PROGRESS.md`; không sửa code/config ứng dụng.
- Kiểm tra: parse JSON; đối chiếu content với expected 6/6 và exact keys; kiểm giá danh nghĩa dưới 1 credit; kiểm secret prefix, whitespace/diff và working tree. Không chạy build/unit test vì chỉ lưu artifact/docs.
- Gate còn thiếu: actual billing, event quota/dates, subscription terms, vision access, fixture DB4 thật và latency/concurrency lặp lại.
- Git/triển khai: chưa commit/chưa push; không deploy, không apply DB.

## Nhận định

DeepSeek gọi được và làm đúng mẫu đơn giản, nhưng lượt này mất hơn một phút. Chưa có bằng chứng nhanh hơn Muse hoặc phù hợp chat tương tác. Space Bunny chưa dùng được với plan hiện tại. Trước chạy lớn cần xác nhận miễn phí/budget thực và benchmark tập khó của DB4; không suy từ catalog marketing thành quyền sử dụng tài khoản.

## 2026-10-13 — M10 — Thử tiếp DeepSeek: streaming và prompt mới

Chủ dự án yêu cầu thử tiếp DeepSeek 4.1 Flash. Đợt mới giữ ngân sách danh nghĩa dưới 1 credit, không đổi cấu hình sản phẩm; key chỉ dùng trong bộ nhớ.

| Lượt | Điều kiện | Thời gian | Kết quả |
|---|---|---|---|
| Trước đó | 6 tình huống, nonstream, output cap 384 | 67,120 giây | JSON đúng 6/6; stop |
| Lặp prompt | Cùng 6 tình huống, stream, output cap 384 | First content 4,013 giây; tổng 4,016 giây | JSON đúng 6/6; stop; nhận DONE |
| Prompt mới | 3 tình huống EN, nonstream, output cap 256 | 65,933 giây | finish_reason=length; message chỉ có role, không có content; không có JSON để chấm |

- Lượt stream là `text/event-stream` nhưng chỉ có 2 JSON SSE chunk; content tới gần như một khối lúc header mở ở 4,013 giây. Không chứng minh generation được stream từng token hoặc streaming làm model nhanh hơn. Prompt lặp và chế độ stream thay đổi cùng lúc; không tách được hiệu ứng cache, queue, routing và chế độ response.
- Prompt mới chạm output cap; provider báo 256 completion token nhưng không có answer content/reasoning detail. Chưa biết nguyên nhân là reasoning dùng hết budget hay cách gateway trả output. Không coi đây là sai semantic; lượt này không có câu trả lời sử dụng được trong budget đã chọn.
- Usage lượt stream: 311 input + 272 completion = 583; giá danh nghĩa 0,3964 credit. Lượt fresh: 174 + 256 = 430; giá danh nghĩa 0,3256 credit. Đợt mới tổng **0,722 credit**; actual billing/event miễn phí chưa xác minh. Trước lượt fresh kiểm tổng giá danh nghĩa đã dùng + bound còn lại = 0,858 credit.
- Catalog được GET lại trước lượt stream và vẫn niêm yết 400/1.000 credits/M token input/output. Không retry sau length, không thêm luồng hoặc chạy DB thật.
- Artifacts: [stream repeat](m10-devora-stream-repeat-2026-10-13.json), [fresh nonstream](m10-devora-fresh-probe-2026-10-13.json).
- Nhận định: có lượt nhanh 4 giây, nhưng 2 lượt nonstream đều khoảng 66–67 giây; chưa đủ cơ sở coi provider nhanh/ổn định hoặc nghiệm thu DB4. Cần fixture thật và kiểm điều khiển reasoning/stream trước chạy lớn nếu triển khai tiếp.
- Kiểm tra: parse artifact; same prompt và expected; stream JSON 6/6, DONE/stop; fresh length và content vắng; usage/giá danh nghĩa tổng dưới 1; không secret và scoped diff/whitespace. Git: docs/artifacts chưa commit/chưa push; không deploy/apply DB.

### Test nhiều luồng sau khi được bỏ giới hạn credit/token

Xem [M10 — Devora 8 luồng](m10-devora-8workers-2026-10-13.md): 24 request trong 69,772 giây, 21 HTTP 200/3 HTTP 502. Retry ba lỗi bằng 3 luồng thành công trong 7,198 giây. Bỏ trường max_tokens; output hợp lệ đúng 144/144 lần quyết định sau retry trên 24 fixture đơn giản. Chưa phải gate DB4 hoặc kết luận 8 luồng tối ưu.

### Pilot dịch 100 từ Anh–Việt

Xem [M10 — Dịch 100 từ](m10-devora-en-vi-100-2026-10-13.md): đủ 100 bản dịch theo sense trong snapshot local; Codex review 86 pass/13 minor/1 major/0 severe quan sát được. API có nhiều 502/524 và default output 2.048 gây length; cần tăng budget/chia batch/retry để hoàn tất. Không seed/apply DB.
