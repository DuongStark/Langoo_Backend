# M12 — Kế hoạch sửa BE và đồng bộ FE sau rà soát 12/11

Ngày: 2026-11-13. Trạng thái: **đã push/deploy code `4df8655`; proxy/HSTS đã áp; còn gate dữ liệu và FE QA**.
[Report triển khai và gate](../reviews/m12-fe-feedback-remediation-2026-11-13.md).

Đầu vào: `docs/fe/ra-soat-2026-11-12.md` (bản FE cung cấp, giữ local),
[đối chiếu BE](../reviews/m12-fe-audit-crosscheck-2026-11-13.md),
[18 feedback và FE mới](../reviews/m12-feedback-crosscheck-2026-11-13.md).
Tài liệu gửi FE: [handoff](../handoff/m12-fe-feedback-sync-2026-11-13.md).

## 1. Mục tiêu và phạm vi

Sửa nguyên nhân ở BE để FE bỏ các bản vá tạm về romaji, contract tra ngược,
trạng thái đã lưu và nguồn dữ liệu chậm. Giảm request sổ tay, giữ đúng phạm vi
hồ sơ, thống nhất số liệu và quy trình nghiệm thu.

Baseline đã kiểm: FE main `00f674d`, BE local/VPS Git HEAD `3bc6388`.
SHA Git không tự chứng minh source/dist/bundle đang phục vụ khớp hoàn toàn.
FE checkout có WIP; chỉ đọc snapshot, không chỉnh sửa FE trong kế hoạch BE.

Làm trực tiếp checkout BE `main`; giữ WIP khác. Không migration, dependency mới,
đổi provider hoặc ENV trong thiết kế ưu tiên. Nếu EXPLAIN chứng minh cần index,
lập migration mới qua workflow DB trước khi áp dụng; không sửa migration cũ.
Push/deploy đã được chủ dự án yêu cầu ở lượt tiếp theo; không tự sửa trạng thái feedback production.

## 2. Danh mục, thứ tự và mã công việc

Các mã M12-A17/A18/A19/A20 được đăng ký mới ở lượt lập plan này. Mã đã có
giữ nguyên; từng đầu ra vẫn báo riêng dưới mã của nó.

| Đợt | Mã + tên | Phạm vi BE | FE phụ thuộc |
|---|---|---|---|
| 1 | M12-A03 — IP client qua proxy | Tiếp tục [thiết kế mục 3](#m12-a03--ip-và-giới-hạn-request); xác minh Cloudflare/Caddy rồi mới đổi cấu hình tin IP | Không tự tăng limit; tiếp tục giảm request |
| 1 | M12-A11 — Gộp refresh sources | Tiếp tục [thiết kế mục 3](#m12-a11--sources), bổ sung đo cold query | Không đổi response; giữ placeholder/cache UI |
| 1 | M12-A06.1 — Contract reverse | Làm riêng phần reverse của [thiết kế A06.1](#m12-a061--reverse-contract), canonical snake_case + aliases cũ | Giữ adapter đến khi release được xác nhận |
| 2 | M12-A12 — Chọn nghĩa tra ngược trước dedup | Tiếp tục [thiết kế A12](#m12-a12--ranking-và-dữ-liệu); kiểm dữ liệu ví dụ nước/of/水 | Hiển thị đúng thứ tự BE, không tự đảo bằng frequency |
| 2 | M12-A17 — Tìm không dấu, romaji và mục phiên âm | Thiết kế cụ thể ở mục 4 | Bỏ query romaji phụ sau BE rollout |
| 3 | M12-A18 — Tra trạng thái nghĩa đã lưu | Endpoint riêng theo user và profile, mục 5 | Thay localStorage saved-only bằng nguồn server |
| 3 | M12-A19 — Dữ liệu hiển thị sổ tay theo trang | Projection tùy chọn trên items list, mục 6 | Bỏ fetch chi tiết cho từng dòng |
| 1–3 | M12-A20 — Cache riêng và lỗi HTTP rõ ràng | Phần app headers/cache/error của mục 7; phối hợp H04 (audit local) | Sửa SW/cache account, map lỗi theo code |
| FE làm ngay | M6/M8.3 — Nhãn và số liệu ôn tập | Giữ nghĩa field; dùng contract đã có ở mục 8 | Bỏ Math.max, chọn đúng nguồn/phạm vi |
| FE làm ngay | M11.1 — Điều kiện và lỗi tạo quiz | Precheck đã có; giữ luật hiện tại ở mục 8 | Bỏ ngưỡng 3; phân biệt matching và item hợp lệ |

M12-A07 phân bổ mixed quiz vẫn theo plan riêng `docs/plans/m12-remediation-2026-11-03/A07-quiz-allocation.md` (WIP local, ngoài release này).
Không đánh đồng với thiếu precheck. Những finding M12-A01/A02 và gate cũ khác
vẫn mở theo bộ plan 03/11; lượt này không xác nhận đã sửa hoặc hạ ưu tiên chúng.

## 3. M12-A03/A11/A06.1/A12 — Cách thực hiện và nghiệm thu

### M12-A03 — IP và giới hạn request

- Đọc cấu hình Caddy/Cloudflare thực tế, lưu metadata đã loại secret, ghi IP
  mà Express nhận. Không suy từ 429 rằng mọi request cùng IP mạng trường học.
- Theo plan A03: chỉ tin peer được xác minh, sanitize header trước Express;
  test hai client đáng tin có bucket riêng, header giả không vượt quota.
- Validate cấu hình và có bản rollback trước rollout; không đổi firewall/SSH.
  Không tăng 120/phút để che N+1; không thử tải lớn trên production.

### M12-A11 — Sources

- `src/sources/sources.service.ts/.spec.ts`: chia sẻ một refresh đang chạy,
  TTL từ lúc hoàn tất; mọi query settle trước mở batch tiếp theo sau lỗi.
- Giữ gộp nguồn máy/credits, body `{data:[...]}`, warmup nền. Cache đã tồn tại
  10 phút, không xây thêm lớp Redis chỉ để xử lý stampede.
- Đo lạnh/ấm riêng trong fixture representative; kiểm từng aggregate và pool
  pressure. Gộp refresh không tự chứng minh request lạnh từ 8 giây thành nhanh.
  Chỉ đề xuất summary/index khi có số đo; không tự trả stale vô hạn với 200.
- Nghiệm thu: 10 cold requests → 8 repo calls thay vì 80; warm request → 0
  repo calls mới; failure/retry/TTL/grouping đúng; lưu latency thực tế.

### M12-A06.1 — Reverse contract

- Files: dictionary service/types/response DTO và service/HTTP tests; docs API.
- `/dictionary/reverse` và `/dictionary/suggestions/reverse`: thêm canonical
  `lexeme_id`, `frequency_rank`, `sense_hint`, `via_lexeme_id`, `via_lemma`,
  `exact_sense`; giữ camelCase aliases hiện có theo A06, đánh dấu deprecated.
- Một mapper sinh cả hai bộ field, equality đúng với null/false/0; bigint là
  string. Chưa xóa alias trong release này; không kéo toàn bộ A06 vào commit.
- Nghiệm thu HTTP + OpenAPI + FE adapter hiện tại nhận được cả response cũ/mới.

### M12-A12 — Ranking và dữ liệu

- Chọn representative tốt nhất trong nhóm text trước khi dedup, giữ metadata
  từ cùng row theo plan cũ; tie-breaker ổn định, limit sau chọn đúng ứng viên.
- Đọc READ ONLY assertions/hint của nước/of/water và đường tới 水; lưu fixture
  tối thiểu có nguồn. Tách sai assertion khỏi sai scoring.
- Tinh chỉnh scoring giữa các nhóm chỉ khi fixture chứng minh tiêu chí phù hợp;
  tần suất không được thay tính đúng nghĩa. Không hardcode “water luôn đầu”.
  Data correction phải có danh sách row, lý do, backup và duyệt apply riêng.
- QA cả en-only/ja-only/both, nguồn có/không hint; ghi rõ A12 thuật toán không
  tự đóng lỗi dữ liệu “nước → of” nếu assertion chưa được xử lý.

## 4. M12-A17 — Tìm không dấu, romaji và mục phiên âm

**Files:** `src/dictionary/dictionary.service.ts`, search/reverse repositories,
cursor helper nếu cần, specs, `test/dictionary*.e2e-spec.ts`, docs API/handoff.
**Endpoints:** search, suggestions, reverse và suggestions/reverse hiện có.
Không thêm request FE hay endpoint dịch mới.

1. Reverse: ưu tiên exact có dấu/case-insensitive trước, fallback đối sánh
   không dấu bằng hàm hiện có khi không có exact; không trả mọi kết quả prefix
   thay cho exact. Kết quả phải giữ query người dùng, scope/limit/dedup.
2. Romaji: giữ query gốc, thêm biến thể phân tách `n` có giới hạn và kana
   tương ứng; dùng chung pipeline scope/ranking/dedup/cursor. Không thay toàn
   bộ ni/nya vì `genin → げにん` cũng có thể là cách đọc hợp lệ.
3. Search có Bearer vẫn ghi đúng một history cho query gốc ở trang đầu;
   suggestions và trang tiếp theo không tạo history phụ. FE không phải bỏ
   auth để tránh lịch sử; biến thể không trở thành từ khóa tra độc lập.
4. Cursor phải đại diện toàn tập đã ghép. Nếu đổi semantics làm cursor cũ
   không hợp lệ, tăng version rõ ràng, trả 400 VALIDATION_FAILED để FE restart
   trang đầu một lần; không đọc cursor cũ như format mới.
5. Rà `awateru`: đọc metadata nguồn/tag/relation trước. Dùng tín hiệu nguồn
   để không đưa mục chỉ tham chiếu romanization thành entry learner độc lập;
   giữ alias tìm từ chuẩn. Không xóa core, không loại mọi Latin/pos unknown.
   Nếu thiếu metadata đáng tin, giữ gate data mở thay vì đoán từ string gloss.
6. Không đổi scope M6.2. `lang`/`to` chỉ thu hẹp tập hồ sơ, không mở EN ở JA-only.

**Test:** nước/nuoc, dấu đúng ưu tiên, đa nghĩa do bỏ dấu; honyaku/hon'yaku,
genin/gen'in và từ có ni/nya hợp lệ; guest/EN-only/JA-only/bilingual; cursor
trang nhỏ không trùng/mất; history một dòng; query `%`, `_`, backslash vẫn
literal. Nếu đụng prefix SQL, phối hợp M12-A14 (escape prefix, đã tích hợp trong A17 của release này).
Chạy EXPLAIN fixture dữ liệu lớn; không đóng bằng unit mock SQL riêng lẻ.

## 5. M12-A18 — Trạng thái nghĩa đã lưu

**Contract đề xuất, chưa có trên server:**

`GET /v1/me/saved-senses?profile_id=<uuid>&sense_ids=1,2,3`

- Bearer bắt buộc; `profile_id` bắt buộc và thuộc user. Mỗi request 1–50 ID
  PostgreSQL bigint dương dạng string, loại trùng, không ép Number.
- Response 200: `{profile_id, data:[{sense_id, saved_collection_ids:[]}]}`.
  Mỗi ID đầu vào có một row, thứ tự theo đầu vào sau dedup; array ID sổ luôn
  đầy đủ, không cắt ngầm rồi diễn giải là chưa lưu. Dùng max50 để chặn batch lớn.
- Membership tính trên face thực tế của item, gồm mặt phụ và item clone;
  chỉ sổ chưa archive thuộc profile đã chọn/user hiện tại, face nằm trong tập
  language hiện tại. Item paused/known vẫn là đã lưu. Không gộp bằng mặt chữ.
- ID không tồn tại/không thấy trong scope trả array rỗng, không tiết lộ metadata
  của sense ngoài scope. Profile lạ/không thuộc user:404 PROFILE_NOT_FOUND;
  query sai:400 VALIDATION_FAILED; thiếu/sai auth:401; dependency fail:503,
  không biến DB lỗi thành mảng rỗng. Định nghĩa đầy đủ code DB fail khi implement.
- `Cache-Control: private, no-store`; không gắn membership vào response dictionary
  đang có nguy cơ cache public/SW theo URL. Không nhận user_id từ client.

**Files:** controller/service/DTO/types membership mới dưới `src/collections`,
module imports, app repository dùng Prisma `app.*`, unit/HTTP tests,
`docs/api/collections.md`, handoff. Không thêm bảng lưu trạng thái song song.

**Test:** user A không đọc B; profile ownership; anchor/secondary/clone;
archived/paused/known; đổi language; cùng sense ở hai sổ, xóa một vẫn còn một;
empty/duplicate/overflow/invalid ID; limit50; DB failure; payload không có
email/ghi chú; query batch không N+1. FE key theo user+profile+IDs, invalidate
sau add/delete/clone/append/archive và đổi hồ sơ/account.

## 6. M12-A19 — Projection hiển thị sổ tay

**Contract đề xuất:** giữ `GET /v1/collections/:id/items`, thêm query tùy chọn
`include=display`. Không gửi include thì response/cursor/order cũ giữ nguyên.

- Khi opt-in, mỗi item thêm `display` null hoặc object gồm `sense_id`, `lemma`,
  `reading`, `romanization`, `pos`, `kanji:[{literal, readings_vi:[], meanings_vi:[]}]`.
  Chuỗi nullable giữ null; arrays luôn array. DTO phải mô tả rõ kiểu, không dùng
  object/unknown để che dữ liệu không chuẩn. Gloss của item vẫn lấy `meaning_vi`
  hiện có, không thay bằng gloss máy nếu người dùng đã chỉnh nghĩa.
- Chọn từ `display_sense_id`/face đang thấy theo profile của collection, không
  tùy tiện chọn anchor đã bị ẩn. Chuẩn hóa readings/meanings Kanji từ nguồn
  hiện có, không gọi dịch hoặc AI. Null display có nghĩa thiếu dữ liệu đọc,
  không có nghĩa item đã bị xóa; DB fail phải trả lỗi, không giả null hàng loạt.
- Batch toàn bộ sense và Kanji phân biệt trong trang; không gọi getSenseDetail
  có links/examples/ảnh rồi lặp từng item. Ownership/language kiểm trước enrich.
  Giữ max100, cursor asc/desc và kết quả phân trang như hiện có.
- Đây là projection dùng cho danh sách, không mang SVG/components/examples
  nặng. Click mở chi tiết vẫn dùng endpoint đơn. Không cần thêm cả hai API
  batch senses/kanji độc lập nếu projection đáp ứng đủ nội dung dòng hiện tại.

**Files:** items controller/service/query/response DTO/types, repository đọc
dictionary batch, collections module và tests; docs collections/handoff.
Không tạo vòng dependency DictionaryModule ↔ CollectionsModule.

**Test:** hai profile/ngôn ngữ khác nhau, anchor ẩn/mặt phụ hiện; từ không có
Kanji/kana/missing readings; một chữ lặp nhiều dòng chỉ batch một lần; 12/100
items không tăng query theo số dòng; no-include không đổi payload; cursor và
meaning_vi người dùng không đổi. QA FE mục tiêu mỗi lần chuyển trang chỉ một
request items cho dữ liệu dòng, không tự bật prefetch detail cho toàn trang.

## 7. M12-A20 — Cache dữ liệu riêng và lỗi HTTP

**Files:** bootstrap, filter, middleware/interceptor cache có phạm vi rõ;
sources/legal/dictionary controllers nếu thêm cache headers; unit/HTTP tests;
API docs/runbook. HSTS thuộc cấu hình HTTPS edge, theo gate H04.

- Tắt `X-Powered-By`, thêm nosniff và kiểm JSON/SVG/attachment/SSE không hỏng.
  Không tự thêm includeSubDomains/preload khi chưa kiểm toàn bộ domain.
- Trả private,no-store cho dữ liệu tài khoản và dictionary có Bearer phụ thuộc
  profile, membership và projection riêng. Không dùng public cache hàng loạt
  cho kanji JSON. Giữ policy SVG đã có và test Vary/authorization phù hợp.
- Sources/legal manifest có thể đặt public max-age ngắn 300s sau kiểm payload
  độc lập account; manifest public HTTP cache chỉ bật khi đã kiểm gate FE không
  dùng notice cũ để grant sai version. Server cache sources và HTTP cache là hai lớp.
- Framework 404 trả NOT_FOUND với câu chung thay vì Cannot GET...; giữ status
  và domain 404 cụ thể. Không thay mã domain/validation details ngoài contract.
- Chưa triển khai i18n toàn BE. FE map known code/locale trước; không dịch tự
  động lỗi DB hoặc tin mọi serverMessage. Không cần dependency Helmet chỉ để
  bật hai header nếu middleware hiện có đáp ứng.

**Test:** success/error/private/public headers, Bearer guest và token invalid,
không cache error auth thành 200, unknown route 404 không echo framework;
SVG/feedback download/chat stream giữ đúng content type/transport.
Headers không tự ngăn Workbox cache tùy biến: FE vẫn phải sửa account/profile.

## 8. Dùng contract đã có thay vì sửa sai ý nghĩa

- **SRS/M8.3:** `/me/activity` có `today` theo timezone và
  `days[date=today].review_count` = mọi lượt SRS toàn user, không quiz.
  Dùng cho nhãn ghi rõ “tất cả hồ sơ”. `/me/stats.today.review_count` = hoạt
  động SRS + quiz; dùng cho mục tiêu hoạt động, không gọi là tổng SRS.
  `/srs/stats.reviews_today` vẫn là lượt tính quota theo profile. Trang nào
  yêu cầu tổng SRS riêng profile cần field mới trong đợt riêng; không lấy max
  hay trừ/cộng các field khác scope. Cập nhật docs giải thích và test mẫu 2 new
  reviews + quiz để FE không vá nhầm; chưa thêm metric mới trong plan này.
- **items_learned:** item đã có ít nhất một SRS introduced_at, không đồng nghĩa
  đã thuộc/số đã lưu. Giữ nhãn “Từ đã học”, không đổi BE thành saved count.
- **M11.1:** precheck đã chạy trước quota/provider, tối thiểu 2 item hợp lệ;
  matching tiêu thụ 4 item/câu, mỗi item tối đa một câu. FE chỉ dùng item_count
  gợi ý, lỗi 409 available/required của BE là quyết định cuối. Chưa xây endpoint
  quiz eligibility; nếu cần preview chính xác, tách task reuse allocator sau A07,
  không sao chép một thuật toán thứ hai vào FE/BE.
- **Chat:** message_count là tổng tin, mỗi lượt thành công lưu user+assistant.
  FE chia hai chỉ khi nhãn nói số lượt gửi; không đổi nghĩa field cho client khác.

## 9. Release, kiểm tra và điều kiện đóng việc

1. FE có thể sửa ngay cache account/profile, thông báo lỗi, quiz min3 và số liệu;
   không cần chờ endpoint mới. BE sửa A03/A11/A20 theo gate từng phần.
2. BE A06.1 trước A12; canonical+aliases tương thích adapter hiện có.
3. BE A17 có unit/DB/HTTP/cursor gate; rollout được xác nhận mới FE bỏ query phụ.
4. BE A18/A19 opt-in và riêng endpoint: rollout BE trước, FE dùng capability đã
   xác nhận. Rollback FE trước nếu cần quay BE về bản thiếu endpoint/projection.
5. Mỗi mục cập nhật ledger handoff: status local/test/commit/push/deploy, SHA,
   môi trường, contract và bằng chứng smoke. Chỉ điền “BE đã sửa” khi có code;
   chỉ yêu cầu FE bật ở production sau xác nhận deploy. Không phát hành tất cả
   chỉ vì một đợt đã pass. Không tự đóng feedback theo status resolved sẵn có.

Kiểm tra khi implement: regression đúng lỗi → suite module → build/lint/full unit;
HTTP/DB trên test database riêng có marker, AI stub; không reset DB production.
Contract mới phải kiểm Swagger và payload thực. Khi chuẩn bị release chạy full E2E
và các gate liên quan; Node22 CI, ghi version/lệnh/số test thực, không kế thừa số
test cũ. Data fix/ops rollout có backup, validate, rollback riêng.

Rollback giữ payload cũ/alias; bỏ FE feature switch trước khi gỡ API mới;
không xóa dữ liệu collection hoặc curation để rollback code. Cursor phiên bản
khác được restart có giới hạn. Không rollback header sang public cho dữ liệu riêng.

## 10. Lịch sử lượt lập plan (trước khi được giao code)

- Thay đổi: plan này, handoff FE, lưu review 18 feedback từ snapshot chỉ đọc,
  liên kết ở review M12 và PROGRESS; không sửa source FE/BE/API đang chạy.
- Kiểm tra: đối chiếu plan cũ/source/contract; 74 link local, 2 JSON ví dụ,
  fence/whitespace của 5 file tài liệu PASS; đủ 18 row feedback, diff check exit0
  và đã kiểm trạng thái working tree.
  Không chạy lại unit/build/DB trong lượt docs; 94 unit pass là kết quả review trước.
- Gate: triển khai và kiểm chứng từng mục, DB/HTTP/browser/ops, chốt sản phẩm ngoài
  phạm vi nếu muốn mở scope hoặc dịch trả phí. Đợt này không đóng milestone M12.
- Git/triển khai tại thời điểm lập plan: tài liệu local; đã được thay bởi trạng thái rollout ở mục11. Giữ WIP khác.

## 11. Theo dõi triển khai 13/11

Đã triển khai A11/A06.1/A12/A17/A18/A19/A20 và proxy A03/HSTS lên VPS tại
`4df8655`. CI653unit/289E2E/31DB3 PASS, deploy workflow success, health DB OK.
Nguồn FE chỉ đọc, không sửa. Không đổi schema/ENV hoặc ghi dữ liệu production.
Sources đo READ ONLY cold4.577ms/warm0,33ms,10caller→8queries; không phải P95.
A12 assertion nước→of còn mở; cold query optimization, CF zone settings và FE
browser/PWA/authenticated QA còn gate. Xem report và ledger handoff đã cập nhật.
Các trạng thái local ở mục10 là nhật ký trước khi được yêu cầu rollout.
