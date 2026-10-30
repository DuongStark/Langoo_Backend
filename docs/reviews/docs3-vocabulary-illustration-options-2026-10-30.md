# DOCS3 — Phương án ảnh minh họa từ vựng

Ngày: 2026-10-30. Trạng thái: nghiên cứu và đề xuất; chưa triển khai, chưa chạy pilot,
chưa gọi API tạo ảnh trả phí. Các lựa chọn dưới đây là khuyến nghị, chưa phải quyết định của chủ dự án.

## 1. Kết luận đề xuất

Dùng ảnh AI được tạo trước và lưu dùng lâu dài làm nguồn chính cho các nghĩa dễ minh họa;
tận dụng bộ minh họa CC0 có nguồn gốc rõ khi có sẵn ảnh phù hợp. Ảnh chụp nguồn mở chỉ bổ sung
cho nội dung cần độ chính xác thực tế. Từ trừu tượng hoặc quan hệ ngữ pháp có thể không có ảnh.

Chi phí phải tính theo **ảnh dùng được**, gồm API, tạo lại, tìm/chọn, duyệt, tích hợp và lưu/phân phối.
Ảnh miễn phí tiền bản quyền có thể tốn công hơn ảnh AI giá thấp. Chưa thể khẳng định nguồn tối ưu
tuyệt đối trước khi đo pilot trên từ thật của Langoo.

Không có nguồn nào bảo đảm tuyệt đối không phát sinh tranh chấp. CC0 cho phép dùng thương mại
nhưng không xóa quyền nhãn hiệu/quyền hình ảnh cá nhân; chính Creative Commons không xác minh
quyền sở hữu từng tác phẩm. Ảnh AI được phép dùng thương mại cũng không đồng nghĩa có bảo đảm
không xâm phạm hoặc quyền độc quyền đối với đầu ra.
Nguồn: [CC0](https://creativecommons.org/publicdomain/zero/1.0/),
[điều khoản Workers AI](https://www.cloudflare.com/service-specific-terms-developer-platform/).

## 2. Hiện trạng dự án đã đối chiếu

- Langoo học Anh–Nhật cho người Việt; đơn vị nội dung là `sense`, liên kết liên ngữ qua `concept`.
  Xem [ngữ cảnh](../../CONTEXT-DU-AN.md), [tiến độ](../../PROGRESS.md).
- Tiến độ 28/10 ghi 20 deck EN với 2.910 mục từ có nghĩa Việt. Đây là cohort khởi đầu tốt hơn
  việc làm ảnh cho toàn bộ từ điển. Con số lấy từ tài liệu, chưa query lại DB trong lượt này;
  không coi 2.910 là số nghĩa/concept duy nhất cần ảnh.
- `core.media_asset` đã có `object_key`, `mime`, `bytes`, `sha256`, `provider`, `source_id`,
  nhưng CHECK hiện chỉ nhận `stroke_svg`, `stroke_gif`, `audio_tts`.
  [Migration gốc](../../db/migrations/024_core_reference.sql) và
  [tham chiếu](../../CSDL-THAM-CHIEU.md) chưa có mapping ảnh minh họa sense/concept.
- [SenseCardDto](../../src/dictionary/dto/dictionary-response.dto.ts) có `sense_id`, `concept_id`,
  gloss và nghĩa con; chưa có trường ảnh minh họa. API flashcard cần đối chiếu thêm khi triển khai.
- [Storage factory](../../src/storage/storage.factory.ts) chỉ triển khai local; S3/R2 còn backlog.
  Không coi interface storage hiện có là đã sẵn public media/CDN. Storage feedback có quyền truy cập
  riêng; không mở public thư mục feedback để phục vụ ảnh học tập.
- [DB3-A](../plans/db3-a-foundation.md) nói về KanjiVG; serving ảnh nét đã gắn M14.
  Nghiên cứu này không thay đổi phạm vi đã chốt đó.

## 3. So sánh các cách lấy ảnh

| Cách | Ưu điểm | Công việc/giới hạn | Vai trò đề xuất |
| --- | --- | --- | --- |
| Bộ minh họa CC0 từ tác giả | Không phí bản quyền; tải một bộ có thể đồng nhất phong cách | Phủ từ hạn chế; vẫn cần gắn đúng nghĩa | Tận dụng khi đã có asset phù hợp |
| Openverse / Wikimedia | Nhiều ảnh thật; có metadata giấy phép | Phải kiểm nguồn gốc từng file, ghi công theo license; tìm/chọn tốn thời gian | Nội dung cần ảnh thật |
| Pexels / Pixabay / Unsplash | Ảnh chụp đẹp, có lựa chọn miễn phí | Điều khoản API riêng, quota và hạn chế tải/lưu; dễ lệch nghĩa | Nguồn bổ sung có chọn lọc |
| AI qua API, tạo trước | Tự động theo nghĩa, kiểm soát bố cục; giá sinh ảnh thấp | Cần kiểm chất lượng, có thể tạo sai; giấy phép model và dịch vụ đều cần xét | Nguồn chính được khuyến nghị thử |
| Tự chạy model | Chủ động môi trường, không trả từng request cho API | GPU, cài đặt và vận hành; chưa biết phần cứng sẵn có | Chưa ưu tiên ở quy mô đầu |

Nguồn CC0 đáng thử là [Kenney](https://kenney.nl/support): game assets trên trang asset được
tác giả công bố CC0, dùng được thương mại, không bắt buộc ghi công. Kiểm license trong gói;
không suy ra mọi sản phẩm trên website đều cùng điều kiện. Chưa đo số từ Langoo mà bộ này phủ được.

[SVG Repo](https://www.svgrepo.com/page/licensing/) chứa nhiều loại giấy phép, không được coi
toàn bộ website là CC0. [OpenMoji](https://github.com/hfg-gmuend/openmoji/blob/master/FAQ.md)
là CC BY-SA 4.0: dùng thương mại được, nhưng có nghĩa vụ ghi công và ShareAlike khi sửa tác phẩm.
Không ưu tiên các bộ cần thêm xử lý giấy phép nếu mục tiêu là ít công quản trị nhất.

[Openverse](https://docs.openverse.org/api/reference/made_with_ov.html) là công cụ tìm nguồn,
không bảo đảm metadata giấy phép chính xác; phải kiểm trang gốc.
[Wikimedia Commons](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia)
cũng yêu cầu xét từng file và nghĩa vụ license. Chính sách v1 nên ưu tiên CC0 hoặc CC BY đã xác minh;
tạm loại NC, ND, giấy phép không rõ; chỉ thêm BY-SA khi đã xử lý nghĩa vụ tương ứng.

Các hạn chế dịch vụ đáng lưu ý tại ngày khảo sát:

- [Pexels](https://help.pexels.com/hc/en-us/articles/900004904026-How-do-I-get-an-API-key)
  thông báo tạm dừng cấp API key mới. Không thiết kế phụ thuộc việc đăng ký key ngay.
  [API docs](https://www.pexels.com/api/documentation/) có yêu cầu dẫn nguồn,
  khác với cách hiểu đơn giản từ license tải ảnh thông thường.
- [Pixabay API](https://pixabay.com/api/docs/) không cho tải hàng loạt có hệ thống,
  yêu cầu cache request 24 giờ và không cho hotlink ảnh lâu dài. Không dùng để tự động vét
  hàng nghìn keyword cho kho ảnh.
- [Unsplash API](https://unsplash.com/documentation) có quy tắc hotlink, attribution và
  tracking download. Cần tuân thủ luồng riêng thay vì áp dụng mặc định tải về storage như mọi nguồn.

## 4. Chi phí tạo ảnh tham khảo

[Model card FLUX.1 Schnell của nhà phát triển](https://huggingface.co/black-forest-labs/FLUX.1-schnell)
công bố Apache-2.0 và cho phép dùng model thương mại. Điều đó không phải chứng nhận pháp lý
cho từng ảnh sinh ra. Dùng prompt chung, không yêu cầu nhân vật/nhãn hiệu có bảo hộ hoặc sao chép
tác phẩm cụ thể; kiểm đầu ra trước khi xuất bản, lưu model/version/prompt và điều khoản dịch vụ.

[Replicate pricing](https://replicate.com/pricing) niêm yết FLUX Schnell **3 USD/1.000 ảnh đầu ra**.
Bảng sau là phép tính, chưa phải hóa đơn/pilot; giả sử mỗi mục tiêu cần một ảnh duy nhất:

| Mục tiêu | 1 lần tạo/mục tiêu | Bình quân 2 lần tạo/mục tiêu |
| --- | ---: | ---: |
| 100 ảnh được chọn | 0,30 USD | 0,60 USD |
| 1.000 ảnh được chọn | 3 USD | 6 USD |
| 2.910 ảnh được chọn | 8,73 USD | 17,46 USD |
| 10.000 ảnh được chọn | 30 USD | 60 USD |

Chưa gồm thuế, nạp tiền tối thiểu nếu có, prompt/vision, lưu trữ, băng thông, công duyệt và lập trình.
Không quy đổi VND vì chưa đối chiếu tỷ giá và phí thanh toán. 2.910 mục từ không nhất thiết cần 2.910 ảnh.

[Cloudflare Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
cũng đáng thử: Schnell tính theo tile và step; có 10.000 neurons miễn phí/ngày dùng chung.
Ví dụ giả định đầu ra 1024×1024, 4 step: `4 × 0,0000528 + 4 × 0,0001056 = 0,0006336 USD/ảnh`
trước miễn phí và phí gói liên quan. Đây là tính toán theo bảng giá, chưa xác nhận độ phân giải/hóa đơn
endpoint thực tế. Không lấy số này làm cam kết ngân sách; thử nhỏ và đo trước khi chọn provider.

**Công duyệt mới là biến số lớn:** giả sử 20 giây/ảnh, duyệt 1.000 ảnh khoảng 5,6 giờ;
nếu tìm ảnh thủ công mất 2 phút/ảnh thì 1.000 ảnh mất khoảng 33,3 giờ. Đây là giả định để so sánh,
không phải benchmark. Vì vậy không đáng mất nhiều ngày tối ưu vài USD API trước khi đo công duyệt.

Nếu mỗi WebP được chọn trung bình 50 KB thì 10.000 ảnh khoảng 500 MB cho một kích thước;
ảnh gốc, thumbnail, backup và lượt tải phải tính thêm. Không có yêu cầu thuê GPU riêng cho pilot API.

## 5. Cách áp dụng phù hợp Langoo

1. Chọn nghĩa đang phục vụ trong deck, loại trùng theo ID, ưu tiên nghĩa phổ biến dễ minh họa.
   Không bắt đầu bằng hàng triệu lexeme/sense của từ điển.
2. Phân loại: đồ vật/động vật; hành động/tình huống; nội dung cần ảnh thật; nghĩa không cần ảnh.
   Cho phép không có ảnh thay vì gắn ảnh gượng ép cho `although`, `of`, v.v.
3. Tái sử dụng asset đã duyệt theo `concept` khi mapping đã đạt cổng chất lượng.
   Nếu mapping chưa được duyệt hoặc không có concept, gắn trực tiếp `sense_id`; không chờ DB4 xong,
   không tự động lan ảnh sang các nghĩa chỉ giống chuỗi chữ.
4. Với nghĩa cần ảnh mới: dùng bộ CC0 đã duyệt nếu khớp; nếu không, tạo một ảnh AI theo
   lemma + từ loại + định nghĩa/gloss + ngữ cảnh. `bank` ngân hàng và `bank` bờ sông là hai mục tiêu.
5. Tạo trước theo lô, có checkpoint và giới hạn tiền; một ứng viên trước, chỉ tạo lại khi bị loại,
   tối đa hai lần ở pilot rồi chuyển `needs_review`/`no_image`. Không tạo lại theo từng user/lượt ôn.
6. Ưu tiên minh họa đơn giản, nền sạch, một nghĩa rõ, không chữ trong ảnh.
   Ví dụ `borrow`: cảnh một người nhận tạm quyển sách từ người khác; ảnh chỉ có quyển sách không đủ.
7. Duyệt nhanh theo lưới: đúng nghĩa, vật thể/hành động rõ, không lỗi khó hiểu, không logo/watermark,
   phù hợp người học. AI vision có thể sàng lọc ngữ nghĩa khi thật sự giảm công; không dùng điểm vision
   làm bằng chứng quyền sở hữu. Với pilot, người kiểm toàn bộ ảnh được chọn.
8. Lưu ảnh được duyệt và provenance một lần; UI trả ảnh có sẵn hoặc không ảnh. Có thể gỡ một asset
   và vô hiệu hóa các mapping khi có báo lỗi. Chỉ chia sẻ EN–JA qua quan hệ đã được duyệt.

Metadata tối thiểu: asset ID, object key, hash, MIME/kích thước; nguồn/tác giả/trang gốc;
license/version/URL, ngày lấy và bằng chứng giấy phép; với AI có provider, model/version,
prompt/version, run ID và điều khoản áp dụng. Mapping sense/concept cần trạng thái duyệt và lý do từ chối.

Đây là phác thảo tích hợp, **chưa là thiết kế DB/API được duyệt**. Khi triển khai cần migration mới
cho loại media/mapping/provenance, contract ảnh tùy chọn ở từ điển/flashcard, serving public media riêng
và hướng dẫn FE ghi công. Không sửa migration 024 đã chạy. Tận dụng storage local hiện có ở giai đoạn
nhỏ nếu vận hành cho phép; thêm S3/R2/CDN khi có nhu cầu đo được.

## 6. Bước thử được khuyến nghị

Pilot **100 nghĩa thật** từ các deck đang dùng: 40 đồ vật/động vật, 30 hành động, 15 từ đa nghĩa,
15 nghĩa trừu tượng/tình huống. Tách rõ số nghĩa phù hợp có ảnh và số nghĩa được phép bỏ ảnh.

So sánh một bộ CC0 đã chọn với AI Schnell trên phần phù hợp; tối đa 200 ảnh AI đầu ra,
trần tiền tạo ảnh theo giá Replicate hiện khảo sát là 0,60 USD, chưa gồm các chi phí khác.
Chưa thực hiện pilot này trong lượt nghiên cứu.

Ghi: tiền thực trả/ảnh được chọn, thời gian duyệt, tỷ lệ đạt lần đầu, lỗi sai nghĩa,
số lần tạo lại, tỷ lệ tái sử dụng và kích thước file. Ngưỡng khuyến nghị trước mở rộng:
100% ảnh xuất bản có provenance, không có lỗi sai nghĩa nghiêm trọng còn biết,
ít nhất 85% nghĩa thuộc nhóm phù hợp có ảnh dùng được trong tối đa hai lần tạo.
Các ngưỡng này là đề xuất để chủ dự án chốt, chưa phải kết quả nghiệm thu.

## 7. Bổ sung — Muse và lưu ảnh ngoài VPS

Theo câu hỏi tiếp của chủ dự án, đã SSH read-only qua alias `langoo-vps`:
`date -u; df -h /; df -i /; free -m`. Timestamp VPS trả về `2026-10-29 17:40:45 UTC`
(2026-10-30 00:40:45 Asia/Bangkok).

- Root filesystem: 30G tổng, 22G dùng, 6.8G còn trống, 76% đã dùng; inode dùng 14%.
- RAM: 1.975 MiB tổng, 763 MiB available; swap dùng 232/2.047 MiB.
- Đây là snapshot; không dọn file, đổi service hoặc đo peak tải trong lượt này.

### Muse: dùng được về hướng tiếp cận, quota web chưa đo

Repo đã thử Muse web/native cho text tại M10.4/M10.5. Báo cáo cũ ghi grant 1 tỷ token
là thông tin chủ dự án cung cấp, chưa đối soát usage. Không có benchmark sinh ảnh hoặc
accounting token/ảnh trong các báo cáo đã đọc; không suy từ latency text sang latency ảnh.
Xem [nghiên cứu M10.4](m10.4-muse-api-concurrency-research-2026-10-07.md) và
[thử native M10.5](m10.5-muse-native-gateway-2026-10-07.md).

[Tài liệu chính thức hiện tại](https://dev.meta.ai/docs/image-generation) đã có Muse Image,
bao gồm `/v1/images/generations`; đây là thông tin mới bổ sung cho nghiên cứu cũ.
[Bảng giá Model API](https://dev.meta.ai/docs/pricing-rate-limits) niêm yết 0,01 USD/ảnh trả về
thành công. Vì vậy 1.000 ảnh đầu ra = 10 USD, 2.910 = 29,10 USD; tạo lại tăng số đầu ra tính phí.
Giá này thuộc API, không phải phép quy đổi token tài khoản Muse web.

Chưa truy cập trang usage của tài khoản, chưa gửi job, không biết quota khả dụng hiện tại,
token tiêu thụ/ảnh, giới hạn tốc độ và quyền thương mại áp dụng cho tài khoản web này.
Không dùng giá API để kết luận tạo ảnh qua tài khoản web cũng bị tính cùng mức tiền.

Để đo đúng, đề xuất 20 nghĩa thật, một job đang chạy, một ảnh/nghĩa, ghi usage trước/sau,
thời gian từ gửi đến tải được file và số ảnh đạt. Tách usage tuần và reserve nếu UI có hai loại;
nếu meter làm tròn hoặc có job khác cùng account thì chưa thể suy chính xác token/ảnh.
Không chấp nhận số usage do chatbot tự kể như bằng chứng meter.
Khi đủ dữ liệu, dự báo `N ảnh dùng được × số lần tạo trung bình × thời gian mỗi lần / độ song song đo được`.
Ví dụ giả định 15–60 giây/lần, một worker thì 1.000 lần tạo mất 4,2–16,7 giờ;
đây là phép tính kịch bản, không phải tốc độ Muse đã đo. Chưa chạy pilot trong lượt này.

### Storage khuyến nghị: R2 Standard, ảnh truy cập trực tiếp qua domain media

Với VPS đang chứa app/DB, nên lưu ảnh ở object storage thay vì dùng 6.8G còn lại làm kho gốc.
Đề xuất luồng: Muse → worker tải tạm một ảnh → nén/resize → upload R2 → kiểm upload/hash
→ dọn file tạm; DB chỉ giữ object key, metadata/provenance và mapping nghĩa.
Đây là thiết kế đề xuất, chưa triển khai; chỉ dọn tạm của chính job sau xác nhận upload,
không xóa dữ liệu VPS hiện có. Worker có thể chạy trên máy cá nhân để tránh tăng tải VPS.

[R2 pricing](https://developers.cloudflare.com/r2/pricing/) công bố free tier Standard:
10 GB-month, 1 triệu thao tác Class A và 10 triệu Class B mỗi tháng; egress trực tiếp miễn phí.
Ngoài mức miễn phí, Standard storage 0,015 USD/GB-month; thao tác và dịch vụ kèm có thể tính thêm.
Chưa kiểm tài khoản R2, activation/billing hoặc quota đang dùng của chủ dự án.

Ước tính dữ liệu ảnh phục vụ, giả định 50 KB/WebP: 2.910 ảnh khoảng 146 MB;
10.000 ảnh khoảng 500 MB. Nếu giữ ảnh gốc 2 MB/ảnh, 10.000 ảnh thành khoảng 20 GB.
Đây là giả định, phải đo chất lượng/độ đọc ở kích thước thực; nhiều biến thể và backup tính riêng.
Nên khởi đầu một bản WebP 512px cho flashcard, lưu bản gốc được chọn ngoài VPS khi cần,
không giữ mọi lần tạo lỗi hoặc mọi biến thể trên VPS. Bản gốc ở cùng bucket không thay thế backup độc lập.

Kết luận bổ sung: đáng thử Muse web nếu tận dụng được quota đang có và lấy file tự động ổn định;
chưa thể kết luận tiết kiệm hơn Schnell trước pilot. Quyết định storage có thể chốt độc lập:
ưu tiên R2 bên ngoài VPS, phục vụ ảnh trực tiếp để app không phải proxy từng lượt tải.
Điều kiện quyền sử dụng ảnh Muse web vẫn cần kiểm trước xuất bản, không tự gắn CC0 cho ảnh AI.

## 8. Kiểm tra và trạng thái

- Đã đọc quy tắc repo, PROGRESS, PROMPT-BACKEND, ngữ cảnh; đối chiếu migration media,
  DTO từ điển, storage factory và kế hoạch DB3-A. Không query DB thật hoặc kiểm UI trong lượt này.
- Đã tra nguồn chính thức cho license, giá và hạn chế API tại ngày khảo sát.
- Chỉ lưu báo cáo và entry PROGRESS; không thay đổi code/config/DB/dependency.
- Kiểm tra tài liệu: đối chiếu link nội bộ, `git diff --check`, Git status trước kết thúc.
- Gate còn thiếu: thử tạo ảnh, đánh giá chất lượng thực, xác minh tài khoản/quota/billing,
  chốt nguồn/license từng asset và thiết kế triển khai nếu chủ dự án chọn làm tiếp.
- Git/triển khai: chưa commit/push; không deploy. Hai tài liệu PDF untracked có sẵn được giữ nguyên.
