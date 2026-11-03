# DOCS4 — Handoff khắc phục pháp lý cho BE, FE và vận hành

Ngày: **03/11/2026**. Đây là thiết kế DOCS4 ban đầu. **Handoff FE hiện hành:** [M12.1 — Privacy FE](m12.1-privacy-fe-2026-11-03.md), gồm API đã code và gate chưa triển khai.

**Quyết định đã chốt:** bỏ mốc 13, phục vụ mọi độ tuổi; không thay bằng 16+ hoặc tự thu ngày sinh/CCCD. Cơ chế người đại diện cần triển khai riêng, không tự đánh dấu đã xác minh. Các phương án tuổi bên dưới chỉ còn giá trị lịch sử và đã được quyết định này thay thế.
Nguồn: [audit DOCS4](../reviews/docs4-vietnam-legal-audit-2026-11-03.md),
[plan DOCS4](../plans/docs4-vietnam-legal-audit-2026-11-03.md).

## 1. Kết luận và phạm vi giao việc

**BE cần bổ sung khả năng thực thi và chứng minh lựa chọn riêng tư; FE cần thông báo,
thu nhận lựa chọn và hiển thị quyền dữ liệu đúng với khả năng thực tế của BE.** Chỉ
sửa câu chữ hoặc thêm checkbox FE chưa đủ. API tự phục vụ xóa tài khoản không phải
điều kiện pháp lý mặc định: giai đoạn đầu có thể dùng email + quy trình xử lý có kiểm chứng.

Tài liệu này phân công việc và đề xuất contract để hai đội thống nhất. **Các route,
field và mã lỗi mới bên dưới chưa tồn tại, chưa được deploy; FE không gọi chúng trước
khi BE bàn giao OpenAPI và xác nhận rollout.** Quyết định tuổi/căn cứ xử lý/nhà cung cấp
cần chủ dự án và chuyên gia pháp lý chốt trước triển khai phần phụ thuộc.

Kiểm HTTP công khai lại trong lượt handoff: main bundle `/assets/index-D0op7NmE.js`,
legal chunk `/assets/LegalArticle-BQhu6Kvg.js`, SHA256
`05ada9ce217a1ed4c8dd19b934368216d46f21068525a6af588b7f7998a9b472`.
Chunk vẫn chứa “30 ngày”, “13 tuổi”, Groq/MyMemory; không có chuỗi “20 ngày”, “16 tuổi”.
Đây là đọc bundle tĩnh, chưa nghiệm thu render hoặc network E2E. Không dùng hash này
để suy ra commit FE hay nội dung mọi màn hình.

## 2. Phân công theo phát hiện

| Mục audit | BE cần làm | FE cần làm | Chủ dự án / ops / pháp lý |
|---|---|---|---|
| R1 — căn cứ/đồng ý | Lưu event và version; kiểm quyền xử lý ở điểm gọi dịch vụ ngoài; cơ chế rút lựa chọn | Thông báo rõ trước xác nhận; không tích sẵn; email/Google cùng quy tắc; cho từ chối mục đích tùy chọn | Chốt mục đích nào cần consent, mục đích nào có căn cứ khác |
| R2 — quyền dữ liệu/SLA | Runbook tiếp nhận, xác minh, xuất/sửa/xóa/hạn chế; theo dõi deadline; có thể làm thủ công trước | Sửa policy VI/EN, thêm hướng dẫn và lối gửi yêu cầu dễ tìm; phân biệt gửi yêu cầu với đã xóa | Có người theo dõi mailbox và xử lý thực, lịch ngày làm việc |
| R3 — trẻ em | Enforce policy tuổi đã chốt ở cả đăng ký email và Google tạo user mới; hỗ trợ đại diện nếu phục vụ trẻ | Cùng policy ở đăng ký, Google, điều khoản và tài khoản cũ | Chọn phục vụ dưới16 với luồng đại diện hay giới hạn từ16; không tự đổi sản phẩm |
| Y1 — chủ thể | Metadata controller/contact/version đồng nhất | Hiển thị thông tin chủ thể thật, liên hệ và quyền | Cung cấp danh tính, địa chỉ/kênh liên hệ phù hợp; không dùng placeholder để phát hành |
| Y2 — retention/xóa | Map mọi store, file ảnh và dữ liệu vendor; job xóa có retry và kiểm kết quả | Xóa cache thiết bị đúng phạm vi; không gọi archive là xóa vĩnh viễn | Retention backup/log, khôi phục không tái tạo dữ liệu đã xóa |
| Y3 — bên thứ ba | Inventory provider thực, payload tối thiểu, xử lý rút/chặn theo căn cứ | Khai báo đúng bên nhận và dữ liệu gửi, cảnh báo theo ngữ cảnh | DPA, địa điểm, hồ sơ đánh giá tác động/miễn cụ thể; không suy miễn chỉ vì quy mô nhỏ |
| Y4 — PDF/dịch | Không cần API dịch mới nếu FE vẫn gọi trực tiếp; nếu thêm proxy phải thiết kế riêng | Chặn fallback mạng trước lựa chọn, giải thích chữ được chọn có thể gửi đi; chế độ chỉ local | Chốt nhà cung cấp dịch được phép, điều kiện xử lý/lưu nội dung |
| Y5 — analytics | Kiểm log URL/query phía API, redaction và retention | Đo payload Vercel, scrub dữ liệu cá nhân, áp căn cứ/lựa chọn đúng | Chốt analytics thực sự ẩn danh hay còn xử lý dữ liệu cá nhân |
| Y6 — điều khoản | Hỗ trợ workflow khiếu nại theo cơ chế đã chọn | Nội dung thay đổi điều khoản/quyền chấm dứt, kênh khiếu nại | Luật sư rà điều khoản và tư cách hoạt động |
| Y7 — sự cố/AI | Audit nội bộ, phân quyền, quy trình phát hiện/chặn và hỗ trợ sự cố | Nhận diện AI/cảnh báo phù hợp, kênh báo sai | Người phụ trách, phân loại AI, sự cố/72h khi đủ điều kiện; xác minh nghĩa vụ an ninh mạng |

## 3. Công việc BE

### BE-01 — Danh mục mục đích, version và bằng chứng lựa chọn

- Lập purpose registry với mã ổn định, mô tả VI/EN, căn cứ xử lý, loại dữ liệu,
  bên nhận, yêu cầu đồng ý và version thông báo. Các mục đích tài khoản, AI, dịch,
  analytics cần được đánh giá riêng; không tự đánh dấu tất cả là bắt buộc.
- Terms acceptance, đã đọc thông báo riêng tư và consent xử lý dữ liệu là các
  sự kiện khác nhau. Không lưu một boolean `accepted_all=true` để thay cả ba.
- Với xử lý cần consent: lưu user/subject scope, purpose, lựa chọn grant/withdraw,
  version nội dung, thời điểm **server**, nguồn thao tác và idempotency để retry không
  tạo lịch sử mâu thuẫn. Giữ lịch sử thay vì overwrite bằng boolean cuối cùng.
- Không cần log mật khẩu/token, toàn bộ chat, ảnh, IP đầy đủ hoặc user-agent để chứng
  minh mọi consent. Chỉ giữ bằng chứng tối thiểu, có retention và phân quyền.
- Đăng ký email và **Google tạo tài khoản mới** cần cùng gate. Đăng nhập Google vào
  tài khoản đã có không được tự ghi thêm consent hoặc âm thầm coi người đó đã đồng ý.
- User cũ thiếu bằng chứng là `unknown/needs_action`, không backfill giả `granted`.
  Việc xử lý thiết yếu tiếp tục hay dừng phải dựa trên căn cứ đã chốt cho từng mục đích.
- Privacy settings typed riêng; không nhét consent tùy ý vào `notify` JSON của
  `PATCH /v1/me/settings`, vì field đó dành cho thông báo M9.

Files tham khảo: `src/auth/dto/register.dto.ts`, `google-login.dto.ts`,
`src/auth/auth.service.ts`, `src/auth/oauth/google-oauth.service.ts`, `src/users/`,
`src/ai/chat/chat.service.ts`, `src/ai/quiz/quiz.service.ts`.
Nếu cần bảng/event mới: viết migration mới đúng số tiếp theo và đồng bộ Prisma theo
quy trình DB; handoff này không tự apply schema hay dùng bảng lõi từ điển để lưu PII.

### BE-02 — Thực thi lựa chọn và phiên bản

- Kiểm server-side trước gọi provider chat/quiz nếu xử lý đó cần consent; client
  sửa localStorage hay gọi thẳng HTTP không được vượt gate. Một cảnh báo FE không
  thay thế kiểm BE cho dữ liệu BE chuyển đi.
- Khi rút lựa chọn: ghi trạng thái trước khi báo thành công; request mới không
  được gọi vendor trái lựa chọn. Xác định race giữa check và provider dispatch;
  hủy request chưa gửi nếu làm được. Dữ liệu đã gửi không thể thu hồi bằng cách đóng UI:
  phải theo quy trình vendor và ghi rõ giới hạn.
- Nếu version cũ còn hiệu lực thì không ép consent lại chỉ vì đổi dấu câu. Thay đổi
  mục đích/phạm vi cần đánh giá có cần xác nhận lại; không coi dùng tiếp là consent mới.
- Chốt lỗi domain và mô tả OpenAPI cho lỗi thiếu lựa chọn/version cũ; không trả500,
  không để FE refresh-token/retry vô hạn đối với lỗi yêu cầu người dùng quyết định.

### BE-03 — Quyền dữ liệu: tối thiểu làm được qua vận hành

Có thể mở email tiếp nhận trước, dùng sổ/ticket có phân quyền theo dõi. Phải có
request ID, loại quyền, received_at, deadline, người xử lý, phương thức xác minh,
trạng thái và bằng chứng kết quả; không bắt phải viết UI admin mới mới bắt đầu làm.

- Xác minh đủ để tránh xuất/xóa nhầm người; không mặc định phải thu CCCD. Tài khoản
  Google-only phải có đường xác minh phù hợp, không bắt nhập mật khẩu Langoo chưa từng tạo.
- Xuất bản sao dữ liệu qua kênh riêng tư, thời hạn ngắn, tránh secret/hash/token hoặc
  dữ liệu người khác; kiểm ownership ở cả request status và download.
- Xóa tài khoản gồm account/identities/sessions, profile, học tập, chat/quiz, ảnh
  feedback và các store liên quan theo bản đồ dữ liệu. Không chỉ `deleted_at`, archive
  chat hoặc DELETE profile. Bản ghi buộc phải giữ theo căn cứ khác phải được phân loại,
  hạn chế mục đích và thông báo phù hợp, không hứa xóa tuyệt đối rồi giữ âm thầm.
- Xóa file storage là side effect ngoài transaction DB: có queue/outbox hoặc job
  retry theo ownership, completion record và kiểm orphan. Không báo hoàn tất khi file
  vendor/storage còn pending mà chính sách hứa đã xóa.
- Khi bắt đầu pha xóa không thể đảo ngược, đóng session/vô hiệu credential phù hợp,
  chặn job/request đang chạy ghi lại dữ liệu. Kiểm Google login không khôi phục nhầm
  user cũ; đăng ký mới về sau không được phục hồi dữ liệu đã xóa.
- Runbook restore backup phải áp lại danh sách xóa/hạn chế trước mở phục vụ; backup
  có vòng đời hữu hạn và quyền truy cập, không cam kết “chu kỳ tiếp theo” không thời hạn.

### BE-04 — Retention và nhà cung cấp

Rà `ChatRetentionJob` (mặc định 180 ngày không hoạt động, có thể tắt), scheduler thực,
search-history giữ50 dòng, `feedback_attachment`, OAuth challenges, log/cache/backup.
Đây là cơ chế sẵn có, không đồng nghĩa mọi store có retention đủ. Chốt retention theo
mục đích, chạy job idempotent/bounded trên dữ liệu test; không xóa production để chứng minh.
Kiểm vendor thực từ cấu hình được phép đọc đã sanitize, không suy từ tên adapter
`openai`. Không ghi key/connection string vào handoff.

## 4. Công việc FE

### FE-01 — Sửa nội dung đang công khai, làm được trước API mới

- **Giữ trang hiện có**, sửa `src/components/legal/content.ts`,
  `src/components/legal/LegalArticle.tsx`, các page privacy/terms và i18n liên quan.
  Main FE a4e1a64 đã có `pages/privacy-policy/index.tsx`,
  `pages/terms-of-service/index.tsx`; bundle audit có `/privacy`/`/terms`.
  Xác minh route/redirect thực trước sửa và giữ các URL đã khai báo Google OAuth.
- Policy phải có chủ thể thật, dữ liệu/mục đích/bên nhận, retention từng nhóm, quyền
  rút/hạn chế/phản đối, cách xác minh/gửi yêu cầu và thời hạn. Đồng bộ VI/EN và ngày/version.
- Sửa blanket30 ngày: phản hồi2 **ngày làm việc**; xem/sửa/cung cấp10 ngày;
  rút/hạn chế/phản đối15 ngày; xóa20 ngày. Phân biệt mốc riêng bên xử lý/bên thứ ba
  và gia hạn có điều kiện/thông báo theo Điều5 NĐ356. Không biến mọi mốc thành ngày làm việc.
- Nội dung phải phản ánh quy trình đã có người thực hiện. Không công bố “xóa ngay”,
  “không gửi dữ liệu”, “không lưu” hoặc tên vendor khi chưa kiểm được.
- Điều khoản không dùng câu “tiếp tục sử dụng = đồng ý mọi xử lý mới”. Rà quyền
  chấm dứt/khiếu nại và trách nhiệm bắt buộc với chuyên gia pháp lý.

### FE-02 — Đăng ký email/Google và tài khoản cũ

- Hiển thị link policy/terms và thông báo mục đích ngay ở bước liên quan. Consent
  cần thao tác rõ ràng, không tích sẵn; chấp nhận terms và đồng ý mục đích tùy chọn tách riêng.
- Google Sign-In không phải consent cho Langoo gửi chat, ảnh hoặc dữ liệu sang
  dịch vụ khác. Email/Google tạo user mới phải có cùng policy tuổi/quyền riêng tư.
- Gửi version và lựa chọn đúng contract BE đã phát hành. Nếu lưu thất bại thì giữ
  pending/retry có kiểm soát, không hiện “đã lưu” chỉ vì localStorage đã đổi.
- Với user cũ: màn hình bổ sung lựa chọn theo trạng thái BE; không gán sẵn tất cả
  granted. Cho hủy/quay lại và vẫn mở được policy/kênh quyền dữ liệu.
- Files tham khảo: `src/pages/register/index.tsx`, `src/components/auth/`,
  `src/contexts/AuthContext.tsx`, `src/api/auth.ts`, `src/types/api.ts`.

### FE-03 — AI, dịch và PDF

- Trước lần sử dụng cần lựa chọn: nêu tin nhắn/ảnh/ngữ cảnh nào gửi cho vendor thực,
  mục đích và liên kết policy. Không gửi request trước khi người dùng xác nhận khi
  căn cứ đã chốt yêu cầu consent; từ chối AI không khóa tra từ/học không dùng AI.
- PDF: “file không upload” khác với “đoạn chữ được chọn không gửi đi”. Hiển thị:
  “Tệp PDF được đọc trên thiết bị. Khi dùng dịch trực tuyến, đoạn chữ được chọn sẽ
  được gửi tới dịch vụ dịch.” Nội dung này là gợi ý copy, cần khớp runtime cuối.
- Có lựa chọn **chỉ xử lý trên thiết bị**. Khi on-device unavailable/timeout, không
  tự fallback Google/MyMemory nếu chưa có lựa chọn phù hợp. Hiện trạng không hỗ trợ
  dịch local thì nói rõ; không tự bật mạng để tránh báo lỗi.
- Gate ở shared translation dispatcher, không chỉ ở một nút: kiểm cả trang dịch,
  bôi đen PDF, lookup tooltip/dialog và OCR→dịch. Hủy/từ chối phải chặn mọi nhánh.
- Mỗi lần đổi vendor/phạm vi dữ liệu phải đánh giá version/lựa chọn; không đổi
  vendor âm thầm sau khi user chọn “chỉ local”. Nút clear cache xóa đúng translation
  cache, không xóa PDF hoặc ghi chú chưa lưu của người dùng.
- Files: `src/lib/translate.ts`, `src/hooks/use-lookup.ts`,
  `src/components/lookup/LookupTooltip.tsx`, `TranslationDetailDialog.tsx`,
  `src/pages/translate/index.tsx`, `src/pages/pdf/index.tsx`, các caller OCR.

Khách chưa đăng nhập vẫn dùng dịch/PDF: lựa chọn theo thiết bị là một UX gate, không
được gọi là consent đã được server lưu cho tài khoản. Nếu muốn bằng chứng server cho
khách phải thiết kế riêng với dữ liệu tối thiểu; không thu thêm danh tính chỉ để có log.

### FE-04 — Trang quyền riêng tư trong hồ sơ và analytics

- Thêm lối “Quyền riêng tư & dữ liệu”: xem lựa chọn, rút mục đích tùy chọn, yêu cầu
  bản sao/sửa/xóa/hạn chế, chỉ rõ ảnh hưởng từng tính năng.
- **Làm ngay:** link/email yêu cầu và hướng dẫn rõ ràng, trước khi có ticket API.
  Mailto mở ứng dụng email không chứng minh email đã gửi/được nhận; không báo request
  accepted hoặc đếm SLA từ thao tác bấm mailto.
- **Sau BE:** hiển thị trạng thái request; `received/processing` chưa phải `completed`.
  Không dùng logout/revoke Google thay cho xóa dữ liệu tại Langoo.
- Vercel Analytics: kiểm payload/network cho page URL/query/referrer/custom event,
  loại email/token/nội dung dịch/tên tài liệu. Nếu xử lý cần consent, gate trước nạp/gửi;
  chưa quyết định cần banner thì không tự áp banner cho mọi cookie thiết yếu.
- Khi logout/xóa: clear cache đúng user và xử lý tab/stream liên quan. Không xóa dữ
  liệu local chưa lưu mà không thông báo; phân biệt xóa server và xóa file người dùng sở hữu.

## 5. Contract BE–FE đề xuất để chuẩn bị tích hợp

**Đề xuất, chưa triển khai.** Dùng `/v1`, snake_case, error envelope hiện có.

| Giao diện dự kiến | Contract và quyền |
|---|---|
| `GET /v1/legal/manifest` | Public: version policy/terms, purpose registry, vendor notice, URLs VI/EN và policy tuổi đã duyệt; không PII. FE dùng version server, không tự suy từ ngày UI. |
| `GET /v1/me/privacy` | JWT: lựa chọn từng purpose và version, trạng thái needs_action, policy áp dụng. Không trả record người khác. |
| `POST /v1/me/privacy/events` | JWT: purpose_id, action grant/withdraw, notice_version, request_id cho dedup; timestamp/user_id do server xác định. Trả trạng thái đã lưu; unknown purpose/version invalid phải lỗi rõ. |
| Đăng ký email/Google tạo mới | Mở rộng DTO bằng legal context đã version hóa; server kiểm và lưu cùng bước tạo user hoặc onboarding hạn chế quyền tương đương. Không tạo user fully-enabled rồi bỏ qua bước consent khi client đóng trang. |
| API ticket quyền dữ liệu — phase sau | Tạo/xem yêu cầu scope current user; received khác completed. Loại quyền, auth/reauth, export/download và retention ticket phải thiết kế trước, không giả dùng DELETE profile. |

Ví dụ payload **minh họa** event:

```json
{
  "purpose_id": "ai_assistance",
  "action": "grant",
  "notice_version": "<version-BE-da-cong-bo>",
  "request_id": "<UUID-do-client-tao-giu-nguyen-khi-retry>"
}
```

Purpose `ai_assistance` là tên đề xuất, chưa phải enum production. Reuse request_id
với body khác phải reject; retry cùng body không sinh consent kép. BE bàn giao DTO,
status/schema response và error code cụ thể trước khi FE viết tích hợp. Không gửi
những field này vào auth hiện tại vì whitelist/forbidNonWhitelisted sẽ reject.

Các lớp kiểm consent phải có guard/policy ở BE; UI là lớp trình bày. Với dịch gọi
trực tiếp từ browser, gate nằm ở FE dispatcher; thêm auth API không thể kiểm soát
request browser gửi thẳng vendor. Không đưa API key nhà cung cấp lên FE.

## 6. Những quyết định còn cần chốt và rollout

| Quyết định | Phần phụ thuộc |
|---|---|
| Chủ thể controller và người theo dõi quyền dữ liệu | Policy, manifest, mailbox/runbook |
| Căn cứ từng mục đích và vendor được phép | Consent UI, ledger, enforce AI/dịch/analytics |
| Có phục vụ dưới16 không | Policy tuổi FE/BE; nếu có phải thiết kế đại diện và quyền trẻ; không auto chọn16+ |
| Retention DB/file/log/backup/vendor | Nội dung policy, jobs và nghiệm thu xóa |
| Email/manual trước hay ticket/self-service ngay | Scope API/privacy center và nguồn lực vận hành |

Thứ tự: (1) chốt chủ thể/căn cứ/tuổi và người xử lý yêu cầu; (2) FE sửa thông tin
đúng hiện trạng và gate mạng tại chỗ, vận hành mở quy trình email; (3) BE triển khai
manifest/ledger/API có test, contract additive; (4) FE tích hợp; (5) kiểm tương thích
client cũ rồi mới bật enforce. Không mở cửa bỏ kiểm vô thời hạn để giữ client cũ:
đặt deadline/rollout và quyết định chặn tính năng xử lý ngoài hoặc yêu cầu cập nhật.
Rollback UI/BE không được làm mất lịch sử rút consent hoặc tự grant lại.

## 7. QA và tiêu chí đóng gate

- [ ] Policy VI/EN và manifest cùng version, truy cập công khai được; URL OAuth cũ còn hợp lệ.
- [ ] Email/Google tạo mới, user cũ và hai tab: lựa chọn thật được lưu đúng chủ thể,
  từ chối/rút không bị overwrite bởi retry/tab cũ; server rejects bypass API.
- [ ] Unknown/stale version, request_id trùng khác body và lỗi DB không báo lưu thành công.
- [ ] Trước grant/sau withdraw: không có request vendor từ các luồng AI cần consent;
  kiểm cả stream/chat/quiz, từ chối không khóa tính năng độc lập.
- [ ] Network PDF/bôi đen/OCR/dịch: chế độ local-only không gửi text/ảnh tới vendor,
  kể cả khi model local tải lỗi/timeout và khi user chưa đăng nhập.
- [ ] Tuổi dưới13/13–15/từ16 theo policy đã duyệt ở cả FE/BE; quyền người đại diện nếu áp dụng.
- [ ] Diễn tập request quyền dữ liệu trên tài khoản giả: deadline, xác minh, dữ liệu
  xuất không lẫn user khác; xóa không còn file orphan/credential active hoặc job ghi lại.
- [ ] Backup restore test và vendor deletion có record, không dùng dữ liệu thật để test.
- [ ] Analytics payload không có PII trong query/event; quyết định consent có căn cứ.
- [ ] FE không gọi archive/logout/DELETE profile là xóa tài khoản; mailto không báo đã nhận.
- [ ] BE unit/HTTP/DB, Swagger và FE browser/network QA có kết quả theo từng release;
  migrations/ENV/ops được ghi riêng. Test chưa chạy phải để mở.

Các checkbox trên là **gate tương lai, chưa chạy trong lượt viết handoff**.

## 8. Căn cứ, giới hạn và trạng thái bàn giao

Các yêu cầu gắn R1–Y7 kế thừa căn cứ chi tiết tại audit DOCS4: Luật91/2025/QH15
(26/06/2025, hiệu lực01/01/2026), Điều4/9/10/20–24/33/38;
[NĐ356/2025/NĐ-CP](https://vanban.chinhphu.vn/?docid=216387&pageid=27160)
(31/12/2025, hiệu lực01/01/2026), Điều5–7; Luật Trẻ em102/2016/QH13 Điều1;
Luật AI134/2025/QH15 Điều11 và các văn bản liệt kê trong audit.
API/event ledger/local-only là giải pháp kỹ thuật đề xuất, không phải tên API do luật yêu cầu.

Đã đối chiếu source BE hiện tại, FE main archive a4e1a64 và bundle công khai mới;
kiểm link/format/diff ở bước bàn giao. Chưa sửa BE/FE/schema, chưa chạy test chức năng,
chưa commit/push/deploy tài liệu lượt này. Quyền push M4.5 ở lượt trước không được
hiểu là yêu cầu tự push handoff pháp lý.

### Giới hạn & Khuyến nghị

Đây là handoff kỹ thuật từ audit sơ bộ, không phải kết luận tuân thủ hoặc ý kiến tư
vấn pháp lý chính thức. Chưa xác minh đủ hồ sơ chủ thể, hợp đồng vendor, runtime,
miễn trừ và toàn bộ nghĩa vụ ngành. Người phụ trách/chuyên gia pháp lý cần xác nhận
căn cứ, độ tuổi, SLA/ngoại lệ và hồ sơ trước phát hành; kiểm lại văn bản hiện hành
tại vbpl.vn/Thư Viện Pháp Luật. Không tự yêu cầu logo TMĐT, di chuyển toàn bộ DB,
banner cookie cho mọi cookie hay chứng nhận AI rủi ro cao khi chưa đủ điều kiện áp dụng.
