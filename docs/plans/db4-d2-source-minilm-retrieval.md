# DB4-D2 — Mapping nguồn đã xác minh và chọn candidate bằng MiniLM

Ngày: 2026-10-08. Phạm vi đã được chủ dự án cho triển khai.

## Đầu ra

1. Export READ ONLY một snapshot: sense/context, concept WordNet, seed lexical,
   existing links và metadata source/batch. Giữ toàn bộ EN gloss, POS và restriction.
2. Đối chiếu snapshot với `wn.db` và JMdict gốc, kiểm hash/version/license evidence.
   Không lấy `verified=true` trong DB hay một ILI đơn lẻ làm bằng chứng đủ.
3. MiniLM ONNX CPU, revision cố định, cache embedding theo nội dung/model. Truy hồi
   toàn concept hợp lệ theo POS và từng EN gloss, kết hợp seed lexical, tối đa 5
   candidate trong bundle. Không ép chọn concept khi thiếu context.
4. Xuất candidates/bundles theo contract DB4-D1, source-identity sidecar và status
   cho mọi sense trong cohort. Score chỉ dùng retrieval, không là xác suất exact.

## Cách thực hiện

- PostgreSQL dùng Node/pg, transaction REPEATABLE READ READ ONLY, keyset/chunk.
- Python chỉ đọc artifact/SQLite gốc và chạy ONNX; không có quyền ghi PostgreSQL.
- Dùng crosswalk WordNet/ILI đã có thay vì tải một bản WordNet mới qua Wn. Cùng
  lexicon/version/synset được đối chiếu với artifact gốc; JMdict không đi fast path.
- Nguồn thiếu/chưa xác minh giữ blocked. Audit file và mọi input được hash; bundle
  chỉ nhận ready candidates. Direct identity là kết quả audit riêng, không tạo
  quyết định AI giả hoặc tự promote/curate concept.
- Không gọi Muse/OpenCode, không apply DB, không đổi API, không deploy app.
- Pilot retrieval trên dữ liệu thật; kiểm kỹ thuật không thay cho gold semantic
  hoặc chứng minh recall/precision. D4 R1/R2 và D5 gate vẫn còn nguyên.

## Kiểm tra cần chạy

- TypeScript/ESLint/contract tests và retrieval tests: hash drift, fake source
  audit, source identity ambiguity, POS/restriction, full context, denominator.
- Python unit: multi-gloss retrieval, POS/unknown, chunk không mất token, cache
  invalidation, ties, input/result integrity và raw source audit.
- Smoke ONNX thật và cohort nhỏ export READ ONLY từ VPS; lưu thời gian/RAM/cache.
- `git diff --check`, trạng thái Git và handoff lệnh chạy.

## 2026-10-08 — Kết quả triển khai

- Adapter đã code và kiểm local. READ ONLY export VPS 100 sense / 41 lexeme
  N5/N4; audit scoped JMdict/OEWN/OMW EN/JA pass, Wiktextract blocked.
- Pool 120.875 concept; ONNX thật cold 1.323,738s, warm 51,315s; xuất 345 candidate
  / 69 bundle, 31 no-candidate theo POS. 69 ready không là semantic accuracy.
- 41 Node tests (30 D1 + 11 D2) / 15 Python tests pass; TypeScript/lint/Black/compile
  pass; chi tiết kiểm, hash, metric và hạn chế ở [review](../reviews/db4-d2-source-minilm-retrieval-2026-10-08.md).
- [Handoff CLI/ENV/cache/consumer](../handoff/db4-d2-source-minilm-retrieval-2026-10-08.md).
  Adapter `retrieval-*` không đổi parser orchestration frozen hoặc contract D1.
- Gate còn thiếu: full source/legacy audit, Wiktextract adapter, semantic recall@5,
  DB4-D4/D5 review/pilot và DB4-D6/D7 apply/serving. Chưa commit/push/deploy/apply.
  Không gom WIP milestone khác.
