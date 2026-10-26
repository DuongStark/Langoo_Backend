# M10 — DeepSeek 4.1 Flash qua Devora: 8 luồng, không đặt output token cap

Ngày: **2026-10-13**. Chủ dự án cho phép bỏ giới hạn credit/token và gọi nhiều luồng. Phạm vi: test API thực trên fixture tự soạn; không tích hợp Langoo, không chạy DB4 production hoặc đổi VPS. Key chỉ ở bộ nhớ, không lưu vào repo.

## Cách chạy

- Endpoint `https://api.devora.my.id/v1/chat/completions`, model `devora-01/deepseek/deepseek-v4.1-flash`.
- **8 worker / 24 request**, queue giữ tối đa 8 request phía client đang chờ; mỗi request 6 tình huống. Sau đợt chính, chỉ retry một lần 3 request HTTP 502 bằng **3 worker**.
- Payload: `temperature=0`, `stream=true`, `stream_options.include_usage=true`; **bỏ hẳn trường max_tokens**. Provider vẫn có default/giới hạn riêng; không gọi đây là context/output vô hạn.
- Không dùng reasoning_effort hay thinking option chưa được Devora xác nhận; không tự đổi model/fallback.
- Fixture: 24 source sense đơn giản tự soạn về ngân hàng/bờ sông, vẽ/kéo, nhà máy/thực vật, học sinh/giáo viên, đa nghĩa nhẹ/nặng/sáng, đồng hình tiếng Anh và 4 trường hợp không có candidate. Sáu item mỗi request, hoán vị candidate; seed `20261013 + index_zero_based`. Có diagnostic request ID khác nhau.
- Expected được xác định trước gọi, output chỉ cho ID → A/B/null; parse JSON, kiểm đủ key và enum rồi đối chiếu expected. Tổng 144 lần quyết định nhưng **chỉ 24 tình huống riêng biệt**, không phải 144 sense DB4 độc lập.
- Socket timeout 180 giây, đợt chính có kiểm deadline 240 giây khi đọc stream. Không auto-retry trong queue đợt chính; retry là pha riêng có artifact.

## Kết quả đợt chính

| Chỉ số | Kết quả |
|---|---:|
| Request / peak inflight client | 24 / 8 |
| Tổng thời gian pha API | **69,772 giây** |
| HTTP 200 | **21/24 (87,5%)** |
| HTTP 502 | **3/24**, request 8, 13, 23 |
| HTTP 429 / timeout quan sát được | **0 / 0** |
| JSON hợp lệ / finish_reason=stop | 21/21 lượt HTTP 200 |
| Quyết định đúng trong output hợp lệ | **126/126** |
| Request trả đáp án đúng đủ 6 item | 21/21 lượt HTTP 200 |
| Latency thành công: min / median / max | 2,494 / **11,026** / 38,092 giây |
| Latency mọi request, gồm lỗi: p50 / p95 | 11,034 / 38,090 giây |
| First answer content: median / p95 | 10,888 / 33,098 giây |
| Usage trả về, 21 request | 8.419 input + 5.015 completion token |
| Giá quy đổi danh nghĩa theo catalog | **8,3826 credits** |

502 body chỉ ghi `error code: 502`; chưa xác định gateway hay upstream, không suy ra đây là rate limit/concurrency cap. Median số chunk có answer content bằng 1: nhiều response tới thành một khối; streaming API không chứng minh model phát token trực tiếp tới client trong mọi lượt.

## Retry ba lỗi 502

| Request gốc | HTTP / JSON | Thời gian | Đúng |
|---|---|---:|---:|
| 13 | 200 / hợp lệ / stop | 3,043 giây | 6/6 |
| 23 | 200 / hợp lệ / stop | 3,119 giây | 6/6 |
| 8 | 200 / hợp lệ / stop | 7,183 giây | 6/6 |

- Pha retry 3 worker hoàn tất trong **7,198 giây**; không retry thêm.
- Sau một lần retry: **24/24 request logic có đáp án, đúng 144/144 lần quyết định** trên cùng 24 tình huống đơn giản. Tổng **27 HTTP inference attempt**, không xóa lỗi của pha đầu khỏi tỷ lệ thành công.
- Usage retry: 1.199 input + 1.095 completion; danh nghĩa 1,5746 credits.
- Tổng usage được báo của các attempt thành công: **15.728 token** (9.618 input + 6.110 completion). Tổng giá niêm yết quy đổi **9,9572 credits**. Không có usage cho 3 attempt 502; **actual billing/event miễn phí chưa xác minh**, không cam kết phí thực hoặc quy đổi credits sang USD.
- Tổng thời gian hai pha API là 76,970 giây; không gồm khoảng nghỉ/đọc artifact/chuẩn bị giữa hai pha.

## Nhận định và phạm vi áp dụng

- **8 luồng gọi được**, qua 24 request chưa thấy 429. Các lỗi 502 quan sát được phục hồi sau một lần retry ít luồng hơn. Nếu dùng cho job nền, cần checkpoint, retry có backoff và chỉ retry lỗi transport; chưa triển khai chúng ở phiên test này.
- Không nghiệm thu độ chính xác DB4 bằng 24 fixture dễ và lặp lại. Chưa gửi dữ liệu DB/PII thật, kiểm các sense biên/partial/khác POS hoặc contract của runner DB4.
- Không có baseline 1/4/16 luồng cùng prompt/settings trong đợt này nên **chưa biết 8 luồng là tối ưu**, không kết luận tốc độ tăng 8 lần, không kết luận bỏ cap token hay streaming là nguyên nhân tăng tốc.
- Latency dao động 2,5–38 giây, nhiều stream tới gần như một khối; chưa đủ cơ sở thay chat tương tác chỉ vì median 11 giây.
- Các lượt hợp lệ đều stop, không còn output vắng do chạm cap client như probe 256 token trước. Provider không trả reasoning breakdown đầy đủ để xác định nguyên nhân probe cũ.

## Artifacts, kiểm tra và trạng thái

- [Config + 24 fixture](m10-devora-8workers-2026-10-13-config.json).
- [24 kết quả đợt chính JSONL](m10-devora-8workers-2026-10-13.jsonl).
- [Summary](m10-devora-8workers-2026-10-13-summary.json).
- [Retry ba lỗi](m10-devora-8workers-2026-10-13-retry.json).
- Kiểm tra: parse và đối chiếu đủ 24 index/8 peak; lỗi đúng 3 index; schema/expected/stop/DONE; đủ ba retry; tính lại token/credit từ usage và catalog; không secret trong artifacts; whitespace/scoped diff và working tree. Không build/test app vì không thay code/config.
- File/phạm vi: report/artifacts M10 và links trong report trước, khảo sát và `PROGRESS.md`.
- Gate còn thiếu: actual billing/free policy, benchmark DB4 thật, controlled concurrency/latency baseline, model upstream identity; Space Bunny vẫn cần subscription.
- Git/triển khai: chưa commit/chưa push; không deploy/apply DB, không đổi Muse/Qwen hoặc config VPS.
