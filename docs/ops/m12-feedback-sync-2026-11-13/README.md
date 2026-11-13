# M12-A03/A20 — Candidate proxy và gate triển khai

Ngày 13/11/2026: **đã áp cấu hình lên VPS, validate/reload và kiểm tra live PASS**.
App `4df8655` qua CI/deploy workflow thành công. Express tiếp tục trust loopback,
không đọc CF-Connecting-IP trực tiếp. Candidate giữ comment lịch sử “Not deployed”
của bản trước rollout; nội dung snapshot này đã áp, không sửa byte cấu hình sau nghiệm thu.

- [Caddyfile.candidate](Caddyfile.candidate) giữ4host đã đọc, thêm trust CF CIDRs,
  lấy resolved client_ip rồi ghi đè XFF cho API, xóa header CF trước Node.
  Header nhiều giá trị/repeated field bị400; invalid IP fallback peer theo Caddy.
- [cloudflare-cidrs.json](cloudflare-cidrs.json) lưu22CIDR từ hai endpoint chính
  thức ngày13/11, checksum của chuỗi CIDR theo thứ tự +newline. Không dùng
  private_ranges hoặc allow-all để thay Cloudflare. Shell fetch bị403, snapshot
  lấy qua web tool từ cùng hai nguồn; nội dung parse bằng ipaddress trước lưu.
- Global trusted_proxies áp Caddy server; hai ứng dụng study khác được giữ
  policy XFF=remote_host để không tự thay scope IP của dịch vụ ngoài Langoo API.
- Candidate HSTS max-age86400 chỉ trên API HTTPS, không includeSubDomains/preload.
  Không bật public HTTP cache manifest khi gate notice version FE chưa kiểm.

Nguồn kỹ thuật:
[Caddy options](https://caddyserver.com/docs/caddyfile/options),
[request matchers](https://caddyserver.com/docs/caddyfile/matchers),
[replacer v2.11.4](https://github.com/caddyserver/caddy/blob/v2.11.4/modules/caddyhttp/replacer.go),
[Cloudflare IPv4](https://www.cloudflare.com/ips-v4),
[IPv6](https://www.cloudflare.com/ips-v6).

## Kiểm tra local

Image caddy:2.11.4-alpine digest
sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b.
`caddy validate --config /config/Caddyfile.candidate --adapter caddyfile`:PASS.
Harness `node scripts/review/m12-proxy-smoke.cjs`:PASS sau khi thêm reject
multi-value. Dùng Caddy thật→Express configureHttpProxy thật→Nest throttler
storage, client synthetic loopback và hai IP test không phải người dùng thật.

Hai client qua cùng peer trusted có bucket riêng; đổi XFF giả không reset quota;
untrusted dùng TCP peer; IPv6 client được resolve; invalid fallback peer;
header dạng comma-list và duplicate-lines bị400. Harness đầu phát hiện Caddy
chấp nhận phần tử cuối trong header nhiều giá trị, nên đã thêm guard và chạy lại.
Không thêm debug-IP endpoint vào production. Harness tự dọn container/files tạm.

## Quy trình rollout / rollback

1. Kiểm mode zone/Workers/PseudoIPv4 và đường truy cập3000/IPv6. Kiểm CIDR mới
   từ nguồn chính thức; nếu retrieval/parse/checksum fail thì dừng, giữ bản cũ.
2. Backup Caddyfile hiện tại, đọc diff với candidate và các thay đổi khác từ lúc
   tạo snapshot. Không chép đè host mới của dịch vụ khác. Giữ phiên SSH.
3. Validate bằng Caddy version thực tế; reload chỉ sau validate. Kiểm health/TLS,
   cả domain API mới/cũ và hai host study; không sửa firewall/SSH trong bước này.
4. Xác minh IP/bucket trên lưu lượng tổng hợp hữu hạn đã được cho phép, không
   spam login live; lưu metadata đã sanitize. Chỉ lúc này đóng gate live A03/HSTS.
5. Rollback Caddyfile backup nếu health/TLS lỗi, validate rồi reload. Rollback
   có thể làm rate limit lại gộp edge; không tăng quota để che việc đó.

## Kết quả rollout thực tế

- Backup `/opt/langoo/storage/ops/m12-feedback-20261113/` root-private gồm
  Caddyfile.before, source-before.tar.gz (baseline3bc6388), dist-before.tar.gz.
  Không commit artifact server hoặc secrets. Candidate khớp4host trước áp,
  validate bằng Caddy2.11.4 thực tế, install/reload PASS, final khớp snapshot.
- CF CIDR đã đối chiếu lại nguồn chính thức trước áp. Không sửa CF zone settings.
  Request thật qua CF: peer thuộc CIDR, resolved IP là client; XFF giả không đổi
  client. Direct origin dùng peer, bỏ qua CF header giả. Duplicate header400;
  CF edge tự chặn header CF giả403. Harness local đã kiểm tách bucket/quota.
- Log tạm chỉ match nonce, không lưu request headers;6record đã xác minh, gỡ
  config logging ngay sau probe và reload final. Không có public debug endpoint.
  [Bằng chứng sanitize](../../reviews/m12-feedback-release-2026-11-13/proxy-verification.json).
- HTTP health DB OK, TLS/HSTS86400/nosniff/no Express. Hai host study TLS200.
  Domain API cũ langoo-api.pixpress.art đã bỏ DNS public từ trước; dùng api.langoo.org.
- Firewall default deny, allow22/80/443 cả IPv4/IPv6, không mở3000; không sửa firewall.
- Zone Workers/PseudoIPv4 chưa đọc qua CF API, chỉ xác nhận flow hiện tại thực tế.
  Không kết luận mọi Worker mode đều đã kiểm.
- App middleware đã chạy production: private/no-store, sources public300s,
  unknownroute404 NOT_FOUND, manifest vẫn no-store; SVG giữ policy riêng.
- [Receipt release](../../reviews/m12-feedback-release-2026-11-13/release-receipt.json)
  và [report](../../reviews/m12-fe-feedback-remediation-2026-11-13.md).

Rollback proxy: khôi phục Caddyfile.before về /etc/caddy/Caddyfile, validate rồi
reload; kiểm health/TLS lại. Không rollback DB vì release này không migration/data.
Nếu rollback app, dùng bản build/source đã backup và quy trình PM2 hiện hành;
rollback có thể làm mất contract A18/A19 nên phải báo FE trước khi chuyển consumer.
