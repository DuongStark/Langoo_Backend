# DB4-D4 — Muse semantic match pilot (2026-10-08)

**Status:** the main 8-worker VPS run and one bounded repair pass have finished.
The final ledger has 137/138 outputs accepted by D1; one output still omits a
candidate review. No mapping has been applied to the database.

## Scope and frozen input

- Prompt versions: `db4-d4-semantic-match-v1-r1` and
  `db4-d4-semantic-match-v1-r2`, with shared system prompt.
- Frozen D2 cohort: 69 ready bundles, five candidates per bundle, 345 candidate
  reviews expected per phase; empty shortlist rows are excluded.
- Transport: the VPS native Muse gateway and a fresh side-chat per request.
  This is not a direct provider API call; the gateway does not expose token
  usage, and the exact model identity was not independently verified.
- User requested eight workers. Main and repair runs use transient systemd units
  on the VPS; they survive disconnecting this workstation but are not configured
  to restart after a VPS reboot.

## Execution and incidents

1. The initial run was blocked before dispatch by a local manifest-path guard.
   No model calls were sent in that attempt.
2. The corrected runner then hit `NoiseInvalidMessage` for 15 request bodies.
   The installed Noise library limit is 65,535 bytes; the serialized bodies were
   71,696–149,173 bytes. The exception occurs during local encryption before
   `send_bytes`, and read-only history showed all 15 side-chats empty. Those
   15 did not reach Muse in this attempt; the other 123 were not dispatched.
3. The runner was changed to split the transport envelope into 48 KiB chunks.
   A read-only `chat.history` request with a 70 KiB query received an application
   HTTP 400 response, proving the oversized transport reached the endpoint. This
   check created no generation.
4. Run2 sent 15 requests. It incorrectly treated HTTP 200 from `chat.stream` as
   model completion; history initially contained only partial JSON prefixes.
   The failure breaker stopped further dispatch, leaving 123 unstarted. After
   waiting for the provider responses, read-only history reconciliation recovered
   all 15 complete assistant outputs. All 15 passed the D1 output parser; there
   were 0 D1 schema/binding failures.
5. The runner now keeps a gateway connection for each worker and waits until the
   assistant output binds to the frozen request. Run3 sent the 123 requests that
   had never been dispatched, using 8 workers; it settled after 22m06s with 110
   outputs accepted by the runner and 13 timeouts.
6. Read-only history confirmed those 13 messages had completed, but each omitted
   one of five candidate reviews. D1 validation of the combined 138-response
   ledger accepted 123 outputs. Thirteen were missing a candidate; two other
   outputs failed D1 because they omitted `missingBranches` or changed candidate
   order.
7. Run4 made one bounded repair pass over exactly those 15 rejected requests,
   with a versioned reminder to count candidates and retain every required field.
   Fourteen passed D1. The remaining R1 output still omitted candidate 5, the
   same candidate omitted in its first attempt. It remains unresolved; no second
   repair was dispatched.

Final D1 coverage is 137/138 requests; 69 bundles have at least one validated
phase, and 68 have both. Full-output R1/R2 agreement is 0/68. For 340 candidate
verdict pairs, 266 relation labels agree (78.2%), exact/non-exact agrees for 331
(97.4%), and branch coverage agrees for 314 (92.4%). R1 has 36 `exact` candidate
verdicts among 340 reviews; R2 has 38 among 345. `noSuitableCandidate` counts
are 6 and 5. These are same-model consistency metrics, not accuracy or
independent review.

### 2026-10-10 — DB4-D4 — Automatic decision policy clarification

The owner requires unattended operation without human approval per mapping.
The D1 contract already allows machine decisions; human review is not a mandatory
runtime step. The intended policy is documented in
[the D4 plan](../plans/db4-d4-semantic-match-prompt-v1.md#61-yêu-cầu-vận-hành-tự-động--chốt-ngày-10102026).

Read-only aggregation of the final local normalized R1/R2 files under
`uploads/db4-d2-pilot/muse-d4-v1/validated/1b03b68ea623/` gives:

| Bundle classification | Count |
| --- | ---: |
| Same single exact in both outputs, neither output unresolved | 20 |
| Both outputs all-none in the supplied shortlist | 4 |
| Paired outputs failing the acceptance condition above | 44 |
| Missing one validated phase | 1 |
| Total supplied bundles | 69 |

These are necessary structural/consensus conditions, not measured semantic
precision, final decisions, promoted links, or a quality gate pass. The 31
retrieval targets without candidates are not included in the 69-bundle table.

The full-output 0/68 metric hashes entire review arrays, including shuffled
candidate order, reasons and conflict details. It must not be interpreted as
68 different candidate selections or used as a semantic quality gate. Of the
340 compared candidate pairs, 32 are exact in both phases and nine disagree
on exactness; whole-bundle ambiguity/unresolved conditions reduce the initial
exact acceptance pool to 20 bundles.

Only documentation changed in this turn. Checked the actual validator comparison
and D1 decision rules and recomputed aggregate counts; 143 local document links,
`git diff --check` and untracked-document whitespace checks passed.
No new model calls or DB/VPS mutations;
documents remain uncommitted/unpushed. D3/D5/D6/D7 work remains before a complete
production automation pipeline.

## Live tracking

The durable private run state is on the VPS:

- Run3 main batch: `/opt/langoo/storage/db4-d4-muse-20261008/run3/`
- Run4 repair batch: `/opt/langoo/storage/db4-d4-muse-20261008/run4/`
- Final ledger and D1 normalized outputs:
  `/opt/langoo/storage/db4-d4-muse-20261008/final/`
- Progress: `progress.json` (worker count, requests settled, states, elapsed time)
- Responses: `responses.jsonl` after the finite request set settles
- Private session/job checkpoints: `jobs/`; session IDs are not copied into the
  public response artifact.
- Run3 progress/response state: `progress.json` and `responses.jsonl`.
- Run4 progress and eventual response: same filenames under the run4 directory.

Both transient units have exited; neither is still running. They exit with code 1
when any request remains unresolved, which is how the runner reports an incomplete
output set.

The local ignored ledgers used for D1 validation and repair preparation are
`uploads/db4-d2-pilot/muse-d4-v1/responses-reconciled.jsonl` and
`responses-before-repair.jsonl`; the final ledger is
`uploads/db4-d2-pilot/muse-d4-v1/responses-final.jsonl`.

## Code and checks

- `scripts/db4/muse-review-runner.py`: 48 KiB Noise chunks, persistent per-worker
  gateway connection, and no longer treats transport acknowledgement as final
  assistant completion. Dispatch remains finite; it never retries a possibly
  sent request automatically.
- `scripts/db4/muse-review-prepare-repairs.ts`: binds the rejection summary to the
  frozen request/response artifacts and prepares one bounded, versioned repair
  request per rejected output.
- `scripts/db4/muse-review-validate.ts`: accepts a complete response ledger with
  unresolved states, validates each completed output against D1, and reports
  partial coverage instead of pretending the cohort completed.
- Passed locally: `python3 -m py_compile scripts/db4/muse-review-runner.py`,
  `npx tsc -p tsconfig.db4.json`, scoped ESLint for the DB4 prepare/validate
  scripts, and `git diff --check`.
- Passed on VPS: runner `py_compile`; live read-only chunked history check; 15
  initial recovered outputs passed D1; main ledger validator accepted 123/138;
  repair validator accepted 14/15; final ledger validator accepted 137/138.

## Remaining gates

- One output remains unresolved because both original and single repair omitted
  the same candidate. Do not promote or apply it. Run D1 output ledger is final.
- Semantic correctness remains unproven. Agreement is only a consistency signal
  because both phases use the same Muse account/model. No database apply, app
  deployment, commit, or push has happened.

## Git and deployment

Code and docs are saved locally and remain uncommitted/unpushed. The only VPS
changes are private pilot artifacts and a transient systemd runner; no app code,
database rows, or migrations were changed.
