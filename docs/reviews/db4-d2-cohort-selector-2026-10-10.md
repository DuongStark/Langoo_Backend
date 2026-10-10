# DB4-D2 — Selector cohort JLPT với split lexeme-disjoint

Ngày: 2026-10-10. Trạng thái: code đã commit/push `0208649`; export và selector
đã chạy trên VPS, cohort artifact đã freeze; chưa chạy MiniLM/Muse hoặc apply DB.

## Thay đổi

- `retrieval-export.ts` có cohort mới `jlpt-n1-n5`; cohort `jlpt` cũ giữ nguyên
  semantics N4/N5. Export đếm population trong cùng transaction
  `REPEATABLE READ READ ONLY`, ghi `cohortCount`/`truncated` vào inventory và trả
  count trong CLI summary.
- `cohort-select.ts` xác minh export manifest/fingerprint, retrieval version,
  sense artifact hash, inventory hash/count và từ chối export partial. Không đọc
  hay ghi PostgreSQL.
- Split dùng `jmdict:<entry>` từ identity nguồn, không dùng numeric DB lexeme ID.
  Seed SHA256 chia mặc định 20/80 theo lexeme; 41 lexeme pilot cũ bị ép vào
  development. Capacity rebalance giữ lexeme nguyên nhóm. Danh sách/hashes nguồn
  ở [artifact provenance](db4-d2-known-development-lexemes-2026-10-10.json).
- Capping chọn nhiều nhất 5 sense/lexeme bằng hash thứ tự. Greedy selector giữ
  quota gần tỷ lệ population độc lập theo JLPT level, POS family, gloss count,
  field/info và original-link status (unlinked/nonexact/exact). JLPT không bị
  coi là frequency corpus; không tạo sampling weights.
- Shard assignment giữ lexeme cùng split/shard, hard cap 100 target/shard và 10
  shard toàn cohort. Target có `sourceRef.file + line + rowSha256`, sense/lexeme
  identity, original-link status, strata, split và stable target key.
- Cohort target chứa `lexemeKey`, `sourceRef`, `originalStatus`; contract
  DB4-D1 mapping v1 không thay đổi.
- Artifact đầu ra mới: `population.json`, `selected.jsonl`, `sampling.json`.
  Artifacts immutable; cùng prefix không bị ghi đè.

## Provenance pilot development

Đã đối chiếu source hash của D2 review (31 no-candidate sense, 13 lexeme), D4
requests (138 rows, 69 R1 target, 32 lexeme), D5 repeat (20 R2 rows) và v2 sample30
(60 rows, 30 R1 target, 15 lexeme). Hợp nhất cho ra **41 lexeme**; 15 lexeme v2
sample30 đều đã có trong tập D4. Pilot/repeat không thêm entry ngoài tập này.
Remote artifacts chỉ đọc qua SSH; không lấy raw prompt/reply.

## Chạy cohort sau khi release code lên VPS

```bash
cd /opt/langoo/app

npx tsx scripts/db4/retrieval-export.ts \
  --artifact-dir /opt/langoo/storage/db4-batches/<run-id> \
  --prefix export --cohort jlpt-n1-n5 --limit 20000 --chunk 500

npx tsx scripts/db4/cohort-select.ts \
  --artifact-dir /opt/langoo/storage/db4-batches/<run-id> \
  --manifest export/manifest.json \
  --known-development docs/reviews/db4-d2-known-development-lexemes-2026-10-10.json \
  --seed db4-d4-d5-cohort-2026-10-10-v1 \
  --prefix cohort/2026-10-10-v1
```

Export `--limit` phải phủ toàn bộ `cohortCount`; selector dừng nếu không. Cohort
count từ preflight cũ là 15.245, phải kiểm lại ở snapshot mới. Full export hiện
cũng kéo concept corpus như trước; chưa chạy để chưa tạo thêm dung lượng/tải VPS.
Sau freeze còn cần source audit, ONNX/RRF theo cohort, review artifacts và batch
prepare; selector không gọi Muse hoặc ghi DB.

## Kiểm tra

- `npx tsc -p tsconfig.db4.json --noEmit` — pass.
- `npx eslint scripts/db4/cohort-select.ts scripts/db4/retrieval-export.ts scripts/db4/_batch-types.ts --max-warnings 0` — pass.
- `npx prettier --check` trên ba file TypeScript và JSON known-development — pass.
- Known-development JSON parse + kiểm 41 ID sorted/unique — pass.
- Scoped `git diff --check` — pass. Full-tree check có trailing whitespace có sẵn
  tại `docs/handoff/fe-handoff-2026-10-08.md:3` của WIP khác; không sửa.
- Unit/integration tests không chạy theo phạm vi lượt này. Kết quả export/selector
  trên dữ liệu thật được ghi ở mục kế tiếp.

## Kết quả chạy VPS — 2026-10-10

- Code lấy từ commit `0208649` trong checkout tạm `/tmp`; không pull, deploy hoặc
  ghi đè working tree `/opt/langoo/app` vì có WIP M4.5 chưa commit.
- VPS `.env` không có `DB4_DATABASE_URL`; tiến trình được truyền rõ
  `DATABASE_URL` hiện có dưới tên `DB4_DATABASE_URL` chỉ trong lần chạy này,
  không sửa file ENV. Export xác nhận
  `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`,
  `transaction_read_only=on`, rồi `ROLLBACK`; không có DB writes.
- Export cohort `jlpt-n1-n5`: population 15.245, xuất đủ 15.245 sense và 120.875
  concept, `truncated=false`, limit 20.000. Export mất khoảng 8m24s; selector
  mất khoảng 3m42s. Tổng artifact 796.500.592 bytes (~797 MB); còn 9,0 GB disk.
- Selector tạo đúng 1.000 target: 200 development + 800 holdout, 10 shard đủ 100
  mỗi shard. Lexeme leakage 0, duplicate sense key 0, cao nhất 3 sense/lexeme
  (cap 5). JLPT selected: dev N1–N5 = 60/39/53/21/27; holdout =
  244/148/247/76/85. 41/41 pilot lexeme có trong population; 7 vào sample và
  cả 7 ở development. Trong sample, original status đều là `unlinked`.
- Export artifact hash checks và selected JSONL hash đều pass; gates
  `lexemeDisjoint`, `pilotLexemesInDevelopment`, quotas, unique sense keys và
  shard cap đều pass.
- Storage: `/opt/langoo/storage/db4-batches/db4-d2-jlpt-n1-n5-20261010-0208649`.
  Manifest SHA256 `34eb02c2e6bfa865b326a57135b436e79b34b6af539b349d40d97387d26e3be6`;
  selected SHA256 `8a224400f36abdbad7ae9c1eb694e6cdc530809abf67976be99bcef5c2628fd2`;
  sampling SHA256 `00bf325930a1c08f276b0afa8feb02f1c43e27d2f34682ce30011a75f93cf528`.

## Còn thiếu và Git

- Chạy full export read-only trên VPS với count/population mới; chạy selector, xác
  nhận đúng 200/800, không leakage, strata/shard counts và unmatched pilot IDs.
- Thực hiện source audit rồi retrieval RRF; chưa có semantic measurements,
  runner/resume, D5 quality gate, D6 apply hoặc D7 serving.
- Commit code/docs `0208649` đã push. VPS chỉ nhận artifact cohort trong storage;
  app code không deploy, DB không đổi, `.env` không sửa, MiniLM/Muse chưa chạy.
- Còn source audit, ONNX/RRF recall/quality measurement, Muse batch và các gate
  D5/D6/D7. Không xem cohort freeze là mapping hoàn tất.
