# DB4-D2 — Mapping nguồn đã xác minh và chọn candidate bằng MiniLM

Ngày: 2026-10-08. Trạng thái: code và kiểm tra local; chưa commit/push/deploy/apply.

## Kết quả

Đã triển khai pipeline export → audit nguồn gốc → MiniLM shortlist → artifact
DB4-D1. [Handoff và lệnh chạy](../handoff/db4-d2-source-minilm-retrieval-2026-10-08.md),
[plan](../plans/db4-d2-source-minilm-retrieval.md),
[metric/hash/mẫu đầu ra](db4-d2-source-minilm-retrieval-2026-10-08.json).

| Phép đo thật                    | Kết quả                                                         |
| ------------------------------- | --------------------------------------------------------------- |
| Cohort                          | 100 sense / 41 lexeme JMdict JLPT accepted N5/N4, theo sense ID |
| Pool đã audit                   | 120.875 concept WordNet                                         |
| Candidate / bundle              | 345 candidate, 69 bundle × 5 candidate                          |
| Chưa có candidate               | 31 sense; giữ trong denominator/status                          |
| Dựng cache và retrieval lần đầu | 1.323,738 giây (~22 phút), RAM đỉnh 673,97 MiB                  |
| Chạy lại cùng cache, audit v3   | 51,315 giây, RAM đỉnh 396,92 MiB                                |
| Lượt cold / warm                | Kết quả hits giống nhau trên cohort này                         |
| Gọi LLM / ghi DB                | 0 / 0                                                           |

Thời gian retrieval lấy từ manifest Python, không bao gồm export, source audit,
download model và Node generation. Chạy ONNX **local**: Linux, 4 CPU / RAM 8 GB,
Python 3.12, 2 thread, batch 32, publisher `model_quint8_avx2.onnx` revision pin.
Không lấy số này làm benchmark VPS 1 vCPU / 2 GB. Lần thử portable float trước đó
được dừng khi chưa hoàn tất; không có benchmark đủ để so hai variant.

31 sense rỗng do POS không có trong catalog WordNet hiện tại: 10 interjection,
8 pronoun, 5 conjunction, 4 particle, 2 expression và 2 prefix. Không nới POS
để ép mapping. `no_candidates_after_pos_filter` chỉ là kết quả retrieval, không
chứng minh từ đó không có nghĩa hay không có concept phù hợp ở nguồn khác.

## Audit nguồn

DB VPS được đọc trong REPEATABLE READ READ ONLY. `staging.wn_synset` đã rỗng,
nhưng `core.wordnet_synset` còn crosswalk; đối chiếu lại bằng file `wn.db` gốc
và JMdict gốc đang có trong kho dữ liệu local.

| Nguồn       | Phiên bản     | Checks pass / failure | Trạng thái trong export |
| ----------- | ------------- | --------------------- | ----------------------- |
| JMdict      | 3.6.2         | 637 / 0               | verified                |
| OEWN        | 2024          | 453.744 / 0           | verified                |
| OMW EN      | 1.4           | 328.465 / 0           | verified                |
| OMW JA      | 1.4           | 215.254 / 0           | verified                |
| Wiktextract | thiếu version | 0                     | blocked                 |

Checks đếm các điều kiện hash/version/lineage/synset/POS/text/form/attributes,
**không** phải số mapping semantic đúng hay tập gold. Audit bound với snapshot
export chỉ định; chưa hoàn thành D0 audit toàn DB/legacy. Ba WordNet nằm trong
cùng container `wn.db`, có cùng byte hash nhưng metadata lexicon được kiểm riêng.

Lần audit đầu phát hiện 100 mismatch JMdict attributes vì importer bỏ `examples`.
Đã đối chiếu importer và chỉ loại đúng trường đó khi so với nguồn; giữ mọi field
còn lại, toàn bộ EN gloss theo thứ tự, bộ form đầy đủ và reading. Audit v3 có
thêm kiểm reading/form và POS sense WordNet; tất cả bốn nguồn trên pass.

License evidence được đọc từ nguồn chính chủ và hash byte trong artifact policy.
Metadata license OMW cũ không đủ; correction chỉ nằm trong audit artifact.
Wiktextract chưa có raw auditor/anchor adapter nên không được nâng thành verified.
Các notice/attribution cần giữ khi consumer đưa nội dung ra app; xem handoff.

## Code và phạm vi

- `scripts/db4/retrieval-export.ts`: explicit `DB4_DATABASE_URL`, chunk/keyset,
  giữ source/batch/identity, toàn EN gloss/raw attrs/restrictions và link hiện hữu.
- `scripts/db4/_retrieval.ts`: schema artifact, immutable write/hash, streaming
  catalog, source audit và direct WordNet identity có kiểm ownership/ambiguity.
- `scripts/db4/mapping_minilm.py`: raw audit, ONNX CPU, token chunk, retrieval
  theo từng gloss + query trung bình + seed, POS, top 5 và metrics.
- `scripts/db4/retrieval-generate.ts`: kiểm bindings/coverage, xuất candidate,
  bundle, source-identity, status và generation manifest; `apply=false`.
- `scripts/db4/requirements-retrieval.txt`: dependency Python pin, không torch.
- `scripts/db4/retrieval.test.ts`, `scripts/db4/test_minilm.py`: regression
  artifact integrity/source ownership/context/POS/restriction/cache/recovery.

Giữ nguyên contract/hash DB4-D1 và parser orchestration `_cli.ts`; adapter CLI
được đặt tên `retrieval-*` để không lẫn với executable orchestration chưa làm.
Không thay DB3-B, gloss VI, runtime dictionary, API, migration hay app ENV.

Cache có checkpoint từng block và hash, lock chống writer song song. Test mô phỏng
ngắt build rồi resume, warm reuse, corruption và lock; không tuyên bố đã thử kill
job ONNX thật trên VPS. Cohort blocked-only có test không download/load model.

## Kiểm tra đã chạy

```bash
npx tsc -p tsconfig.db4.json
npx eslint scripts/db4/_retrieval.ts scripts/db4/retrieval-export.ts \
  scripts/db4/retrieval-generate.ts scripts/db4/retrieval.test.ts
npx tsx --test scripts/db4/contract.test.ts scripts/db4/retrieval.test.ts
uploads/db4-d2-venv/bin/python -m unittest discover -s scripts/db4 -p test_minilm.py
uploads/db4-d2-venv/bin/python -m py_compile scripts/db4/mapping_minilm.py scripts/db4/test_minilm.py
uploads/db4-d2-venv/bin/python -m black --check scripts/db4/mapping_minilm.py scripts/db4/test_minilm.py
```

TypeScript/lint pass, **41/41 Node tests** (30 D1 + 11 D2), **15/15 Python tests**,
compile/Black pass. Export VPS thật, audit v3, ONNX cold/warm và generation đủ
100 status đã chạy thành công. Không chạy full app/E2E vì không sửa runtime.
Format/link/diff và working tree được kiểm trước báo cáo cuối.

## Gate còn thiếu và cách dùng tiếp

**69 bundle ready nghĩa là đủ contract/context để review, không phải 69 mapping
đúng.** Đọc mẫu có top candidate yếu: `彼処` sense “that far / that much / that
point” xếp “far cry” lên đầu; `居らっしゃる` gồm “to come / to go / to be
(somewhere)” cũng có candidate không phủ đủ gloss và sắc thái kính ngữ.
Không sử dụng top 1 hoặc cosine làm verdict exact.

Các trường hợp này cần DB4-D4 R1/R2 hoặc kết luận uncertain/no suitable candidate;
DB4-D5 cần gold/semantic audit để đo recall@5, quan hệ và false exact. Tập 100
theo ID dùng làm smoke, không phải pilot ngẫu nhiên hay gate production D1.
Không gọi Muse/OpenCode trong lượt này; chưa làm provider runner, scoring
calibration, candidate import, promote/rollback/serving.

Direct WordNet identity chỉ xuất audit/proposal riêng, không tạo R1/R2 giả.
Có unit checks ownership/version/ambiguity; cohort live này toàn JMdict nên
chưa benchmark nhánh direct identity bằng cohort WordNet thực tế.

Artifact lớn/cache/model để trong `uploads/db4-d2-pilot` (Git ignore). JSON report
trong repo lưu counts/hash, 31 target rỗng và 12 mẫu × 3 candidate. Trên VPS chỉ
chạy exporter trong `/tmp/langoo-db4-d2-20261008.10mKnq`; đã dừng process tạm
bị treo từ lượt export lỗi đầu. Không cài ONNX, không đổi `/opt/langoo/app`,
không mở job nền hay deploy app trong lượt này.

Git: code/test/docs local chưa commit/push; working tree còn WIP nhiều milestone
khác, không gom chúng vào DB4-D2. Trạng thái toàn DB4 vẫn còn các gate nêu trên.
