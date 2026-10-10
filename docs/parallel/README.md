# Chia việc song song — 2026-10-05

## Cập nhật phạm vi 06/10/2026

Chủ dự án đã hủy DB3-C (tra gloss VI có/không dấu); kế hoạch C đã được gỡ.
DB3 tiếp tục gồm DB3-A và DB3-B. DB4 có thể kiểm kê nguồn, lập kế hoạch và chốt
contract song song với dịch DB3-B; candidate mapping dùng sense JA/EN và concept
gốc, không phụ thuộc gloss VI máy. Công cụ DB4 dùng worktree/DB test riêng sau
khi chốt plan và interface; apply vào DB thật cần phối hợp với DB3-B. Gloss VI
dẫn xuất từ EN không được tính thành chứng cứ độc lập cho mapping.

**Plan DB4 hiện hành:** [mapping sense↔concept](../plans/db4-sense-concept-mapping.md),
gồm contract, hai lượt semantic review, pilot, journal/rollback, serving và các family
translation/relation/example. [Baseline local 06/10](../reviews/db4-baseline-2026-10-06.json)
đã có SQL/count; source và legacy artifact audit vẫn thuộc D0.

**D1 đã code local:** [spec v1](../plans/db4-schema-v1.md), entrypoint
`scripts/db4/_mapping-types.ts`, fixtures và test offline đã có. Gate commit/tích hợp
cùng base và DeepSeek đối chiếu interface vẫn cần trước bắt đầu D2/D4 thật.
DeepSeek tiếp tục dịch DB3-B, chuẩn bị D0 read-only; sau nhận contract dùng constructors/
bound parsers D1 khi làm D2 retrieval và D4 runner. Fixture synthetic không thay source audit.
Phân công chi tiết và thứ tự merge ở §22 của plan DB4. Các prompt M10/DB3 đợt cũ
bên dưới ghi lại setup trước đó; scope DB4 dùng plan hiện hành này.

## Trạng thái còn lại

Đối chiếu code, `PROGRESS.md` và các kế hoạch tại HEAD `f1ee0d6`.
Đây là trạng thái phát triển; chưa xác minh lại tiến trình đang chạy trên VPS.

| Ưu tiên | Việc | Trạng thái / điều kiện |
| --- | --- | --- |
| 0 | Chốt bản sửa M13 | Đã sửa 6 P2 + 2 P3 và push main `4d43752` ngày 05/10; CI + Deploy VPS của commit này thành công. |
| 1 | Review M10.1 streaming | Đã review/sửa 7 P2 + 1 P3 trên branch GPT, commit cục bộ `9b8c6b5`; build/lint, 371 unit + 31 E2E chat pass. Còn tích hợp/push nhánh này. |
| 1 | DB3 dữ liệu nền | Chưa triển khai: 214 bộ thủ, KanjiVG, deck hệ thống, gloss VI, audit nguồn/credits. Chính sách JLPT đã chốt dùng `jlpt_link`; không cần hỏi lại quyết định này. |
| 2 | DB4 mapping sense ↔ concept | Đã có [plan chi tiết](../plans/db4-sense-concept-mapping.md) và baseline local 06/10; D0/D1 làm song song DB3-B, contract commit trước D2–D4, pilot trước promote/mở rộng. |
| 2 | M2.3 B | Chưa làm email verification/recovery và quản lý session liên quan; còn chọn dịch vụ email, hợp đồng client và migration. |
| 2 | M2.3 C rollout | Backend challenge đã có, tắt mặc định. Kiểm tra client và migration trên DB đích trước bật; không suy từ ghi chú cũ rằng migration 029 còn thiếu. |
| 3 | M14 / DB5 | Chưa làm curation ghi `core`, quyền/audit, refresh serve và chuyển API sang DB thật. Cần duyệt ngoại lệ blacklist; runbook hiện ghi API vẫn dùng DB demo cloud dù máy chủ đã là VPS. |
| Sau đó | Quiz gọi LLM thật | Factory hiện luôn trả `StubQuizProvider`, kể cả `AI_PROVIDER=openai`; chức năng quiz hiện có vẫn dùng generator deterministic. |
| Sau đó | Chat bổ sung | Summary hội thoại dài, idempotency gửi tin, bảng giá token/cost thật. Streaming đã có ở M10.1, retention đã có ở M12; không làm lại hai mục này. |
| Tuỳ nhu cầu | S3/R2, thống kê nâng cao, Apple login | Chưa triển khai. Local storage trên VPS hiện dùng được; S3 không phải điều kiện bắt buộc để tiếp tục. |
| Tạm gác | M9 reminders | Chủ dự án đã tạm gác; giữ nguyên trạng thái. |

Không coi các nhãn “chờ review” lịch sử trong tài liệu là bằng chứng một module chưa có code.
Các lỗi M11/M12 đã được sửa và commit; việc còn lại của chúng chủ yếu là xác minh phiên bản vận hành.

## Hai phiên làm việc ngay

Chọn **GPT Sol High** cho phiên A vì scope tập trung vào luồng async, transaction và test hồi quy.
Nếu dùng Luna Max, giữ scope review này và để người tích hợp kiểm tra bản vá trước merge.
Đây là lựa chọn phân công theo loại việc, không phải kết quả benchmark các model.

| Phiên | Model | Worktree | Branch | Đầu ra |
| --- | --- | --- | --- | --- |
| A | GPT Sol High (hoặc Luna Max) | `../Langoo-worktrees/gpt-backend` | `parallel/gpt-m10-stream` | Review M10.1, sửa lỗi trong phạm vi đã có, test và commit riêng. Prompt: `gpt.md`. |
| B | DeepSeek V4 Flash | `../Langoo-worktrees/deepseek-data` | `parallel/deepseek-db3` | Kiểm kê dữ liệu DB3 + kế hoạch DB3-A cụ thể để duyệt, rồi triển khai tools/seed sau duyệt. Prompt: `deepseek.md`. |

Mở từng thư mục trong một phiên riêng và dán prompt tương ứng. Hai model chưa được khởi chạy
bằng API trong lần setup này; DeepSeek cần chạy bằng công cụ/phiên người dùng đang có.

Repo dữ liệu tham khảo: `/media/duongstark/Du lieu/code/data-Langoo`.
Thư mục này **không có Git** tại thời điểm kiểm tra; phiên B chỉ đọc nguồn đó,
ghi mọi đầu ra mới vào worktree của mình để có thể review/commit.

## Cách ly môi trường

- Hai worktree được tạo từ commit `f1ee0d6`. Sau khi M13 được push, worktree GPT đã
  fast-forward lên `4d43752`; phiên DeepSeek kiểm tra base khi tích hợp.
  Scope A không sửa admin/feedback/storage/pagination; scope B không sửa runtime backend.
  Người tích hợp đưa hai nhánh về cùng base trước nghiệm thu chung.
- Mỗi worktree có `.env` riêng, chỉ trỏ PostgreSQL local, AI stub, scheduler tắt.
  Không sao chép API key/cloud URL; `.env` không được commit.
- A: DB `langoo_parallel_gpt_test`, port ứng dụng `3101`, storage `uploads/gpt`.
- B: DB `langoo_parallel_deepseek_test`, port ứng dụng `3102`, storage `uploads/deepseek`.
- Mỗi bên có `node_modules`/Prisma client riêng. Không symlink dependency/generated client giữa hai worktree.
- Chỉ reset DB của phiên mình; không dùng `langoo_test` hoặc DB của phiên kia.
  DB demo đủ kiểm thử API, **không đủ đo coverage của DB từ điển đầy đủ**.
- Phiên B cần DB dữ liệu đầy đủ để kiểm kê số lượng: ưu tiên local, chỉ đọc;
  nếu chưa có URL được cấp thì ghi rõ thiếu số liệu, không thay bằng số từ tài liệu cũ.
  Không tự dùng `.env` production hay SSH vào VPS để chạy script ghi.

Kiểm tra mỗi worktree:

```bash
nvm use  # .nvmrc = 22; shell trên máy hiện mặc định Node 25, ngoài engines của repo.
npm run build
npm test -- --runInBand
# E2E chỉ chạy sau khi kiểm tra TEST_DATABASE_URL trỏ đúng DB local riêng.
npm run test:e2e -- --testPathPatterns=chat
```

Trong mỗi worktree có `PARALLEL-TASK.md` chứa prompt riêng, được Git ignore cục bộ;
có thể yêu cầu agent đọc file này để bắt đầu. Prompt gốc được quản lý trong `docs/parallel/`.

### Setup đã kiểm chứng

- Hai worktree/branch đã tạo; `.env` và `PARALLEL-TASK.md` đều được ignore, worktree sạch.
- `npm ci` + Prisma generate hoàn tất riêng từng worktree. Lần cài ban đầu shell dùng
  Node 25 và có cảnh báo engines; build và smoke dưới đây đã chạy bằng Node **22.22.2**.
- Hai DB fixture đã dựng trên `127.0.0.1:55432`, timezone UTC, migration nền đến 037
  (36 file, bỏ số 028 theo lịch sử). Chỉ tạo hai DB mới; không reset DB đang dùng trước đó.
- `npm run build`: pass ở cả hai worktree bằng Node 22.
- Phiên A: `npm run test:e2e -- --runTestsByPath test/chat-stream.e2e-spec.ts`:
  **1 suite / 1 test pass** trên DB riêng. Đây là smoke xác nhận môi trường, chưa thay cho
  review và bộ test đầy đủ của M10.1.
- Bộ tài liệu setup chưa commit. M13 đã commit/push `4d43752`, CI và workflow Deploy VPS
  thành công; đây là auto-deploy sau push được yêu cầu, không chạy deploy thủ công.
  Phiên GPT đang thực hiện review M10.1; trạng thái phiên DeepSeek do người dùng quản lý.

**Bàn giao phiên GPT:** review đã hoàn tất, commit cục bộ `9b8c6b5` trên
`parallel/gpt-m10-stream`, worktree sạch. Báo cáo ở worktree GPT:
`docs/reviews/m10-stream-review-2026-10-05.md`. Chưa merge/push/deploy bản sửa này.

## Quyền sửa file và tích hợp

1. A sửa chat/provider chat/test chat; B sửa `docs/plans/db3*`, `docs/reviews/db3*`
   và, sau duyệt, `scripts/db3/**` + fixtures/test đi kèm.
2. Người tích hợp giữ `PROGRESS.md`, `.env.example`, `package*.json`, migration numbers,
   `prisma/schema.prisma`, `src/config/**`, `src/ai/ai.module.ts` và các helper dùng chung.
   Nếu cần đổi, báo trong review để người tích hợp xử lý; không tự sửa đồng thời.
3. Không push, merge `main`, deploy, apply migration production hoặc ghi DB thật từ hai phiên.
   Commit cục bộ theo đơn vị logic, gửi hash + báo cáo lệnh kiểm tra + rủi ro còn lại.
4. Tích hợp từng nhánh, chạy gate phù hợp; migration/env chung chốt một lần.
   Nếu cần thay đổi contract mới, dừng phần phụ thuộc và trình kế hoạch theo `PROMPT-BACKEND.md`.

## Các đợt sau

| Đợt | GPT | DeepSeek | Điều kiện |
| --- | --- | --- | --- |
| 1 | M10.1 review/fix | DB3 inventory + DB3-A plan | Có thể bắt đầu song song ngay. |
| 2 | M2.3 B plan rồi auth/security implementation | DB3-A tools/seed local | Duyệt plan, dịch vụ email/client và phạm vi seed. |
| 3 | DB4 scoring/validation/promote/rollback | DB4 runner/checkpoint/batch artifacts | Chốt interface/artifact format trước chia file; review pilot trước mở rộng. |
| 4 | M14 quyền/audit/API | DB5 coverage/serve/go-live checklist | Duyệt ngoại lệ ghi core và dữ liệu curated; chỉ người tích hợp chuyển production. |

Không chạy DB3/DB4 LLM toàn bộ ngay. Quyết định hiện có là Zen `space-bunny-free`
cho dữ liệu, tách khỏi chat Groq; kiểm tra lại khả năng gọi/model/hạn mức lúc chạy pilot,
không coi tên model đã lưu là bảo đảm còn dùng được.
