# M12-A03/A20 — Candidate proxy và gate triển khai

Ngày 13/11/2026: **cấu hình local đã validate và chạy harness, chưa áp lên VPS**.
App Express tiếp tục trust loopback; không đọc CF-Connecting-IP trực tiếp.
Đọc VPS chỉ xác nhận Caddy2.11.4 và4host block; chưa kiểm zone settings,
Pseudo IPv4/Workers, mọi đường vào origin và firewallIPv6 trong lượt này.

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

## Khi được giao deploy

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

App middleware A20 xử lý no-store/nosniff và bỏ Express signature ở code local;
Caddy candidate không tự chứng minh code app đã chạy trên production.
