# M10.1 — Review và sửa streaming

Ngày: **2026-10-05**. Branch `parallel/gpt-m10-stream`, base **`4d43752`**
(đã tích hợp bản sửa M13). Phạm vi theo `docs/parallel/gpt.md` ở worktree chính.

## Finding và bản sửa

Đã sửa **7 P2 + 1 P3** trong phạm vi chat/provider chat, không đổi migration,
dependency, cấu hình chung hoặc runtime quiz/admin/feedback.

| ID | Mức | Bằng chứng trước sửa | Bản sửa / ca hồi quy |
| --- | --- | --- | --- |
| S01 | P2 | `streamMessageWithLease` emit start trước gọi provider; test provider lỗi trước delta vẫn nhận event start, controller đã gửi HTTP 200 | Chỉ emit start ở delta có nội dung đầu; empty delta không chặn retry. E2E lỗi sớm trả JSON 503, busy/quota/ownership trả JSON trước headers. |
| S02 | P2 | Parser đọc từng data line, nuốt malformed JSON, bỏ qua DONE và chấp nhận EOF sau partial text; test nhận `okextra` sau DONE | Parse theo event, ghép nhiều data line, CR/LF/CRLF và UTF-8 qua chunk. Yêu cầu DONE hoàn chỉnh, reject truncated/error/malformed frame, cancel và release reader khi hoàn tất. |
| S03 | P2 | Controller nghe request.close; service/stub không chặn persist sau abort, retry delay vẫn cho lần gọi kế tiếp | Theo dõi response.close, gỡ listener/heartbeat, check signal ở prepare/provider/transaction; delay có thể hủy. Unit mock adapter không tuân signal; E2E client abort thật, DB lease và transaction rollback. |
| S04 | P2 | Lỗi DB không phải DomainException sau delta bị throw vào JSON exception filter; service unit rejected với lỗi SQL thay vì event terminal | Mọi lỗi persist trả một event error đã lọc nội dung; mã domain được giữ. Controller bảo vệ lỗi phát sinh sau headers. E2E CHECK tokens_out lỗi sau user INSERT rollback cặp/counter/usage. |
| S05 | P2 | Timeout tự abort bằng Error tên Error; real HTTP timeout test trả Error thay vì lỗi được retry policy nhận diện | Dùng DOMException TimeoutError; nhận diện abort theo name để hỗ trợ lỗi qua realm. Provider timeout và abort kiểm thử bằng server HTTP local thật. |
| S06 | P2 | Lease = một timeout + 30s, nhưng retry có hai timeout; mặc định lượt retry thành công gần 120s vượt lease 90s | Lease bao trọn 2 timeout + 700ms backoff + 30s grace, mặc định 150,7s. Test mô phỏng lần đầu timeout 60s, lần sau thành công sau 59s và kiểm tra commit vẫn hợp lệ. |
| S07 | P2 | httpError copy body upstream vào exception; service warn ghi error.message; test log có private-prompt/test-only-key | HTTP error chỉ giữ status, bỏ/cancel body; log provider chỉ giữ phân loại HTTP/abort/failure, không copy prompt/key/body từ upstream. |
| S08 | P3 | Token usage kiểm tra number >= 0 nên nhận 1e300 hoặc số lẻ; test trả 1e300 thay vì estimate | Chỉ nhận integer không âm trong phạm vi int PostgreSQL; usage sai fallback estimate. Áp dụng cả chat thường và streaming. |

Lần chạy trước sửa của các test provider/service: **19 test fail / 17 pass**,
tái hiện lỗi event sớm, parser, timeout, cancel/persist và log. Nhóm controller bổ sung
sau đó xác nhận request body close khác response socket close.

## Kiểm chứng

- `npm run build`: **pass**, Node 22.22.2.
- `npm run lint`: **pass** toàn repo; sau bổ sung ca CR/CRLF, ESLint hai file
  parser/provider test thay đổi cũng **pass**, 0 warning.
- `npm test -- --runInBand`: **48 suite / 371 test pass** trên bản sửa cuối cùng.
  Bổ sung **31 unit regression** so với base M13.
- E2E chat: **4 suite / 31 test pass**, gồm **10 regression M10.1 mới**:
  `chat-stream-fixes`, `chat-stream`, `chat`, `chat-m10-fixes`.
  Các suite HTTP/DB mới kiểm tra status JSON, một terminal event, rollback,
  ownership/quota, busy giữa hai endpoint, archive/expire và client disconnect thật.
- `git diff --check`: **pass**.

```sh
nvm use
npm run build
npm run lint
npm test -- --runInBand
npm run test:e2e -- --runTestsByPath test/chat-stream-fixes.e2e-spec.ts test/chat-stream.e2e-spec.ts test/chat.e2e-spec.ts test/chat-m10-fixes.e2e-spec.ts
```

Lỗi DB CHECK/503 xuất hiện trong log E2E là ca test chủ động tạo. Các lần chạy
trung gian đã sửa fixture quota (quota config 0 vốn fallback mặc định), cách điều
khiển native backoff timer trong test, và lỗi lint của các mock; không ghi nhận
chúng thành finding runtime. Chưa chạy toàn bộ E2E ngoài phạm vi chat ở lượt này.

## Hợp đồng và giới hạn

- Thứ tự sự kiện giữ `start → delta* → done/error`; start chờ delta đầu.
  Endpoint thường vẫn trả payload/status cũ, dùng chung quota và lease.
- Provider lỗi/stream bị cắt không lưu partial text. Quota reserve không được hoàn lại;
  retry nội bộ không reserve thêm. Token usage chỉ tăng khi persist thành công.
- Check abort trong transaction có thể rollback khi hủy đã được quan sát. Hủy ngay
  sau DB commit không thể hoàn tác giao dịch đã commit; client cần tải lại lịch sử
  nếu không nhận done. Idempotency gửi tin qua mạng vẫn là backlog riêng.
- Adapter OpenAI-compatible yêu cầu sentinel DONE trong event hoàn chỉnh. Gateway
  không gửi DONE sẽ bị báo provider unavailable; chưa kiểm chứng lại Groq/Zen thật.
- Test dùng local DB riêng `langoo_parallel_gpt_test`, UTC, AI stub/custom mocks;
  server HTTP giả lập upstream chỉ nghe loopback. Không gọi LLM thật, không ghi VPS.

## Ngoài scope để người tích hợp xử lý

- Cursor chat/quiz vẫn dùng Date millisecond, khác queue M13 đã giữ microsecond.
  Cần review riêng nếu muốn phân trang toàn bộ timestamp precision; không sửa helper chung ở nhánh này.
- Các ghi chú migration/deploy trong runbook và backlog có chỗ lịch sử chưa đồng bộ.
  Xác minh DB/commit chạy thật trước rollout; không suy trạng thái production từ tài liệu cũ.
- Tài liệu FE streaming chứa thông tin đăng nhập tài khoản admin mock. Người tích hợp
  cần loại bỏ thông tin đăng nhập khỏi tài liệu và kiểm tra tài khoản demo khi chuẩn bị go-live;
  nhánh này không sửa auth/FE ngoài phạm vi được giao.

## Tài liệu chuẩn đã đối chiếu

- [WHATWG SSE parsing/interpretation](https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation): ghép data line, các kiểu newline và bỏ event chưa hoàn chỉnh ở EOF.
- [Node HTTP IncomingMessage close](https://nodejs.org/api/http.html#event-close_3): request close báo hoàn tất request từ Node 16; controller dùng response close để theo dõi kết nối trả stream.

## Bàn giao

Commit cục bộ trên branch GPT sau khi gate pass. Không push/merge main/deploy trong
lượt review này theo prompt được giao; bản sửa M13 `4d43752` đã push main trước khi bắt đầu.
CI và [workflow Deploy VPS của M13](https://github.com/DuongStark/Langoo/actions/runs/37258960255)
đã thành công; bản sửa streaming trong nhánh này chưa được deploy.


## 2026-10-26 — M10.1 — Tích hợp vào checkout main duy nhất

- Commit gốc `9b8c6b5` còn riêng trên worktree GPT, được nhập thành `13d59cb` trên main mới `7efeacd`. Hòa giải để giữ ảnh M10.3 cùng cancel/retry/parser SSE/token validation; chỉnh format provider khi lint.
- Kiểm tra bản hợp nhất: Node 22 build pass, 60 suite/524 unit pass (gồm chat ảnh và SSE). Kết quả lint cuối, Git và giới hạn xem [report DOCS1](docs1-worktree-consolidation-2026-10-26.md).
- E2E chat chạy lại trong lượt deploy ngày 26/10 nhưng không nghiệm thu được: `127.0.0.1:55432/langoo_test` không có PostgreSQL đang nghe, data directory dev chưa có; 4 suite/31 test lỗi `ECONNREFUSED` trước khi kiểm tra hành vi. Không reset/tạo DB và không gọi provider thật. CI có PostgreSQL service, `db:test:reset` và sẽ là gate E2E trước deploy. Các kết quả E2E ngày 05/10 phía trên là lịch sử của nhánh gốc.
- Không cần sửa code FE để theo API hiện tại: `start → delta* → done/error` giữ nguyên; lỗi JSON trước delta đã được client mẫu kiểm qua `response.ok`/content type. Hướng dẫn FE ở `docs/fe/chat-streaming.md` đã gỡ credentials của tài khoản mock.
- Release hoàn tất: push `main` tại `243585a` (gồm M10.1 code commit `13d59cb`, consolidation commits và tài liệu cleanup). CI run [40250935483](https://github.com/DuongStark/Langoo/actions/runs/40250935483) success: lint, build, unit và full E2E PostgreSQL 17; Deploy VPS run [40251098440](https://github.com/DuongStark/Langoo/actions/runs/40251098440) success. VPS `/opt/langoo/app` HEAD `243585a`, tracked working tree sạch, PM2 `langoo-api` online (restart 189). Public health HTTP 200: `status=ok`, `db=ok`, UTC, DB latency 2 ms. Không có migration; không gọi provider thật.
- Git/triển khai: release code đã push/deploy; không cần sửa code FE cho contract hiện tại. Hướng dẫn FE và report credentials mock đã được làm sạch trong commit `243585a`. E2E local không chạy được vì thiếu PostgreSQL dev data directory, nhưng full CI E2E pass. Worktree local sạch sau release; các gate của M10.1 đã đạt.
