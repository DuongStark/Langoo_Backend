# DB4-D4/D5 — VPS shadow batch runner

This release runs a frozen shadow batch through Muse R1 and conditional R2,
then writes an integrity-bound status report. It does not access PostgreSQL or
apply mappings. The report keeps unresolved, pending and unknown-transport
targets visible and always leaves promotion/apply gates closed.

## Current implementation boundary

The runner supports the frozen initial R1/R2 schedule, durable intent ledger,
no-auto-resend recovery, R1-gated R2, D1 validation, and target-level report.
One retrieval expansion, format-repair dispatch, and the DB4-D5 Pilot A/B audit
coordinator are still incomplete. Until those plan gates are implemented and
tested, a report is an initial-generation shadow result; it is not a completed
DB4-D4/D5 rollout or a quality/promotion gate.

## Prepare an isolated release

Use the exact clean commit recorded in the run manifest. Do not update
`/opt/langoo/app` to install the runner. The release directory contains the
repository code and its pinned Node dependencies; the Muse transport remains
the existing `/opt/langoo/services/muse-native` installation. The systemd unit
must start Python from that installation's `venv/bin/python`: the DB4 runner
launches its phase worker with the same interpreter, which provides the Muse
transport packages (`curl_cffi`, `noise`, and protobuf). The base system Python
does not include these packages and would leave every request pending before a
dispatch intent is recorded.

Muse's Noise implementation accepts at most 65,535 plaintext bytes per encrypted
frame. DB4 splits the larger serialized service envelope into ordered 48 KiB
`NoiseTransportFrame` chunks with one shared chunk ID. Keep the full prompt and
candidate context intact; do not truncate a request to fit one frame.

```sh
install -d -o root -g root -m 0755 /opt/langoo/services/db4-batch/releases
git clone <repository-url> /opt/langoo/services/db4-batch/releases/<commit>
cd /opt/langoo/services/db4-batch/releases/<commit>
git checkout --detach <commit>
npm ci --ignore-scripts --no-audit --no-fund
chown -R root:root /opt/langoo/services/db4-batch/releases/<commit>
chmod -R a-w /opt/langoo/services/db4-batch/releases/<commit>
```

Confirm the release HEAD exactly matches the manifest `git.revision`, the
manifest has `dirtySourceSha256: null`, and the relevant DB4 source paths are
clean. Keep this release directory in place while its batch is running.

## Configure a run

Install the service template as root and reload systemd:

```sh
install -o root -g root -m 0644 \
  scripts/ops/db4-batch/langoo-db4-batch@.service \
  /etc/systemd/system/langoo-db4-batch@.service
install -d -o root -g root -m 0755 /etc/langoo/db4-batch
systemctl daemon-reload
```

Create a **new** smoke run manifest from the clean pinned release. Keep the
frozen sampling/export/generation artifacts unchanged and choose a new unique
run ID; never dispatch the old local preflight manifest, whose source pin was
created before this release was committed.

```sh
RUN_ID=db4-smoke-20261010-<commit-short>
ARTIFACT_ROOT=/opt/langoo/storage/db4-batches/db4-d2-jlpt-n1-n5-20261010-0208649
install -d -o langoo -g langoo -m 0700 "$ARTIFACT_ROOT/batch-runs/$RUN_ID"
cd /opt/langoo/services/db4-batch/releases/<commit>
runuser -u langoo -- node --max-old-space-size=448 --import tsx scripts/db4/batch-prepare.ts \
  --artifact-dir "$ARTIFACT_ROOT" \
  --run-id "$RUN_ID" \
  --sampling cohort/2026-10-10-v1/sampling.json \
  --generation generation/cohort-2026-10-10-v1/manifest.json \
  --export export/manifest.json \
  --output-prefix "batch-runs/$RUN_ID" \
  --prompt-revision v2.1
```

The generated manifest must have `git.dirtySourceSha256: null`, `mode: shadow`,
`apply: false` and `promotionReady: false`. Run a read-only preflight against
that exact manifest before configuring/starting the service.

Create `/etc/langoo/db4-batch/<run-id>.env` with mode `0644`. This file has
paths and bounded execution settings only; it must not contain credentials:

```ini
DB4_RELEASE_PATH=/opt/langoo/services/db4-batch/releases/<commit>
DB4_ARTIFACT_ROOT=/opt/langoo/storage/db4-batches/<cohort-id>
DB4_MANIFEST=batch-runs/<run-id>/run-manifest.json
DB4_WORKERS=1
DB4_TIMEOUT=240
DB4_R1_CAP=1
DB4_R2_CAP=1
```

The first VPS run is only an isolated transport smoke: each phase is capped to
one new dispatch. R2 is sent only if the one R1 result meets the frozen
conditional-R2 rule. Unused requests remain pending. Do not increase these caps
to run the 1,000-target shadow until expansion, format repair and Pilot A/B
audit coordination are implemented and pass their gates.

The runner performs the read-only TypeScript preflight before loading request
payloads. It then loads only the active phase, does not materialize target or
candidate shards in Python, and releases the phase payload before D1 validation.
Before retrying a stopped service, check VPS available memory and PSI. The first
release reached about 646 MiB cgroup memory while holding both phases and unused
target/candidate data; that run was stopped before its ledger or Muse dispatch.
The memory-safe release passed preflight in the service sandbox. Its first service
start then exposed `EROFS` while hardening the Muse lock directory; the unit now
allows writes to that directory while retaining the cookie-file read-only mount.

The account lock at `/opt/langoo/storage/muse-native/runner-account.lock` must
be owned and writable by `langoo`, matching the existing Muse runner. The
unit allows writes to `/opt/langoo/storage/muse-native` because the runner secures
that directory as mode `0700` while acquiring the shared lock; the cookie file
remains explicitly read-only. Keep this directory owner/mode private. The
artifact root must be owned by `langoo`; artifacts stay under
`/opt/langoo/storage/db4-batches`.

Before starting, run the read-only preflight from the pinned release. It checks
source hashes and request bindings without making provider calls or DB writes:

```sh
cd /opt/langoo/services/db4-batch/releases/<commit>
runuser -u langoo -- node --max-old-space-size=448 --import tsx scripts/db4/batch-preflight.ts \
  --artifact-dir /opt/langoo/storage/db4-batches/<cohort-id> \
  --manifest batch-runs/<run-id>/run-manifest.json
```

The 448 MiB V8 old-space cap and 800 MiB service memory limit are set for the
current 1.9 GiB VPS; the unit also limits work to one CPU. Recheck `free -h`
and service health before starting; stop if memory pressure has materially
increased.

## Start and inspect

```sh
systemctl start langoo-db4-batch@<run-id>.service
systemctl status langoo-db4-batch@<run-id>.service --no-pager
journalctl -u langoo-db4-batch@<run-id>.service -f
```

The coordinator runs R1, validates its complete denominator, runs only R2 jobs
eligible under the frozen R1 gate, and writes `reports/final/<report-key>/`.
`reports/progress.json` and the runner's read-only status command can be used
while the service is active:

```sh
python3 -B scripts/db4/muse-batch-runner.py status \
  --artifact-root /opt/langoo/storage/db4-batches/<cohort-id> \
  --manifest batch-runs/<run-id>/run-manifest.json
```

Stop with `systemctl stop ...`; SIGTERM is handled as a checkpoint request.
After an interrupted or blocked run, inspect progress/ledger and fix the
external cause before starting the same unit again. The ledger prevents an
intent-persisted request with unknown outcome from being sent a second time.
After a crash the unit may restart at most three times per hour; ordinary
nonzero integrity/auth exits do not auto-restart. A manual resume uses the same
immutable run and release.

## Gate status

The only implemented execution path is shadow mode. `batch-report.ts` reruns
preflight and D1 phase validation, writes a complete target denominator plus
R1/R2 transport counts, and records Pilot A/B as `not_run`. `apply` and
`promotionReady` stay false. Do not use `proposed_exact` rows as DB write input;
DB4-D6/D7 remain separate work with their own audit, journal, rollback and
serving gates.

## 2026-10-11 — DB4-D4/D5 bounded format repair and report recovery

JSONL request scans now retain one payload at a time. Preflight retains compact
request identities; D1 validation remains complete for both phase denominators.
Report stderr emits `db4_report_progress` stages. A completed shard has an
immutable `reports/final/<identity>/shards/<shard>.json` checkpoint. Resume
verifies its manifest/validation/shard bindings, target rows and every evaluation
artifact hash before reuse. A changed ledger gives a new report identity; partial
shards never count as a published final report. Use a 256 MiB Node old-space cap
for offline replay; measure the cgroup separately from Node RSS.

The new repair path is opt-in and does not open the expansion or Pilot A/B gates.
A wave is immutable, outside the original frozen schedule, and may point to a
parent wave. All waves in a chain must share one clean Git pin. Every target can
have at most one repair job in the entire chain. Repair output passes full D1,
original candidate order and preservation of every parsed original semantic field
(including reason/confidence); changes yield `semantic_change_during_repair` and
remain unresolved. The original raw reply is preserved. Missing JSON fields or a
missing verdict can be filled; an existing semantic claim cannot be rewritten.

Prepare from a clean committed release (no transport/DB calls):

```sh
node --max-old-space-size=256 --import tsx scripts/db4/batch-repair.ts prepare \
  --artifact-dir "$ARTIFACT_ROOT" --manifest "$RUN_MANIFEST" --max-repairs 1
```

Use the returned immutable manifest path with the **same release pin**. This
recovers the saved invalid R1 without dispatching additional original R1 targets:

```sh
/opt/langoo/services/muse-native/venv/bin/python -B \
  scripts/ops/db4-batch/run-shadow.py \
  --artifact-root "$ARTIFACT_ROOT" --manifest "$RUN_MANIFEST" \
  --repair-manifest "$REPAIR_MANIFEST" --repair-cap 1 \
  --workers 1 --timeout 240 --r1-cap 1 --r2-cap 1
```

Launch under a transient systemd service with the persistent artifact root,
`User=langoo`, account/run locks and resource limits. Keep `/opt/langoo/app`
untouched. A repaired R1 enables original R2 only after a fresh, complete D1
validation. If repair is unknown or invalid, R2 is not sent. Resume never resends
an intent-persisted original or repair job. The phase counts include repair
intents, so a successful repair smoke can show two R1 intents (original + repair)
and at most one R2 intent.

For a normal pinned run, `run-shadow.py --auto-repair --repair-cap N` plans one
bounded repair wave after each mapping phase. It is not enabled by the installed
systemd template yet. For an already planned R2-only repair, add
`--repair-phase r2`; the coordinator obtains fresh R1 validation and gates the
repair on the original R2 job's R1 dependency. Use `--repair-manifest` on validator,
report, native runner status/reconcile and further prepare calls once a repair
wave exists. Omitting it intentionally fails on unknown repair ledger jobs.

Expansion and Pilot A/B audit remain incomplete; full 1,000-target shadow and
DB4-D6/D7 apply/serving remain closed.

To recover an existing invalid R1 automatically after an offline report finishes,
use `run-shadow.py --recover-r1 --repair-cap 1 --r2-cap 1 --wait-for-report
<relative-report-manifest>`. The coordinator waits up to 30 minutes for the prior
complete report, checks its run binding, summary/results hashes, denominator and
closed gates, then prepares one repair and uses the repair-only queue. It never
starts another original R1. A missing/invalid prior report stops the flow before
any dispatch. The wait and subsequent job run under systemd on VPS.
