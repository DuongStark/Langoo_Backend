# DB4-D4/D5 — Review batch runner và preflight

Ngày lập: 2026-10-10; cập nhật lần cuối: 2026-10-11
Trạng thái: **Foundation `708e3b8` và memory fix `cbe9e56` đã commit/push; VPS
preflight và lazy-load R1 pass trong systemd sandbox. Service smoke thất bại
trước ledger/dispatch vì unit cũ chặn chmod thư mục account lock; unit fix đang
được kiểm tra.** Đây là shadow runner cho initial generation, chưa phải quality
gate hay DB/app deployment.

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
| `python3 -m unittest discover -s scripts/db4 -p 'test_muse_batch_runner.py' -v` | 13/13 pass                                                                                                                                                        |
| `python3 -m unittest discover -s scripts/ops/db4-batch -p 'test_*.py' -v`       | 2/2 pass                                                                                                                                                          |
| Python `py_compile` for runner/tests/coordinator                                | Pass                                                                                                                                                              |
| Scoped ESLint                                                                   | Pass                                                                                                                                                              |
| Scoped Prettier check                                                           | Pass                                                                                                                                                              |
| Read-only full-artifact preflight, Node heap 448 MiB                            | Pass: 1,000 selected; 966 ready; 34 no-candidate; 1,932 requests; 10 shards; 78 artifact refs verified; `apply=false`, `museCalled=false`                         |
| Preflight resource profile                                                      | 2:20.34 elapsed; 526,776 KiB max RSS; 0 swap activity                                                                                                             |
| `systemd-analyze verify`                                                        | Pass (exit 0) on a 0644 copy; the shared workspace mount reports source files as mode 0777 and warns only for that copy. VPS installation uses `install -m 0644`. |
| Scoped `git diff --check`                                                       | Pass before final docs check                                                                                                                                      |
| Runner memory follow-up                                                         | 13/13 Python tests pass; `py_compile` passes; sandbox preflight + 966 R1 request load pass, cgroup ~457 MiB                                                       |
| Account-lock sandbox diagnosis                                                  | Old unit failed `EROFS` while chmodding `/opt/langoo/storage/muse-native`; no ledger event or dispatch; transient test passes with parent directory writable      |

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
  reproduced `EROFS`; allowing the parent directory in `ReadWritePaths` made
  both run and account lock acquisition pass. No ledger event, dispatch or Muse
  call was created. The template fix is in the worktree and not yet installed.
- Retry the same manifest/run ID after committing/pushing and installing the
  corrected unit; current ledger has no events, so there is nothing to resend.
  Confirm free memory, PSI, other services and account lock first. Keep
  per-invocation R1=1/R2=1. R2 remains conditional; actual calls can be zero,
  one or two.
- Retrieval expansion, one-time format repair, and Pilot A/B audit coordinator
  are not implemented. Therefore the 1,000-target shadow is not authorized by
  this smoke and remains closed.
- The systemd template and run environment are installed on VPS; the template
  still has the old lock path setting. The failed smoke made no Muse request,
  DB write/apply or app deployment.

## Git / triển khai

Foundation `708e3b8` and memory-safe runner `cbe9e56` are pushed. The unit
ReadWritePaths/runbook/progress fix is being prepared for a separate scoped
commit; unrelated local DB4/FE WIP remains unstaged. Update this section with
that commit hash, deployment of the unit and the capped smoke result.
