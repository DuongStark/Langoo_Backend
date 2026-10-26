# DOCS1 — Đối chiếu tiến độ và tồn đọng dự án

> Snapshot trước hợp nhất. Checkout và WIP đã được xử lý tiếp theo trong [report hợp nhất DOCS1](docs1-worktree-consolidation-2026-10-26.md).

Ngày kiểm tra: 2026-10-26 (Asia/Bangkok). Phạm vi: tài liệu, lịch sử Git local/remote và public health. Không sửa code, DB, cấu hình hoặc deploy.

## Nguồn và giới hạn

- Đã `git fetch origin` thành công; `origin/main` tại `7efeacd` (20/10). HEAD local `56f17fb`, không có commit riêng và chậm 97 commit. Không pull/merge vì working tree có WIP.
- Đối chiếu `PROGRESS.md`, `PROMPT-BACKEND.md`, `CONTEXT-DU-AN.md`, tài liệu handoff và commit/SQL trên `origin/main`; các số liệu DB dưới đây là số liệu ghi trong commit/tài liệu, chưa query DB production lại.
- Public `GET https://langoo-api.pixpress.art/v1/health`: HTTP 200, status/db `ok`, timezone UTC, db_latency_ms 36, thời điểm response `2026-10-26T00:20:17.817Z`. Health không chứng minh toàn bộ tính năng hoặc release đang chạy.
- Không có source FE trong phạm vi kiểm tra; các mục FE là gate chưa có bằng chứng đóng trong tài liệu BE, chưa kết luận FE chưa làm.

## Đã tiến đến đâu

| Mã / chức năng | Bằng chứng mới nhất tìm thấy |
| --- | --- |
| M0–M8 — Nền tảng, auth, hồ sơ, từ điển, collections, SRS, review, gamification | Đã có backend và các vòng sửa/recheck. M6.2 scope hồ sơ có report deploy 12/10. Một số dòng vẫn ghi chờ review; không coi mọi gate sản phẩm đã đóng. |
| M4.2/M4.3 — Search ngắn và liên kết Anh–Nhật | Release `48b8507` đã push/deploy theo report 20/10; migration 044, 491 unit/231 E2E và 32 HTTPS requests pass theo report. Links 0–3 từ, đúng scope/identity và có VI. Gate BE/index đã đóng; còn FE/browser cache smoke. |
| M4.5/M10.5 — Ưu tiên nghĩa | JA BCCWJ 66.041 profiles đã deploy; EN ranking/gloss đã có các commit apply v1/v2/v3 ngày 08–10/10. Dòng “EN chưa apply/lô 5k đang chạy” là lịch sử, không dùng làm trạng thái hiện tại. |
| DB3 — Gloss, ví dụ, dữ liệu học | Commit 16/10 ghi JMdict có VI 253.627/253.630; commit 15/10 ghi 277.538/277.538 ví dụ JA có VI; commit 19/10 ghi 10.751 tag JLPT. Đây là độ phủ, không phải nghiệm thu semantic toàn bộ. |
| DB4-D5/D6/D7 — Mapping và serving | D5 đợt đầu đạt theo audit 12/10; expansion 6.985 links ghi 14/10; full apply 40.135 mapping ghi 18/10; JMdict mapped 47.599/253.630 (18,8%). Commit 19/10 ghi serve.sense_pair 1.046.182 cặp. Không còn ở trạng thái chỉ shadow/chưa apply như phần tổng hợp 11/10. |
| M10/M11 — Chat và quiz | Chat nonstream/SSE có smoke 12/10; quiz có provider riêng, retry, quiz v2/chọn dạng câu, và chống lặp 19/10. Pilot M11.2 model thật ghi 8/8 ngày 13/10. Provider/runtime hiện tại chưa đọc env lại. |
| M5 — Bộ từ mẫu | 13 deck JA đã seed/publish; list/clone/append được handoff ghi live `6551ac1`; preview phân trang có commit mới nhất `7efeacd`, chưa xác nhận deploy riêng commit này. |
| M14 — Admin sửa nghĩa và mapping | Có code/API, migration 042 và handoff 15/10 (`bfd3093`). Chính sách máy mặc định chấp nhận, lỗi xử lý qua user report/admin; không còn chỉ là đề xuất. |

## Tồn đọng / việc cần xác nhận

1. **DOCS1 — Đồng bộ trạng thái:** local chậm 97 commit và có 10 file tracked sửa + 31 file untracked trước lượt này. WIP tập trung quiz/DB4 và artifacts M10. Phải phân loại, giữ lại và đối chiếu với code mới trước tích hợp; không reset hoặc gom commit tất cả. PROGRESS/header/checklist/backlog và CONTEXT có trạng thái lịch sử mâu thuẫn commit mới.
2. **M4.3/M4.5/M5/M10.3/M11/M14 — Nghiệm thu FE:** cần xác nhận links theo sense/scope/cache; sub_senses và priority; gợi ý VI; decks list/preview/clone/append; UI gửi ảnh; quiz v2; admin xử lý báo lỗi/sửa data. Rồi kiểm journey trình duyệt tra từ → lưu bộ → ôn → quiz → XP/thống kê.
3. **M2.3 — Auth:** đợt B email verification/recovery/session guard chưa triển khai theo backlog; rollout nonce/challenge C còn phụ thuộc client. Cần dịch vụ email và kiểm trạng thái flag thực trước rollout.
4. **DB4/M14 — Chất lượng và coverage:** mapping JMdict mới ghi 18,8%; mở rộng là việc sau, không đồng nghĩa 81,2% còn lại đều có exact mapping. Cần theo dõi báo lỗi, sửa nghĩa/mapping và chất lượng dữ liệu máy theo policy 15/10. Audit đạt của đợt 479 proposal không tự nghiệm thu toàn bộ đợt 40.135.
5. **M10/M11 — AI:** đối chiếu backlog còn hiệu lực (summary hội thoại dài, retry idempotency, tính chi phí thật, giải thích đáp án); SSE, retention và pilot model thật đã có bằng chứng triển khai ở phần khác nên không ghi tất cả là chưa làm. UI/ảnh chat và chất lượng cohort rộng còn cần xác nhận.
6. **M12/M13 — Vận hành:** xác nhận gate runtime của các finding đã sửa trên release đang chạy. Dòng “chưa deploy” từ 05/10 có trước merge/deploy 12/10 và release 20/10, chưa đủ để kết luận code vẫn chưa deploy. Backup restore drill chưa có bằng chứng mới trong phạm vi rà soát; S3/R2 adapter còn backlog. Con số npm audit cũ cần chạy audit mới trước kết luận lỗ hổng hiện tại.
7. **M9 — Nhắc nhở:** chủ dự án đã tạm gác; không phải lỗi đang chặn backend hiện tại.

Ưu tiên đề xuất: xử lý lệch checkout/tài liệu và WIP → nghiệm thu FE cùng BE hiện có → khép gate auth/vận hành → mở rộng dữ liệu/AI khi cần. Không quy đổi thành % hoàn thành toàn dự án do chưa có danh sách nghiệm thu FE đầy đủ.

## Tài liệu đối chiếu

Các đường dẫn sau đọc từ `origin/main` bằng `git show origin/main:<path>`; một số chưa có trong checkout local:

- `PROGRESS.md`; `docs/reviews/m4.3-searchable-links-deploy-2026-10-20.md`.
- `docs/handoff/fe-handoff-2026-10-20.md`; `docs/handoff/fe-search-suggestions-vi-2026-10-20.md`.
- `docs/handoff/fe-decks-sample-collections-2026-10-20.md`; `docs/handoff/m14-curation-2026-10-15.md`.
- `docs/reviews/db4-d5-audit-2026-10-12.md`; `docs/reviews/vps-deploy-merged-2026-10-12.md`.
- `db/ops/apply-links-full-20261018.sql`; `db/ops/apply-links-full-curate-20261019.sql`; `db/ops/apply-sense-vi-v1.sql`.

## Kiểm tra và Git

- Đã chạy: fetch, log/status/rev-list, đọc tài liệu/SQL trên remote, public health GET. Không chạy test/build ứng dụng trong lượt chỉ rà soát này; kết quả unit/E2E nêu trên dẫn từ report lịch sử.
- `git diff --check` trước thay đổi phát hiện trailing whitespace có sẵn tại `docs/handoff/fe-handoff-2026-10-08.md:3`; giữ nguyên WIP đó. Scoped whitespace check của report/entry mới sẽ kiểm trước bàn giao.
- Thay đổi lượt này chỉ report này và entry DOCS1 trong PROGRESS. Chưa commit/push; không deploy.
