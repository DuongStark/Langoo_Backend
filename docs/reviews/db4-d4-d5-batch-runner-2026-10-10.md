# DB4-D4/D5 — Review batch runner và preflight

Ngày: 2026-10-10
Trạng thái: **Local implementation and technical tests pass; remote preflight and
transport smoke are pending.** This is the initial-generation shadow runner,
not a quality gate or a DB/app deployment.

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

The capped preflight is slower than a small unit test because it revalidates the
full 1,000-target artifact and embedded source, candidate, prompt and request
refs. It is read-only; it did not invoke the transport or write the database.

## Chưa đạt / giới hạn

- The real artifact preflight has only been measured locally. VPS memory was last
  observed at 1.9 GiB RAM, ~681 MiB available and 860 MiB swap in use. Recheck
  `free -h`, active services and the Muse account lock before running the
  448 MiB-heap preflight there; stop if available memory has fallen materially.
- The first remote transport smoke must use a new run ID and clean committed
  source pin, with per-invocation R1=1/R2=1. R2 is conditional, so actual calls
  can be zero, one or two. Existing local preflight manifest is not a dispatch
  manifest for the release.
- Retrieval expansion, one-time format repair, and Pilot A/B audit coordinator
  are not implemented. Therefore the 1,000-target shadow is not authorized by
  this smoke and remains closed.
- No service has been installed/started on VPS; no Muse request was issued by
  this runner; no DB write/apply or application deployment occurred.

## Git / triển khai

At review creation the code, tests, plan and report are local and not committed.
The planned commit stages only the DB4-D4/D5 foundation and its required batch
contract/atomic artifact dependencies; unrelated local DB4/FE changes remain
unstaged. Update this section with commit/push hash and the capped VPS smoke
result after those actions complete.
