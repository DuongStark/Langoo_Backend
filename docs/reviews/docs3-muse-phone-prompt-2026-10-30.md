# DOCS3 — Thử prompt ảnh điện thoại để giảm cảm giác AI

Ngày 2026-10-30 (+07). Chủ dự án tiếp tục phản hồi ảnh quá nét/dàn dựng, muốn gần ảnh
điện thoại hoặc máy ảnh thông thường; yêu cầu tạo thêm, tối ưu prompt/chi phí và tra cứu nguồn.

Trạng thái: đã tải và xem đủ 8 sample mới, tạo preview A/B/C cùng 4 ảnh cũ;
chưa có đánh giá lựa chọn của chủ dự án, chưa curated hoặc xuất bản.

## Chẩn đoán có căn cứ và giới hạn

- Quan sát lô 2: kết cấu nổi mạnh, ánh sáng được dàn khá đẹp, nền mờ và màu đậm.
  Đây là nhận xét thẩm mỹ trên ảnh thật đã tạo; chưa chứng minh nguyên nhân riêng của model.
- [Adobe: Clarity/sharpening](https://www.adobe.com/learn/lightroom-cc/web/apply-clarity-dehaze-sharpen-lightroom-cc)
  giải thích tăng tương phản chi tiết có thể làm ảnh trông quá sắc; số pixel không quyết định toàn bộ
  cảm giác nét. Đây là cơ sở nhiếp ảnh, không phải thử nghiệm sửa ảnh Muse.
- [Crafting Synthetic Realities](https://arxiv.org/abs/2409.17484) ghi nhận tính thẩm mỹ chuyên nghiệp
  trong nhiều ảnh AI photorealistic. Không suy từ nghiên cứu này rằng một keyword gây AI slop.
- [D-Judge](https://arxiv.org/abs/2412.17632) tách chất lượng, ngữ nghĩa, thẩm mỹ và đánh giá con người;
  ảnh đẹp hoặc rõ không tự bảo đảm cảm giác tự nhiên. Không dùng điểm sharpness làm thước đo duy nhất.
- Giả thuyết cho lần thử: giảm cách mô tả “ảnh đẹp”, dùng mục đích chụp bình thường,
  ánh sáng có sẵn, hậu cảnh nhận ra, chi tiết mềm và ít tương phản hơn. Không chủ động làm ảnh lỗi,
  bẩn quá mức hoặc mất khả năng nhận nghĩa.

## Thiết kế tiết kiệm

- 4 từ từ lô 2: breakfast, fry, spicy, picnic (4 nghĩa/sense IDs giữ nguyên).
- A: dùng lại 4 ảnh lô 2, không phát sinh generation; B/C mới, tổng cap **8 ảnh**.
- B: prompt ngắn, ảnh điện thoại trong nhóm gia đình; C: thêm mô tả máy phổ thông,
  ánh sáng thường, hậu cảnh nhận ra, tương phản vừa, chi tiết hơi mềm và JPEG nhẹ.
- B/C cùng mô tả cảnh cốt lõi. Không seed cố định/khóa bố cục, mỗi sample một lần tạo:
  đây là so sánh khám phá, chưa đủ kết luận nhân quả, ổn định hoặc tối ưu toàn cục.
- B gồm 57–64 từ tiếng Anh/sample; C 92–99 từ. Đếm từ khác token và quota;
  chưa có meter đáng tin nên không báo số token/tiền tiết kiệm.
- Yêu cầu Muse truyền `image_prompt` nguyên văn, không tự thêm mỹ từ; client không có log tool-level
  để xác minh độc lập việc model thực sự dùng nguyên prompt.
- Không hậu kỳ blur/noise, không sửa/nén ảnh cũ thành “kết quả mới”, không reroll,
  không đổi dịch vụ tạo ảnh hoặc gọi paid Model API.
- [Plan lô 3](../plans/docs3-muse-image-pilot-2026-10-30.md#lô-3--prompt-ảnh-điện-thoại-8-ảnh-thử-để-tiết-kiệm).

## Prompt, artifacts và kết quả

Artifacts local gitignored: `uploads/docs3-muse-images-20261030-batch3/`.
`cohort.json` chứa từng sample B/C với prompt tiếng Anh; `reference-manifest.json` giữ mapping A;
`prompt.txt` là yêu cầu agent; `events.jsonl` ghi timing/download. Các lô trước giữ nguyên.

### Kết quả đo

| Chỉ số                                   | Kết quả                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| Ảnh mới                                  | 8/8 PNG 512×512, hash khác nhau                                                |
| Ảnh A tham chiếu                         | 4 ảnh lô 2 được copy nguyên bytes, không tạo lại                               |
| Lượt 1                                   | Chỉ trả breakfast/fry B/C: 4 ảnh; DOM ổn định 107,87s, runner 120,46s          |
| Lượt 2                                   | Chỉ gửi spicy/picnic B/C còn thiếu: 4 ảnh; DOM ổn định 151,34s, runner 160,23s |
| Tổng thời gian hai runner                | 280,69s ≈ 4 phút 41 giây; không tính thời gian người vận hành giữa lượt        |
| Wall clock từ đầu lượt 1 đến xong lượt 2 | 362,51s ≈ 6 phút 03 giây, gồm khoảng xử lý giữa lượt                           |
| Dữ liệu 8 PNG mới                        | 3.302.920 bytes ≈ 3,30 MB                                                      |
| Dữ liệu 4 PNG tham chiếu                 | 1.947.154 bytes                                                                |
| Quota token thực                         | Không có meter trước–sau đáng tin; không báo delta                             |

Lượt đầu nói rõ “First 4 of 8 generated and saved”, busy đã tắt. Lượt tiếp chỉ yêu cầu 4 sample thiếu,
không gửi lại mẫu đã xong; tổng quan sát được 8 ảnh mới. Không suy từ lần giao thiếu này rằng Muse
có giới hạn cứng 4 ảnh/turn. Raw reply không được coi là bằng chứng số tool call hoặc model revision.
Timer có polling và đợi DOM ổn định 12 giây; không phải latency từng image generation.

### Nhận xét trực quan — chưa phải lựa chọn của người dùng

- Đã xem cả 8 ảnh mới và so với A từ lô 2. C thường mở khung hình và mềm chi tiết hơn;
  khác biệt rõ ở fry/breakfast. C của fry cho thấy bếp/đèn trần, thay vì chỉ chủ thể cận và dầu nổi nét.
- Spicy B/C vẫn nhấn mạnh da/mồ hôi; picnic B/C còn nụ cười/bố cục kiểu ảnh stock.
  Chưa thể kết luận prompt đã xử lý hết cảm giác AI.
- C còn tác dụng phụ: “older phone” và “ordinary” có thể đi kèm phòng cũ/bếp bừa bộn trong đầu ra.
  Đây là liên hệ quan sát trong ít mẫu, không phải quy luật nhân quả hoặc mục tiêu sản phẩm.
  Không đánh đồng bẩn/cũ với thật; không tăng noise/blur tới mức khó nhận nghĩa.
- B ngắn hơn C khoảng 37% theo **số từ** (239 so với 379 từ cho 4 prompt), không phải phép đo token
  hoặc quota. Không có bằng chứng prompt dài hơn luôn tốt hơn.
- Tạm dùng C làm hướng thử cho cảnh trong nhà; nếu B/C cùng đủ tự nhiên với người học thì ưu tiên B
  vì đơn giản hơn. Chưa chốt template chung cho toàn từ điển hoặc gọi là tối ưu toàn cục.

### Artifacts bàn giao

- `index.html`: 4 hàng breakfast/fry/spicy/picnic × 3 cột A/B/C, cùng kích thước hiển thị,
  click ảnh để xem riêng; từng prompt và nhận xét agent được thu gọn để người xem tự đánh giá trước.
- `docs3-phone-prompt-comparison.zip`: 8 PNG mới + 4 A tham chiếu và metadata/prompt/preview.
  Không chứa raw events/cookie/tài khoản. Các file ở local, gitignored; không tạo kho ảnh trên VPS.
- `prompts-english.txt`: 8 prompt nguyên văn; `tested-C-template.txt`: template từ C thực sự đã thử,
  ghi rõ hạn chế older-phone wording. Không tự coi bản rút gọn chưa render là đã kiểm chứng.
- `manifest.json`, `references.json`, `summary.json`: mapping, hash/bytes, timing. Tổng wall clock
  gồm khoảng giữa hai lượt lưu riêng trong summary; không trộn với tổng active runner.

## Kiểm tra / gate / Git

- Script spike cho custom prompt nhận 1..20 sample và ID duy nhất theo `sample_id`,
  cho phép B/C cùng `sense_id`. Default lô 1 vẫn yêu cầu 20 nghĩa khác nhau.
- Marker/checkpoint mới `DOCS3-IMAGES-20261030-BATCH3`; không tự gửi lại khi chưa biết kết quả.
- Trước lô: browser/display/bridge đều active, health app/DB ok, root còn 6.8G.
  Giữ nguyên dịch vụ, không đổi app/DB/ENV/storage hoặc publish; ảnh nhận về local qua SSH.
- Đã kiểm syntax/format/diff, 8 PNG decode/kích thước/hash/nhãn UI và mapping đúng 4 sense,
  4 ảnh A nguyên bytes, ZIP CRC/đủ 12 PNG và links, xem trực quan cả 8 ảnh mới; health sau chạy kiểm lại.
- Không chạy test app vì chỉ spike; không sửa ảnh bằng postprocessing hoặc deploy.
- Gate: chưa có human preference, curation, xác minh rights, test bulk/quota hoặc ảnh tham chiếu thật.
- Git / triển khai: script/plan/report/PROGRESS local chưa commit/push; không deploy/apply DB.
