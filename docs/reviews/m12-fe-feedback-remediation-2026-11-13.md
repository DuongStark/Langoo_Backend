# M12 — Sửa BE và đồng bộ FE sau rà soát 12/11

Ngày: 2026-11-13. **Đã code và kiểm tra local; chưa commit/push/deploy.**

[Plan](../plans/m12-fe-feedback-remediation-2026-11-13.md) ·
[Handoff FE](../handoff/m12-fe-feedback-sync-2026-11-13.md) ·
[Review 18 feedback](m12-feedback-crosscheck-2026-11-13.md).

## 1. Kết quả theo mã

| Mã + tên | Thay đổi đã lưu | Trạng thái / giới hạn |
|---|---|---|
| M12-A11 — Sources refresh | Một refresh đang chạy dùng chung cho warmup/request; chờ mọi query settle trước mở lượt mới; TTL sau hoàn tất; clone cache trước trả | Unit/HTTP PASS. Chưa đóng yêu cầu latency lạnh production 7,8–8,3 giây |
| M12-A06.1 — Reverse contract | Canonical snake_case và camelCase alias cùng mapper; Swagger có type/null/deprecated rõ | Unit/OpenAPI/HTTP PASS. Không làm toàn bộ A06 nullable/schema inventory cũ |
| M12-A12 — Representative trước dedup | Chọn JA row exact hint trước loại trùng; tie-break ổn định; serialize sau ranking, không lộ ordinal nội bộ | Regression/HTTP PASS. Chưa sửa assertion nước→of trong DB thật; không hứa 水 đã vào top |
| M12-A17 — Search/romaji/VI | Giữ query gốc, thêm n-separated/kana variants cùng scope/ranking/cursor/history; reverse không dấu khi không có exact; prefix escape wildcard; ẩn entry JA metadata romanization | Unit/DB/HTTP PASS; cursor v6, v5 cũ trả400. Không xóa core hoặc bỏ mọi Latin/unknown |
| M12-A18 — Saved membership | GET /v1/me/saved-senses, profile ownership, max50 bigint IDs, face/secondary/clone, unarchived, đúng language; transaction RepeatableRead; lỗi đọc503 | Unit/HTTP/DB PASS. API mới chỉ local; FE chưa dùng |
| M12-A19 — Items projection | include=display opt-in; chọn face hiện được; hai core queries cho sense/Kanji cả trang; giữ meaning_vi; giữ cờ machine/reviewed | Unit/HTTP/DB PASS; không đổi payload khi omit include. FE chưa bỏ request từng dòng |
| M12-A20 — Cache và lỗi HTTP | Middleware private,no-store mặc định, nosniff, bỏ Express signature; sources public300s; lỗi no-store; framework404 câu chung | HTTP PASS. Manifest giữ no-store; SVG giữ policy riêng; HSTS mới ở candidate chưa apply |
| M12-A03 — Proxy IP | Giữ Express trust loopback, unit trust boundary; Caddy2.11.4 candidate + CF CIDRs + harness thật | Local validate/harness PASS; zone/Workers/PseudoIPv4/live rollout còn gate |

Không đổi provider/quota/SRS scheduler, profile scope M6.2, DB schema, ENV hoặc
code FE. Không apply migration/data trên production. Không tự đóng feedback.

## 2. File và contract

- Sources: `src/sources/sources.service.ts/.spec.ts`, controller cache header.
- Dictionary: service/spec/types/response DTO, search/reverse repositories,
  cursor và specs; update test search cursor sangv6.
- Membership: `src/collections/saved-senses.controller.ts`, service/spec,
  `dto/saved-senses.dto.ts`, module wiring.
- Projection: items controller/service/spec/query/response DTO/types,
  `repositories/sense-lookup.repository.ts/.spec.ts`, `dto/item-display.dto.ts`.
- HTTP: `src/common/http-security.middleware.ts`, AppModule, bootstrap,
  exception filter/spec; proxy comment/spec.
- Integration: `test/m12-feedback-sync.e2e-spec.ts` gồm11test; proxy harness
  `scripts/review/m12-proxy-smoke.cjs` và [ops candidate](../ops/m12-feedback-sync-2026-11-13/README.md).
- Consumer docs: [collections](../api/collections.md), [dictionary](../api/dictionary.md),
  handoff ledger và plan. API không còn chỉ là đề xuất nhưng chưa có trên production.

Membership giữ ID string, trả từng input sau dedup với saved_collection_ids;
profile sai ownership404, query sai400, guard401/503, lỗi đọc503
COLLECTION_READ_UNAVAILABLE. Projection có thêm meanings_vi_machine và
meanings_vi_reviewed để không làm mất dấu gloss máy/chưa duyệt khi flatten
JSON Kanji; FE phải hiện badge khi machine=true/reviewed=false. Đây là bổ sung
nhỏ so với draft plan để giữ bất biến chất lượng, không gọi dịch hoặc AI.

## 3. Dữ liệu thực đã kiểm chỉ đọc

Qua SSH/pg READ ONLY với statement_timeout10s, không lưu connection string:

- `awateru`, lexeme2127137, nguồn wiktextract, posunknown nhưng có metadata
  `attributes.wikt_pos=romanization`. Sense1606231 có tags Rōmaji/alt-of/romanization
  và definition chỉ dẫn về あわてる. Code chỉ dùng marker chính thức, không đoán
  qua chuỗi definition và không xóa dữ liệu.
- Assertion216799, nguồn wiktextract, source_key
  `wikt:55028:sense:8:translation:1`: of → nước, hint introducing an epithet.
  Water cũng có assertion nước với hint inorganic compound H₂O. Tần suất of4
  đứng trước water288; comparator JA không thể tự sửa một assertion EN sai nghĩa.
  **Chưa apply correction**. Cần kiểm nguồn, chốt correction row và backup riêng;
  không hardcode từ water hay loại preposition toàn bộ chỉ để ví dụ trông đúng.
- Caddy live version2.11.4; config4host chưa có trusted_proxies. Chỉ đọc config,
  chưa reload/restart hay đổi firewall/CF zone.

## 4. Kiểm tra đã chạy

### RED và lỗi bắt được trong quá trình làm

- Trước code: sources warmup +10call chạy11lượt listSources thay vì1; reverse
  thiếu canonical field; honyaku thiếu hon'yaku/ほんやく:3regression FAIL đúng lỗi.
- Full unit lần đầu:1test helper đọc nhầm tagged-template thành Prisma.Sql;
  sửa test để compose bằng Prisma.sql. Không dùng unit pass để thay SQL integration.
- Full E2E lần đầu bắt alias cl2 không tồn tại ở nhánh surface/reading khi thêm
  lọc romanization; đã chuyển filter về lexeme_priority và nhánh canonical có
  alias hợp lệ. Dừng lượt full cũ; chạy lại dictionary+API mới32test PASS,
  sau đó reset riêng DB test và chạy lại full33suite/289test PASS.
- Proxy harness đầu cho thấy comma-list/duplicate CF header chọn phần tử cuối;
  đã thêm guard reject400 dùng placeholder join các field, chạy lại PASS.
- Có một lượt lint đọc file test khi đang ghi và báo parse error; source parser
  và prettier kiểm lại không lỗi. Kết quả nghiệm thu dùng lượt lint sau cùng.

### Kết quả cuối

| Kiểm tra | Kết quả |
|---|---|
| Full unit Node22.23.3, Jest --runInBand | 72suites/653tests PASS |
| Unit module sau bổ sung flags Kanji | 3suites/28tests PASS |
| Full HTTP/DB E2E Node22.23.3 | 33suites/289tests PASS, 283,391s |
| Target dictionary/API sau sửa alias | 3suites/32tests PASS |
| Build Node22 | PASS, exit0 |
| ESLint --max-warnings0 | PASS, exit0 |
| Caddy2.11.4 candidate validate | PASS; cảnh báo header_up ở hoststudy là chủ ý giữ policy peer cũ |
| Caddy→Express→Nest throttler harness | PASS: hai client tách bucket, spoof không reset quota, untrusted/invalid dùng peer, IPv6, multi/duplicate400 |
| Docs links/JSON/fences/diff/status | 37link local/4JSON ví dụ/22CIDR+checksum PASS;34file source/test whitespace+Prettier PASS; diff check exit0, đã kiểm working tree |

Full unit chạy trước phần flags cuối;3suite28test kiểm lại đúng vùng thay đổi.
Full E2E kết thúc sau cập nhật flags/Swagger. AI dùng stub, không gọi vendor thật.
Log lỗi forced rollback/AI fail và MaxListeners warning có trong E2E; suite vẫn
pass. Chưa coi warning hay suite pass là bằng chứng không còn vấn đề ngoài phạm vi.

DB test Docker postgres17 riêng `langoo_m12_feedback_test` tại loopback55439,
container label M12-feedback-20261113; đã xác minh target trước reset, có marker
database. Migrate tới049 chỉ trong DB test; không reset local data-Langoo/VPS.
Container DB test của lượt này đã dừng sau kiểm tra, không dừng dịch vụ khác.
Fixture đếm sources/explain cũng READ ONLY:10coldrequests→8repoqueries,
cold19,81ms/warm0,48ms; reverse planning7,887ms/execution0,299ms. Đây là dump
test nhỏ, không đại diện dữ liệu production hay SLO8giây. Probe dùng1pgclient
có cảnh báo query queue deprecated; runtime Prisma dùng pool như trước.

## 5. Gate còn thiếu và bàn giao

- Chưa commit/push/deploy; chưa cập nhật Caddy/Cloudflare/ENV trên VPS. A03/HSTS
  cần rollout/health/TLS/IP thực theo runbook, giữ scope các host khác.
- Chưa correction assertion216799 hoặc kiểm semantic rộng của reverse. A12
  thuật toán đã sửa nhưng finding dữ liệu nước/of và vị trí 水 chưa đóng.
- Chưa benchmark cold sources/EXPLAIN quy mô production hoặc xác nhận P95 dưới tải.
- FE sửa theo handoff: cache account/profile/SW, quiz min3, metric, message;
  chờ deploy rồi dùng membership/projection, bỏ romaji query ẩn danh phụ. Giữ
  adapter canonical trong chuyển tiếp. Chưa browser/PWA2account/onboarding.
- M12-A01/A02/A07 và các finding audit cũ khác không tự hoàn tất do release này.
  Các tài liệu/phạm vi WIP khác giữ nguyên; Git status có thay đổi từ trước.
