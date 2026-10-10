# DB4-D2 — Hybrid lexical-MiniLM retrieval bằng RRF

Ngày: 2026-10-10. Trạng thái: code local, kiểm tra tĩnh pass; chưa chạy cohort,
chưa commit/push/deploy/apply DB.

## Đầu ra

- Bản retrieval mới `db4-d2-hybrid-rrf-v1`, giữ adapter/export và contract D1.
- Mỗi EN gloss tạo một lexical lane và một MiniLM lane; thêm mỗi loại một lane
  query tổng từ toàn bộ gloss/definition EN.
- Lexical dùng inverted index trên audited English labels/definitions, unique-token
  overlap và boost khi query khớp normalized label. MiniLM lấy cosine shortlist;
  POS compatibility vẫn là filter cứng như trước.
- Lấy tối đa 30 candidate/lane; hợp nhất rank bằng RRF `1/(60 + rank)` với
  rank bắt đầu từ 1. Gloss coverage chỉ dùng làm tie-break sau RRF.
- Candidate pool union giới hạn 100 theo RRF, coverage, semantic key; D1 bundle
  nhận tối đa 5 candidate.
- `hit.score` và D1 `rankScore` là normalized RRF 0–1. Features giữ raw RRF,
  lane ranks, MiniLM cosine, lexical overlap, coverage, cap/pruning metrics;
  calibrated score vẫn null. Điểm retrieval không phải confidence.
- Version mới đổi key cache và manifest version. Không sửa/ghi đè artifact hay
  cache `db4-d2-minilm-v1` cũ; D1 schema không đổi.

## File/phạm vi

- `scripts/db4/mapping_minilm.py`: lexical index, lane retrieval, RRF, deterministic
  pool cap, feature provenance và method version.
- `scripts/db4/_retrieval.ts`: version validation và cách ánh xạ normalized RRF
  sang D1 `rankScore`; artifact cũ/new được tách bằng method version.
- `docs/plans/db4-d2-source-minilm-retrieval.md`,
  `docs/handoff/db4-d2-source-minilm-retrieval-2026-10-08.md` và `PROGRESS.md`:
  thuật toán/consumer/status.

## Kiểm tra

- `npx tsc -p tsconfig.db4.json --noEmit` — pass.
- `npx eslint scripts/db4/_retrieval.ts --max-warnings 0` — pass.
- `python3 -m py_compile scripts/db4/mapping_minilm.py` — pass.
- `uploads/db4-d2-venv/bin/python -m black --check scripts/db4/mapping_minilm.py` — pass.
- `npx prettier --check` cho TypeScript và plan/handoff/review liên quan — pass.
- `git diff --check` trên các file tracked thuộc thay đổi — pass. Full-tree check
  chỉ báo trailing whitespace có sẵn ở `docs/handoff/fe-handoff-2026-10-08.md:3`
  của WIP khác; file đó được giữ nguyên.
- Unit/integration tests không chạy; không chạy ONNX mới, không export cohort,
  không gọi Muse, không ghi DB.

## Gate còn thiếu

- Split 200/800 đã chốt; selector/export code có local. Chưa export/freeze cohort,
  tạo shard artifact hoặc bind snapshot thực.
- Chưa đo recall@30/recall@5, precision, semantic quality, runtime/RAM hay so sánh
  RRF với retrieval v1 trên cùng mẫu gold.
- Chưa chạy selector trên dữ liệu thật, Muse batch runner, D5 quality gate,
  DB4-D6 apply/journal hoặc D7 serving.

## Git và triển khai

Thay đổi local chưa commit/push. Không deploy app, không áp DB. Giữ nguyên các
thay đổi khác đã có trong working tree.
