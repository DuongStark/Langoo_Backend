# DB3-A — Sửa lỗi và hậu kiểm 2026-10-05

## Kết quả

Đã sửa **2 P1 + 4 P2** của review trên baseline `6e99d61`, trong worktree/branch `parallel/deepseek-db3`. Phiên song song vừa tạo commit **`a24a5f4`** chứa phần code, regression và README/plan. Báo cáo hậu kiểm này chưa commit; chưa apply DB thật/VPS trong phiên sửa lỗi này.

| Finding | Thay đổi | Kiểm chứng |
| --- | --- | --- |
| F1 — Rollback bỏ guard/chấp nhận dry-run | Chung guard apply/rollback; schema manifest format 2; kiểm tra task, host/port/database và trạng thái | Từ chối thiếu flag, sai đích/task, dry-run, legacy, aborted/đã rollback; DB không đổi |
| F2 — Rollback xoá dữ liệu cũ | Snapshot trước/sau của mọi bảng đích và source; xoá đúng dòng mới, phục hồi dòng sửa/xoá; giữ ID | Seed hai lần rồi rollback lần hai giữ dữ liệu lần đầu; bigint `9007199254740993` và timestamp 6 chữ số thập phân được giữ nguyên |
| F3 — Cấp JLPT ngược | Chọn `MAX(source_level)` tương ứng N5 → N1 | Lexeme accepted N1+N5 vào N5 |
| F4 — Item không còn eligible vẫn tồn tại | Đồng bộ đủ 5 deck, kể cả cấp rỗng; loại anchor rejected/đổi cấp/đổi primary; sửa position/count | Đổi N5 → N1, rejected hết N5, đổi primary và rollback tập item cũ đều pass |
| F5 — Manifest lỗi sau COMMIT | Ghi atomic/fsync, preflight và prepared trước COMMIT; recovery kiểm tra state sau lỗi ghi trạng thái cuối | Lỗi filesystem trước COMMIT giữ DB cũ; lỗi sau COMMIT có journal phục hồi; rollback cũng có rollback-prepared/recovery idempotent |
| F6 — Radical thiếu vẫn apply | Gate đủ 214 khoá/ký tự duy nhất và field đã chốt; fixture explicit chỉ DB test local | Tập 4 dòng bị từ chối khi thiếu fixture; thiếu name_en/trùng khoá bị chặn; bộ raw đủ 214 apply được |

Rollback dừng nếu dữ liệu đã thay đổi sau run. Deck mới đã được user clone/tham chiếu không bị xoá; lỗi này rollback cả transaction, không làm mất liên kết của user. Deck cũ giữ ID, trạng thái publish và concept của anchor còn eligible khi seed lại.

## Bổ sung trong cùng phạm vi

- Manifest radical có hash/URL/license/version theo raw snapshot của từng nguồn; bỏ version/ngày Wikipedia hardcode. KanjiVG apply cần version explicit.
- Báo cáo KRADFILE part chưa khớp và part khớp nhiều bộ; không tự quyết định mapping.
- KanjiVG báo cáo hai chiều file↔kanji; file sort cố định, kiểm tra trùng codepoint/hash; cache `--copy-to` không overwrite file khác hash.
- Sửa parser ký hiệu vị trí `~阝`/`阝~` ở bộ 163/170. Chỉ glyph `阝` vào variants; các match nhiều bộ được báo cáo để review.
- `--limit` chỉ dùng DB local `_test` và seed bộ deck mới; không thay deck đang có bằng tập giới hạn.
- Lock bảng đích cũng tuần tự hoá việc cấp source ID `MAX(id)+1` trong các run DB3.
- `fetch-sources.ts` xuất hiện trong worktree trong lúc hậu kiểm: sửa nhỏ validation/type cho response EN và lỗi lint template unreachable. Script tải nguồn chưa được chạy mạng trong phiên này.
- Cập nhật README và phần plan về transaction, snapshot, guard, recovery và tiêu chí nghiệm thu.

## Kiểm thử

Node **22.22.2**.

| Lệnh | Kết quả |
| --- | --- |
| `npm run build` | PASS |
| `npx eslint 'scripts/db3/**/*.ts' --max-warnings 0` | PASS, gồm file fetch-sources mới |
| `npx tsc --noEmit --incremental false` | PASS |
| `npx tsx scripts/db3/selftest.ts` | PASS, gồm regression marker vị trí |
| `DB3_TEST_RADICAL_SOURCES=/tmp/opencode/db3raw node --import tsx --test scripts/db3/regression.test.ts` | **14 subtest + parent: 15 pass, 0 fail** |
| `git diff --check` | PASS |

Regression tự tạo một DB UUID mới trên PostgreSQL local đã cấu hình qua TEST_DIRECT_URL/TEST_DATABASE_URL, nạp dump + migration hiện có, chạy kiểm tra rồi xoá DB mới. Không reset DB của phiên DeepSeek/GPT, không ghi full local/VPS, không gọi LLM.

Full radical test xác nhận 214 dòng, `serve.kanji_card` của 日 hiển thị radical_char=日/name_vi=Nhật; apply lần hai không đổi dữ liệu và rollback phục hồi trạng thái trước mỗi run. KanjiVG fixture xác nhận media_kinds hiển thị stroke_svg và phục hồi metadata cũ đúng sau rollback.

## Việc vận hành còn lại

1. Giữ raw snapshot/revision và xác minh các license còn treo theo plan; không coi version hash là revision Wikipedia.
2. Chuẩn bị KanjiVG đầy đủ có release/tag/commit; lần này kiểm chứng DB bằng 3 SVG fixture, chưa kiểm thử cả corpus media.
3. Dry-run trên đích thật, review coverage/unmapped/ambiguous và manifest rồi apply bằng guard explicit khi được yêu cầu.
4. API phục vụ ảnh tiếp tục thuộc M14; gloss/LLM DB3-B và mapping DB4 giữ nguyên phạm vi riêng.

Rollback format 2 chỉ phục hồi DB. Cache SVG bất biến ngoài DB được giữ lại để ops/M14 quản lý, không tự xoá file có thể đang dùng. Manifest legacy không đủ snapshot nên bị từ chối thay vì xoá theo danh sách khoá cũ.
