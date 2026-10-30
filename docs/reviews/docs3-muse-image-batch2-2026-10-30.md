# DOCS3 — Lô 2: 20 ảnh Muse đời thường và đa dạng

Ngày 2026-10-30 (+07). Yêu cầu trực tiếp: thêm 20 ảnh từ bộ Ẩm thực & Nhà hàng,
ưu tiên đời thường, đa dạng hơn lô 1 và giảm cảm giác AI slop.

Trạng thái: đã tải và kiểm đủ 20 ảnh mới local; chưa curated hoặc xuất bản.

## Phạm vi và brief

- Deck `35`, `en-restaurant-dining`; snapshot 20 anchor sense thật bằng transaction READ ONLY.
- Không trùng `sense_id` hoặc từ với 20 ảnh lô 1. Không ghi đè ảnh/metadata cũ.
- Từ: sweet, sour, spicy, crispy, ripe, rotten, bake, roast, grill, fry, boil, steam,
  chop, slice, grate, stir, marinate, breakfast, snack, picnic.
- Giữ đúng nghĩa noun của `grill` (dụng cụ), `steam` (hơi nước), `slice` (lát mỏng).
- Brief riêng cho từng từ: 14 ảnh chụp sinh hoạt, 2 tranh mực, 1 chì màu,
  2 cắt giấy, 1 comic hai khung trong một ảnh. Đây là yêu cầu đầu vào, chưa phải số thể loại đã nghiệm thu.
- Đời thường: bếp nhà, quầy ăn bình dân, chợ, tủ lạnh, bàn ăn sáng, công viên;
  nhiều góc cận/overhead/ngang/rộng, nhiều điều kiện sáng và màu. Tránh nền kem đồng loạt,
  vật thể chính giữa, pastel chung, đồ ăn bóng nhựa, HDR và cảnh quảng cáo quá hoàn hảo.
- Muse built-in generation, một ảnh mỗi nghĩa, cap 20, không reroll. Không gọi API trả phí,
  ImageGen khác, tìm ảnh stock hoặc xuất bản. Không thay app/DB/ENV/storage production.

## Thực thi và artifacts

- [Plan lô 2](../plans/docs3-muse-image-pilot-2026-10-30.md#lô-2--20-nghĩa-mới-cảnh-đời-thường-và-nhiều-cách-thể-hiện).
- [Script spike](../../scripts/ops/muse-native/image-pilot-browser.mjs) thêm prompt file và marker tùy chọn;
  mặc định giữ prompt lô 1. Kiểm prompt có marker/sense IDs và checkpoint mới trước dispatch.
  Lưu label UI của ảnh khi tải để đối chiếu tên từ.
- Marker: `DOCS3-IMAGES-20261030-BATCH2`, chat mới riêng. Đăng nhập sẵn, không cần renew cookie.
- Thư mục local gitignored: `uploads/docs3-muse-images-20261030-batch2/`.
  `cohort.json`, `prompt.txt`, `events.jsonl`, `quota-observation.json` lưu bằng chứng.
- Snapshot trước lô: browser/display/bridge đều active, root còn 6.9G, RAM available 488 MiB.
  Giữ nguyên trạng thái dịch vụ ban đầu khi xong; không tự dừng browser đang active từ trước lô.

## Kết quả

| Chỉ số                           | Thực đo                                           |
| -------------------------------- | ------------------------------------------------- |
| Nghĩa / ảnh                      | 20/20, không trùng nghĩa hoặc hash ảnh với lô 1   |
| Định dạng                        | 20 PNG, tất cả 512×512, decode/verify đạt         |
| Gửi đến DOM ổn định              | 307,02 giây ≈ 5 phút 07 giây                      |
| Toàn runner, gồm nhận file local | 317,77 giây ≈ 5 phút 18 giây                      |
| Bình quân toàn runner            | 15,89 giây/ảnh; không phải latency từng tool call |
| Tổng PNG                         | 9.154.279 bytes = 9,15 MB                         |
| Bình quân PNG                    | 457.714 bytes ≈ 458 KB/ảnh                        |
| ZIP ảnh + metadata               | 9.170.555 bytes                                   |
| Token/quota thực                 | Chưa đo được; không có meter trước–sau đáng tin   |

Timer không gồm chuẩn bị cohort/brief. Có polling khoảng 2 giây và đợi DOM ổn định 12 giây;
đây là một lô 20 ảnh qua agent, chưa phải benchmark latency model hoặc khả năng bulk.
Không suy số token/quota từ prompt dài hoặc giá API. Không coi thiếu số đo là tiêu thụ 0.

### Đánh giá trực quan và sửa metadata

- Đã xem cả 20 ảnh: 14 ảnh giả lập chụp đời thường, 2 tranh mực (`bake`, `stir`),
  1 chì màu (`grate`), 2 cắt giấy (`slice`, `snack`), 1 comic (`sour`). Đều là ảnh AI tạo.
- Có khác biệt rõ so với lô 1 ở chất liệu, góc nhìn, khoảng cách và bối cảnh;
  không dùng chung nền kem/clipart xuyên suốt. Vị chua biểu đạt bằng phản ứng,
  giòn bằng kết cấu vỡ, chín/thối bằng tình trạng trái cây.
- Kiểm đúng noun của `grill`, `steam`, `slice`; `stir` là khuấy và `marinate` là ngâm ướp,
  đúng hình lẫn nguồn nghĩa.
- **Raw reply Muse hoán đổi sense IDs của `stir` và `marinate`.** Không nhập theo lời trả lời:
  manifest lấy từ cohort có thẩm quyền + filename UI + kiểm ảnh. Đã giữ đúng
  `stir=2462808`, `marinate=898972`. Không đổi ảnh hoặc dữ liệu DB.
- Vẫn có vài ảnh được dàn ánh sáng khá chỉn chu (`sweet`, `roast`, `breakfast`);
  đây là nhận xét trực quan, không phải thang điểm trí nhớ đã kiểm với người học.
  Chưa formal curation hoặc thử hiệu quả ghi nhớ.
- PNG nhiều chi tiết hơn: 9,15 MB so với 4,29 MB lô 1. Chưa nén WebP hoặc đổi kích thước.

### Bàn giao và VPS

- `uploads/docs3-muse-images-20261030-batch2/index.html`: xem đủ 20 ảnh theo tên/nghĩa/thể loại.
- `docs3-muse-20-images-batch2.zip`: 20 PNG đặt tên từ, gallery, manifest, cohort, prompt,
  summary và ghi chú quota; không chứa raw events, cookie hoặc thông tin tài khoản.
- `manifest.json`: hash/bytes/kích thước/sense ID chuẩn; `summary.json`: metrics thực đo.
- Các artifacts trên đều local, gitignored; giữ nguyên toàn bộ lô 1. Không tạo kho PNG/ZIP lên VPS.
  Muse giữ output trong workspace cloud riêng của Muse.
- Snapshot sau thử: browser/display/bridge vẫn active như trước; không đổi unit/config/provider.
  Health HTTP thành công, app/DB `ok`, db latency 29ms; root còn 6.8G (76% đã dùng).

## Kiểm tra / gate / Git

- Đã xác minh cohort 20 nghĩa và không trùng lô 1; brief gồm 14 photographic (kể cả backyard snapshot)
  và 6 illustration; `node --check`, Prettier script/plan/report, `git diff --check`;
  20 PNG decode/kích thước/hash/nhãn UI, 20 hash khác nhau, xem trực quan cả 20 ảnh,
  kiểm ZIP CRC/đủ 20 PNG và liên kết nội bộ. Health app/DB sau thử đạt.
- Không chạy test ứng dụng vì chỉ spike vận hành, không đổi `src` hoặc DB.
- Gate: quota chưa đo được; chưa curated hoặc thử hiệu quả ghi nhớ,
  chưa xác minh điều khoản xuất bản hoặc khả năng bulk.
- Git / triển khai: script/plan/report/PROGRESS local chưa commit/push; không deploy/apply DB.
  Giữ nguyên các tài liệu PDF untracked có sẵn.
