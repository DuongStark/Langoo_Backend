# M6 — Review nghiệm thu SRS

Ngày: 2026-09-27. Commit được kiểm tra: `8b13333`.

**Kết luận: chưa đủ điều kiện nghiệm thu.** Có 14 phát hiện cần xử lý/đồng bộ hợp đồng
trong M6.1: 4 P1 và 10 P2. Bộ test hiện có xanh nhưng chưa phủ các tình huống dưới đây.

## Phạm vi và kiểm chứng

- Đối chiếu `PROMPT-BACKEND.md`, `CONTEXT-DU-AN.md`, `PROGRESS.md`,
  `docs/srs.md`, `docs/api/srs.md`, code SRS, timezone, settings và migration 019/026.
- `npm run build`, `npm run lint`: pass.
- `npm test -- --runInBand`: 20 suite, 151 test pass.
- `npm run test:e2e`: 8 suite, 82 test pass; có warning MaxListeners của test server.
- Kiểm tra bổ sung qua HTTP với Nest app thật và Prisma trên DB local `_test`;
  các user/collection/item/SRS riêng phục vụ audit đã được xóa cascade sau kiểm tra.
  Truy vấn xác nhận còn 0 user có prefix `audit-m6-`.
- Chỉ đọc schema cloud trong transaction `READ ONLY`; không apply migration.
- Đây là báo cáo review, chưa sửa implementation hoặc viết kế hoạch M6.1.
- Cuối lượt review xuất hiện file chưa tracked `src/srs/review-engine.service.ts`
  từ thay đổi song song; tại thời điểm kiểm tra file này chưa được nối vào module/service.
  File được giữ nguyên; kết quả kiểm chứng trên đây áp dụng implementation tại `8b13333`.

## Các phát hiện

### M6-01 — P1: ease chạm sàn 1.3 làm API trả 500

Vị trí: `db/migrations/026_srs_scheduler.sql:7,13`,
`src/srs/srs.service.ts:207`.

- Cột `ease_factor` là `real`, nhưng CHECK so sánh với literal `1.3`.
- PostgreSQL xác nhận `1.3::real::double precision = 1.2999999523162842`
  và `1.3::real >= 1.3` là **false**.
- Fixture review có ease 1.35; trả lời Again → scheduler kẹp 1.3 → HTTP 500.
- Hậu quả: thẻ ở ngưỡng khó không ghi được lượt ôn; transaction bị rollback.
- Cần migration mới sửa kiểu/constraint tương thích; không sửa đè migration 026 đã chạy.
  Regression phải đi qua DB, vì unit test scheduler hiện vẫn pass tại 1.3.

### M6-02 — P1: review các sibling đồng thời gây deadlock

Vị trí: `src/srs/srs.service.ts:136,229`.

- Mỗi transaction khóa một dòng SRS riêng rồi cập nhật các sibling để bury.
  Hai transaction có thể giữ dòng mà bên kia đang cần.
- Gửi 4 review đồng thời cho 4 thẻ của cùng item, mỗi request có UUID retry riêng:
  hai lần kiểm tra đều có 3 HTTP 500 và 1 HTTP 200.
- Prisma báo `P2034` tại `tx.srsState.updateMany()`; DB chỉ ghi 1 log.
- Cần thứ tự/phạm vi khóa thống nhất cho các sibling và cách xử lý conflict phù hợp,
  đồng thời kiểm lại điều kiện được ôn sau khi lấy khóa.

### M6-03 — P1: `client_review_id: null` làm mất lượt ôn nhưng vẫn trả 200

Vị trí: `src/srs/dto/create-review.dto.ts:57`, `src/srs/srs.service.ts:145`.

- `@IsOptional()` bỏ qua null, nhưng service chỉ phân biệt `undefined`.
- Ôn thẻ A không gửi client ID, sau đó ôn thẻ B với `client_review_id: null`:
  B nhận HTTP 200 và log của A; B vẫn `state=new`, tổng log vẫn là 1.
- Nhánh retry đã tìm `client_review_id IS NULL` như một idempotency key hợp lệ.
- Cần chặn null hoặc chuẩn hóa thành trường bị bỏ qua trước khi xử lý idempotency.

### M6-04 — P1: endpoint ghi nhận review bỏ qua trạng thái không được ôn

Vị trí: `src/srs/srs.service.ts:116,165`.

- Endpoint chỉ kiểm ownership, suspended và due time; thiếu kiểm tra buried,
  collection archived và item paused như endpoint `/due`.
- Sau khi ôn một thẻ: gửi trực tiếp review cho sibling đang buried → 200.
  Chuyển item sang paused rồi ôn thẻ khác → 200. Archive collection rồi ôn → 200.
  Cả bốn request đều ghi log/XP.
- Có thể xảy ra với queue cũ trên FE hoặc hai thiết bị; cần kiểm lại eligibility
  trong transaction, dùng cùng quy tắc với queue.

### M6-05 — P2: giới hạn 1.000 candidate cắt cụt pagination và sai filter collection

Vị trí: `src/srs/srs.service.ts:75`, `src/srs/repositories/due.repository.ts:110`.

- Mỗi lần gọi đều lấy 1.000 dòng đầu, rồi mới áp collection filter, daily caps và cursor.
- Fixture có 1.002 thẻ new, new limit 9.999: duyệt 10 trang chỉ nhận 1.000 thẻ,
  trang cuối trả `next_cursor=null` dù còn 2 thẻ.
- Lọc riêng collection chứa 2 thẻ cuối trả danh sách rỗng.
- Cần đưa filter/keyset xuống truy vấn và lấy đủ candidate hợp lệ theo cap;
  không được dùng trần nội bộ làm mất dữ liệu trong API phân trang.

### M6-06 — P2: cursor mất microsecond nên bỏ sót thẻ

Vị trí: `src/srs/scheduler/queue.ts:74,86`,
`src/srs/repositories/due.repository.ts:108`.

- DB sắp theo timestamp đầy đủ, nhưng `Date`/`toISOString()` chỉ giữ millisecond.
- Hai thẻ có due time `.000100` và `.000900`, ID theo thứ tự ngược lại:
  trang 1 trả thẻ `.000100`, trang 2 rỗng thay vì trả thẻ `.000900`.
- Cần dùng cùng khóa và cùng độ chính xác giữa SQL, cursor và phép so sánh.

### M6-07 — P2: daily limits đếm sai loại lượt học và có thể vượt qua khi POST

Vị trí: `src/srs/repositories/due.repository.ts:115`,
`src/srs/srs.service.ts:64,180,370`.

- `prev_state <> 'new'` tính cả intraday learning vào review quota.
  Đặt review limit 1, ôn một learning card trong ngày: chưa có log `prev_state=review`
  nào nhưng một review card đến hạn của item khác đã bị loại khỏi queue.
- Mọi learning/relearning đều vào bucket không giới hạn; không phân biệt interday.
  Fixture learning từ ngày trước vẫn được trả khi review quota hết.
- New quota đếm theo profile, review quota đếm toàn user. Chuyển sang profile vừa tạo,
  chưa ôn gì, `reviews_today` vẫn là 1 từ profile trước; cần thống nhất phạm vi quota/stats.
- POST không thực thi cap: new limit 1 nhưng gửi review cho 2 item khác nhau đều nhận 200,
  `introduced_at` được ghi cho 2 thẻ.
- Cần tách số liệu thống kê khỏi bộ đếm quota nếu có semantics khác nhau,
  phân biệt intraday/interday và bảo đảm cap tại thao tác ghi.

### M6-08 — P2: learn-ahead trả thẻ mà API không cho trả lời

Vị trí: `src/srs/repositories/due.repository.ts:94`,
`src/srs/srs.service.ts:172`.

- Sau New + Good, thẻ learning có due time 10–15 phút sau vẫn có trong `/due`.
  Gửi đáp án cho chính thẻ đó ngay lập tức → 422 `SRS_ITEM_NOT_DUE`.
- Thẻ future learning còn được xếp trước review/new đang đến hạn, dù mục đích
  learn-ahead là dùng khi không còn thẻ khác để học.
- `docs/srs.md` cũng đang mâu thuẫn: §3 mô tả học sớm, §5 cấm trả lời sớm.
  Cần chốt hợp đồng thống nhất giữa spec, queue và submit.
  [Anki Manual](https://docs.ankiweb.net/deck-options.html#learning-steps) mô tả
  learn-ahead khi không còn nội dung khác để học.

### M6-09 — P2: retry không trả lại đúng kết quả ban đầu

Vị trí: `src/srs/srs.service.ts:145`.

- Review A với key K → `learning`; sau một lượt tiếp theo thẻ thành `review`.
  Retry K trả đúng log A nhưng phần `srs` là `review`, không phải `learning` của A.
- Code trả `state: current`; không có snapshot kết quả gắn với log.
- Nhánh lookup cũng không kiểm payload/card có khớp key đã dùng hay không.
- Cần lưu/tái dựng kết quả ban đầu và có chính sách rõ ràng khi cùng key nhưng payload khác.

### M6-10 — P2: scheduler chưa tương đương Anki như đã tuyên bố

Vị trí: `src/srs/scheduler/anki-scheduler.ts:125,195`,
`src/srs/srs.service.ts:180`.

- Relearning + Easy luôn trả 1 ngày như Good. Nhánh SM-2 chính thức của Anki
  cho Easy thêm một ngày so với interval relearning hiện tại: mặc định là 2 ngày.
- Với interval 1 ngày, ease 1.3, RNG 0.5: Hard/Good/Easy trong code đều là 2 ngày.
  Anki ràng buộc Good dài hơn Hard và Easy dài hơn Good, trừ giới hạn trần.
- Scheduler không nhận elapsed days/days late nên không thể tính phần bù cho thẻ quá hạn
  của công thức Good/Easy theo Anki.
- Unit test hiện còn khẳng định Relearning + Easy = 1 ngày; cần sửa oracle test
  theo phiên bản Anki được chốt, không chỉ chỉnh code cho test hiện tại xanh.
- Nguồn đối chiếu chính thức ngày review:
  [SM-2 review states](https://github.com/ankitects/anki/blob/main/rslib/src/scheduler/states/review.rs),
  [relearning states](https://github.com/ankitects/anki/blob/main/rslib/src/scheduler/states/relearning.rs).

### M6-11 — P2: mốc ngày kế tiếp sai ở múi giờ có DST

Vị trí: `src/common/time/timezone.ts:46`.

- Cộng 24 giờ tuyệt đối không luôn đưa tới ngày lịch kế tiếp ở timezone người dùng.
- New York, `2026-11-01T04:30Z`: hàm trả `2026-11-01T04:00Z` (đã qua),
  đúng phải là `2026-11-02T05:00Z`.
- New York, `2026-03-08T04:30Z`: hàm trả `2026-03-09T04:00Z`,
  đúng phải là `2026-03-08T05:00Z`.
- Ảnh hưởng `buried_until` và `due_today`. Test hiện chỉ phủ UTC và Việt Nam.

### M6-12 — P2: thẻ new bỏ qua position trong collection

Vị trí: `src/srs/repositories/due.repository.ts:101`.

- Spec §3 yêu cầu new theo position; SQL dùng due_at/srs_id cho mọi state.
- Tạo A trước B, đổi position A thành 100 trong khi B ở position 2:
  queue vẫn trả A trước B.
- Cần khóa sắp xếp riêng cho new, đồng bộ với cursor và tiêu chí thứ tự liên collection.

### M6-13 — P2: nhận `reviewed_at` nhưng âm thầm bỏ qua

Vị trí: `src/srs/dto/create-review.dto.ts:61`, `src/srs/srs.service.ts:196`.

- Swagger quảng bá client có thể ghi giờ trả lời.
- Gửi thời điểm trước hiện tại 5 phút được nhận 200, nhưng log lưu giờ server hiện tại.
- Cần thực thi chính sách thời gian với validation phù hợp, hoặc bỏ trường khỏi hợp đồng
  và từ chối input đó; không nên tiếp tục nhận rồi bỏ qua.

### M6-14 — P2: due card thiếu cờ nghĩa máy chưa duyệt

Vị trí: `src/srs/repositories/due.repository.ts:66`,
`src/srs/srs.service.ts:392`, `src/srs/types/srs.types.ts:9`.

- Xác nhận bằng code: query chỉ lấy `meaning_vi`, không lấy `meaning_source`;
  payload prompt/answer cũng không có thông tin nguồn nghĩa.
- Item clone với `meaning_source=machine` lên màn hình ôn sẽ không có cờ cho FE hiện badge,
  trái bất biến #9 của `PROMPT-BACKEND.md`.
- Cần truyền metadata nguồn nghĩa trong due response và kiểm thử item nguồn machine.

## Trạng thái triển khai DB

Truy vấn chỉ đọc xác nhận local có migration 026 cùng 8 cột mới. Cloud cấu hình trong
`DIRECT_URL` chưa có bản ghi 026 và chưa có cả 8 cột này. Đây là bước triển khai đang
chờ duyệt đã được ghi trước đó, không phải thao tác bị bỏ quên trong lần review này.
Backend mới chưa sẵn sàng chạy trên schema cloud hiện tại; cần sửa các lỗi M6.1,
kiểm chứng migration bổ sung tại local rồi mới thực hiện quy trình triển khai cloud.

## Bổ sung môi trường — ENV-01 (ngoài 14 phát hiện)

Ghi nhận bổ sung ngày 2026-09-27 khi lập [kế hoạch M6.1](../plans/m6.1-srs-fixes.md):

- Local session có `TimeZone = Asia/Bangkok`. Prisma Date bind và SQL `now()`/DEFAULT
  hoặc literal có offset có thể lệch nhau 7 giờ; Prisma↔Prisma nhất quán không đủ chứng
  minh fixture đúng khi trộn nguồn. Fixture SQL audit ban đầu bị ảnh hưởng đã được chỉnh
  để tái hiện đúng; bản sửa cần regression trộn nguồn thời gian thực sự.
- Kiểm tra chỉ đọc: Date `2026-09-27T00:00:00Z` qua Prisma được diễn giải thành
  `2026-09-26T17:00:00Z`; hiệu `bound - literal` là `-25200` giây. Cách mô tả “+7h”
  phụ thuộc chiều so sánh; không dùng cách cộng/trừ giờ thủ công làm bản sửa.
- Thêm `options=-c%20timezone%3DUTC` vào URL kết nối thử trong bộ nhớ: session thành UTC,
  độ lệch về 0. Cloud runtime kiểm tra chỉ đọc hiện UTC và độ lệch 0; runtime/direct
  hiện dùng cùng URL. Chưa xác minh toàn bộ pool/reconnect và chưa đổi cấu hình lâu dài.
- M6.1 chuẩn hóa `TEST_DATABASE_URL`/`TEST_DIRECT_URL`, CI và kiểm tra session trước test;
  M12 bổ sung kiểm tra vận hành cloud/pool. Timezone ngày học của user vẫn giữ nguyên.

Đây là ghi chú môi trường riêng; kết luận **14 phát hiện (4 P1, 10 P2)** và baseline
review gốc không thay đổi. Plan M6.1 được đối chiếu thêm với code M7 tại `27aca4e`.

## Điều kiện để review lại

- Có regression cho các ca dữ liệu thật ở trên, đặc biệt ease floor, concurrent siblings,
  null retry, cap và pagination >1.000/microsecond.
- Chốt các điểm spec mâu thuẫn: phiên bản/semantics Anki, learn-ahead,
  phạm vi daily limit/stats và `reviewed_at`.
- Các test M6 mới và suite cũ cùng pass; code/schema/API docs đồng bộ.
- M6.1 ghi riêng lịch sử bản sửa; giữ báo cáo này làm bằng chứng review M6 ban đầu.
