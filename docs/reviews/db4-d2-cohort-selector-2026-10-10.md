# DB4-D2 — Selector cohort JLPT với split lexeme-disjoint

Ngày: 2026-10-10. Trạng thái: code local, static checks pass; chưa export/freeze
cohort thật, chưa chạy MiniLM/Muse hoặc apply DB.

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
- Unit/integration tests không chạy theo phạm vi lượt này. Chưa chạy export,
  selector trên dữ liệu thật, MiniLM, Muse, DB write hoặc VPS deploy.

## Còn thiếu và Git

- Chạy full export read-only trên VPS với count/population mới; chạy selector, xác
  nhận đúng 200/800, không leakage, strata/shard counts và unmatched pilot IDs.
- Thực hiện source audit rồi retrieval RRF; chưa có semantic measurements,
  runner/resume, D5 quality gate, D6 apply hoặc D7 serving.
- Code/docs local chưa commit/push. Không deploy code hoặc artifact; không đổi DB,
  ENV hay service. Giữ nguyên các WIP khác trong working tree.
