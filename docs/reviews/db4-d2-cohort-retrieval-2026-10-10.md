# DB4-D2 — Source audit và hybrid retrieval trên cohort 1.000 sense

Ngày: 2026-10-10. Trạng thái: cohort export, source audit, ONNX/RRF retrieval và
D1 candidate generation đã chạy local từ snapshot cohort freeze trên VPS; không
gọi Muse, không apply DB, không deploy app. Candidate quality chưa được đánh giá.

## Mã và phạm vi

**DB4-D2 — Retrieval cohort JLPT N1–N5 theo source audit và hybrid RRF.** Mục
tiêu là kiểm tra source integrity và khả năng tạo shortlist cho cohort frozen,
không khẳng định candidate đúng nghĩa.

- Parent VPS export: 15.245 sense / 120.875 concepts; manifest
  `34eb02c2e6bfa865b326a57135b436e79b34b6af539b349d40d97387d26e3be6`.
- Frozen selection: 1.000 sense, 200 development / 800 holdout, 10 shards × 100;
  selected SHA256 `8a224400f36abdbad7ae9c1eb694e6cdc530809abf67976be99bcef5c2628fd2`.
- Run artifacts live in ignored local directory
  `uploads/db4-d2-jlpt-n1-n5-0208649/`; originals remain on VPS under
  `/opt/langoo/storage/db4-batches/db4-d2-jlpt-n1-n5-20261010-0208649/`.
  Large raw/export/model/result artifacts are not committed.

## Source integrity

The selected export is projected from the frozen full export. The new
`cohort-project.ts` validates sampling/population references, selected row hashes,
stable sense and lexeme identities, snapshot target keys, lexeme-disjoint split,
same-shard-per-lexeme assignment, quota/shard counts, and raw JSONL line
boundaries. It writes a new senses file, inventory and manifest without querying
or mutating PostgreSQL.

| Source      | Version | Raw identity checks | Result                                    |
| ----------- | ------: | ------------------: | ----------------------------------------- |
| JMdict      |   3.6.2 |               6.745 | verified, 0 mismatch                      |
| OEWN        |    2024 |             453.744 | verified, 0 mismatch                      |
| OMW EN      |     1.4 |             328.465 | verified, 0 mismatch                      |
| OMW JA      |     1.4 |             215.254 | verified, 0 mismatch                      |
| Wiktextract | unknown |                   0 | blocked; raw identity adapter unavailable |

The raw JMdict bytes used for the audit match SHA256
`8cdbb0cc9625f775cd093e37931974b568221747bf6f2cbaff7b0671b5631ca5`. The active
JMdict snapshot on VPS differed; it was not substituted for the pinned source.
Source identity checks establish byte/record provenance, not cross-language
semantic alignment.

Key derived artifact hashes:

- Cohort export manifest:
  `9f59fd436e3c938e82810b5d024c4f15112ffd532e4398f1b6cca6a180efe776`.
- Projection sidecar:
  `43af99bb69e14cfa5dc3b548ddbe0c879f506a12791649b98facbc0df98281c6`.
- Selected source audit:
  `b548a7024a2fe17a4ab4d01e0a7656a6ad34c67407cd0c0c6d148672d2c8bad3`.

## Retrieval result

| Metric                        |                       Result |
| ----------------------------- | ---------------------------: |
| Selected senses               |                        1.000 |
| Has at least one candidate    |                          966 |
| No candidate after POS filter |                           34 |
| Candidate rows                |                        4.830 |
| Ready bundles                 |                          966 |
| Concepts in audited pool      |                      120.875 |
| Runtime                       |                  334,841 sec |
| Peak RSS                      |                   469,09 MiB |
| ONNX threads / batch          |                       2 / 32 |
| Embedding cache               | hit; 120.875 vectors resumed |

Cache reuse was allowed only after checking the pinned model revision, ONNX model,
tokenizer/config and concept-corpus hashes; the embedding values were reused and
bound to the new RRF retrieval cache key. Method is `db4-d2-hybrid-rrf-v1`, model
revision `1110a243fdf4706b3f48f1d95db1a4f5529b4d41`. The retrieval manifest marks
`semanticQualityValidated=false`; 966 hits do not prove recall or precision.
Candidates must remain unresolved until D4/D5 evaluation.

Generation manifest hash:
`7a9da647d7cd38cc311c7f12711243f47fd35837f59f86823b29b2cc297a760e`; it records
`apply=false`. Retrieval manifest hash:
`dbfebae79339e6393c478ac3ceff2091e147da10899350d7dfec756a6926b1c`.

## Interrupted out-of-scope attempt

An initial invocation used the full 15.245-sense export because the retrieval CLI
does not accept the selector's `selected.jsonl` filter. It was stopped after 145
rows, before completion. Output is isolated at
`search/attempt-full-population-interrupted/partial-results.jsonl` (145 rows;
SHA256 `023902ad1f1e060d2e88dec436730a5499af1c6296060da8deb714e93700358`) and
explicitly marked interrupted. It is not used by audit, generation or any
decision. The projector added in this change makes the selected-sense scope
explicit and content-bound.

## Checks, limits and next step

- `npx tsc -p tsconfig.db4.json --noEmit` — pass.
- `npx eslint scripts/db4/cohort-project.ts scripts/db4/cohort-project.test.ts --max-warnings 0` — pass.
- `npx prettier --check scripts/db4/cohort-project.ts scripts/db4/cohort-project.test.ts` — pass.
- `node --import tsx --test scripts/db4/contract.test.ts scripts/db4/retrieval.test.ts scripts/db4/cohort-project.test.ts` — 45/45 pass.
- `uploads/db4-d2-venv/bin/python -m unittest discover -s scripts/db4 -p test_minilm.py` — 15/15 pass.
- `git diff --check` — D2 scoped files pass; full worktree reports existing
  whitespace at `docs/handoff/fe-handoff-2026-10-08.md:3`, left untouched.
- Independent artifact verification confirmed selection/export/audit/search/
  generation manifests bind the expected hashes and 1.000-row denominators.

Not tested: gold recall/precision, semantic correctness of any candidate, Muse
dispatch, runner resume/unknown recovery, database application, or serving.
The batch runner and technical smoke in
[DB4-D4/D5 plan §17](../plans/db4-d4-d5-automated-batch-rollout.md) remain a gate
before shadow dispatch. No core DB, app code, VPS service or running Muse job was
changed by this work.

## Files and Git

- Code: `scripts/db4/cohort-project.ts` and
  `scripts/db4/cohort-project.test.ts`.
- Updated: DB4-D2 plan, DB4-D2 handoff, `PROGRESS.md`.
- Artifacts: ignored `uploads/db4-d2-jlpt-n1-n5-0208649/`; not included in Git.
- Git: implementation/docs commit `b74268d` created and pushed; no deploy/apply.
