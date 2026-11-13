# M12 — Handoff BE/FE sau rà soát 12/11 và feedback đã gửi

Ngày: 2026-11-13. Nguồn FE đã đọc: main `00f674d`.

> FE đã gửi kết quả tích hợp dev + API production; chưa deploy FE.
> Xem [phản hồi tiếp nối A19/A20](m12-fe-followup-2026-11-13.md) cho gloss display,
> backfill nghĩa legacy và [bảng mã lỗi/status](m12-error-status-fe-2026-11-13.md).
> Phân biệt bổ sung tiếp nối với release4df8655 đã deploy dưới đây.

**BE đã deploy `4df8655`; bổ sung gloss A19 đã deploy tiếp tại `c77be0a`.**
API production: `https://api.langoo.org`. Proxy/HSTS đã áp dụng và kiểm tra live.
FE có thể tích hợp contract dưới đây; vẫn cần QA giao diện/PWA sau khi FE sửa.
[Report triển khai](../reviews/m12-fe-feedback-remediation-2026-11-13.md) ghi bằng chứng,
giới hạn kiểm tra và các lỗi dữ liệu còn mở. Không có thay đổi source FE trong đợt này.

[Plan BE](../plans/m12-fe-feedback-remediation-2026-11-13.md) ·
[Đối chiếu đủ 18 feedback](../reviews/m12-feedback-crosscheck-2026-11-13.md) ·
[Đối chiếu 12 mục gửi BE](../reviews/m12-fe-audit-crosscheck-2026-11-13.md).

## 1. BE đã có, FE cần dùng đúng

| Khả năng hiện có | FE cần làm | Vì sao |
|---|---|---|
| Quiz kiểm nguồn trước khi tiêu quota/gọi provider | Xử lý 409 QUIZ_NOT_ENOUGH_ITEMS và details available/required ngay trong dialog; bỏ QUIZ_MIN_ITEMS=3 | Sàn hiện là 2 item hợp lệ, không phải 3; matching dùng 4 item/câu. Số từ nhìn thấy không luôn bằng số nguồn hợp lệ |
| `/v1/me/activity` trả today/timezone và review_count từng ngày | Muốn hiện tổng SRS hôm nay toàn tài khoản: lấy days.find(date === today).review_count, ghi phạm vi “tất cả hồ sơ” | Chỉ số này gồm lượt SRS học mới/learning/review, không có quiz |
| `/v1/me/stats.today.review_count` tính hoạt động SRS + quiz | Dùng cho tiến độ mục tiêu hoạt động; không ghép Math.max với SRS reviews_today | Hai chỉ số khác nghĩa và phạm vi |
| `/v1/srs/stats.reviews_today` phục vụ quota của profile | Giữ cho chỉ số quota hoặc đổi nhãn rõ; không gọi đây là tổng mọi lượt học | BE không đổi field vì sẽ làm thay điều kiện daily cap |
| `items_learned` là item đã bắt đầu học | Giữ nhãn “Từ đã học”; nếu cần “Từ đã lưu” thì dùng count riêng đã thống nhất | Không phải tổng item trong sổ hay số từ đã thuộc |
| Dictionary áp primary/secondary language của profile khi có Bearer | Gửi auth cho cả search/suggest/detail; cache key có account/profile/language; không bỏ token để mở kết quả khác scope | Đây là contract M6.2, không phải lỗi lọc nhầm |
| Chat message_count là tổng user + assistant | Nếu chia 2, nhãn phải nói số lượt người dùng gửi; nếu nhãn tổng tin thì dùng nguyên giá trị | Một lượt thành công lưu 2 tin; chưa có bằng chứng BE đếm sai |

Các contract đã đọc: [quiz](../api/quizzes.md), [activity](../api/gamification.md),
[dictionary/scope](../api/dictionary.md), [SRS](../api/srs.md), [chat](../api/chat.md).
Đây là xác nhận source/contract hiện có; không phải thông báo deploy mới.

## 2. FE có thể sửa ngay, không cần chờ BE mới

### FE-01 — Cache theo tài khoản và hồ sơ

- Files chính: `src/lib/account-reset.ts`, `src/contexts/AuthContext.tsx`,
  `src/hooks/use-dictionary.ts`, `src/hooks/use-profile.ts`, `vite.config.ts`.
- Đã xóa cache `langoo-api` khi đổi account, nhưng vẫn coi mọi dictionary query
  ngoài history là public. Kết quả thực tế phụ thuộc hồ sơ; cache RAM chưa có
  account/profile và SW `langoo-dict` chưa dọn theo scope.
- Tách query key theo account/profile/tập language; không dùng dữ liệu guest cho
  account hoặc profile khác. Public sources có thể giữ riêng, không giữ tất cả
  dictionary chung một nhóm. Hủy request cũ, chặn response cũ nạp lại cache mới.
- Ưu tiên bỏ SW cache API cá nhân/scoped thay vì cache chung theo URL; xóa cache
  legacy khi nâng phiên bản, xử lý cả tab khác. Headers BE không tự sửa Workbox.
- QA hai tài khoản, hai profile, đổi language, mạng chậm/offline và request đang
  chạy lúc đổi account; không chỉ kiểm logout online trong cùng một tài khoản.

### FE-02 — Điều kiện quiz

- Files: `src/lib/quiz-errors.ts`, `StartStudyDialog.tsx`.
- Bỏ chặn cố định dưới 3 từ. Tối thiểu 2 là sàn chung, không có nghĩa mọi bộ 2
  từ đều tạo được mọi kiểu đề. Một câu matching cần 4 từ; mỗi item chỉ dùng một
  lần làm nguồn câu hỏi. MC cần nguồn/nhiễu hợp lệ, đồng nghĩa/đa nghĩa có thể bị lọc.
- `item_count` chỉ dùng gợi ý; đừng báo đủ chắc chắn rồi xử lý lỗi lặng lẽ.
  Giữ lỗi inline của BE và số available/required. Không tự viết lại thuật toán
  nguồn BE vào FE. Hiện chưa có endpoint kiểm eligibility trước khi tạo.
- Giữ timeout create quiz 120s và không retry POST tự động. Nếu vẫn chờ lâu khi
  thiếu từ, gửi payload, code/details, timing và phiên bản BE; không chỉ báo “cần 3”.

### FE-03 — Thống kê

- `ProfileStatsSection.tsx`: bỏ Math.max giữa reviews_today và today.review_count.
  `StudyOverview.tsx`: đồng bộ nguồn và nhãn với Hồ sơ.
- Thẻ “Đã ôn hôm nay” toàn user dùng activity review_count. Mục tiêu ngày dùng
  activity_count hoặc me.stats.today.review_count; nhãn nói hoạt động, gồm quiz.
  Giữ số SRS theo profile ở ô riêng nếu cần. Không trộn các số trong cùng một ô.
- Nếu cần tổng SRS riêng profile, gửi yêu cầu field mới; API activity hiện là
  toàn user. Đừng dùng tổng toàn user rồi ghi như thể chỉ profile đang mở.
- QA: chỉ học thẻ mới, lặp learning, chỉ quiz, hai profile, timezone qua ngày.

### FE-04 — Thông báo lỗi

- `src/api/client.ts`: auth code/429/5xx phải map theo locale trước khi chọn
  serverMessage. Chỉ cho qua message nghiệp vụ đã biết, có ý nghĩa với người dùng.
  Bản hiện tại đã chặn một số câu framework nhưng vẫn trả câu BE trước nhánh 429/5xx.
- Giữ chính sách không retry 4xx. Validation details chưa được BE dịch toàn bộ;
  đừng đưa nguyên câu tiếng Anh lên UI VI hoặc ngược lại khi có cách map field/code.

### FE-05 — Lưu 1 chạm và các nhánh còn cần kiểm

- `SenseDetailDialog.tsx`: chọn sổ phù hợp profile/language thay vì mặc định sổ
  gần nhất/đầu danh sách rồi thất bại. Giữ hộp thoại chọn nếu chưa có đích phù hợp.
- Kiểm nút trong thẻ từ và lookup bôi đen, login/register/onboarding/Google,
  pending save dùng một lần và không lưu nhầm qua tài khoản khác.
- Form autofill, phần phát âm quá dài và script e2e cũ vẫn cần QA riêng. Script
  kiểm UI phải chặn ghi nếu không cố ý tạo/xóa dữ liệu; không chạy thử lên tài
  khoản thật rồi coi rác trong sổ là dữ liệu test có thể bỏ qua.

## 3. BE đã deploy; FE cần đồng bộ

Các thay đổi dưới đang chạy trên production tại `4df8655`.
A12 đã sửa thuật toán nhưng dữ liệu “of → nước” vẫn sai và còn xuất hiện ở đầu EN.
Sources đã gộp refresh: probe production READ ONLY, pool2, 10 caller cùng lúc chỉ
8 query; cold 4.577ms, warm 0,33ms. Đây là một mẫu service, chưa phải P95 HTTP.

| Mã | BE đã deploy | FE cần đồng bộ | Lưu ý khi chuyển đổi |
|---|---|---|---|
| M12-A11 — Sources | Gộp refresh đồng thời và đo cold query, giữ payload | Không đổi API; kiểm lần đầu, lần sau, lỗi và retry | Giữ snapshot UI; không coi snapshot đã sửa tốc độ BE |
| M12-A06.1 — Reverse contract | Thêm snake_case chuẩn, giữ aliases camelCase cũ | Đọc canonical, kiểm badge/link; regenerate types theo schema đúng | Giữ snakeKeys adapter, không xóa sớm |
| M12-A12 — Reverse ranking | Chọn nghĩa trước dedup, kiểm assertion/ranking nước/of/水 | Giữ thứ tự server, không đảo lại bằng tần suất | Không hardcode water/水 lên đầu tại FE |
| M12-A17 — Search | Không dấu, romaji variants chung ranking/scope/cursor/history; rà mục romanization rời | Bỏ query ẩn danh phụ và mergeSearchHits trong romaji-n.ts; chỉ gọi một request có auth | Vá việc query phụ bỏ token; không bypass profile để tránh ghi history |
| M12-A18 — Saved membership | Endpoint batch riêng theo user/profile | Thay saved-senses local-only bằng response BE; invalidate đúng mutation | Có thể giữ dấu “vừa lưu trên thiết bị”; không hứa đã biết mọi sổ/mọi máy |
| M12-A19 — Items projection | Items list opt-in include=display, batch sense/Kanji trong trang | Dùng display cho dòng sổ tay; bỏ fetch sense/Kanji từng dòng; chi tiết chỉ tải khi mở | Giảm gọi trùng/lazy load, không tăng rate limit |
| M12-A03/A20 — IP, cache, headers, lỗi | Xác minh IP thực, bảo vệ cache riêng, chuẩn hóa 404/header | FE vẫn sửa SW và map lỗi; xử lý 429 thân thiện | Không chờ BE để sửa lỗi FE-01/04 |

### Contract production để FE tích hợp

**M12-A18:** `GET /v1/me/saved-senses?profile_id=<uuid>&sense_ids=1,2`
Bearer bắt buộc, tối đa 50 sense ID. Không gửi user_id.

```json
{
  "profile_id": "<uuid của hồ sơ thuộc user>",
  "data": [
    {"sense_id": "1", "saved_collection_ids": ["<uuid sổ>"]},
    {"sense_id": "2", "saved_collection_ids": []}
  ]
}
```

Đã lưu = có face tương ứng trong sổ chưa archive của profile đã chọn, đúng ngôn
ngữ hiện tại; paused/known vẫn là đã lưu. Rỗng chỉ có nghĩa chưa lưu trong phạm
vi đó. Lỗi mạng/DB không được hiển thị thành “chưa lưu”. Cùng nghĩa trong hai sổ,
xóa một sổ vẫn phải giữ dấu nếu còn sổ khác. Key có user/profile/IDs, invalidate
sau add/delete/clone/append/archive/đổi profile; không cache response này public.

**M12-A19:** `GET /v1/collections/:id/items?include=display&limit=12&...`
Giữ `data/next_cursor` và mọi field item cũ, thêm `display` khi opt-in:

```json
{
  "sense_id": "1",
  "lemma": "学生",
  "reading": "がくせい",
  "romanization": "gakusei",
  "pos": "noun",
  "kanji": [
    {"literal": "学", "readings_vi": ["học"], "meanings_vi": [], "meanings_vi_machine": false, "meanings_vi_reviewed": false}
  ]
}
```

Đây là object `item.display`, ví dụ minh họa contract đang có trên production.
`display=null` khi không có dữ liệu đọc phù hợp; giữ nghĩa user từ meaning_vi.
Không tự tạo thêm request detail cho mọi dòng khi display đã đủ; bấm mở thẻ mới
lấy examples/links/SVG. Hai cờ meanings_vi_machine/meanings_vi_reviewed giữ
nguồn gốc gloss máy; FE phải hiện badge chưa kiểm duyệt khi machine=true và
reviewed=false. Mục tiêu mỗi lần tải trang chỉ một items request cho dữ liệu dòng.

## 4. Các đề nghị BE chưa/không sửa và lý do

| Đề nghị | Quyết định của đợt này | Lý do / bên xử lý |
|---|---|---|
| Bỏ giới hạn profile để JA tra EN | Chưa đổi | Đúng contract M6.2; cần chủ dự án đổi sản phẩm rồi đồng bộ search/detail/save/cache |
| Thêm quiz precheck | Không thêm lần nữa | Đã có; BE sửa lỗi allocator A07 riêng nếu có repro, FE bỏ ngưỡng 3 sai |
| Đổi reviews_today thành mọi lượt học | Không đổi field cũ | Nó tính quota profile; FE dùng activity cho tổng SRS, tổng theo profile cần field mới |
| Đổi items_learned thành từ đã lưu | Không đổi | Là số item bắt đầu học; giữ nhãn đúng, saved count là tính năng khác |
| Dịch toàn bộ lỗi theo Accept-Language | Chưa làm toàn BE | FE map code giải quyết UI trực tiếp; BE ưu tiên contract/404, giữ details hiện tại |
| Dịch chính thức qua BE | Để đợt riêng | Cần provider, chi phí/quota/cache và notice; treo FE đã có timeout để xử lý trước |
| Tăng rate limit vì quá nhiều request | Không dùng làm cách sửa gốc | Cần sửa IP proxy, giảm N+1 và retry thừa trước |
| Loại mọi Latin/unknown khỏi từ điển | Không làm kiểu lọc này | Có mục từ hợp lệ; BE kiểm metadata mục chỉ phiên âm, không đoán chỉ từ chữ/POS |
| Mở history/report cho khách để hết 401 | Không bỏ auth | FE đã có chặn/hướng dẫn login; backend guard đúng chức năng |
| Logo/model/cache asset/login UX/copy AI | FE phụ trách, không tạo BE task trùng | FE main mới đã có triển khai; cần QA và xác minh deploy, không báo thiếu toàn bộ |

Các mục ngoài phạm vi release vẫn còn mở. Rollout này không tự đóng toàn bộ audit hoặc feedback.

## 5. Ledger BE — bằng chứng triển khai ngày 13/11

Tất cả dòng dưới đã commit/push và deploy code `4df8655` lên VPS production.
[CI thành công](https://github.com/DuongStark/Langoo_Backend/actions/runs/43365114780):
653 unit, 289 E2E và 31 DB3 regression PASS.
[Deploy thành công](https://github.com/DuongStark/Langoo_Backend/actions/runs/43365414363):
build, PM2 reload, health DB OK.

| Mã | Kiểm tra bổ sung trên production | FE có thể chuyển sang |
|---|---|---|
| M12-A03 | Peer Cloudflare thuộc CIDR; IP client không phải edge; XFF giả không đổi client; direct origin bỏ qua CF header giả; duplicate400 | Giữ xử lý429; không tăng quota để che request thừa |
| M12-A11 | Cold4,58s/warm0,33ms service; HTTP sources200, public max-age300 | API giữ nguyên; snapshot UI không thay thế đo cold |
| M12-A06.1 | OpenAPI và reverse HTTP: canonical/aliases bằng nhau | Canonical snake_case; bỏ adapter sau regenerate types và QA FE |
| M12-A12 | Reverse không dấu200, water có trong kết quả; of vẫn đứng trước do dữ liệu | Giữ thứ tự server; chưa thông báo lỗi nước/of đã hết |
| M12-A17 | honyaku trả 翻訳; awateru bị lọc đúng metadata | Một request có Bearer; bỏ query phụ romaji/merge, reset cursor cũ một lần |
| M12-A18 | Route/schema live; không token401; service READ ONLY đúng face và chặn owner khác | Batch membership theo profile, invalidate theo mutations |
| M12-A19 | Đọc12item thật:12display, meaning_vi không đổi; Swagger đủ quality flags | include=display, bỏ N+1 detail từng dòng, giữ badge máy/chưa duyệt |
| M12-A20 | HSTS86400/nosniff/no Express;404 chuẩn/no-store; sources public300s | FE vẫn phải dọn SW/cache cá nhân và map code lỗi |

Production chưa kiểm HTTP có đăng nhập vì chưa có credentials test; membership/
projection đã kiểm HTTP/DB trong CI và đọc service/DB production. Không tạo account,
JWT giả hoặc sửa dữ liệu người dùng để test. Cần FE QA end-to-end trên phiên đăng nhập
hợp lệ, gồm hai account/profile, PWA/offline, save/delete/clone và request đang chạy.

FE gửi lại commit/build môi trường + kết quả QA tương ứng. Kiểm lại các feedback
đã đóng còn sót, không đóng feedback chỉ vì deploy thành công.
DB đọc ngày 13/11 có 27 resolved, không có in_progress; 18 nội dung cụ thể chưa
có admin_note nghiệm thu. Đóng việc cần cả contract và hành vi, không chỉ nhãn.

## 6. Phần còn mở và phạm vi bàn giao

- Dữ liệu assertion216799 “of → nước” chưa correction: cần đối chiếu nguồn,
  bản vá dữ liệu có backup/rollback và kiểm lại reverse. Không giao FE hardcode né lỗi này.
- Sources đã đo trên production; cold4,58s vẫn cần tối ưu nếu muốn nhanh hơn.
  Chưa EXPLAIN rộng, P95 hoặc load test; không kết luận đã giải quyết toàn bộ độ trễ.
- Proxy/HSTS đã áp và kiểm flow hiện tại; chưa truy cập settings Workers/PseudoIPv4
  của zone Cloudflare. Hai host study TLS200; domain API cũ đã bỏ DNS, không dùng làm gate public.
- Cursor search v6: v5 trở xuống trả400 VALIDATION_FAILED; reset pagination một lần.
- Manifest giữ no-store; SVG giữ policy riêng. FE vẫn xử lý legacy SW cache.
- Source FE, schema, ENV và dữ liệu production giữ nguyên. Không tự đổi trạng thái feedback.
- File này là tài liệu để chuyển cho FE; chưa gửi tin/email đến người khác.
