# DB4-D4/D5 — Review batch runner và preflight

Ngày: 2026-10-10
Trạng thái: **Foundation `708e3b8` đã commit/push; local và VPS read-only
preflight pass. Smoke đầu tiên được dừng trước ledger/dispatch do memory peak;
runner memory fix đang được kiểm tra.** Đây là shadow runner cho initial
generation, chưa phải quality gate hay DB/app deployment.

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

| Gate                                                                            | Kết quả                                                                                                                                                           |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx tsc -p tsconfig.db4.json --noEmit`                                         | Pass                                                                                                                                                              |
| `node --import tsx --test scripts/db4/*.test.ts`                                | 82/82 pass                                                                                                                                                        |
| `python3 -m unittest discover -s scripts/db4 -p 'test_muse_batch_runner.py' -v` | 12/12 pass                                                                                                                                                        |
| `python3 -m unittest discover -s scripts/ops/db4-batch -p 'test_*.py' -v`       | 2/2 pass                                                                                                                                                          |
| Python `py_compile` for runner/tests/coordinator                                | Pass                                                                                                                                                              |
| Scoped ESLint                                                                   | Pass                                                                                                                                                              |
| Scoped Prettier check                                                           | Pass                                                                                                                                                              |
| Read-only full-artifact preflight, Node heap 448 MiB                            | Pass: 1,000 selected; 966 ready; 34 no-candidate; 1,932 requests; 10 shards; 78 artifact refs verified; `apply=false`, `museCalled=false`                         |
| Preflight resource profile                                                      | 2:20.34 elapsed; 526,776 KiB max RSS; 0 swap activity                                                                                                             |
| `systemd-analyze verify`                                                        | Pass (exit 0) on a 0644 copy; the shared workspace mount reports source files as mode 0777 and warns only for that copy. VPS installation uses `install -m 0644`. |
| Scoped `git diff --check`                                                       | Pass before final docs check                                                                                                                                      |
| Runner memory follow-up                                                         | 13/13 Python tests pass; `py_compile` passes; remote smoke with the old runner was stopped before ledger/dispatch due to cgroup memory peak                       |

The capped preflight is slower than a small unit test because it revalidates the
full 1,000-target artifact and embedded source, candidate, prompt and request
refs. It is read-only; it did not invoke the transport or write the database.

## Chưa đạt / giới hạn

- VPS read-only preflight passed against the frozen full artifact in 5:55.69,
  max RSS 279,220 KiB. Before the first transport call, the old Python runner
  reached about 646 MiB cgroup memory while holding targets, candidates and both
  request phases during its Node preflight. It was stopped at 00:14:55 +07 with
  about 136 MiB system memory available. The instance failed after stop, but
  inspection confirmed there was no ledger, dispatch intent, account lock or
  Muse call. Service is inactive; its previous release and environment file
  remain installed.
- Retry with a new run ID and the memory-safe committed source pin, after
  checking `free -h`, PSI, active services and the Muse account lock. Keep
  per-invocation R1=1/R2=1. R2 is conditional, so actual calls can be zero, one
  or two. The previous preflight manifest is not a dispatch manifest for a new
  release.
- Retrieval expansion, one-time format repair, and Pilot A/B audit coordinator
  are not implemented. Therefore the 1,000-target shadow is not authorized by
  this smoke and remains closed.
- The systemd template and old-release smoke environment are installed on VPS;
  the stopped instance made no Muse request, DB write/apply or app deployment.

## Git / triển khai

Foundation commit `708e3b8` is pushed. The memory-safe follow-up, updated runbook
and progress entry are being prepared for a separate scoped commit. Unrelated
local DB4/FE WIP remains unstaged. Update this section with its commit/push hash
and a new capped VPS smoke result after those actions complete.
