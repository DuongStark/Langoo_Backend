# DOCS1 — Rà soát độ phủ chức năng và API

Ngày: **2026-10-26** (Asia/Bangkok). Source được rà soát: `main` tại `5fc41a7`;
release code vừa deploy `243585a`. Phạm vi: yêu cầu sản phẩm, controller/DTO/service,
handoff FE và Swagger production. Đây là kiểm tra độ phủ contract, không phải chạy
nghiệm thu hành vi của mọi endpoint.

## 1. Kết quả chính

- Source có **93 HTTP operation trong 19 file controller**. Swagger production
  có **93 operation / 75 path**. Đối chiếu method + path: **không có chênh lệch**.
- Luồng tra từ → chọn nghĩa → lưu collection → học/SRS → quiz/chat đã có API.
  Deck có list/preview/clone/append; admin có feedback, report, curation và audit.
- Thiếu rõ theo yêu cầu hiện tại: **M2.3 email verification/recovery**, **M5 tìm
  trong sổ tay**, và **M4 contract phân phối audio phát được**.
- **M9 reminders/devices chưa có API**, đúng quyết định tạm gác ngày 29/09.
- Các tiện ích tài khoản và lịch sử học dưới đây là khoảng trống cho UX mở rộng;
  chưa gọi chúng là vi phạm milestone đã nghiệm thu.

Inventory đầy đủ, gồm source line và mức mô tả Swagger:
[93 operation](docs1-api-inventory-2026-10-26.json).

## 2. Độ phủ hiện tại

| Phạm vi | Số operation | Luồng đã có |
| --- | ---: | --- |
| Auth — M2/M2.2/M2.3 | 8 | register/login/refresh/logout/me, Google login/challenge/link |
| Profile và settings — M3 | 7 | CRUD hồ sơ học, đọc/sửa settings |
| Dictionary — M4 | 11 | search/suggestions/reverse, lexeme/sense/links, kanji/SVG, search history, gloss report |
| Collections và tags — M5 | 16 | CRUD collection/item, tags, deck list/preview/clone/append |
| SRS — M6 | 4 | due/review/stats, thao tác card |
| Phiên học — M7 | 5 | tạo/đọc phiên, đọc câu đã làm, trả lời, kết thúc |
| Gamification — M8 | 3 | stats cá nhân, achievements, đánh dấu đã xem |
| Nhắc nhở — M9 | 0 | đã tạm gác; settings.notify mới là cấu hình JSON |
| Chat — M10 | 9 | phiên/history/message/SSE/quota |
| Quiz — M11 | 4 | sinh/list/detail/start; chấm qua sessions |
| Admin/curation — M13/M14 | 18 | thống kê, user, reports, audit, sửa gloss/mapping/concept |
| Feedback — M13 | 6 | gửi/xem feedback cá nhân; admin đọc/xử lý/ảnh |
| Health và nguồn dữ liệu | 2 | health và sources/credits |
| **Tổng** | **93** | |

## 3. Thiếu hụt đã có căn cứ trong yêu cầu

### M2.3 — Xác thực email và khôi phục mật khẩu

Bốn route trong kế hoạch đợt B chưa có trong source hoặc Swagger live:

- `POST /v1/auth/email/verification/request`
- `POST /v1/auth/email/verify`
- `POST /v1/auth/password/forgot`
- `POST /v1/auth/password/reset`

Ảnh hưởng: tài khoản password mất mật khẩu chưa có luồng tự khôi phục. Register
hiện tự cấp token; không được trình bày như đã có bước xác thực email. Endpoint
Google link **đã có**, không ghi nó vào danh sách route thiếu; phần session/provider
guard của kế hoạch B vẫn cần làm cùng đợt auth này.

Căn cứ: [kế hoạch M2.3 §B2](../plans/m2.3-google-oauth-fixes.md),
[controller auth](../../src/auth/auth.controller.ts).
Gate triển khai: email transport thật, migration và phối hợp client theo plan.

### M5 — Tìm từ trong sổ tay

Yêu cầu sản phẩm có “tìm trong sổ tay”, nhưng
`GET /v1/collections/:collectionId/items` chỉ có `language_id`, `status`, `limit`,
`cursor`; không có `q` hoặc lọc tag. `GET /v1/collections` cũng chưa tìm theo tên.

FE lọc một trang đã tải sẽ bỏ sót item ở trang khác. Nên bổ sung tìm kiếm phía BE
vào route list đang có; không bắt buộc thêm một endpoint search riêng.

Căn cứ: [CONTEXT §1.2](../../CONTEXT-DU-AN.md),
[ListItemsQueryDto](../../src/collections/dto/list-items-query.dto.ts),
[ListCollectionsQueryDto](../../src/collections/dto/list-collections-query.dto.ts),
[items service](../../src/collections/items.service.ts).

### M4 — Audio có key nhưng thiếu contract phát âm thanh

`GET /v1/senses/:id` trả `pronunciations[].audio_key`; backend trả nguyên key,
chưa có `audio_url`, route phân phối audio hoặc quy tắc resolver được tài liệu hóa.
Hai mẫu production đọc trong audit:

- sense `1417625` (cat): có `En-us-cat.ogg` và các tên file khác.
- sense `1744594` (hello): có `En-au-hello.ogg`, `En-uk-hello.ogg`.

Đây là tên file, không phải URL phát trực tiếp. Không kết luận dữ liệu audio thiếu;
thiếu nằm ở contract đưa key thành nội dung phát được. FE có thể đã tự resolve ở
repo khác, nhưng chưa có source FE để xác nhận. Cần thống nhất resolver ở client
hoặc bổ sung `audio_url`/audio route phía BE và quyền sử dụng/attribution tương ứng.

Căn cứ: [kiểu pronunciation](../../src/dictionary/types/dictionary.types.ts),
[mapper dictionary](../../src/dictionary/dictionary.service.ts),
[API dictionary](../api/dictionary.md). Không tải/phát các file audio trong audit.

### M9 — Reminders và push device

Không có controller/module reminders hoặc devices; DTO device lúc login chỉ có
`platform` và `app_version`, chưa nhận push token. Vì vậy `settings.notify` không
đồng nghĩa hệ thống đã gửi nhắc học.

Nếu mở lại M9, cần CRUD lịch nhắc + đăng ký/cập nhật/thu hồi push token, cùng worker
và provider gửi theo plan. Các route gợi ý `GET/PUT /reminders`, `POST /devices`
trong CONTEXT là thiết kế, chưa phải API khả dụng.

Căn cứ: [CONTEXT §7.4/§8](../../CONTEXT-DU-AN.md),
[DeviceInfoDto](../../src/auth/dto/device-info.dto.ts),
[quyết định tạm gác trong PROGRESS](../../PROGRESS.md).

## 4. Khoảng trống cho các màn hình mở rộng

Các route dưới đây là gợi ý để chốt khi mở phạm vi; chưa phải contract đã được duyệt.

| Chức năng | Hiện có / thiếu | Hướng bổ sung |
| --- | --- | --- |
| Tài khoản cá nhân | GET auth/me đọc tên/avatar; không có self-update tên/avatar, đổi password, self-delete account | PATCH me + luồng avatar; đổi password có proof; account deletion thiết kế riêng |
| Quản lý đăng nhập | logout thu hồi phiên hiện tại; không có list/revoke các thiết bị, logout-all, list/unlink identity | API quản lý phiên/identity nếu có màn hình account security |
| Lịch sử phiên học | GET sessions/:id cần biết ID; chưa có GET sessions để tìm lại phiên review/practice | list theo hồ sơ, status, kind, thời gian và cursor |
| Biểu đồ cá nhân | GET me/stats chỉ có tổng và today; chưa có chuỗi ngày/heatmap | thêm stats history nếu FE cần chart; admin timeseries không thay được API user |
| Hiển thị danh sách sổ tay | item trả sense IDs/faces, chưa có lemma/reading; chưa có batch sense-detail public | bổ sung preview cho list hoặc batch lookup để giảm số request trên trang dài |
| Nhập một từ tùy ý ngoài dictionary | create item bắt buộc sense_id; face cũng bắt buộc sense FK | cần chốt “nhập tay” là sửa nghĩa/ghi chú hay custom vocabulary; chưa đủ để thêm route đơn thuần |
| Xóa lịch sử tra từ | mới có GET 50 dòng, chưa có xóa từng mục/toàn bộ | cân nhắc nếu UI có nút xóa lịch sử |
| Quản trị deck trên UI | consumer list/preview/clone/append đã có; admin CRUD/publish deck chưa có | phần mở rộng M14, hiện nội dung deck được vận hành bằng script |

Hồ sơ học (`/profiles`) khác tài khoản cá nhân; PATCH profiles không sửa tên/avatar
của user. Quiz **đã có lịch sử** qua GET quizzes và các session gần nhất trong detail,
không liệt kê lịch sử quiz là thiếu hoàn toàn.

## 5. Contract có endpoint nhưng Swagger chưa đủ mô tả

**39/93 operation** chưa có schema response thành công trong Swagger, trong đó
3 operation đặc thù là chat SSE, SVG và ảnh đính kèm. Còn **36 JSON operation**
thiếu schema, tập trung chat, quiz, feedback, admin/curation và Google challenge/link.

Điều này không chứng minh runtime trả sai; nhiều service dùng TS interface và tài
liệu Markdown có contract. Tuy nhiên FE sinh client từ OpenAPI sẽ thiếu kiểu output.
Cần bổ sung response DTO/schema; ghi rõ SSE/binary content type. Inventory ghi
`success_response_schema` cho từng operation để triển khai bổ sung chính xác.

Đây là phần chưa đủ của mục tiêu OpenAPI đầy đủ ở M12, không cần tạo thêm route.

## 6. Những phần không tính là thiếu API của MVP hiện tại

- Sharing collection, leaderboard tuần, nghe–chọn, AI giải thích đáp án nâng cao:
  thuộc phase/backlog riêng; không suy rằng cứ bảng tồn tại là phải có endpoint.
- Mode review `matching` đã có route qua sessions, payload chọn `option_index` như
  MCQ. Quiz `matching` hỗ trợ bảng cặp và gửi `pairs`. Đây là hai contract khác nhau.
- Tùy chọn difficulty quiz trong yêu cầu cũ đã bị bỏ có chủ đích bởi quiz v2;
  không khôi phục chỉ vì tài liệu gốc còn nhắc đến.
- M14 sửa gloss/mapping/concept đã có API, không còn là mục “chưa làm” như backlog cũ.
- Không có source FE trong repo này; chưa xác nhận các màn hình FE đã tích hợp đúng
  hay đã có resolver audio riêng.

## 7. Thứ tự xử lý đề xuất

1. M2.3 recovery/verification và M5 tìm trong sổ tay: ảnh hưởng trực tiếp luồng user.
2. M4 chốt đường phát audio; bổ sung profile cá nhân nếu giao diện đã có màn sửa.
3. M12 bổ sung schema Swagger cho contract đang live.
4. Lịch sử/biểu đồ cá nhân và giảm request danh sách khi FE cần.
5. M9 thực hiện khi chủ dự án mở lại; các phần phase 2 tiếp tục giữ riêng.

## 8. Kiểm tra, giới hạn và Git

- Đọc yêu cầu/plan/handoff; trích controller decorators bằng TypeScript AST.
- GET `/docs-json` production: parse JSON, đếm route và đối chiếu method/path với
  local sau chuẩn hóa param `:id` ↔ `{id}`; 93/93 khớp.
- GET search/lexeme/sense của `cat`/`hello`: xác nhận key audio từ response live;
  GET health HTTP 200, app/DB OK, timezone UTC.
- Không chạy mutation, không tạo user/phiên, không gọi provider AI, không ghi DB.
  Không chạy lại test app vì chỉ tạo report/inventory, không thay implementation.
- Report và inventory được kiểm link nội bộ/JSON parse; `git diff --check` trước
  kết thúc. Không kết luận toàn bộ 93 endpoint đã được smoke hành vi trong lượt này.
- Git: tài liệu audit đang local, chưa commit/push; không deploy thêm.
