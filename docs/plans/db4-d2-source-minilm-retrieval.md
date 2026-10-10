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

## 2026-10-10 — DB4-D2 — Hybrid retrieval RRF v1

Ranker mới giữ MiniLM ONNX + lexical inverted index và hợp nhất các ranking bằng
Reciprocal Rank Fusion. `db4-d2-hybrid-rrf-v1`
thay `db4-d2-minilm-v1` cho artifact mới; artifact v1 vẫn là lịch sử bất biến,
không được đọc như output của ranker mới.

- Mỗi EN gloss duy nhất tạo một lexical và một MiniLM lane; thêm lane tổng từ
  toàn bộ gloss/definition EN. Giới hạn 30 ID/lane sau filter POS.
- Lexical rank: unique-token overlap trên audited EN labels/definitions; exact
  normalized label/phrase được boost trong lane lexical. MiniLM cosine vẫn được
  lưu làm feature, không làm tiêu chí final tie-break.
- RRF mỗi lane dùng `1 / (60 + rank)` với rank bắt đầu từ 1. Pool union cap 100,
  tie-break theo số gloss được phủ rồi semantic key; cuối cùng giữ tối đa 5.
- D1 `rankScore` nhận normalized RRF 0–1 cho method mới. Cosine, lexical score,
  rank từng lane và coverage ở features; `calibratedScore=null`. Score không là
  confidence hoặc xác suất semantic match.
- Ranker version/cache key đổi; không xóa/ghi đè embedding cache hoặc artifacts
  cũ. Exact source seeds tiếp tục là retrieval hint và không được nâng thành
  evidence/decision.

Tại thời điểm review RRF ban đầu, code mới chỉ qua kiểm static; chưa chạy ONNX
trên cohort. Kết quả chạy tiếp theo ngày 10/10 được ghi dưới đây và trong
[review DB4-D2 cohort retrieval](../reviews/db4-d2-cohort-retrieval-2026-10-10.md).

## 2026-10-10 — DB4-D2 — Cohort selector deterministic

`retrieval-export.ts --cohort jlpt-n1-n5` chọn JMdict sense có JLPT accepted
N1–N5; tên cohort `jlpt` cũ vẫn giữ hành vi N4/N5. Inventory ghi population
count/truncated. `cohort-select.ts` chỉ nhận cohort N1–N5, population đầy đủ,
fingerprint/hash hợp lệ và retrieval version hiện tại.

Selector nhóm bằng stable `identity.externalId` (`jmdict:<entry>`), không dùng DB
numeric ID làm khóa split. Danh sách 41 lexeme pilot cũ được giữ trong
[known-development artifact](../reviews/db4-d2-known-development-lexemes-2026-10-10.json)
và ép vào development. Split mặc định seeded 20/80 theo lexeme; nếu quota thiếu,
capacity được rebalance deterministically mà không tách lexeme. Mỗi lexeme tối đa
5 sense; strata độc lập gồm JLPT level, POS family, EN gloss count, field/info,
và original-link status (unlinked/nonexact/exact). Không có frequency data nên
JLPT level không đại diện tần suất.

`selected.jsonl` bind từng target về export sense bằng file ref, line và row SHA256;
thêm stable target key, original-link status, strata, split và shard. `sampling.json`
ghi input hashes, seed, known lexemes, split-assignment hash, counts/quotas,
exclusions và shard counts. Selector chỉ ghi immutable artifacts, không query DB
hay gọi Muse; CLI và gate được mô tả trong handoff và
[review selector](../reviews/db4-d2-cohort-selector-2026-10-10.md).

Code đã qua TypeScript/ESLint/Prettier static checks và được commit/push trong
`0208649`. Cohort artifact đã được export/selector trên VPS; kết quả/hash ở
[review selector](../reviews/db4-d2-cohort-selector-2026-10-10.md). Tại thời điểm
đó chưa chạy test suite, benchmark ONNX, gọi Muse, deploy app hoặc apply DB.

## 2026-10-10 — DB4-D2 — Retrieval trên cohort 1.000 sense

Thêm `cohort-project.ts` để chiếu chính xác các dòng đã chọn từ full export thành
export 1.000 sense dùng riêng cho audit/retrieval. Projector kiểm selected file,
sampling/population hashes, target key, source row hash, identity, giữ mọi
lexeme cùng split/shard, quota và shard counts trước khi ghi artifact mới; không
query hoặc sửa DB.

Trên cohort đã freeze, source audit theo snapshot xác nhận JMdict/OEWN/OMW EN/JA;
Wiktextract tiếp tục `blocked` do thiếu adapter identity/audit. Hybrid
lexical-MiniLM RRF chạy trên 1.000 sense: 966 có shortlist, 34 `no_candidates`
sau POS filter, 4.830 candidate trong 966 bundle (tối đa 5 mỗi bundle). Dùng lại
120.875 concept embeddings sau khi xác minh hash model, tokenizer, corpus và cache;
thời gian 334,841 giây, peak RSS 469,09 MiB, 2 ONNX threads, cache hit. Kết quả là
retrieval availability, không đo recall/precision hay độ đúng ngữ nghĩa.

Artifacts nằm dưới `uploads/db4-d2-jlpt-n1-n5-0208649/` (ignored, không commit):
cohort export manifest `9f59fd436e3c938e82810b5d024c4f15112ffd532e4398f1b6cca6a180efe776`,
source audit `b548a7024a2fe17a4ab4d01e0a7656a6ad34c67407cd0c0c6d148672d2c8bad3`,
retrieval manifest `dbfebae79339e6393c478ac3ceff2091e147da10899350d7dfec756a6926b1c`,
generation manifest `7a9da647d7cd38cc311c7f12711243f47fd35837f59f86823b29b2cc297a760e`.
Chi tiết input hashes, raw audit counts, runtime và giới hạn ở
[review cohort retrieval](../reviews/db4-d2-cohort-retrieval-2026-10-10.md).

Không gọi Muse, không apply DB, không deploy app. D4/D5 batch runner/resume và
technical smoke vẫn là gate trước shadow dispatch; semantic gate và DB4-D6/D7
còn thiếu.
