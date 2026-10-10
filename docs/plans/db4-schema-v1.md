# DB4-D1 — Contract mapping v1

Ngày: 06/10/2026. Owner: GPT; consumer D2/D4: DeepSeek.
Phạm vi: `sense_concept`. Đây là contract offline đã triển khai; D0 audit nguồn,
retrieval/scoring, provider runner, pilot và mutation thuộc các chặng tiếp theo.

## 1. Điểm import và cách kiểm tra

Import duy nhất cho consumer: `scripts/db4/_mapping-types.ts`.
File này re-export primitives, job và CLI; không import helper DB3 hoặc mở connection.

```bash
nvm use
npx tsc --project tsconfig.db4.json
npx eslint scripts/db4 --max-warnings 0
npx tsx --test scripts/db4/contract.test.ts
```

Fixture có sẵn trong `scripts/db4/fixtures/`. Tái tạo offline:

```bash
npx tsx scripts/db4/fixtures/build.ts
```

`manifest.json` pin SHA256 **bytes file**, gồm newline. Các fixture đều `mode=fixture`,
nguồn `synthetic-fixture`, URL `example.invalid`; source audit/rate giả lập chỉ kiểm
contract. Không dùng chúng làm gold pilot, xác minh license hoặc bằng chứng API đã chạy.
`evaluateMappingGate()` luôn trả ineligible cho fixture.

Các object dùng Zod `.strict()`. Gọi **bound parser** ở bảng dưới khi đọc artifact;
`SomeSchema.parse()` chỉ kiểm shape, không thay kiểm hash/lineage/file evidence.
Không thêm field tùy tiện; thay shape/hashing cần contract version mới và fixture mới.

| Đối tượng                | API consumer                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| Candidate                | `createMappingCandidate(input)`, `parseMappingCandidate(value)`                             |
| Generation               | `parseMappingCandidates(array)`; một pair duy nhất trong một generation                     |
| Bundle                   | `createMappingBundle(candidates, builderVersion)`, `parseMappingBundle(value, candidates)`  |
| Bundle tự kiểm integrity | `parseMappingBundleIntegrity(value)`; chưa chứng minh thuộc generation gốc                  |
| Render theo phase        | `renderMappingBundle(bundle, phase, seed, promptVersion)`                                   |
| Provider output          | `parseMappingOutput(value, bundle)`, `mappingOutputHash(value, bundle)`                     |
| Decision                 | `parseMappingDecision(value, candidate, bundle, outputR1, outputR2)`                        |
| Audit                    | `parseMappingAudit(value, validatedDecision)`                                               |
| Job                      | `createMappingJob(config, queuedEntries)`, `parseMappingJob(value)`                         |
| Job + input              | `parseMappingJobBound(job, bundles, manifest)` sau verify bytes và generation               |
| State                    | `assertTargetTransition(from,to)`, `transitionMappingTarget(job,key,state,patch)`           |
| Cache / reservation      | `mappingCacheKey(provider,phase,renderedHash)`, `createMappingReservation(provider,limits)` |
| Pilot / gate             | `parsePilotManifest(value)`, `evaluateMappingGate(manifest,gate)`                           |
| CLI                      | `parseMappingCli(command,argv)`, `assertMappingDatabaseTarget(cli,actual)`                  |
| File bytes               | `verifyArtifactBytes(ref,bytes)`; filesystem containment/lock/fsync thuộc D4                |

## 2. Primitive, ordering, hash

- ID PostgreSQL: decimal **string**, `1..9223372036854775807`, không leading zero.
  Không chuyển qua Number. ID sort dùng `compareIds()`/BigInt.
- Hash: SHA256 UTF-8, lowercase 64 hex. Text original giữ nguyên, không trim khi hash.
- `canonicalJson`: sort object keys theo thứ tự JS UTF-16, giữ array order và null.
  Reject undefined, bigint JS, NaN/Infinity, -0, Date/non-plain object, symbol, cycle,
  sparse/decorated array; nesting tối đa 64. Không dùng serializer tự viết bên consumer.
- `rankScore`/self-confidence `[0,1]`, tối đa 6 chữ số thập phân; `calibratedScore=null`
  ở v1. Không biến self-confidence thành calibration.
- Required nullable field **phải có** giá trị null; không omit.
- Artifact ref `{path,sha256}`: path tương đối dưới artifact root, không `..`, `.`,
  backslash, colon, control character hoặc empty segment; sha256 là **raw bytes file**.
  Hash JSON nội dung đã validate dùng `hashJson()` và là loại hash khác.
- Sources/evidence sort key, synset sort `canonicalJson([lexicon,synsetId])`.
  Text rows sort rank tăng, rồi BigInt id tăng; nếu có null ID thì key tăng.
  Forms/retrieval branches giữ thứ tự producer, không trùng.

### 2.1 Stable identity

`senseSemanticKey(source.code, identity.externalId, identity.senseKey)` tạo
`sense:` + hash `{schemaVersion:1,sourceCode,externalId,sourceSenseKey}`.
`identity.senseKey` là anchor sense trong entry nguồn, **không phải local sense_id**.
D0/D2 phải xác minh anchor ổn định trước export; thiếu identity thì blocked/unresolved.

`conceptSemanticKey(sortedSynsetKeys,ili)` tạo `concept:` + hash
`{schemaVersion:1,synsetKeys:[{lexicon,synsetId}],ili}`; không gộp synset chỉ vì cùng ILI.
Numeric IDs phục vụ binding snapshot, không tạo semantic identity.

`mappingTargetKey(senseKey,fingerprint)` hash
`{family:'db4-target',schemaVersion:1,senseKey,semanticInputFingerprint:fingerprint}`.

### 2.2 Snapshot và key candidate

`SemanticSnapshotSchema`: schemaVersion, mode, sourceSnapshots (`sourceKey,sha256`),
identityHash, senseInputHash, conceptInputHash, rawAttributesHash, sourcePolicyVersion,
normalizerVersion, retrievalVersion. Fingerprint hash toàn object + family
`db4-semantic-snapshot`. Đây là manifest hash content, không thay D0 export thật.
JA/EN/raw/source thực sự dùng phải có trong input hashes; gloss VI dẫn xuất không dùng
thì không đưa vào hash này. Field VI ngoài schema bị reject.

`PromotionBaselineSchema`: targetIdentityHash, existingLinksHash,
candidateDecisionsHash, conceptPolicyHash, migrationsHash, servingDefinitionHash;
hash với family `db4-promotion-baseline`. Đổi link/curation/view phải rebind promote,
không tự làm stale semantic job vì DB3 append gloss VI.

Pair/candidate/input/bundle hash dùng object literal trong helper làm chuẩn:

1. pairKey: family `sense_concept_pair`, version, semantic fingerprint, senseKey, conceptKey.
2. inputHash: `candidateSemanticInput()` gồm mode, fingerprint, toàn sense/concept,
   toàn context, evidence và audited sources. Không gồm rank/hypothesis/reasons/predecessor.
3. candidateKey: family `sense_concept`, version, pairKey, inputHash, generatorVersion.
4. bundleKey: family `sense_concept_bundle`, version, senseKey, ordered candidateKey/inputHash
   (sort candidateKey), builderVersion, fingerprint.
5. contextHash: full canonical bundle content, bỏ bundleKey/contextHash.
6. renderedContextHash: canonical payload gồm phase, seed, promptVersion, bundle sau shuffle.

Đổi rank không đổi candidateKey; artifact byte hash vẫn phát hiện sidecar đổi.
Đổi text/provenance đổi inputHash/candidateKey. Đổi generator tạo candidateKey mới.
Không lưu hai hypothesis cho cùng pair trong generation dù DB UNIQUE có relation.

## 3. Candidate

Input và exported type: `MappingCandidateInput`; result: `MappingCandidate`.
Xem `fixtures/cat-exact.json.candidate` để có object đầy đủ, không tự đoán field.

Required root: schemaVersion=1, candidateType=sense_concept, mode,
semanticInputFingerprint, sense, senseContext, concept, conceptContext, evidence,
sources, hypothesisRelation, retrieval, classification, reasons, predecessor.
Constructor thêm pairKey/inputHash/candidateKey. Parser kiểm lại các hash.

- `sense`: id/lexemeId nullable bigint strings; semanticKey; identity nullable
  `{sourceKey,externalId,senseKey}`; language/lemma/reading/forms/senseNo/isPrimary/jlptLevel.
- `senseContext`: **mọi EN gloss row**, definitions (language đúng nguồn hoặc null),
  metadata/metadataEvidenceKey, neighbors, tối đa 2 examples.
  Metadata gồm rawAttributes, rawPos, normalizedPos, normalizationVersion,
  appliesToKanji/appliesToKana, info/misc/field/dialect/register/languageSources.
  Không dùng first gloss của serving thay nhóm EN đầy đủ.
- `concept`: id nullable, semanticKey, ili nullable, sorted synsetKeys
  `{lexicon,synsetId,sourceKey}`, pos nullable.
- `conceptContext`: definitions riêng từng nguồn, typed labels, neighbors, ≤2 examples.
  Label lemma/synonym/translation không được đặt vào definitions.
- Text row: `{key,evidenceKey,id,rank,language,kind,text}`; kinds
  gloss/definition/lemma/synonym/translation/example/neighbor. Các list kiểm đúng kind.
- Evidence: `{key,kind,owner:{type,semanticKey},sourceKey,sourceHash,batchId,
payloadHash,dependencyGroup,sourcePath,method}`. kind=text_row hoặc sense_metadata.
  Text payload hash = `textRowHash(row)` (bỏ evidenceKey); metadata = hashJson(metadata).
  Mỗi row/metadata bind đúng owner/source/hash/batch. Không có evidence/source thừa.
  Evidence của gloss VI dịch từ EN phải giữ dependencyGroup EN nếu được dùng;
  hai AI verdict cùng dictionary cũng không thành hai dictionary source độc lập.
- Source: key, nullable sourceId, code, nullable version/snapshot/sha256/license/
  attribution/url, batchIds, audit `{status,evidence,reasons}`.
  Verified cần version hoặc snapshot, source hash, license/attribution/URL hợp lệ,
  audit evidence; không chấp nhận license unknown/CẦN XÁC MINH. Source blocked có reason.
  Source hash là checksum snapshot đã audit; evidence.sourcePath định vị row trong snapshot.
  Việc mở file audit và kiểm claim licensing thật thuộc D0/D2, không suy từ code nguồn.
- Retrieval: generatorVersion, branches, rank, rankScore, calibratedScore=null,
  features JSON, pruningRefs. Các field này là sidecar, không truyền rank/hypothesis vào LLM.
- classification: ready/blocked_source/missing_context/unresolved/stale.
  Ready cần ID, stable identity, synset keys, source audited, source context và concept
  definition, reasons rỗng. Non-ready cần reasons và không được build review bundle.
- predecessor null hoặc `{candidateKey,inputHash}`; giữ lịch sử khi context đổi.

Direction luôn **source sense → target concept**: broader=source rộng hơn target,
narrower=source hẹp hơn target, related=liên quan, exact=đúng toàn bộ phạm vi/điều kiện.
None/uncertain chỉ là output review, không là candidate/link relation.

Reason codes frozen: blocked_source, missing_identity, missing_context, pos_conflict,
restriction_conflict, definition_conflict, compound_sense, ambiguous_concepts,
no_candidates, no_suitable_concept, retrieval_miss, context_too_large,
legacy_unverifiable, stale_input, review_disagreement, budget_exhausted.

## 4. Bundle và output

Bundle có 1..5 ready candidate của **cùng sense/context/provenance**, cùng snapshot/mode/
generation. Source branches = toàn source gloss/definition row keys, không để AI tự tạo
branch rồi coi là ground truth. Empty shortlist không gọi provider: D2 report no_candidates,
D5 audit trường hợp đó riêng. Context lớn thì block, không cắt mất nghĩa cho vừa cap.

`createMappingBundle()` lấy semantic fields, loại retrieval/hypothesis/legacy decision.
Candidate key là output ID mặc định; không dùng A/B/C.
Shuffle bằng sort hash `{seed,phase,candidateKey}`, giữ source/context unchanged.
R1/R2 contextHash chung, rendered hashes theo phase/prompt/seed; không bắt hai rendered
hash bằng nhau. `utf8Bytes` tính payload thực tế, D4 phải reserve token bằng tokenizer/
upper bound của provider và account cả wrapper/prompt thật, không suy byte = token.

Output root: schemaVersion=1, task=sense_concept_review, bundleKey, senseId,
contextHash, reviews[], noSuitableCandidate, unresolvedReason.
Mỗi review: candidateKey, conceptId, relation (6 nhãn), coveredBranches,
missingBranches, conflicts, reason, confidence nullable audit-only.

Validator yêu cầu đủ shortlist, không trùng/ngoài list; echo đúng IDs/hash;
coverage là partition đầy đủ source branches. Exact không missing/conflict.
Conflict `{code,sourceEvidenceKeys,conceptEvidenceKeys,detail}` dùng evidence thật của
đúng owner/candidate; không accept invented refs. `noSuitableCandidate=true` iff mọi
verdict none. Có uncertain hoặc nhiều exact thì bắt unresolvedReason.
Hai exact cạnh tranh không tự chọn theo numeric ID.

D3 tạo decision bằng policy; D1 chỉ validate lineage và điều kiện tối thiểu:
accept_exact cần hai exact, đầy đủ, unambiguous, không unresolved;
accept_nonexact cần hai relation nonexact đồng ý; reject_pair cần hai none;
defer phải có reason. Nonexact ở v1 chưa được promote. Không có tự động verified=true.

Audit bind candidate/input/outputHashR1/R2/decisionHash, reviewerKind=llm/human/rule,
reviewerId + reviewerSession thật, reviewedAt, verdict=pass/fail/deferred,
severity=none/minor/severe, reason, suggestedDecision nullable. Severe không pass.
GPT/Claude đánh giá là llm, không ghi human. Audit không overwrite provider output.

Display priority là artifact riêng: senseKey, displayPriority, priorityBasis,
measuredFrequency nullable, evidenceRefs, policyVersion. Corpus frequency cần chứng cứ;
source_order/ai_estimate/curated không được bịa measuredFrequency. Không đổi is_primary.

## 5. Provider/job/checkpoint

Provider config gồm provider=stub/openai-compatible, model, endpoint (null iff stub),
protocol=stub/chat-completions/responses, promptVersion, responseSchemaVersion=1,
reasoningConfig `{effort,maxTokens}`, sessionId, rate gồm input/output/reasoning
MicrousdPerMillion, verifiedAt, evidence ref. Config không chứa key/Authorization.
Rate zero chỉ khi source audit/preflight xác minh free hoặc stub; không mặc định free
từ tên model. D4 dùng ENV DB4 riêng và snapshot rate trước dispatch.

Cache hash bind provider/model/endpoint/protocol/promptVersion/phase/rendered hash/
responseSchemaVersion/reasoningConfig. Session không làm đổi cache semantic key;
R1/R2 namespaces tách. Cùng model hai lượt ghi same_model_two_pass, không tuyên bố
hai nguồn thống kê độc lập.

Job config: schemaVersion/task/mode/fingerprint/snapshot/pilotManifest/providers,
policyVersions `{source,retrieval,decision,audit}`, seed, caps.
Caps: maxRequests, maxTokens, maxCostMicrousd, maxOutputTokens, maxContextBytes,
maxRetries=0..2, concurrency=1. $0.10 = **100000 micro USD**; giá/cost dùng integer.
JobKey hash config và ordered immutable entry identities/input refs/rendered hashes;
usage/state thay đổi không đổi jobKey, config/caps override sẽ fail hash.

Entry: targetKey/senseKey/bundleKey/contextHash/bundle ref/renderedR1/renderedR2,
state, nullable decision/audit/gate/journal/reason. Các refs phải byte verify trước
`parseMappingJobBound()`, rồi bind manifest và rendering. Pilot không tự giảm target.

Attempt: global contiguous index từ 1, phase, kind=review/preflight/cache, cacheOrigin,
targetKey
(null iff preflight), renderedContextHash/cacheKey, startedAt/finishedAt,
outcome=in_flight/response/unknown/failed, retryReason, reservation, actualUsage,
rawResponse/validatedOutput refs nullable. Mỗi phase bind provider/render đúng.

Cache hit có cacheOrigin ref, rawResponse và validatedOutput đã kiểm phase/input từ
cache gốc, outcome=response, reservation/actualUsage đều 0. Không tăng request/token/cost
mới. Dispatch review/preflight có cacheOrigin=null. Cache cho phép queued→r1_received
hoặc r1_validated→r2_received; sau đó vẫn validate phase trước đi tiếp. D4 kiểm file cache
và lưu provenance usage gốc; không biến output chưa validate thành cache hit.

Reservation `{inputTokens,outputTokens,reasoningTokens,tokens,costMicrousd}` dùng
`createMappingReservation()`; tổng token integer, cost làm tròn lên bằng BigInt rates.
Output reserve = maxOutputTokens job; reasoning reserve ≥ provider maxTokens;
cost không dưới rate upper bound. Actual usage `{tokens,costMicrousd}` không vượt
reservation. Thiếu usage giữ reservation (kể cả response), không tính bằng 0.
Tổng cap chung gồm hai phase + preflight + retry; tối đa một in-flight toàn job.

State pipeline:

```text
queued → r1_running → r1_received → r1_validated → r2_running
→ r2_received → r2_validated → decision_ready → awaiting_audit
→ eligible → imported → promoted
```

Nhánh blocked/rejected/deferred/error/stale có reason. Received chưa validated.
Invalid response được received→running khi retry hợp lệ; running→running dành retry
transport đã ghi outcome. Không retry sau validated output/in_flight/unknown.
Error/blocked/deferred là terminal của target/job đó; rerun cần job đã chốt mới,
không xóa lịch sử/counter để lấy lại cap. Crash có response durable phải recover/validate,
không tạo attempt mới. Unknown giữ cost reservation đến khi reconcile bằng evidence thật.

`transitionMappingTarget()` nhận patch attempts/artifact refs/status và validate toàn
checkpoint mới trước persistence. D4 đảm nhiệm atomic write/fsync/lock, chronological
response recovery và append-only attempt history; parser D1 không thực hiện filesystem I/O.

Job status: prepared/running/awaiting_audit/budget_exhausted/completed/failed/stale.
Child journal states riêng registered/prepared/applied/verified/rolled_back/error.
DB mapping_run status **chỉ** running/dry_run/completed/failed/rolled_back;
không ghi awaiting_audit/budget_exhausted vào DB enum.

## 6. Manifest và gate

Pilot manifest pin mode, pilot A/B, fingerprint, policyVersion, seed, sorted unique
targetKeys/positiveTargetKeys/hardNegativeTargetKeys, strata và exclusions.
Strata có targetKey/JLPT/isPrimary/lexemeKey, đủ target; cohorts thuộc target và không
trùng nhau; exclusions không thuộc target. D5 xác minh strata thật/query/hash/gold holdout.

Gate pin hash manifest, policy, report/budgetReport refs và từng targetAudit:
targetKey, verdict/severity, audit ref, twoPassValidated/noCandidatesAudited,
proposalAudited. Không có field passed cho caller tự gán.

`evaluateMappingGate()` tính mẫu số: A đủ đúng 100 target, ≥98 pass, 0 severe;
B ≥100 positive, ≥50 hard negative, precision positive ≥99%, 0 severe.
Cần audit đủ, hai lượt validated hoặc no-candidate audited; budgetWithinCaps,
unknownRequests=0. Fixture luôn fail eligibility. Gate counts không chứng minh nội dung
audit hoặc nguồn thật: D5 phải verify bytes, reviewer/model/session và bind actual job,
report, usage ledger. D6 còn rebind DB, kiểm existing exact/curation/dependency và journal.
Gate pass không cho phép promote các individual fail/deferred.

## 7. CLI frozen

Đây là parser/interface; các executable `mapping-*.ts` sẽ được D2–D7 triển khai.
Ngày 08/10 đã có adapter READ ONLY riêng `retrieval-export.ts`,
`mapping_minilm.py`, `retrieval-generate.ts`; xem [DB4-D2 handoff](../handoff/db4-d2-source-minilm-retrieval-2026-10-08.md).
Adapter dùng input audit/search manifest riêng, giữ constructors/shape/hash D1;
không thay flags của parser này và không là các executable orchestration bên dưới.
Mọi command nhận `--artifact-dir` (default `uploads/db4`, resolve absolute).
Artifact refs luôn tương đối root. Cú pháp `--flag value`; không `--flag=value`,
không positional, duplicate/unknown flag hoặc missing value. Không đọc `.env` ở D1.

| Command             | Required / modes                                                           | Optional                                    |
| ------------------- | -------------------------------------------------------------------------- | ------------------------------------------- |
| mapping-inventory   | không                                                                      | —                                           |
| mapping-export      | --inventory ref                                                            | --limit positive integer                    |
| mapping-generate    | --export ref; retrieval offline                                            | --limit                                     |
| mapping-score       | --candidates ref                                                           | --limit                                     |
| mapping-review      | --job ref --generate; mới: --bundles ref --provider stub/openai-compatible | --resume (không overrides bundles/provider) |
| mapping-audit       | --job ref                                                                  | —                                           |
| mapping-bind-target | --job ref --gate ref                                                       | —                                           |
| mapping-import      | --plan ref và đúng một --dry-run/--apply                                   | --allow-db name --allow-test --recover      |
| mapping-promote     | đúng một --plan ref/--rollback ref, và đúng một --dry-run/--apply          | --allow-db name --allow-test --recover      |
| mapping-verify      | --root ref                                                                 | —                                           |
| mapping-refresh     | --root ref và đúng một --dry-run/--apply                                   | --allow-db name --allow-test                |

--generate chỉ review và bắt buộc kể cả stub để interface thống nhất; không đồng nghĩa
command tên mapping-generate gọi AI. Review không nhận --limit hoặc --dry-run.
Apply bắt --allow-db, test DB thêm --allow-test + actual local host; dry-run không nhận
write guards/recover. Rollback không kết hợp recover. D6 kiểm journal state thật khi recover.
Effect trả read_only/provider/database; parser không thực thi các effect.

`assertMappingDatabaseTarget()` so tên DB query từ connection với allow-db; DB suffix
`_test` cần localhost/127.0.0.1/::1 và allow-test. Đây là guard tối thiểu, D6 còn phải
bind host/port/schema/target fingerprint từ promote-plan và preflight thật.

## 8. Bàn giao

- D2 dùng constructors/bound parsers, xuất toàn EN rows + raw attrs, source audit thật,
  stable identity và lexicon/synset provenance. Streaming JSONL/chunk index/manifest
  xuất ở D2; không đưa rank/legacy decision vào bundle.
- D3 dùng fixtures semantic làm input test; chưa có lexical scorer/calibration ở D1.
- D4 dùng job/provider/output/cache/reservation/state schemas, bổ sung adapter,
  durable artifacts/locks/HTTP mock, retry recovery và secret guards. Response validator
  phải gọi `parseMappingOutput`, không chỉ Zod parse hoặc API json_mode.
- Source đủ audit/identity mới được vào D2/D4; commit/tích hợp cùng base trước
  vận hành shared runner/apply. DB4-D2 ngày 08/10 đã kiểm local adapter + scoped
  raw-source audit/smoke trên READ ONLY export thật theo yêu cầu trực tiếp.
  D0 full/legacy audit và semantic pilot/VPS job chưa được thay bằng smoke này.

DB3-B types/checkpoint và quiz code hiện hành không thay đổi bởi contract này.
