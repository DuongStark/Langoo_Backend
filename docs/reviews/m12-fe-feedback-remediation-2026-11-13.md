# M12 — Sửa BE và đồng bộ FE sau rà soát 12/11

Ngày: 2026-11-13. **Đã push/deploy VPS code `4df8655`, proxy/HSTS đã áp; đã kiểm tra live.**

[Plan](../plans/m12-fe-feedback-remediation-2026-11-13.md) ·
[Handoff FE](../handoff/m12-fe-feedback-sync-2026-11-13.md) ·
[Review 18 feedback](m12-feedback-crosscheck-2026-11-13.md).

## 1. Kết quả theo mã

| Mã + tên | Thay đổi đã lưu | Trạng thái / giới hạn |
|---|---|---|
| M12-A11 — Sources refresh | Một refresh đang chạy dùng chung cho warmup/request; chờ mọi query settle trước mở lượt mới; TTL sau hoàn tất; clone cache trước trả | Unit/HTTP PASS. Production probe cold4,58s/warm0,33ms; chưa P95/load test |
| M12-A06.1 — Reverse contract | Canonical snake_case và camelCase alias cùng mapper; Swagger có type/null/deprecated rõ | Unit/OpenAPI/HTTP PASS. Không làm toàn bộ A06 nullable/schema inventory cũ |
| M12-A12 — Representative trước dedup | Chọn JA row exact hint trước loại trùng; tie-break ổn định; serialize sau ranking, không lộ ordinal nội bộ | Regression/HTTP PASS. Chưa sửa assertion nước→of trong DB thật; không hứa 水 đã vào top |
| M12-A17 — Search/romaji/VI | Giữ query gốc, thêm n-separated/kana variants cùng scope/ranking/cursor/history; reverse không dấu khi không có exact; prefix escape wildcard; ẩn entry JA metadata romanization | Unit/DB/HTTP PASS; cursor v6, v5 cũ trả400. Không xóa core hoặc bỏ mọi Latin/unknown |
| M12-A18 — Saved membership | GET /v1/me/saved-senses, profile ownership, max50 bigint IDs, face/secondary/clone, unarchived, đúng language; transaction RepeatableRead; lỗi đọc503 | Unit/HTTP/DB PASS. API đã deploy; FE cần tích hợp và QA đăng nhập |
| M12-A19 — Items projection | include=display opt-in; chọn face hiện được; hai core queries cho sense/Kanji cả trang; giữ meaning_vi; giữ cờ machine/reviewed | Unit/HTTP/DB PASS; không đổi payload khi omit include. FE chưa bỏ request từng dòng |
| M12-A20 — Cache và lỗi HTTP | Middleware private,no-store mặc định, nosniff, bỏ Express signature; sources public300s; lỗi no-store; framework404 câu chung | HTTP PASS. Manifest giữ no-store; SVG giữ policy riêng; HSTS86400 đã apply và kiểm live |
| M12-A03 — Proxy IP | Giữ Express trust loopback, unit trust boundary; Caddy2.11.4 candidate + CF CIDRs + harness thật | Local và live PASS flow CF/direct origin; zone settings Workers/PseudoIPv4 chưa có quyền đọc |

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
  handoff ledger và plan. API đã có trên production tại `4df8655`.

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
- Baseline Caddy2.11.4 có4host, thiếu trusted_proxies; sau rollout đã áp candidate,
  validate/reload PASS. Không đổi firewall hoặc CF zone settings.

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

## 5. Rollout và kiểm tra production ngày 13/11

- Code commit/push `4df8655f395640bb4ba425e98bdac48784e0a263`.
  [CI43365114780](https://github.com/DuongStark/Langoo_Backend/actions/runs/43365114780)
  PASS653unit/289E2E/31DB3 regression. Full unit CI gồm flags Kanji cuối cùng.
  [Deploy43365414363](https://github.com/DuongStark/Langoo_Backend/actions/runs/43365414363)
  success: build Node22, PM2 reload, health DB OK.
- Backup root-private `/opt/langoo/storage/ops/m12-feedback-20261113/`:
  Caddyfile.before, source-before.tar.gz và dist-before.tar.gz. Candidate4host
  validate trước/sau install, reload thành công, config cuối khớp candidate.
- Proxy dùng request thật qua Cloudflare và direct origin: peer thuộc CF CIDR,
  resolved IP là client, XFF giả không đổi client; direct origin không tin CF
  header giả; duplicate CF header400. Header CF giả qua edge bị Cloudflare403.
  Log tạm chỉ6request có nonce, loại headers, không có public debug endpoint;
  đã gỡ logging tạm và reload final config. Chi tiết [ops](../ops/m12-feedback-sync-2026-11-13/README.md).
- [HTTP smoke](m12-feedback-release-2026-11-13/http-smoke.json):8checks PASS,
  health DB UTC; OpenAPI route/aliases/quality flags; honyaku→翻訳; awateru không
  lọt JA; reverse nuoc có water và alias khớp; sources200/public300s; noJWT401;
  unknownroute404/NOT_FOUND. HSTS86400/nosniff và bỏ Express signature xác nhận live.
- [Probe production](m12-feedback-release-2026-11-13/production-probe.json):
  compiled service thật, database langoo, default_transaction_read_only=on,
  timeout30s, pool2.10call sources đồng thời→8repositorycalls, cold4.577ms,
  warm0,33ms,32groups. Cache process riêng lạnh, không flush DB buffer cache.
  Đây không phải HTTP P95 hay so sánh kiểm soát với baseline8s.
- Service/DB production READ ONLY: membership khớp face thật, chặn owner khác;
 12item/12display; meaning_vi giữ nguyên. Không ghi dữ liệu, không tạo user/JWT.
  HTTP production có auth chưa kiểm vì không có credentials test; CI có HTTP/DB.
- Hai host study TLS200; domain API cũ không còn DNS public. Firewall hiện default
  deny incoming, chỉ22/80/443 mở cảv4/v6,3000 không mở; không sửa firewall.
- Source FE không sửa. Không apply migration/correction, không đổi ENV/CF zone
  hoặc trạng thái feedback. Runtime evidence không chứa secret/email/user IDs.

- Kiểm tài liệu sau rollout:55link trong staged checkout,13JSON artifact/ví dụ
  PASS, fences cân bằng, diff --check PASS và đã kiểm working tree. Hai JSON
  fragment lịch sử trong dictionary.md giữ nguyên, không tính là JSON mới pass.
  Commit cuối chỉ13file docs/PROGRESS/artifact, không build/test lại code đã CI xanh.

## 6. Gate còn thiếu và bàn giao

- Assertion216799 “of → nước” còn sai, live reverse vẫn xếp of trước water.
  Cần đối chiếu nguồn, correction có backup/rollback, kiểm semantic reverse sau apply.
- Cold sources4,58s còn chi phí count trên DB lớn; chưa tối ưu SQL/EXPLAIN rộng,
  chưa P95 dưới tải. Coalescing đã xác nhận, không gọi toàn finding latency đã đóng.
- Chưa kiểm settings Workers/PseudoIPv4 qua Cloudflare API; flow CF hiện tại đã kiểm.
- FE tích hợp membership/projection/romaji một request; sửa SW/cache scope,
  quiz ngưỡng3, metric/nhãn và lỗi. Browser/PWA hai account, auth HTTP live,
  onboarding/save/delete/clone và tình huống offline còn cần FE QA.
- M12-A01/A02/A07 và audit cũ khác không tự hoàn tất do release này.
- Git/triển khai: code đã commit/push/deploy như trên; bộ docs/receipt cập nhật
  sau rollout được chốt bằng commit tài liệu riêng. WIP khác giữ ngoài commit.

## 7. M12-A19/A20 — Tiếp nhận phản hồi FE sau tích hợp 13/11

- FE báo dev+production QA A17/A18/A19 localeVI và sửa FE-01/02/03,394unit/build
  pass; chưa commit SHA/deploy FE. Đây là kết quả FE tự báo, không dùng thay QA BE.
- A19 bổ sung gloss_en/gloss_vi+VI quality flags trong cùng projection query,
  dùng serve.sense_card như API detail; không thay meaning_vi item. A20 bổ sung
  [bảng lỗi/status cho FE](../handoff/m12-error-status-fe-2026-11-13.md), không đổi runtime code/status.
- A19 backfill script plan/apply/rollback, pin database/hash/count, row lock/recheck,
  backup private fsync trước commit. Chỉ untouched source exact gloss_en, không
  user/edited/custom; máy/chưa duyệt giữ meaning_source=machine. Production
  scan chỉ đọc240safe candidate,2user không thể phân biệt autofill/tự nhập.
- Lượt integration đầu11/12pass: test so gloss với sai cấp detail.body thay vì
  detail.body.card; sửa assertion envelope, không sửa response API để khớp test.
  Backfill test đã pass ngay lượt đầu, kiểm stale/hash/skip/apply/rollback.
- Trạng thái runtime/tests/Git bổ sung ở handoff tiếp nối sau nghiệm thu.

- Kiểm tra tiếp nối: Node22.23.3 full72suite/654unit PASS (155,774s),
  4suite/32HTTPDB PASS (110,835s), build PASS. DB test riêng đã giữ nguyên
  guard loopback/name_test; không reset DB production.
- Production backfill đã COMMIT240mục, verify READ ONLY240/240 khớp, nguồn
  machine;2user giữ nguyên. Backup private fsync trước commit, hash+count pin,
  không rollback thử production. Receipt sanitize đã lưu, không chứa item/user ID.
- Lint lượt đầu13lỗi Prettier trong spec; đã sửa format, full lint --max-warnings0 PASS exit0.
- Docs49link/fences/JSON/diff/status PASS; giữ WIP khác ngoài commit.
