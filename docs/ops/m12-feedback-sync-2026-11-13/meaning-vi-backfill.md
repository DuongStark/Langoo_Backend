# M12-A19 — Backfill nghĩa Việt legacy có backup và rollback

Ngày13/11/2026. Script [m12-meaning-vi-backfill.cjs](../../../scripts/review/m12-meaning-vi-backfill.cjs).
Không migration/schema change; không đổi face/SRS/quiz hoặc dữ liệu dictionary.

## Điều kiện

Anchor sense qua serve.sense_card, meaning_vi byte-exact bằng gloss_en,
gloss_vi không rỗng và khác nghĩa hiện tại, meaning_source='source',
created_at=updated_at. VI máy chưa duyệt chuyển meaning_source thành machine;
VI đã duyệt hoặc không phải máy dùng source như policy clone deck hiện có.
Các mục source đã có lần update, user/machine/llm và nghĩa không trùng đều giữ nguyên.
Áp dụng cả sổ archive vì có thể restore; không tự mở archive.

Nguồn user legacy có thể chứa autofill từ FE vì POST cũ luôn ghi user; không thể
khẳng định an toàn chỉ từ equality. Hai mục như vậy trên production được giữ
để đối chiếu riêng; không hứa backfill toàn bộ legacy.

## Quy trình và CLI

Chạy trên VPS với LANGOO_APP_ROOT=/opt/langoo/app (hoặc mặc định repo khi local).
Đọc DATABASE_URL từ môi trường/.env trong tiến trình, không in URL hoặc secret.
Thư mục output phải private0700, file0600; script không ghi đè file đã có.
Tên database và manifest hash/count phải truyền rõ. Ví dụ placeholder:

```bash
LANGOO_APP_ROOT=/opt/langoo/app node scripts/review/m12-meaning-vi-backfill.cjs plan \
  --database langoo --output /private/m12/plan.json
LANGOO_APP_ROOT=/opt/langoo/app node scripts/review/m12-meaning-vi-backfill.cjs apply \
  --database langoo --manifest /private/m12/plan.json --sha256 <plan-sha256> \
  --expected-count <count> --output /private/m12/apply-backup.json
```

Plan dùng REPEATABLE READ READ ONLY; apply một transaction REPEATABLE READ,
advisory lock, timeout30s mỗi statement/lock3s. Recheck cùng source policy và
khóa từng item, so sánh tất cả field snapshot; một dòng drift thì rollback cả lô.
Backup đầy đủ old/new text/source/timestamps được fsync file+directory trước
COMMIT. Chỉ stdout count/hash/trạng thái; không commit backup/manifests có IDs.
Nếu bị gián đoạn sau backup trước xác nhận COMMIT, kiểm DB bằng CAS trước khi
kết luận apply thành công; không replay mù. Backup trước commit không tự chứng
minh transaction đã commit.

Rollback (chỉ dùng khi cần, chưa chạy production):

```bash
LANGOO_APP_ROOT=/opt/langoo/app node scripts/review/m12-meaning-vi-backfill.cjs rollback \
  --database langoo --manifest /private/m12/apply-backup.json \
  --sha256 <apply-backup-sha256> --expected-count <count> \
  --output /private/m12/rollback-backup.json
```

Khóa/recheck id+anchor+new text+new source+applied updated_at, drift một mục thì
abort cả lô. Khôi phục nghĩa/nguồn; updated_at ghi thời điểm rollback, không giả
vờ chưa từng sửa. Không rollback đè chỉnh sửa của người dùng sau apply.

## Bằng chứng

Trạng thái ban đầu: READ ONLY scan240source chưa update (134archived),2user
không đủ provenance;240VI đều máy/chưa duyệt. Plan production pin SHA0adaa5d5…, apply đã COMMIT240mục; READ ONLY verify240/240,
nguồn machine cho cả240. Còn2user giữ nguyên. Backup private tại
/opt/langoo/storage/ops/m12-feedback-20261113/meaning-vi-followup/apply-backup.json,
SHA256 e408f212ab28b807d788daba86ba23c0f3adbb4030eab5a13468833fa6dd33b6.
Không chạy rollback production. [Receipt sanitize](../../reviews/m12-fe-followup-2026-11-13/meaning-vi-verification.json).
Kết quả cuối ở
[handoff tiếp nối](../../handoff/m12-fe-followup-2026-11-13.md).

Test DB riêng xác nhận skip user/edited/custom/whitespace mismatch, hash sai,
stale plan abort, apply giữ machine provenance, rollback và từ chối rollbacklần2.
Không chạy rollback thử trên production.
