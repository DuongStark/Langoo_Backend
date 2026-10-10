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
