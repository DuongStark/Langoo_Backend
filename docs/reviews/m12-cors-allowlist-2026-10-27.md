# M12 — CORS allowlist localhost + langoo.org (2026-10-27)

## 1. Yêu cầu

Chủ dự án: "cái cors sửa thành localhost, langoo.org và www.langoo.org sau đó
push git."

Bối cảnh: API VPS trong `docs/ops/vps-deployment.md` đang để mở hoàn toàn
(`CORS_ORIGINS=*`) từ 28/09/2026 vì chưa chốt domain web; việc siết CORS đã nằm
trong danh sách "nên làm tiếp" của M12. Đây là phần hardening CORS của M12, không
mở milestone mới.

## 2. Thay đổi

| Nơi | Trước | Sau |
| --- | --- | --- |
| `src/config/cors.ts` | `raw` rỗng → `null` (tắt CORS); chỉ nhận origin chính xác hoặc `*` | Thêm `DEFAULT_CORS_ORIGINS` = `http://localhost:*`, `https://langoo.org`, `https://www.langoo.org`; `raw` rỗng → dùng mặc định; entry có `*` được dịch thành RegExp nên `http://localhost:*` khớp mọi cổng dev; giữ nguyên ý nghĩa `*` đứng riêng = cho phép mọi origin (dev) |
| `src/main.ts` | Log `corsOrigin.join(', ')` (vỡ khi có RegExp) | Log qua `describeCorsRule()` |
| `src/config/cors.spec.ts` | 3 test cũ theo semantics "trống = tắt" | 7 test: mặc định, fallback rỗng, `*`, danh sách, khớp cổng localhost (kể cả ca âm), giữ nguyên origin thường |
| `.env.example`, `src/config/env.schema.ts`, `README.md`, `render.yaml` | Ghi "bỏ trống = tắt CORS", Render đặt `'*'` | Ghi rõ mặc định allowlist; Render blueprint dùng `'http://localhost:*,https://langoo.org,https://www.langoo.org'` |
| `docs/fe/chat-streaming.md` | "CORS đang mở `*`" | Allowlist mới |
| `docs/ops/vps-deployment.md` | `CORS_ORIGINS=*` được ghi như cấu hình hiện tại; tồn đọng "siết khi FE ổn định" | Ghi mặc định mới của repo, và **xác nhận `.env` VPS đo 27/10 vẫn là `CORS_ORIGINS=*`**, cần sửa + restart mới có hiệu lực |

Vì sao mặc định 3 origin đó thay vì để "trống = tắt": môi trường nào quên khai
báo `CORS_ORIGINS` sẽ tự cho web chính thức và dev localhost, không còn phải dựa
vào `*`. Muốn tắt hẳn CORS thì gọi `parseCorsOrigins(raw, [])` (không dùng qua
ENV); không còn cách tắt bằng biến rỗng.

Cách khớp: `*` trong một entry được dịch thành `[^/]+` (không chứa `/`), đủ cho
cổng dev bất kỳ hoặc subdomain; mọi ký tự khác được escape nên origin thường
không bị hiểu thành regex. `http://localhost:*` không khớp
`https://localhost:5173`, `http://localhost` (không cổng) hay `http://localhost.evil.dev`.

## 3. Kiểm tra

- Node 22.22.2.
- `npx jest src/config/cors.spec.ts`: 1 suite/7 test pass.
- `npm run build`: pass; `npm run lint`: pass (exit 0, `--max-warnings 0`).
- `npm test`: 60 suite/528 unit pass (2026-10-27, Node 22.22.2).
- Chưa chạy E2E, không gọi API VPS, không đổi `.env`/runtime VPS, không deploy.

## 4. Gate còn thiếu

1. `.env` VPS vẫn `CORS_ORIGINS=*`; sau khi deploy code mới cần sửa dòng này
   (hoặc bỏ hẳn để dùng mặc định) rồi `sudo -u langoo -H pm2 restart langoo-api`.
2. Trước khi siết phải xác nhận origin thật của web; nếu web còn chạy ở domain
   khác `langoo.org`/`www.langoo.org` thì trình duyệt sẽ bị chặn CORS.
3. Kiểm header `Access-Control-Allow-Origin` thật từ browser/curl với `Origin`
   hợp lệ và không hợp lệ sau khi restart; chưa làm trong lượt này.

## 5. Git

Code + tài liệu của M12 được commit cùng lượt và push `main` theo yêu cầu chủ dự
án. Hash cụ thể ghi ở `PROGRESS.md` sau khi commit.
