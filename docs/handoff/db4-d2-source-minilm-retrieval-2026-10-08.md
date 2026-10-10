# DB4-D2 — Mapping nguồn đã xác minh và chọn candidate bằng MiniLM

Ngày: 2026-10-08. Owner triển khai lượt này: GPT, theo yêu cầu trực tiếp.
Đọc cùng [plan](../plans/db4-d2-source-minilm-retrieval.md),
[contract DB4-D1](../plans/db4-schema-v1.md) và [review](../reviews/db4-d2-source-minilm-retrieval-2026-10-08.md).

## 1. Đầu ra và giới hạn

- `retrieval-export.ts`: PostgreSQL REPEATABLE READ READ ONLY, query chunk/keyset;
  export sense, tất cả EN gloss gốc, raw attributes/restrictions/POS, concept,
  WordNet synset lineage, lemma EN/JA, seed pending và existing links.
- `mapping_minilm.py audit`: đối chiếu byte hash/version với `wn.db`/JMdict gốc;
  kiểm synset/ILI/POS, definition/member, batch và license evidence. JMdict dùng
  projection của importer: bỏ duy nhất `examples` trong attributes. Audit chỉ
  chứng minh dữ liệu trong export chỉ định, không chứng nhận toàn DB/nguồn vĩnh viễn.
- `mapping_minilm.py retrieve`: MiniLM ONNX CPU, revision pin; mỗi EN gloss được
  truy hồi riêng, kết hợp query trung bình và seed lexical, lọc POS. Không coi
  mỗi gloss là một nghĩa độc lập. Tối đa 5 hits; giữ toàn bộ context cho review.
- `retrieval-generate.ts`: đọc streaming catalog, chỉ giữ context các hit/anchor;
  kiểm hash và coverage rồi gọi constructors/validators DB4-D1 để tạo candidates/bundles.
- `source-identity.jsonl` tách direct WordNet identity khỏi semantic retrieval.
  WordNet identity phải đúng lexicon/version/synset, audited source và ownership
  của existing link. Cùng ILI hoặc mặt chữ không đủ để đưa JMdict vào nhánh này.
- Không ghi PostgreSQL, không gọi AI, không curate/promote, không refresh serving.
  `hypothesisRelation=exact` trong candidate là giả thuyết cho review, không là verdict.

Source audit production phải có raw-check report pass, bound với export, proof bytes
đúng hash; chỉ sửa flag verified không đủ. License policy là input đã được operator
đọc/xác minh, không tự suy license từ chuỗi `ghi nguồn` trong DB. Correction chỉ nằm
trong artifact, không sửa `public.source`.

## 2. CLI và ENV

Đây là **adapter CLI READ ONLY riêng của DB4-D2**. Không thay parser orchestration
frozen `_cli.ts` và không thay shape/hash candidate/bundle DB4-D1. Chưa triển khai
các executable orchestration `mapping-inventory`/`mapping-export`/`mapping-score`.

- Export cần `DB4_DATABASE_URL` explicit. Không fallback sang `DATABASE_URL` hay
  `DIRECT_URL`; không truyền connection string qua CLI.
- Chỉ export đọc ENV. Các bước audit/retrieve/generate chỉ đọc artifact.
- Artifact root mặc định của Node: `uploads/db4`; Python phải truyền root.
- Mọi reference bên trong root là relative, không traversal/symlink ra ngoài.
- Artifact output dùng tên/prefix mới, không overwrite file gốc. Chỉ cache có
  checkpoint mutable theo corpus/model key và lock.

```bash
python3 -m venv uploads/db4-retrieval-venv
uploads/db4-retrieval-venv/bin/pip install -r scripts/db4/requirements-retrieval.txt

# Đặt DB4_DATABASE_URL ở ENV của phiên chạy, không ghi key/URL vào tài liệu.
npx tsx scripts/db4/retrieval-export.ts \
  --artifact-dir uploads/db4-run \
  --prefix export \
  --cohort jlpt --limit 100 --chunk 500

uploads/db4-retrieval-venv/bin/python scripts/db4/mapping_minilm.py audit \
  --artifact-dir uploads/db4-run --export export/manifest.json \
  --wn-db /path/to/original/wn.db --jmdict /path/to/original/jmdict.json \
  --licenses licenses/policy.json --prefix audit

uploads/db4-retrieval-venv/bin/python scripts/db4/mapping_minilm.py retrieve \
  --artifact-dir uploads/db4-run --export export/manifest.json \
  --audit audit/sources-audited.json --download-model \
  --onnx-file onnx/model_quint8_avx2.onnx \
  --threads 1 --batch 16 --top-k 5 --prefix search

npx tsx scripts/db4/retrieval-generate.ts \
  --artifact-dir uploads/db4-run --export export/manifest.json \
  --audit audit/sources-audited.json --search search/manifest.json \
  --prefix generation
```

`jlpt` chọn sense JMdict có JLPT accepted N5/N4, theo sense ID; `--limit` là số
sense, không phải số lemma. Default 100, chunk ≤2.000. Có thêm `wordnet`,
`unlinked-ja`, `unlinked-en`; **Wiktextract chưa có raw auditor/anchor adapter**, nên
export EN Wiktextract hiện trả blocked/missing identity, không mở AI review.
Không nói toàn DB4-D2 hay toàn EN đã hoàn tất.

MiniLM pin `sentence-transformers/all-MiniLM-L6-v2` revision
`1110a243fdf4706b3f48f1d95db1a4f5529b4d41`. Default portable float model:
`onnx/model.onnx`. `model_quint8_avx2.onnx` là weight quantized cùng revision của
publisher, chỉ chọn trên CPU phù hợp AVX2; không tự đổi variant khi resume.
Model file hashes/variant/corpus text tham gia cache key. Không có torch/GPU service.

## 3. License policy

Lưu bản license/notice gốc bên trong root, rồi tạo policy theo source code:

```json
{
  "oewn": {
    "license": "CC BY 4.0; underlying Princeton WordNet notice retained",
    "attribution": "Open English WordNet Team; Princeton University WordNet",
    "url": "https://github.com/globalwordnet/english-wordnet",
    "evidence": [
      { "path": "licenses/oewn.txt", "sha256": "SHA256_BYTES_LICENSE_FILE" }
    ]
  }
}
```

Thay hash minh họa bằng hash byte thật. Cần policy riêng cho `jmdict`, `oewn`,
`omw-en`, `omw-ja` khi dùng context của chúng. Bản `wn.db` đang dùng là container
chung của ba wordnet; hash chung là hợp lệ sau khi kiểm metadata lexicon/version
và từng source row. Không tự lấy definition cache có `source_id=cili` làm definition
CILI; exporter lấy `concept_gloss` EN WordNet có lineage rõ.

Nguồn license đã đọc trong lượt này:

- [JMdict simplified CC BY-SA 4.0](https://github.com/scriptin/jmdict-simplified/blob/master/LICENSE.txt).
- [OEWN notice/license](https://github.com/globalwordnet/english-wordnet/blob/main/LICENSE.md).
- [OMW English / Princeton WordNet license](https://github.com/omwn/omw-data/blob/main/wns/eng/LICENSE).
- [Japanese WordNet NICT license](https://github.com/omwn/omw-data/blob/main/wns/jpn/LICENSE).

## 4. Cache, RAM và resume

- Pool concept được encode một lần, float32 memmap 384 chiều; reuse theo text/ID/POS,
  weight/tokenizer/config hashes và encoder policy. Không tạo ma trận toàn sense × concept.
- Text dài được chia token chunk 254 + CLS/SEP, overlap 32, pooling + normalize;
  không âm thầm cắt bỏ phần sau. Batch được nhóm theo độ dài để giảm padding.
- Checkpoint mỗi 256 concept: fsync vector block + atomic state replacement,
  SHA256 block; resume xác minh toàn prefix đã lưu. Warm cache kiểm whole-file hash.
- `build.lock` chặn hai writer. Nếu process bị SIGKILL/TERM và lock còn, kiểm PID
  trong lock đã chết rồi mới xóa **lock đó**; giữ vectors pending/state để resume.
  Không xóa lock của process đang chạy hoặc thay corpus/model để ép reuse.
- Không có semantic target (WordNet identity/blocked/existing exact/missing context)
  thì xuất status trực tiếp, không download/load model hay xây cache.
- Giữ công việc nặng ở local/offline trước. Chưa cài ONNX hoặc mở job trên VPS app;
  VPS chỉ được dùng làm nguồn export READ ONLY trong lượt thử. Không coi VPS 1 vCPU
  là đã benchmark theo số liệu CPU local.

## 5. Consumer DB4-D3/DB4-D4

Ngày 08/10 đã soạn [DB4-D4 prompt semantic v1](../plans/db4-d4-semantic-match-prompt-v1.md):
system text + phase R1/R2 dùng trực tiếp, giữ output D1. Chưa có runner tự nạp
prompt/provider hoặc semantic pilot; tích hợp theo phần message/version/hash
trong tài liệu đó. Prompt không tự chọn concept ngoài shortlist để bù retrieval miss.

`generation/manifest.json` bind export/audit/search, semantic snapshot và hashes:

| File                    | Consumer                                                                     |
| ----------------------- | ---------------------------------------------------------------------------- |
| `candidates.jsonl`      | D1 candidate v1; parse bằng `parseMappingCandidate`/`parseMappingCandidates` |
| `bundles.jsonl`         | D1 bundle v1; bind với candidates của đúng sense bằng `parseMappingBundle`   |
| `source-identity.jsonl` | Audit/proposal direct source; không phải AI decision hoặc lệnh apply         |
| `status.jsonl`          | Mọi sense, kể cả no candidate/blocked/unresolved/existing exact              |

Bundle không chứa score/rank/hypothesis. D4 không gửi retrieval score hay R1 verdict
cho R2. D4 vẫn cần tạo job/pilot manifest v1, phase renders, prompt, transport,
budget/attempt ledger; không đưa generation manifest này vào job parser như pilot.

`rankScore=(cosine+1)/2`, clamp/round 6 chữ số chỉ để đúng miền retrieval score;
`calibratedScore=null`. Raw cosine/branch scores/seed/pruning counts ở features.
Không dùng rankScore làm confidence mapping. Diversification giữ top theo từng
gloss khi đủ 5 slot; nhánh chưa được đại diện được ghi rõ trong sidecar.

Seed lexical chưa xác minh nghĩa chỉ là retrieval hint; restriction lọc form cho
seed, không loại một concept phù hợp nghĩa chỉ vì Japanese WordNet thiếu spelling.
Form kind dùng heuristic chữ Hán cho bước seed; raw kana/kanji restrictions vẫn
nguyên vẹn trong bundle để semantic reviewer xét. Không chứng minh recall bằng
số sense có hits. Chưa có gold mapping hoặc LLM semantic review ở lượt này.

## 6. Trạng thái

Code/test/docs lưu local; chưa commit/push/deploy app, không apply DB. Kết quả kiểm
tra và smoke thực tế được ghi tại [review](../reviews/db4-d2-source-minilm-retrieval-2026-10-08.md).

## 7. DB4-D2 follow-up — retrieval version mới ngày 10/10

Artifact mới dùng `db4-d2-hybrid-rrf-v1`; không parse artifact
`db4-d2-minilm-v1` như output của ranker mới. D1 shape không đổi. Pipeline mới
truy hồi top 30/lane từ exact-label/token-overlap index và MiniLM cho query tổng
cùng từng EN gloss, union cap 100, RRF `k=60`, deterministic tie-break theo gloss
coverage rồi semantic key, tối đa 5 candidate.

`hit.score` là normalized RRF 0–1; `features` giữ raw RRF/ranks, cosine MiniLM,
lexical overlap, coverage và pruning counts. `retrieval.rankScore` lấy trực tiếp
normalized RRF; `calibratedScore=null`. Với artifact v1 lịch sử, rankScore vẫn
được diễn giải bằng cosine transform ở đúng method version cũ. Không dùng score
nào làm xác suất đúng.

Chi tiết implementation/check/gate ở [review DB4-D2 RRF](../reviews/db4-d2-hybrid-rrf-2026-10-10.md)
và [plan DB4-D2](../plans/db4-d2-source-minilm-retrieval.md). Kết quả ranker
trên cohort được cập nhật ở §9.

## 8. Cohort selector — code local ngày 10/10

Giữ `--cohort jlpt` cho export lịch sử N4/N5. Để lấy accepted JLPT N1–N5, dùng
cohort mới `jlpt-n1-n5`; export ghi population count trong `inventory.json` và
`truncated`. Đặt `--limit` ít nhất bằng population count. Selector từ chối snapshot
partial, fingerprint sai, retrieval version cũ hoặc số sense khác inventory.

```bash
cd /opt/langoo/app

npx tsx scripts/db4/retrieval-export.ts \
  --artifact-dir uploads/db4-run \
  --prefix export --cohort jlpt-n1-n5 --limit 20000 --chunk 500

npx tsx scripts/db4/cohort-select.ts \
  --artifact-dir uploads/db4-run \
  --manifest export/manifest.json \
  --known-development docs/reviews/db4-d2-known-development-lexemes-2026-10-10.json \
  --seed db4-d4-d5-cohort-2026-10-10-v1 \
  --prefix cohort/2026-10-10-v1
```

`cohort-select.ts` tạo `population.json`, `selected.jsonl`, `sampling.json`, từ
full export đã có; nó không query DB. Đầu ra immutable nên dùng prefix mới cho
cohort mới. 41 known pilot lexeme luôn ở development; các target giữ `senseKey`,
source `senses.jsonl` path/line/row SHA256, `originalStatus`, strata, split và
shard. Chọn tối đa 200 development + 800 holdout, tối đa 5 sense/lexeme, 10 shard
tổng với tối đa 100 sense/shard; nếu dữ liệu không đủ, report số thật và quota
gate chưa đạt. Split không dùng database numeric ID.

Population hiện không có tần suất corpus; JLPT level chỉ là level JLPT. Không
diễn giải nó là số lần dùng từ. Không có sampling weights. Selector kiểm hash
manifest, sense file và inventory; bước `loadExport` tiếp tục kiểm full concept
file trước khi retrieval. Đã chạy cohort trên VPS từ commit `0208649`:
15.245 sense, 120.875 concept, `truncated=false`, tạo đúng 200 development + 800
holdout và 10 shard × 100. Artifact ở
`/opt/langoo/storage/db4-batches/db4-d2-jlpt-n1-n5-20261010-0208649`; manifest
SHA256 `34eb02c2e6bfa865b326a57135b436e79b34b6af539b349d40d97387d26e3be6`, selected
SHA256 `8a224400f36abdbad7ae9c1eb694e6cdc530809abf67976be99bcef5c2628fd2`.
VPS thiếu `DB4_DATABASE_URL`; lần chạy truyền `DATABASE_URL` hiện có rõ ràng cho
tiến trình, không sửa `.env`. Guard READ ONLY được xác nhận trước truy vấn và
transaction được rollback. App code không deploy do working tree VPS có WIP khác.
Xem [review DB4-D2 selector](../reviews/db4-d2-cohort-selector-2026-10-10.md) và
[review DB4-D2 RRF](../reviews/db4-d2-hybrid-rrf-2026-10-10.md).

## 9. DB4-D2 — Project selected cohort, audit và retrieval

Selector lưu row references về full export; `retrieval-generate.ts` hiện nhận một
export đầy đủ thay vì danh sách selector. `cohort-project.ts` tạo export riêng
cho đúng các sense đã chọn, giữ nguyên raw JSONL rows theo source order, xác minh
line/row hash, giữ cùng lexeme trong một split/shard và tái tính
inventory/manifest. Ví dụ:

```bash
npx tsx scripts/db4/cohort-project.ts \
  --artifact-dir uploads/db4-run \
  --manifest export/manifest.json \
  --sampling cohort/2026-10-10-v1/sampling.json \
  --prefix cohort-export/2026-10-10-v1

uploads/db4-retrieval-venv/bin/python scripts/db4/mapping_minilm.py audit \
  --artifact-dir uploads/db4-run \
  --export cohort-export/2026-10-10-v1/manifest.json \
  --wn-db /path/to/original/wn.db --jmdict /path/to/original/jmdict.json \
  --licenses licenses/policy.json --prefix audit/cohort-2026-10-10-v1

uploads/db4-retrieval-venv/bin/python scripts/db4/mapping_minilm.py retrieve \
  --artifact-dir uploads/db4-run \
  --export cohort-export/2026-10-10-v1/manifest.json \
  --audit audit/cohort-2026-10-10-v1/sources-audited.json \
  --onnx-file onnx/model_quint8_avx2.onnx --threads 2 --batch 32 --top-k 5 \
  --prefix search/cohort-2026-10-10-v1

npx tsx scripts/db4/retrieval-generate.ts \
  --artifact-dir uploads/db4-run \
  --export cohort-export/2026-10-10-v1/manifest.json \
  --audit audit/cohort-2026-10-10-v1/sources-audited.json \
  --search search/cohort-2026-10-10-v1/manifest.json \
  --prefix generation/cohort-2026-10-10-v1
```

Ngày 10/10 chạy với cohort 1.000: audit raw kiểm 6.745 JMdict rows, 453.744 OEWN,
328.465 OMW EN và 215.254 OMW JA, không có mismatch; Wiktextract 0 kiểm và vẫn
blocked. RRF trả hits cho 966/1.000 sense; 34 no-candidate sau POS filter. Tạo
4.830 candidates/966 bundles. MiniLM warm/cache-hit runtime 334,841 giây, peak
469,09 MiB, threads 2, batch 32; không phải semantic accuracy benchmark.
Artifacts/hash và chi tiết nguồn ở [review DB4-D2 cohort retrieval](../reviews/db4-d2-cohort-retrieval-2026-10-10.md).

Một lần thử ban đầu đã bắt đầu retrieval nhầm trên full 15.245 population do CLI
chưa hỗ trợ filter selected rows; dừng ở 145 kết quả. Partial output được cách ly
trong `search/attempt-full-population-interrupted/` và **không** dùng làm input
cho generation/decision. Không tái dùng prefix đó.

Trạng thái: cohort artifacts local/ignored, không commit; code projector đang được
đưa vào Git riêng. Chưa gọi Muse, chưa chạy batch runner, không apply DB, không
deploy app. Trước shadow dispatch cần hoàn tất conditional-wave runner, durable
intent/recovery, lock/cap/breaker và technical smoke theo
[plan DB4-D4/D5 batch](../plans/db4-d4-d5-automated-batch-rollout.md).
