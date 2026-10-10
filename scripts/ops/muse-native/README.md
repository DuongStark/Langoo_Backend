# M10.5 — Native Muse gateway thử nghiệm VPS

User authorized native smoke/concurrency test on 2026-10-07. This is a personal
Muse web gateway client, not Meta Model API inference. Keep Qwen/app/DB4 unchanged.

- Upstream: https://github.com/kleprevost/muse-mcp
- Pin: `965cc2f197543a8762d3d7067038da6de962730a`, MIT.
- Transport files `muse.py`, `routes.json`, `desc0.bin`, `desc1.bin` are copied
  unchanged to `/opt/langoo/services/muse-native`; venv in that directory.
- Install only isolated venv dependencies from `requirements.freeze.txt` for
  reproducibility; no global pip or shared app dependencies.
- VPS required `python3.10-venv`; apt also updated Python 3.10 patch dependencies.
  Verify application/DB health after package installation.
- `export-session.mjs`: connect to existing loopback CDP, export only effective
  Muse-origin cookies to `/opt/langoo/storage/muse-native/cookies.json` (0600).
  Disconnect from CDP; never print/copy cookies into Git or run artifacts.
- `native-smoke.py`: `probe`, `single`, `benchmark`, `benchmark-reverse`, `long`; each worker owns one Gateway,
  creates an empty dedicated side-chat, then uses only scoped history.
- Hard persistent cap 20 dispatches; one job marker per request, exact schema,
  per-word ID allowlist and fixture expectations. Saves dispatch intent before
  send; no automatic retry after ambiguous dispatch/timeout.
- Modes: probe transport + vm.health; single 3-word fixture; benchmark 4 identical
  workload jobs sequentially, then 4 with concurrency 2. Full inventory/long-input
  semantic gate is separate from this synthetic smoke.
- Background runs use systemd transient units: `m105-native-single`,
  `m105-native-benchmark`. On temporary browser shutdown schedule root restore
  timer and restore original services when test ends. Do not auto-switch job
  provider/default port from results of this small benchmark alone.
- Results directory: `/opt/langoo/storage/muse-native/`; probe/single/each cN-i/
  benchmark.json and partial. Synthetic thread IDs saved only as hashes.
  Error logs store class/status, never transport exception strings containing auth.

Tests: `PYTHONDONTWRITEBYTECODE=1 python3 scripts/ops/muse-native/test_native_smoke.py`.
On VPS run from readable cwd `/opt/langoo/services/muse-native`, not root home.

See `docs/plans/m10.5-muse-native-gateway.md` and the M10.5 report for real
measurements and remaining gates. No paid Model API calls, DB changes or app deployment;
Muse web quota accounting has not been verified.

Observed: 19 native generations, no marker/ID mixing, peak RSS 48.91 MiB.
Two rounds speedup 2.506x/1.307x, pooled 1.725x: stable gate remains unmet.
Browser services restored; default job endpoint unchanged. Long fixtures use
full bank/light inventory; synthetic fixture repeats are not broad quality eval.

Run background (fresh run only; existing dispatch records prevent auto resend):

```sh
systemd-run --unit=m105-native-single --property=User=langoo --property=Group=langoo --property=WorkingDirectory=/opt/langoo/services/muse-native --property=UMask=0077 --property=MemoryMax=200M /opt/langoo/services/muse-native/venv/bin/python /opt/langoo/services/muse-native/native-smoke.py single
```

## M10.5 — Inventory, automatic batches and three-worker runner

`export-inventory.mjs` is a Node/pg READ ONLY snapshot exporter on VPS. Default
selection is the first 100 lowercase alphabetic EN lemmas with a non-null rank
<=5000, sorted by minimum core frequency_rank; `--limit`/`--max-rank` are bounded.
`--cohort /path/cohort.json` instead uses `{ "words": ["cat", "bank", ...] }`.
Word rank is not sense frequency or proof of 99% coverage. Every available
source sense for the selected exact lemmas is retained. Snapshots never overwrite.

`batch_core.py` tracks source count, distinct display strings and complete prompt
chars for each word. Counts include multiple sources and are not counts of
semantically distinct meanings. Metadata is factored into groups without cutting
definitions. Defaults: 40,000 complete-prompt characters, at most five words;
80+ source senses or inventory fragments run alone. Oversized words are split
with complete ID coverage, then <=6 candidates per fragment feed a final <=3
selection. Shortlisting can lose semantic recall. The 2026-10-07 bulk policy
uses Muse decisions directly; no GPT semantic recheck is required.

`batch_runner.py` keeps input + manifest immutable, hashes them, validates every
per-word ID/80-character definition anchor and a job marker. One independent
Gateway per worker (reused across batches), new scoped chat per batch, dynamic queue, concurrency defaults to three,
CLI permits 1..4. It is a CLI worker, not a public HTTP API or default app provider.

### Prepare and send later

Create a private writable run parent as root once:

```sh
install -d -m 0700 -o langoo -g langoo /opt/langoo/storage/muse-native/batches
touch /opt/langoo/storage/muse-native/runner-account.lock
chown langoo:langoo /opt/langoo/storage/muse-native/runner-account.lock
chmod 0600 /opt/langoo/storage/muse-native/runner-account.lock
```

From `/opt/langoo/services/muse-native`, as `langoo` (or `sudo -u langoo`):

```sh
node export-inventory.mjs --out /opt/langoo/storage/muse-native/batches/common-100-input.json --limit 100 --max-rank 5000
./venv/bin/python -B batch_runner.py prepare --input /opt/langoo/storage/muse-native/batches/common-100-input.json --out /opt/langoo/storage/muse-native/batches/common-100-run
./venv/bin/python -B batch_runner.py status --out /opt/langoo/storage/muse-native/batches/common-100-run
```

Prepare makes `manifest.json` with word counts, batch contents, budgets and the
finite maximum dispatch count. It calls no AI. It requires a NEW output directory
under a parent writable by langoo. `status` also materializes ready dependent
batches/results from completed checkpoints, without any network requests.

When ready to send, root starts a background unit (choose a new unit name):

```sh
systemd-run --unit=m105-common-100 --property=User=langoo --property=Group=langoo --property=WorkingDirectory=/opt/langoo/services/muse-native --property=UMask=0077 --property=MemoryMax=350M --property=NoNewPrivileges=true --property=PrivateTmp=true --property=ProtectSystem=strict --property=ReadWritePaths=/opt/langoo/storage/muse-native/batches/common-100-run /opt/langoo/services/muse-native/venv/bin/python -B /opt/langoo/services/muse-native/batch_runner.py run --out /opt/langoo/storage/muse-native/batches/common-100-run --workers 3
journalctl -u m105-common-100 --no-pager -n 20
```

This runs on VPS after SSH/your computer disconnects. A shared account flock
prevents overlapping runs/reconciliations of this native CLI across directories;
it is opened read-only so systemd does not need to grant writes outside the run.
Other browser tools/providers do not participate in this lock: schedule those
separately on the same Muse account. Per-directory flock also prevents duplicate
schedulers of one run. Cookie renewal uses export-session
from the authenticated browser; never put credentials in the run directory.

### Resume and uncertain outcomes

- Re-run `run` with the SAME directory: completed batches are validated/skipped;
  jobs that never reached dispatch intent can retry once in the new invocation.
- Intent is fsynced before send; dispatch count is persistent. Default cap is the
  manifest upper bound + `--repair-budget` (default 2; 0..10), separate from the
  original spike cap20. The repair budget is cumulative across resumes, not
  replenished on each command. No automatic retry of ambiguous errors.
- A COMPLETE JSON reply containing exactly this batch's words can be re-ranked
  from the same frozen authoritative input, in a new chat, within the repair
  budget. The bad reply is never used as dictionary input. Original intent/reply/
  session checkpoint is archived under private `attempts/`; no overwriting or
  deletion of the record that a generation was sent. New markers are 12 hex
  characters to reduce copying errors; older UUID markers stay valid literally.
- Parser rejects wrong markers/foreign IDs/anchor changes/unknown fields.
  It only strips known redundant per-selection `reason`/`needs_review` metadata,
  promoting any true review flag to the word; raw text is preserved. Prompt
  targets reason <=300 chars; receiver allows <=1000 without trimming, reporting
  overruns. Complete invalid JSON objects fail promptly rather than occupying
  a worker for the entire 180-second timeout.
- For uncertain dispatched jobs: stop the prior worker and run `reconcile --out
/path/run`. It reads ONLY the saved scoped side-chat to recover completed
  replies; it never sends a generation. Then `run` schedules remaining work.
- A local timeout cannot cancel a remote generation. Missing/partial replies or
  replies for foreign words remain quarantined, not automatically re-sent.
  If reconciliation cannot recover them, inspect that run before explicitly
  preparing a replacement; preserve the original. Complete malformed replies
  can use the bounded repair path above. `status` lists pending/failed batch IDs.
- Each worker holds one connection until the queue drains. Error/uncertain jobs
  close that connection; another pending job can reconnect. No shared frame
  reader between workers. Generation endpoint status/reset is observed while
  history requests drain frames; remote errors cannot silently disappear just
  because they belong to the generation stream.
- Checkpoints containing `session_id` stay private (0700 parent/0600 file), and
  are not exported into reports. Reports may contain raw model text/job UUID,
  source dictionary inventory and timing, never cookies/auth/session identifiers.
- Input/manifest/dependent tasks cannot change under a run. New inventory/config
  requires a new directory. Never delete intent records to resume.

`execution-stats.json` describes the latest run invocation; `reconcile-stats.json`
the latest reconciliation. `invocations.json` journals every run/reconciliation;
`cumulative_active_ms` sums their elapsed execution, excluding operator pauses.
It does not pretend a tiny resume time is the full cohort's runtime. Keep previous
stats/attempts; `status` and `prepare` perform no generation and are not timed
as AI execution. `batch_report.py /path/report-directory` binds semantic annotations
to snapshot/output hashes, checks suggested IDs and renders summary/review.html.
Caller creates `semantic-review.json` from an actual review; code does not invent
the semantic verdict. This helper and the old >=90%/0-severe gate were used
for the pilot; bulk does not invoke this helper or require that gate.

Offline tests: `python3 -B scripts/ops/muse-native/test_batch_runner.py` (18 tests);
VPS from the service cwd: `./venv/bin/python -B test_batch_runner.py`.
See [batch plan](../../../docs/plans/m10.5-native-batch-runner.md).

Live 50-word trial: 4,101 source senses, 34 initial batches +5 dependent finals,
39 initial generations +2 guarded repairs. GPT review 44 pass/6 minor/0 severe:
semantic gate FAILED. Active execution 423.459s across three phases, including
old parser timeout waits and recovery; 895.648s including investigation gaps.
Peak native process RSS 75.89 MiB. No clean paired 2-vs-3 full-cohort benchmark
yet; do not infer that three is optimal or extrapolate RAM to 5,000 words.

## Bulk VPS

**M10.5 — Automation Muse bulk trên VPS**, policy agreed 2026-10-07:
use Muse decisions directly, no GPT/Claude judge. Structural schema, source IDs,
anchors and hash checks remain. `needs_review` is preserved as metadata without
blocking valid output. See [bulk plan](../../../docs/plans/m10.5-muse-bulk-automation.md)
and [deployment report](../../../docs/reviews/m10.5-muse-bulk-2026-10-07.md).

New files: `bulk_runner.py`, `prepare-bulk.sh`, `langoo-muse-bulk@.service`,
`test_bulk_runner.py`. Install them in `/opt/langoo/services/muse-native`, owned
by langoo; install the unit as root 0644 in `/etc/systemd/system` and daemon-reload.
Create `/opt/langoo/storage/muse-native/bulk` as langoo 0700. Preserve upstream
transport/venv and existing cookie/account lock. No app .env change is needed.

### Prepare

Prepared cohort: `common-5000-ready-20261007`, 5,000 words /91,689 source senses,
100 shards of50 words; all5,000 are runnable. Preserve22 source IDs with
empty definitions in `source.json` and track them in `excluded_empty_senses`;
these blank IDs provide no ranking evidence and are omitted from prompts.
1,211 planned base generations, hard cumulative cap2,211
including <=10 complete-reply repairs/shard and <=2/batch. Repairs only consume
capacity when needed. Multiple sources can repeat a meaning; source count is
not distinct-meaning count. No AI request during preparation.

For a NEW cohort, root can prepare in the background (job name lowercase/digits/hyphens):

```sh
systemd-run --unit=m105-prepare-NEWNAME --property=User=langoo --property=Group=langoo --property=WorkingDirectory=/opt/langoo/services/muse-native --property=UMask=0077 --property=MemoryMax=350M --property=CPUQuota=100% --property=Nice=10 /opt/langoo/services/muse-native/prepare-bulk.sh NEWNAME 5000 10000
```

The exporter uses one read-only transaction with bounded50-word queries. Private
snapshots are committed using an index after database COMMIT. An interrupted
export without `inventory.json` cannot be used; preserve it and choose a new
job name to export again. An interrupted planner with a complete inventory can
resume with the same binding/config; it rejects changed source/config. A
finished prepared directory is immutable. Script re-entry prints its status.

### Start, monitor, stop and resume

The 5k cohort was started/enabled on2026-10-07 at18:18+07:00. The following
command is idempotent for an active service; run it on VPS, then close your PC:

```sh
ssh langoo-vps 'systemctl enable --now langoo-muse-bulk@common-5000-ready-20261007.service'
```

`enable` resumes this job after VPS reboot; `Restart=on-failure` retries provider
outages after15minutes. There is one shard process at a time,3 Muse workers
within it, with reused connections. No proof that3 maximizes throughput over
all possible concurrency settings. Cgroup hard350MiB /soft280MiB, one-core CPU
quota100%, nice10, strict writable run directory. Account lock caps overlapping
native CLI pools; do not run another Muse browser job on the same account in
parallel unless scheduled separately.

```sh
ssh langoo-vps 'cat /opt/langoo/storage/muse-native/bulk/common-5000-ready-20261007/progress.json'
ssh langoo-vps 'systemctl status langoo-muse-bulk@common-5000-ready-20261007.service --no-pager'
ssh langoo-vps 'systemctl stop langoo-muse-bulk@common-5000-ready-20261007.service'
ssh langoo-vps 'systemctl start langoo-muse-bulk@common-5000-ready-20261007.service'
```

`progress.json` refreshes about every10s while a runner executes. It includes
current shard, completed/total words, cumulative dispatch count, settled
unresolved count, needs_review metadata count and no-recheck policy. Running
unresolved words may not yet be counted under `unresolved_settled`. Wall elapsed
includes downtime/backoff, not measured inference-only time. Detailed sanitized
runner events are in private `shards/shard-NNNN/runner.log`.

Each completion checkpoint is atomic and fsynced before continuing. On resume,
completed decisions are skipped, uncertain sends are reconciled from their
scoped chat. They are never automatically sent again. At6 consecutive failures,
the runner drains in-flight jobs and stops adding new jobs; the supervisor uses
at most3 rounds with30/60s backoff. If pre-dispatch work remains, it pauses and
systemd retries after15minutes. Complete malformed replies can repair within the
finite budgets; ambiguous/missing replies remain in `unresolved.json`, then the
job continues with other shards. A stale login needs browser login/cookie export
on VPS; the service cannot renew an expired account session itself.

Terminal phases: `complete` = every selected word has valid output;
`complete_with_unresolved` = finished queue but missing some valid outputs.
Both stop the service successfully; inspect progress/unresolved, not just exit0.
The service may show `inactive (dead)` after completion, which is expected.
Errors from source/manifest drift stop processing; preserve files and inspect
before attempting to run again.

### Results and consumer

- Root `results.jsonl`: outputs of finished shards, published atomically after
  every shard; Muse selections/reason unchanged, IDs string, source/snapshot
  hashes, `provider=muse_native`, `policy=muse_direct_no_semantic_recheck`.
- Root `unresolved.json`: separate missing/invalid/source-not-preparable words.
  No failed JSON is silently accepted. These files can be collected while the
  run is live; they may lag the current shard. Checkpoint stores latest results.
- `shards/shard-NNNN/source.json`: full frozen original source, including source
  versions/POS/context. `input.json` is the runnable subset, and `manifest.json`
  the deterministic plan. One failed word never causes context truncation.
- `jobs/`, `attempts/`: private scoped session checkpoints, NEVER publish them,
  export cookies, or copy them into repo reports.
- `collect --out /path/run` validates/materializes saved JSONL while service is
  stopped, without any network/generation/semantic review. `status` only reads
  progress and works while the service runs.

Download results when needed:

```sh
scp langoo-vps:/opt/langoo/storage/muse-native/bulk/common-5000-ready-20261007/results.jsonl .
scp langoo-vps:/opt/langoo/storage/muse-native/bulk/common-5000-ready-20261007/unresolved.json .
```

This phase writes artifacts only. An M4.5 consumer must resolve IDs against the
frozen source and validate current DB identity/context before later applying
rankings. No dictionary DB mutation, API/FE integration or provider switch here.

Offline checks (local/VPS):

```sh
python3 -B scripts/ops/muse-native/test_bulk_runner.py
python3 -B scripts/ops/muse-native/test_batch_runner.py
python3 -B scripts/ops/muse-native/test_native_smoke.py
node --check scripts/ops/muse-native/export-inventory.mjs
bash -n scripts/ops/muse-native/prepare-bulk.sh
```

Deployment verification: 10 bulk +21 runner +5 smoke tests pass; systemd resume
smoke published50/50 from existing pilot checkpoints, zero new generations
(count remained41). This is a checkpoint/service check, not an inference speed
benchmark. Actual5k inference/RAM/error distribution and a physical reboot have
not been tested. Code/docs not committed/pushed yet.
