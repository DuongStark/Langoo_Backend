# DOCS1 — Đối chiếu tiến độ và tồn đọng dự án

> Snapshot trước hợp nhất. Checkout và WIP đã được xử lý tiếp theo trong [report hợp nhất DOCS1](docs1-worktree-consolidation-2026-10-26.md).

Ngày kiểm tra: 2026-10-26 (Asia/Bangkok). Phạm vi: tài liệu, lịch sử Git local/remote và public health. Không sửa code, DB, cấu hình hoặc deploy.

## Live check VPS/PostgreSQL — 2026-10-26

SSH alias `langoo-vps` trên máy này kết nối thành công bằng key cá nhân; host `163.223.210.135` (`dataz-1790771447`). PostgreSQL truy vấn bằng user `langoo`, chỉ SELECT.

- API lúc `2026-10-26T00:37:03Z`: HTTP 200, app/DB `ok`, latency 32 ms, UTC. DB size **4.721 MB**.
- VPS app HEAD `7efeacd`, khớp `origin/main` sau fetch. PM2 `langoo-api` online, process uptime khoảng 5 ngày; restart counter 188 nhưng `unstable_restarts=0`. VPS uptime 25 ngày; load 0.09/0.02/0.01.
- Tài nguyên: RAM khả dụng 837 MiB, swap còn 1.741 MiB, disk 30 GB dùng 21 GB/còn 7,1 GB (75%).
- Counts trực tiếp: **1.052.582 lexeme; 1.480.432 sense; 120.875 concept; 625.124 sense_concept; 1.046.182 serve.sense_pair; 350.993 gloss VI**. Concept: 25.617 curated, 95.258 draft.
- Nguồn lexeme khớp tổng: JMdict JA 218.794; OEWN EN 161.646; OMW EN 156.584; OMW JA 94.002; Wiktextract EN 170.177, JA 199.483, VI 51.896. Số 2.375.240 lexeme trong báo cáo cũ là trước trim Wiktextract EN.
- JMdict có 253.630 sense, 47.599 exact mapped (**18,77%**). Run full `db4-llm-links-full-20261018`: 40.135 mappings; expansion `db4-llm-exact-expansion-20261014`: 6.985. Tổng 47.599 mapping bổ sung khớp baseline WordNet 577.525 → 625.124.
- Migration ledger có 040, 041, 042, 044 nhưng **thiếu 043**. Function `public.f_unaccent(text)`, index `translation_assertion_vi_prefix`, extension `unaccent` đều hiện diện. Lệch ledger/effect cần reconcile qua migration tool; không chạy SQL ad hoc.
- Có 5 backup dump ngày 21–25/10; mới nhất `langoo-2026-10-25-0930.dump`, 331.622.290 bytes. Chưa xác nhận restore drill.
- VPS checkout HEAD `7efeacd` có 36 file `.bak-*` chưa track và một entry `node_modules` bị xóa khỏi index; không có tracked source sửa. Chưa dọn backup files.

### Tồn đọng đã xác nhận live

1. Local main ahead origin đúng 4 commit (`13d59cb`, `cb5e080`, `eda6001`, `0fe3829`); VPS vẫn `7efeacd`. M10.1 chat/SSE mới tích hợp local chưa push/deploy.
2. Reconcile ledger migration 043 dù effect hiện diện; dùng runner, rồi kiểm tra ledger/index.
3. FE browser nghiệm thu links/scope/cache, dictionary priority, decks, quiz, admin curation và journey học chưa có bằng chứng trong phiên.
4. M2.3 email verification/recovery B và rollout nonce OAuth C còn chờ dịch vụ email/client.
5. Rà nguyên nhân PM2 restart counter 188 (hiện online, unstable 0); diễn tập restore backup; cập nhật npm audit vì kết quả hiện có cũ.
6. Tiếp tục audit coverage/chất lượng mapping; M9 nhắc nhở vẫn tạm gác theo quyết định dự án.

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

1. **DOCS1 — Đồng bộ trạng thái:** đây là snapshot trước hợp nhất. Checkout/WIP đã xử lý; trạng thái live hiện tại xem phần đầu và [report hợp nhất](docs1-worktree-consolidation-2026-10-26.md).
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

- Đã chạy: fetch, Git status, public health GET, SSH diagnostics, PM2 metadata, PostgreSQL read-only counts/source breakdown/concept status/mapping runs/migration ledger/catalog/index/backup list. Không đọc env/secret, không sửa DB/config VPS.
- Git local lúc live audit: `main` ahead `origin/main` 4 commits; repo source VPS ở `7efeacd`, khớp remote.
- Cập nhật DOCS1, PROGRESS và VPS runbook bằng bằng chứng live. Tài liệu chưa commit/push; không deploy.
