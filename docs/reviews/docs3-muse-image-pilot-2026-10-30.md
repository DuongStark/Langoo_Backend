# DOCS3 — Thử 20 ảnh Muse từ bộ Ẩm thực & Nhà hàng

Ngày 2026-10-30 (+07). Chủ dự án yêu cầu trực tiếp tạo khoảng 20 ảnh để đo tốc độ và tiêu thụ.
Đã tạo/tải/kiểm 20 ảnh local, chưa tích hợp sản phẩm, chưa curated hoặc xuất bản.

## Kết quả đo

| Chỉ số                           | Kết quả                                                  |
| -------------------------------- | -------------------------------------------------------- |
| Cohort                           | Deck `35`, `en-restaurant-dining` — Ẩm thực & Nhà hàng   |
| Số nghĩa                         | 20 anchor sense thật, snapshot READ ONLY từ DB VPS       |
| Ảnh tải được                     | 20/20 PNG, mỗi file 512×512; verify decode và SHA-256    |
| Ảnh trùng bytes                  | 0; đủ 20 SHA-256 khác nhau                               |
| Gửi → kết quả DOM ổn định        | 331,83 giây ≈ 5 phút 32 giây                             |
| Toàn runner, gồm nhận file local | 340,45 giây ≈ 5 phút 40 giây                             |
| Bình quân toàn runner            | Khoảng 17,02 giây/ảnh; không phải latency từng tool call |
| Tổng 20 PNG                      | 4.287.485 bytes = 4,29 MB ≈ 4,09 MiB                     |
| Bình quân PNG                    | 214.374 bytes/ảnh ≈ 214 KB                               |
| ZIP bàn giao local               | 4.299.785 bytes, gồm 20 PNG + preview/metadata/prompt    |
| Token/quota trước–sau            | **Chưa đo được**; không có meter số đáng tin             |

Timer trên tính từ bước gửi yêu cầu/runner tạo ảnh; không bao gồm công chọn cohort,
khôi phục đăng nhập, sửa selector và kiểm tra tương thích trước đó. Polling khoảng 2 giây,
đợi ổn định DOM thêm 12 giây trước khi chốt; không phải timestamp hoàn thành model chính xác.
Một yêu cầu Muse agent yêu cầu 20 ảnh, không phải 20 request API được benchmark riêng.

Muse trả lời đã dùng built-in image generation và không reroll; client không có log tool-level
để xác minh độc lập số lần gọi model hoặc revision model thực. Đã xác minh được 20 file raster thật,
đúng nhãn filename UI, không dùng OpenAI ImageGen, paid Model API hoặc nguồn stock làm fallback.

## Bộ từ và kiểm ảnh

Danh sách đúng thứ tự UI và snapshot sense:

`restaurant`, `bistro`, `buffet`, `bakery`, `kitchen`, `pantry`, `chef`, `waiter`,
`waitress`, `bartender`, `dishwasher`, `menu`, `appetizer`, `dessert`, `beverage`,
`cocktail`, `wine`, `whisk`, `dairy`, `seafood`.

- Input dùng nghĩa anchor thật của deck, gồm định nghĩa EN, gloss VI, `sense_id`; không chọn nghĩa từ chuỗi.
- Đã xem trực quan cả 20 ảnh; nhìn chung phù hợp chủ thể, nền sáng, không thấy chữ/logo/watermark rõ.
- `dishwasher` đúng máy rửa bát; `whisk` đúng dụng cụ đánh trứng, không bị chuyển thành động từ.
- Chất lượng chưa được nghiệm thu curation: phong cách dao động giữa nét phẳng và watercolor;
  `pantry` chỉ hiện kệ thức ăn, chưa thể hiện cả phòng; ảnh `cocktail` riêng lẻ khó phân biệt đồ có cồn.
- Những từ gần nhau như restaurant/bistro, waiter/waitress, beverage/cocktail cần cân nhắc khi dùng làm
  câu hỏi phân biệt. Không gắn nhãn toàn bộ ảnh là đã curated chỉ vì decode và chủ thể đạt.

## Quota: giới hạn phép đo

- Cấu hình General của tài khoản web không hiển thị meter quota/token tại thời điểm kiểm tra.
- `/api/session` trả metadata VM/session, không có số dư usage phù hợp.
- Các path kiểm tra `/api/usage`, `/api/billing/usage`, `/api/usage/balance` trả HTML app shell,
  không phải JSON accounting. Menu tin nhắn chỉ có Copy, không có số usage.
- Không có baseline số trước generation; vì vậy không báo được delta hoặc token/ảnh.
- Không coi thiếu số đo là tiêu thụ 0; không lấy độ dài prompt, số Muse tự kể hoặc giá API
  0,01 USD/ảnh để quy đổi quota Muse web. Không khẳng định grant 1 tỷ token còn bao nhiêu.
- Muốn dự toán bulk theo quota cần meter/accounting thật trước–sau; pilot này chỉ chứng minh
  tạo/tải đủ ảnh và đo throughput/dung lượng cho chính lô này.

## Kết nối và tác động VPS

- Ban đầu cookie native trả HTTP 401. Bật tạm browser/display hiện có và chọn tài khoản đã lưu
  để đăng nhập lại thành công; không yêu cầu mật khẩu, không in hoặc đưa cookie vào Git/artifact.
- Export lại cookie Muse-origin vào file private 0600 trên VPS theo helper sẵn có.
- Native client pin cũ sau đó lỗi `DecodeError`; không sửa transport/protocol production.
  Browser fallback dùng phiên đăng nhập hiện có và chat mới riêng cho pilot.
- Lần chuẩn bị browser đầu lỗi selector trước dispatch, không có generation gửi đi;
  checkpoint riêng giữ dấu vết. Lần thực gửi duy nhất có marker `DOCS3-IMAGES-20261030`.
- Ảnh chuyển qua stdout SSH và lưu local; không tạo kho PNG/ZIP trên VPS. Muse giữ bản trong
  workspace máy cloud của Muse, khác filesystem VPS Langoo. VPS có file script/cohort/checkpoint nhỏ.
- Giữ app/DB/provider như cũ; browser/display bật tạm được dừng về trạng thái inactive sau thử,
  bridge được phục hồi active. Khi dừng browser, systemd dừng cả bridge do `Requires=muse-browser`;
  phục hồi riêng bridge bằng `systemctl --job-mode=ignore-dependencies start muse-bridge.service`
  để trả đúng snapshot ban đầu (browser/display inactive, bridge active), không sửa unit/config.
  Health app/DB kiểm lại sau hoàn nguyên.

## Artifact và cách dùng

Artifacts không commit (đã thuộc gitignore `uploads/`):

- `uploads/docs3-muse-images-20261030/index.html`: mở local để xem đủ 20 ảnh với tên/gloss/sense ID.
- `uploads/docs3-muse-images-20261030/docs3-muse-20-images.zip`: gói 20 PNG đặt tên theo từ,
  kèm manifest, cohort, summary, prompt và ghi chú quota; không có cookie hoặc dữ liệu tài khoản.
- `manifest.json`: 20 mapping filename ↔ sense ID, bytes, SHA-256, kích thước, trạng thái pilot.
- `summary.json`, `events02.jsonl`, `ui-file-labels.json`, `quota-observation.json`: bằng chứng local.
  Không công khai events/raw blob URL; ZIP bàn giao không chứa events.
- [Script spike](../../scripts/ops/muse-native/image-pilot-browser.mjs) chỉ dành cho thử nghiệm
  trên VPS với CDP/Playwright sẵn có. Không tự chạy lại: checkpoint mới đồng nghĩa gửi thêm lô tạo ảnh.
  Không phải adapter backend hoặc quy trình bulk đã harden.
- [Plan](../plans/docs3-muse-image-pilot-2026-10-30.md),
  [nghiên cứu nguồn ảnh/storage](docs3-vocabulary-illustration-options-2026-10-30.md).

Với kích thước thực đo, 1.000 PNG tương tự khoảng 214 MB; 10.000 khoảng 2,14 GB (chưa backup).
Với throughput toàn runner tương tự, 1.000 ảnh khoảng 4,73 giờ. Đây là ngoại suy tuyến tính từ
một lô dễ minh họa, chưa tính rate limit/quota/lỗi hoặc công duyệt, không phải cam kết bulk.
Vẫn khuyến nghị storage ngoài VPS và tái sử dụng ảnh theo nghĩa/concept; chưa thử nén WebP trong lô này.

## Kiểm tra / gate / Git

- Đã chạy: `node --check` script spike; Prettier cho script/plan; kiểm 20 PNG bằng Pillow
  `verify`, kích thước 512×512, SHA-256 khớp dữ liệu tải và 20 hash khác nhau;
  kiểm filename theo nhãn UI, mở trực quan cả 20 ảnh; kiểm ZIP và link nội bộ/diff trước bàn giao.
- Không chạy test ứng dụng: không đổi `src`, schema, ENV hoặc deployment. Script là spike vận hành.
- Gate còn thiếu: token/quota thực, log số lần tạo/model revision, chất lượng formal curation,
  quyền sử dụng áp dụng cho tài khoản, WebP, R2 và khả năng chạy bulk ổn định.
- Git / triển khai: script + plan + report + PROGRESS lưu local, chưa commit/push;
  không deploy sản phẩm hoặc apply DB. Giữ nguyên hai tài liệu PDF untracked có sẵn.
