# DB4-D4/D5 — Review batch runner và preflight

Ngày lập: 2026-10-10; cập nhật lần cuối: 2026-10-11
Trạng thái: **Foundation `708e3b8`, memory fix `cbe9e56`, lock-directory fix
`2cca836`, Muse virtualenv unit fix `9677b05`, Noise chunking `8a2c475` và ACK
phase hotfix `b955bfa` đã push. Smoke release `8a2c475` đã dispatch đúng một R1,
được ACK và lưu response 5.203 byte sau 36,138 giây. D1 replay bằng hotfix kết
luận `invalid_output`: response có 4/5 verdict cần thiết. Không gửi R2 hay retry
R1. Final report chưa hoàn tất do VPS memory pressure; 564 evaluation artifacts
được ghi một phần nhưng chưa có summary/target-results/report manifest.** Đây là
shadow runner cho initial generation, chưa phải quality gate hay DB/app deployment.

## Phạm vi đã làm

- `batch-preflight.ts` validates the frozen run, nested artifact integrity,
  denominators, request bindings, prompt/source hashes and report lineage without
  writing DB or calling Muse. JSONL files are parsed and hashed as streams; refs
  verified during parsing are not hashed twice.
- `batch-validate.ts` validates one shard at a time and preserves pending,
  invalid and unknown transport rows in the request denominator.
- `batch-report.ts` replays D1 validation and D3 decisions, persists immutable
  per-target output and phase counts, and leaves Pilot A/B, promotion and apply
  closed.
- `muse-batch-runner.py` persists intent before dispatch, uses run/account locks,
  does not resend an unknown outcome, reconciles history read-only, honors the
  manifest and invocation dispatch caps, and only allows R2 after a complete
  identity-bound R1 validation.
- `run-shadow.py` coordinates R1, its complete validation manifest, conditional
  R2, and the final report. The systemd unit/runbook use a separate immutable
  release directory and persistent artifact storage.
- `batch-prepare.ts` and the batch/retrieval contracts include the fields needed
  to bind selected targets, strata, sources, generation, prompt and run pin.
- Follow-up DB4-D4/D5 reduces peak memory: request JSONL loads only after the
  Node preflight and only for the active phase; unused target/candidate rows are
  metadata-checked without materialization; R1 payloads are released before D1
  validation; R2 validation binds through the compact schedule.

## Kiểm tra

| Gate                                                                            | Kết quả                                                                                                                                                                                             |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx tsc -p tsconfig.db4.json --noEmit`                                         | Pass                                                                                                                                                                                                |
| `node --import tsx --test scripts/db4/*.test.ts`                                | 82/82 pass                                                                                                                                                                                          |
| `python3 -m unittest discover -s scripts/db4 -p 'test_muse_batch_runner.py' -v` | 13/13 pass                                                                                                                                                                                          |
| `python3 -m unittest discover -s scripts/ops/db4-batch -p 'test_*.py' -v`       | 2/2 pass                                                                                                                                                                                            |
| Python `py_compile` for runner/tests/coordinator                                | Pass                                                                                                                                                                                                |
| Scoped ESLint                                                                   | Pass                                                                                                                                                                                                |
| Scoped Prettier check                                                           | Pass                                                                                                                                                                                                |
| Read-only full-artifact preflight, Node heap 448 MiB                            | Pass: 1,000 selected; 966 ready; 34 no-candidate; 1,932 requests; 10 shards; 78 artifact refs verified; `apply=false`, `museCalled=false`                                                           |
| Preflight resource profile                                                      | 2:20.34 elapsed; 526,776 KiB max RSS; 0 swap activity                                                                                                                                               |
| `systemd-analyze verify`                                                        | Pass (exit 0) on a 0644 copy; the shared workspace mount reports source files as mode 0777 and warns only for that copy. VPS installation uses `install -m 0644`.                                   |
| Scoped `git diff --check`                                                       | Pass before final docs check                                                                                                                                                                        |
| Runner memory follow-up                                                         | 13/13 Python tests pass; `py_compile` passes; sandbox preflight + 966 R1 request load pass, cgroup ~457 MiB                                                                                         |
| Account-lock sandbox diagnosis                                                  | Old unit failed `EROFS` while chmodding `/opt/langoo/storage/muse-native`; no ledger event or dispatch; transient test passes with parent directory writable                                        |
| Muse interpreter probe                                                          | Base `/usr/bin/python3` cannot import `noise`; Muse Native virtualenv imports and opens the authenticated gateway; no generation request was sent                                                   |
| Noise payload limit                                                             | R1 prompt was 90,681 characters; `NoiseConnection.encrypt` rejects plaintext >65,535 bytes; the failure happened before WebSocket send                                                              |
| Bounded smoke reconcile                                                         | One R1 intent; `recoveredCompletedReplies=0`, `transportUnknown=1`, `newDispatches=0`; no R2 request, DB write/apply or app deployment                                                              |
| Noise frame chunking                                                            | Pass on VPS release `8a2c475`: the 90,681-character R1 crossed the 65,535-byte Noise limit as ordered 48 KiB chunks; Muse ACKed and returned a 5,203-byte response in 36.138 seconds                |
| Phase-binding hotfix                                                            | `b955bfa` pushed; local regression accepts only missing phase on legacy ACKs, rejects explicit wrong phase, and new runner emits phase/generation/attempt. 85/85 DB4 TS, 14/14 runner, 3/3 ops pass |
| D1 replay of saved R1                                                           | Passes event/request binding; correctly returns `invalid_output` because Muse emitted 4 of 5 required shortlist verdicts. R1 result `1 invalid_output / 965 pending`; no R2 is eligible             |
| Final report retry                                                              | Stopped under the memory guard after PSI `full avg10` reached 1.36%; 564 immutable evaluation artifacts exist, but no `target-results.jsonl`, summary, or final report manifest                     |

The capped preflight is slower than a small unit test because it revalidates the
full 1,000-target artifact and embedded source, candidate, prompt and request
refs. It is read-only; it did not invoke the transport or write the database.

## Chưa đạt / giới hạn

- VPS read-only preflight passed for run `db4-smoke-20261011-cbe9e56` in
  5:50.42, with 1,000 selected, 966 ready, 34 no-candidate, 1,932 requests and
  78 refs; `apply=false`, `museCalled=false`. Under the same systemd sandbox,
  runtime pin, full preflight and loading all 966 R1 requests passed; cgroup
  memory was observed around 457 MiB during the run.
- First run on release `708e3b8` stopped at 00:14:55 +07 after reaching ~646 MiB
  cgroup and ~136 MiB available RAM. It had no ledger/dispatch intent or Muse
  call. The memory-safe service run on `cbe9e56` then failed within one second:
  runner `ensure_private_dir` chmodded `/opt/langoo/storage/muse-native`, but the
  unit allowed writes only to `runner-account.lock`. The transient test
  reproduced `EROFS`; commit `2cca836` fixed it and is installed on VPS. The next
  retry revealed the system-Python dependency issue; commit `9677b05` points the
  service at the Muse Native virtualenv and is installed/verified. With that
  interpreter, R1 reached generation preparation but its 90,681-character
  rendered prompt overflowed Noise's 65,535-byte plaintext limit. The client
  raised `NoiseInvalidMessage` during encryption, before WebSocket send; ledger
  has one intent and one `transport_unknown`, no ACK or saved response. The
  read-only reconciliation returned 0 completed replies, 1 unknown and 0 new
  dispatches. No retry is made against this run ID.
- The first transport failure on `cbe9e56` remains historical and unretried.
  Release `8a2c475` fixed Noise chunking and successfully stored its R1 response.
  Hotfix `b955bfa` accepts only the legacy ACK shape with a missing `phase`;
  explicit wrong phase still fails. Replay of the saved response now completes
  D1 and identifies a content error, not a transport/ledger error: `parseMappingOutput`
  reports an incomplete shortlist because only 4/5 candidates received verdicts.
  The immutable R1 validation manifest is
  `validation/r1-5a43e5931423d276/manifest.json` with SHA256
  `f03f319c3bf0332d2e561fe8e2c4f6056462bf96adecb8b6fb17900ec09a9e9e`.
- R1 validation has one `invalid_output` and 965 `pending` rows; R2 has 966
  `pending` rows. R1 is not eligible for conditional R2. There was exactly one
  R1 dispatch, no R2 dispatch, and no retry. The final report command was attempted
  twice; the later bounded retry was stopped when memory PSI crossed the guard.
  The persistent folder has 564 per-target evaluation artifacts from the partial
  attempt but no complete target-results file, summary or report manifest. Do not
  treat those partial files as a final report.
- No DB write/apply, full 1,000-target shadow, or app deployment occurred. The
  quality gate remains closed; the smoke shows transport works but this response
  does not pass D1.
- Retrieval expansion, one-time format repair, and Pilot A/B audit coordinator
  are not implemented. Therefore the 1,000-target shadow is not authorized by
  this smoke and remains closed.

## Git / triển khai

Foundation `708e3b8`, memory-safe runner `cbe9e56`, lock-directory fix `2cca836`,
Muse virtualenv unit fix `9677b05`, Noise chunking `8a2c475`, and ACK compatibility
fix `b955bfa` are pushed. VPS has one saved Muse R1 response. Release `b955bfa`
was copied as an immutable sidecar and used only for offline D1 replay; the
systemd smoke configuration remains pinned to `8a2c475`. No app deployment or DB
write/apply occurred. Plan/review/PROGRESS status is in a follow-up docs commit.
Plan/review Prettier and staged `git diff --check` pass. Whole-file Prettier warns
on `PROGRESS.md` both before and after this change; full worktree diff-check reports
only the existing trailing whitespace at line 3 of unrelated FE handoff. The final
report remains incomplete; unrelated DB4/FE WIP remains unstaged.
