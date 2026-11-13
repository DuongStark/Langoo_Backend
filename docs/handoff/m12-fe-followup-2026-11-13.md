# M12-A19/A20 — Trả lời FE sau tích hợp handoff 13/11

Ngày 13/11/2026. Tiếp nối [handoff release4df8655](m12-fe-feedback-sync-2026-11-13.md).
FE tự báo đã tích hợp trên dev + API production; chưa commit SHA/chưa deploy FE.
Không có thay đổi source FE trong lượt BE này; không đóng feedback.

## 1. Gloss trong item.display — BE nhận sửa

Bổ sung `gloss_en`, `gloss_vi` kiểu string|null, `gloss_vi_machine` và
`gloss_vi_reviewed` boolean vào display. Cùng nguồn/chính sách chọn gloss của
GET /v1/senses/:id (`serve.sense_card`), theo đúng display_sense_id/face đang hiện,
không tự lấy anchor khi profile chỉ thấy secondary face. Giữ nguyên meaning_vi
của item; đó vẫn là nghĩa dùng trong học và có thể do user nhập.

FE locale EN dùng display.gloss_en để bỏ request detail từng dòng; nếu null thì
hiện fallback locale đã thống nhất, không tự fetch detail hàng loạt. VI vẫn dùng
meaning_vi của item. Nếu hiển thị gloss_vi dictionary thì giữ badge dịch máy khi
machine=true/reviewed=false. Chỉ mở chi tiết mới lấy examples/links/media.
Không đổi query `include=display`, pagination hoặc auth. Gloss nằm trong query
projection theo trang, vẫn tối đa2reads cho sense+Kanji, không N+1 roundtrip.

**Trạng thái bổ sung này:** code local đang kiểm, chưa nằm trong production4df8655.
Ledger cuối file cập nhật sau test/deploy thực tế; FE không bật trước rollout.

## 2. Backfill meaning_vi — BE xử lý, không chuyển PATCH mỗi dòng lại cho FE

Điều kiện áp: nghĩa hiện tại byte-exact bằng gloss_en, có gloss_vi không rỗng và khác nghĩa cũ, meaning_source='source', created_at=updated_at. Chỉ đọc anchor sense
cho nghĩa chung item, không chọn bất kỳ face khác để thay nghĩa. Không trim,
normalize, fuzzy match hoặc thay nghĩa tùy biến; không đổi SRS/face/quiz lịch sử.

Scan READ ONLY production:240mục source chưa cập nhật, gồm134mục trong sổ archive;
2mục khác có nguồn user dù cũng trùng EN. Cả242VI đều máy/chưa duyệt. Chỉ240mục
source có dấu vết chắc chắn mới được apply; nguồn sau apply là machine. Giữ2mục
user vì API POST cũ luôn ghi user cho cả autofill; khớp chuỗi không chứng minh ý
định người dùng. Không bảo đảm mọi dữ liệu legacy đều sửa được tự động.

Script `scripts/review/m12-meaning-vi-backfill.cjs`: plan chỉ đọc, apply cần
manifest hash+expected count, recheck/row-lock và all-or-nothing; backup private
trước commit, rollback chỉ khi nội dung/provenance/updated_at chưa đổi. Không
đưa ID/nội dung cá nhân hoặc backup vào Git. **Đã apply production240/240mục**,
kiểm lại READ ONLY240khớp nghĩa/nguồn/timestamp; còn2user giữ nguyên. Backup
private trên VPS, [receipt sanitize](../reviews/m12-fe-followup-2026-11-13/meaning-vi-verification.json).
Không chạy rollback thử trên production; rollback đã kiểm trong DB test riêng.

## 3. Mã lỗi — FE map theo code trước fallback status

[Bảng code/status đầy đủ](m12-error-status-fe-2026-11-13.md). Điểm cần bổ sung ngay:

- SRS_DAILY_LIMIT_REACHED=409, không phải429.
- DICTIONARY_SEARCH_TIMEOUT=504; auth/privacy/collection/health unavailable=503.
- QUIZ_GENERATION_COOLDOWN=429 có details.retry_after_s, khác AI_QUOTA_EXCEEDED429.
- Google OAuth cấu hình/provider và lưu ảnh feedback có code503 riêng.
- AI_DAILY_REQUEST_LIMIT/AI_QUIZ_DAILY_LIMIT là ENV, không phải response code.
- Auth503 không tự logout; membership503 không đổi thành chưa lưu; privacy503
  không suy ra đồng ý; SSE error phải map cả khi HTTP200.

## 4. QA FE báo lại — chưa phải kiểm chứng độc lập của BE

- A17: honyaku→翻訳, genin→原因, kinyuu→金融; một request có Bearer, bỏ query ẩn danh/merge.
- A18: endpoint production200 trên tài khoản test có sẵn, dùng làm nguồn dấu đã lưu.
- A19 VI: một items include=display, không sense/Kanji detail mỗi dòng; EN còn
  N+1 trước bổ sung gloss này.
- FE-01: SW bỏ cache /v1/*, xóa legacy langoo-api/langoo-dict; đổi account/profile
  hủy dictionary request và tải lại.
- FE-02: sàn2, bỏ3;409 QUIZ_NOT_ENOUGH_ITEMS inline available/required.
- FE-03: activity SRS toàn hồ sơ, mục tiêu gồm quiz, bỏ Math.max.
- FE tự báo394/394unit và build OK; chưa có commit/build production để BE xác minh.

Còn FE QA: hai account thật, PWA standalone/offline bản build, iPhone thật,
save/delete/clone E2E (script hiện chặn ghi), locale EN, timezone qua ngày.
BE tiếp tục giữ assertion216799 “of→nước” mở; aliases camelCase reverse vẫn giữ,
không có kế hoạch gỡ trong release này. Báo trước nếu có đợt gỡ alias sau này.

## 5. Ledger triển khai tiếp nối

- A19 gloss: đang kiểm local, chưa commit/push/deploy bổ sung.
- A19 meaning_vi: đã apply VPS240mục, verified240/240; backup private và rollback guard đã có,2user giữ nguyên.
- A20 bảng lỗi: đã đối chiếu source; không đổi runtime status.
- Kiểm tra, Git và môi trường cuối cùng được cập nhật trước khi bàn giao.
