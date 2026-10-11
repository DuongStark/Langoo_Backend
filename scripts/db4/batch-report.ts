// DB4-D4/D5: replay phase validation and emit a denominator-preserving report.
// This command reads frozen inputs/events and writes only immutable artifacts.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  BatchEventSchema,
  BatchManifestSchema,
  BatchTargetResultSchema,
  BatchTargetSchema,
  verifyBatchEventChain,
} from './_batch-types';
import {
  ArtifactRefSchema,
  MappingBundleSchema,
  MappingCandidate,
  canonicalJson,
  hashBytes,
  hashJson,
  parseMappingBundleIntegrity,
  parseMappingCandidate,
  parseMappingOutput,
} from './_mapping-types';
import {
  artifactPath,
  readArtifact,
  writeAtomicArtifact,
  writeAtomicJson,
} from './_retrieval';
import {
  BatchValidationManifestSchema,
  ValidationResultSchema,
  validateBatchPhase,
} from './batch-validate';
import { evaluateBatchTarget, PhaseState } from './muse-batch-decide';
import { preflightBatchInputs } from './batch-preflight';
import { scanBatchJsonl } from './_batch-jsonl';

const MAX_JSONL_BYTES = 64 * 1024 * 1024;
const ReportRequestSchema = z
  .object({
    jobKey: z.string().regex(/^[0-9a-f]{64}$/),
    targetKey: z.string().regex(/^[0-9a-f]{64}$/),
    senseKey: z.string().min(1),
    phase: z.enum(['r1', 'r2']),
    generation: z.number().int().min(1).max(2),
    bundleKey: z.string().regex(/^[0-9a-f]{64}$/),
    payload: z
      .object({
        schemaVersion: z.literal(1),
        phase: z.enum(['r1', 'r2']),
        seed: z.string().min(1),
        promptVersion: z.string().min(1),
        bundle: MappingBundleSchema,
      })
      .strict(),
  })
  .passthrough();

function normalizedBundle(value: unknown) {
  const bundle = MappingBundleSchema.parse(value);
  return parseMappingBundleIntegrity({
    ...bundle,
    candidates: [...bundle.candidates].sort((a, b) =>
      a.candidateKey < b.candidateKey
        ? -1
        : a.candidateKey > b.candidateKey
          ? 1
          : 0,
    ),
  });
}

function readJsonl<T>(
  root: string,
  refValue: unknown,
  schema: z.ZodType<T>,
  label: string,
): T[] {
  const ref = ArtifactRefSchema.parse(refValue);
  const path = artifactPath(root, ref.path);
  if (statSync(path).size > MAX_JSONL_BYTES)
    throw new Error(`${label} exceeds 64 MiB`);
  const bytes = readArtifact(root, ref);
  if (!bytes.length) return [];
  const text = bytes.toString('utf8');
  if (!text.endsWith('\n')) throw new Error(`${label} must end with LF`);
  const lines = text.slice(0, -1).split('\n');
  if (lines.some((line) => line.length === 0))
    throw new Error(`${label} contains an empty row`);
  return lines.map((line) => schema.parse(JSON.parse(line) as unknown));
}

function readValidationRows(
  root: string,
  refValue: unknown,
  expected: {
    runId: string;
    phase: 'r1' | 'r2';
    manifest: { path: string; sha256: string };
    schedule: { path: string; sha256: string };
  },
) {
  const ref = ArtifactRefSchema.parse(refValue);
  const validationManifest = BatchValidationManifestSchema.parse(
    JSON.parse(readArtifact(root, ref).toString('utf8')) as unknown,
  );
  if (
    validationManifest.runId !== expected.runId ||
    validationManifest.phase !== expected.phase ||
    canonicalJson(validationManifest.runManifest) !==
      canonicalJson(expected.manifest) ||
    canonicalJson(validationManifest.schedule) !==
      canonicalJson(expected.schedule) ||
    validationManifest.allRequestsRetained !== true
  )
    throw new Error(
      `Stale or incomplete ${expected.phase.toUpperCase()} validation`,
    );
  const rows = readJsonl(
    root,
    validationManifest.results,
    ValidationResultSchema,
    `${expected.phase.toUpperCase()} validation rows`,
  );
  const byJob = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (
      row.runId !== expected.runId ||
      row.phase !== expected.phase ||
      byJob.has(row.jobKey)
    )
      throw new Error(
        `Duplicate or foreign ${expected.phase.toUpperCase()} result`,
      );
    byJob.set(row.jobKey, row);
  }
  return { ref, manifest: validationManifest, rows, byJob };
}

function phaseState(
  row: z.infer<typeof ValidationResultSchema> | undefined,
  phase: 'r1' | 'r2',
): PhaseState {
  if (!row || row.state === 'pending') return { state: 'pending' };
  if (row.state === 'transport_unknown') return { state: 'transport_unknown' };
  if (row.state === 'blocked_transport')
    return {
      state: 'blocked_transport',
      reason: `${phase.toUpperCase()} transport was blocked.`,
    };
  if (row.state === 'invalid_output')
    return {
      state: 'invalid',
      reason: row.errorType ?? 'D1 rejected the output.',
      rawResponse: ArtifactRefSchema.parse(row.rawResponse),
    };
  if (row.state !== 'validated' || !row.rawResponse || row.output === null)
    throw new Error(`Unexpected ${phase.toUpperCase()} validation state`);
  return {
    state: 'ready',
    output: row.output,
    rawResponse: ArtifactRefSchema.parse(row.rawResponse),
  };
}

function parseLedger(root: string, path: string, runId: string) {
  const fullPath = artifactPath(root, path);
  if (!existsSync(fullPath)) return [];
  const bytes = readFileSync(fullPath);
  if (bytes.length > MAX_JSONL_BYTES)
    throw new Error('Event ledger exceeds 64 MiB');
  if (!bytes.length) return [];
  const text = bytes.toString('utf8');
  if (!text.endsWith('\n')) throw new Error('Event ledger must end with LF');
  const events = verifyBatchEventChain(
    text
      .slice(0, -1)
      .split('\n')
      .map((line) => BatchEventSchema.parse(JSON.parse(line) as unknown)),
  );
  if (events.some((event) => event.runId !== runId))
    throw new Error('Event ledger belongs to another run');
  return events;
}

export async function buildBatchReport(
  rootValue: string,
  manifestPath: string,
  repairManifestPath?: string,
) {
  const root = resolve(rootValue);
  const progress = (stage: string) =>
    console.error(JSON.stringify({ task: 'db4_report_progress', stage }));
  progress('preflight');
  const preflight = await preflightBatchInputs(root, manifestPath, progress);
  const manifestBytes = readFileSync(artifactPath(root, manifestPath));
  const manifestRef = { path: manifestPath, sha256: hashBytes(manifestBytes) };
  const manifest = BatchManifestSchema.parse(
    JSON.parse(manifestBytes.toString('utf8')) as unknown,
  );
  const prefix = manifestPath.slice(0, manifestPath.lastIndexOf('/'));
  progress('validate_r1');
  const r1ValidationWritten = await validateBatchPhase(
    root,
    manifestPath,
    'r1',
    repairManifestPath,
  );
  progress('validate_r2');
  const r2ValidationWritten = await validateBatchPhase(
    root,
    manifestPath,
    'r2',
    repairManifestPath,
  );
  const r1Validation = readValidationRows(root, r1ValidationWritten.manifest, {
    runId: manifest.runId,
    phase: 'r1',
    manifest: manifestRef,
    schedule: manifest.artifacts.schedule,
  });
  const r2Validation = readValidationRows(root, r2ValidationWritten.manifest, {
    runId: manifest.runId,
    phase: 'r2',
    manifest: manifestRef,
    schedule: manifest.artifacts.schedule,
  });
  const initialResults = readJsonl(
    root,
    manifest.artifacts.initialTargetResults,
    BatchTargetResultSchema,
    'Initial target results',
  );
  const initialByTarget = new Map(
    initialResults.map((row) => [row.targetKey, row]),
  );
  if (initialByTarget.size !== manifest.cohort.counts.selected)
    throw new Error('Initial result denominator mismatch');

  const events = parseLedger(
    root,
    `${prefix}/ledger/events.jsonl`,
    manifest.runId,
  );
  if (
    canonicalJson(r1Validation.manifest.sourceLedger) !==
      canonicalJson(r2Validation.manifest.sourceLedger) ||
    r1Validation.manifest.sourceLedgerHead !==
      r2Validation.manifest.sourceLedgerHead ||
    r1Validation.manifest.sourceLedgerHead !==
      (events.at(-1)?.eventSha256 ?? null) ||
    canonicalJson(r1Validation.manifest.formatRepairWave ?? null) !==
      canonicalJson(r2Validation.manifest.formatRepairWave ?? null)
  )
    throw new Error(
      'Ledger/repair lineage changed during report; retry from checkpoints',
    );
  const dispatchesByPhase = { r1: 0, r2: 0 };
  const savedByPhase = { r1: 0, r2: 0 };
  const unknownByPhase = { r1: 0, r2: 0 };
  for (const event of events) {
    if (
      event.type === 'dispatch_intent_persisted' &&
      event.details.phase === 'r1'
    )
      dispatchesByPhase.r1++;
    if (
      event.type === 'dispatch_intent_persisted' &&
      event.details.phase === 'r2'
    )
      dispatchesByPhase.r2++;
    if (event.type === 'response_saved' && event.details.phase === 'r1')
      savedByPhase.r1++;
    if (event.type === 'response_saved' && event.details.phase === 'r2')
      savedByPhase.r2++;
    if (event.type === 'transport_unknown' && event.details.phase === 'r1')
      unknownByPhase.r1++;
    if (event.type === 'transport_unknown' && event.details.phase === 'r2')
      unknownByPhase.r2++;
  }

  const reportIdentity = hashJson({
    task: 'db4_batch_report_v1',
    manifest: manifestRef,
    r1Validation: r1Validation.ref,
    r2Validation: r2Validation.ref,
    ...(r1Validation.manifest.formatRepairWave
      ? { formatRepairWave: r1Validation.manifest.formatRepairWave }
      : {}),
  });
  const reportPrefix = `${prefix}/reports/final/${reportIdentity}`;
  const resultRows: z.infer<typeof BatchTargetResultSchema>[] = [];
  const splitCounts = {
    development: { selected: 0, proposedExact: 0 },
    holdout: { selected: 0, proposedExact: 0 },
  };
  const statusCounts: Record<string, number> = {};
  const phaseCounts = {
    r1: {
      validated: 0,
      invalid_output: 0,
      transport_unknown: 0,
      blocked_transport: 0,
      pending: 0,
    },
    r2: {
      validated: 0,
      invalid_output: 0,
      transport_unknown: 0,
      blocked_transport: 0,
      pending: 0,
    },
  };
  for (const row of r1Validation.rows) phaseCounts.r1[row.state]++;
  for (const row of r2Validation.rows) phaseCounts.r2[row.state]++;

  for (const shard of manifest.shards) {
    progress(`report_shard:${shard.shardId}`);
    const targets = readJsonl(
      root,
      shard.targets,
      BatchTargetSchema,
      `Targets ${shard.shardId}`,
    );
    const checkpointPath = `${reportPrefix}/shards/${shard.shardId}.json`;
    const binding = {
      reportIdentity,
      runManifest: manifestRef,
      validations: { r1: r1Validation.ref, r2: r2Validation.ref },
      shard,
    };
    const accumulate = (
      row: z.infer<typeof BatchTargetResultSchema>,
      split: 'development' | 'holdout',
    ) => {
      resultRows.push(row);
      splitCounts[split].selected++;
      statusCounts[row.status] = (statusCounts[row.status] ?? 0) + 1;
      if (row.status === 'proposed_exact') splitCounts[split].proposedExact++;
    };
    if (existsSync(artifactPath(root, checkpointPath))) {
      const checkpointBytes = readFileSync(artifactPath(root, checkpointPath));
      if (checkpointBytes.length > MAX_JSONL_BYTES)
        throw new Error('Shard checkpoint exceeds byte cap');
      const checkpoint = z
        .object({
          binding: z.unknown(),
          rows: z.array(BatchTargetResultSchema),
        })
        .strict()
        .parse(JSON.parse(checkpointBytes.toString('utf8')) as unknown);
      if (
        canonicalJson(checkpoint.binding) !== canonicalJson(binding) ||
        checkpoint.rows.length !== targets.length
      )
        throw new Error('Shard checkpoint binding/denominator mismatch');
      for (const [index, row] of checkpoint.rows.entries()) {
        const target = targets[index];
        const initial = initialByTarget.get(target.targetKey);
        if (
          row.runId !== manifest.runId ||
          row.targetKey !== target.targetKey ||
          row.senseKey !== target.senseKey ||
          !initial
        )
          throw new Error('Shard checkpoint target identity mismatch');
        if (initial.status === 'no_candidates') {
          if (canonicalJson(row) !== canonicalJson(initial))
            throw new Error('Shard checkpoint changed no-candidate target');
        } else {
          if (!row.d1Decision)
            throw new Error('Shard checkpoint lacks evaluation proof');
          const artifact = JSON.parse(
            readArtifact(root, row.d1Decision).toString('utf8'),
          ) as {
            cohortTargetKey: string;
            senseKey: string;
            validationManifests: unknown;
            evaluation: { target: unknown };
          };
          const evaluated = BatchTargetResultSchema.parse(
            artifact.evaluation.target,
          );
          const restored = BatchTargetResultSchema.parse({
            ...evaluated,
            targetKey: target.targetKey,
            senseKey: target.senseKey,
            d1Decision: row.d1Decision,
            auditResult: null,
          });
          if (
            artifact.cohortTargetKey !== target.targetKey ||
            artifact.senseKey !== target.senseKey ||
            canonicalJson(artifact.validationManifests) !==
              canonicalJson(binding.validations) ||
            canonicalJson(restored) !== canonicalJson(row)
          )
            throw new Error('Shard checkpoint evaluation mismatch');
        }
        accumulate(row, target.split);
      }
      continue;
    }
    const shardResultRows: z.infer<typeof BatchTargetResultSchema>[] = [];
    const candidates = readJsonl(
      root,
      shard.candidates,
      z.unknown(),
      `Candidates ${shard.shardId}`,
    ).map((value) => parseMappingCandidate(value));
    const bySense = new Map<string, MappingCandidate[]>();
    for (const candidate of candidates) {
      const rows = bySense.get(candidate.sense.semanticKey) ?? [];
      rows.push(candidate);
      bySense.set(candidate.sense.semanticKey, rows);
    }
    const targetByKey = new Map(
      targets.map((target) => [target.targetKey, target]),
    );
    const r2ByTarget = new Map<
      string,
      { jobKey: string; targetKey: string; senseKey: string }
    >();
    const r2Count = await scanBatchJsonl(
      root,
      shard.requests.r2,
      ReportRequestSchema,
      `R2 requests ${shard.shardId}`,
      (request) => {
        if (r2ByTarget.has(request.targetKey))
          throw new Error('Duplicate R2 target');
        r2ByTarget.set(request.targetKey, {
          jobKey: request.jobKey,
          targetKey: request.targetKey,
          senseKey: request.senseKey,
        });
      },
    );
    const resultByTarget = new Map<
      string,
      z.infer<typeof BatchTargetResultSchema>
    >();
    const r1Count = await scanBatchJsonl(
      root,
      shard.requests.r1,
      ReportRequestSchema,
      `R1 requests ${shard.shardId}`,
      (r1Request) => {
        const target = targetByKey.get(r1Request.targetKey);
        if (!target || resultByTarget.has(target.targetKey))
          throw new Error('Duplicate or foreign R1 target');
        const r2Request = r2ByTarget.get(target.targetKey);
        if (!r2Request)
          throw new Error(`Ready target lacks R2 request: ${target.senseKey}`);
        const r1Row = r1Validation.byJob.get(r1Request.jobKey);
        const r2Row = r2Validation.byJob.get(r2Request.jobKey);
        if (
          !r1Row ||
          !r2Row ||
          r1Row.targetKey !== target.targetKey ||
          r2Row.targetKey !== target.targetKey ||
          r1Row.senseKey !== target.senseKey ||
          r2Row.senseKey !== target.senseKey
        )
          throw new Error(
            `Phase validation missing or mismatched: ${target.senseKey}`,
          );
        const bundle = normalizedBundle(r1Request.payload.bundle);
        const candidateRows = bySense.get(bundle.sense.semanticKey) ?? [];
        const r1 = phaseState(r1Row, 'r1');
        let r2 = phaseState(r2Row, 'r2');
        if (r1.state !== 'ready') {
          r2 = { state: 'skipped', reason: 'R1 has no validated output.' };
        } else {
          const parsedR1 = parseMappingOutput(r1.output, bundle);
          const exact = parsedR1.reviews.filter(
            (review) => review.relation === 'exact',
          ).length;
          if (exact !== 1 || parsedR1.unresolvedReason !== null)
            r2 = {
              state: 'skipped',
              reason: 'R1 did not meet the unique exact R2 condition.',
            };
        }
        const evaluation = evaluateBatchTarget({
          runId: manifest.runId,
          generation: 1,
          bundleValue: bundle,
          candidateValues: candidateRows,
          r1,
          r2,
        });
        if (evaluation.target.senseKey !== bundle.sense.semanticKey)
          throw new Error(`D3 evaluation sense mismatch: ${target.senseKey}`);
        const evaluationArtifact = writeAtomicJson(
          root,
          `${reportPrefix}/evaluations/${target.targetKey}.json`,
          {
            schemaVersion: 1,
            task: 'db4_batch_target_evaluation_artifact',
            cohortTargetKey: target.targetKey,
            mappingTargetKey: evaluation.target.targetKey,
            senseKey: target.senseKey,
            validationManifests: { r1: r1Validation.ref, r2: r2Validation.ref },
            evaluation,
          },
        );
        resultByTarget.set(
          target.targetKey,
          BatchTargetResultSchema.parse({
            ...evaluation.target,
            targetKey: target.targetKey,
            senseKey: target.senseKey,
            d1Decision: evaluationArtifact,
            auditResult: null,
          }),
        );
      },
    );
    if (r1Count !== shard.readyCount || r2Count !== shard.readyCount)
      throw new Error(`Request denominator mismatch for ${shard.shardId}`);

    for (const target of targets) {
      const initial = initialByTarget.get(target.targetKey);
      if (!initial || initial.senseKey !== target.senseKey)
        throw new Error(`Initial result missing target ${target.senseKey}`);
      if (initial.status === 'no_candidates') {
        accumulate(initial, target.split);
        shardResultRows.push(initial);
        continue;
      }
      const result = resultByTarget.get(target.targetKey);
      if (!result)
        throw new Error(`Missing evaluated target: ${target.senseKey}`);
      accumulate(result, target.split);
      shardResultRows.push(result);
    }
    writeAtomicJson(root, checkpointPath, { binding, rows: shardResultRows });
  }
  if (resultRows.length !== manifest.cohort.counts.selected)
    throw new Error('Final target status denominator mismatch');
  progress('publish');
  const resultsRef = writeAtomicArtifact(
    root,
    `${reportPrefix}/target-results.jsonl`,
    resultRows.map((row) => JSON.stringify(row) + '\n').join(''),
  );
  const terminalStatuses = new Set([
    'no_candidates',
    'source_identity_lane',
    'existing_exact_requires_audit',
    'proposed_exact',
    'proposed_nonexact',
    'unresolved_no_exact',
    'unresolved_ambiguous',
    'unresolved_compound',
    'unresolved_disagreement',
    'unresolved_invalid_output',
    'blocked_source',
  ]);
  const terminalCount = resultRows.filter((row) =>
    terminalStatuses.has(row.status),
  ).length;
  const summary = {
    schemaVersion: 1,
    task: 'db4_batch_report',
    runId: manifest.runId,
    reportIdentity,
    inputManifest: manifestRef,
    targetResults: resultsRef,
    selected: resultRows.length,
    terminal: terminalCount,
    nonterminal: resultRows.length - terminalCount,
    byStatus: Object.fromEntries(
      Object.entries(statusCounts).sort(([a], [b]) => a.localeCompare(b)),
    ),
    bySplit: splitCounts,
    phaseResults: phaseCounts,
    dispatchesByPhase,
    savedRepliesByPhase: savedByPhase,
    transportUnknownByPhase: unknownByPhase,
    preflight,
    ...(r1Validation.manifest.formatRepairWave
      ? { formatRepairWave: r1Validation.manifest.formatRepairWave }
      : {}),
    gates: {
      pilotA: 'not_run',
      pilotB: 'not_run',
      promotionReady: false,
      apply: false,
      serving: false,
    },
    generatedAt: events.at(-1)?.at ?? manifest.createdAt,
  };
  const summaryRef = writeAtomicJson(
    root,
    `${reportPrefix}/summary.json`,
    summary,
  );
  const markdown = [
    `# DB4-D4/D5 — Batch report ${manifest.runId}`,
    '',
    `- Selected targets: ${resultRows.length}`,
    `- Terminal statuses: ${terminalCount}`,
    `- Nonterminal statuses: ${resultRows.length - terminalCount}`,
    `- R1 dispatch intents / saved replies / unknown: ${dispatchesByPhase.r1} / ${savedByPhase.r1} / ${unknownByPhase.r1}`,
    `- R2 dispatch intents / saved replies / unknown: ${dispatchesByPhase.r2} / ${savedByPhase.r2} / ${unknownByPhase.r2}`,
    `- Proposal exact, development / holdout: ${splitCounts.development.proposedExact} / ${splitCounts.holdout.proposedExact}`,
    '- Pilot A/B: not run; promotion and apply remain blocked.',
    '',
    '## Target statuses',
    '',
    ...Object.entries(summary.byStatus).map(
      ([status, count]) => `- ${status}: ${count}`,
    ),
    '',
    `Target rows: \`${resultsRef.path}\` (${resultsRef.sha256})`,
    `Machine summary: \`${summaryRef.path}\` (${summaryRef.sha256})`,
    '',
  ].join('\n');
  const markdownRef = writeAtomicArtifact(
    root,
    `${reportPrefix}/summary.md`,
    markdown,
  );
  const reportManifest = {
    schemaVersion: 1,
    task: 'db4_batch_report_manifest',
    runId: manifest.runId,
    reportIdentity,
    runManifest: manifestRef,
    validations: { r1: r1Validation.ref, r2: r2Validation.ref },
    targetResults: resultsRef,
    summary: summaryRef,
    markdown: markdownRef,
    selected: resultRows.length,
    terminal: terminalCount,
    gates: summary.gates,
    apply: false,
  };
  const reportManifestRef = writeAtomicJson(
    root,
    `${reportPrefix}/manifest.json`,
    reportManifest,
  );
  return {
    manifest: reportManifestRef,
    summary: summaryRef,
    targetResults: resultsRef,
    gates: summary.gates,
  };
}

if (require.main === module) {
  const flags: Record<string, string> = {};
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (
      !key?.startsWith('--') ||
      !['artifact-dir', 'manifest', 'repair-manifest'].includes(key.slice(2)) ||
      !value ||
      value.startsWith('--') ||
      flags[key.slice(2)]
    )
      throw new Error(`Unknown/duplicate/missing flag: ${key}`);
    flags[key.slice(2)] = value;
  }
  const manifest = flags.manifest;
  if (!manifest)
    throw new Error(
      'Usage: tsx scripts/db4/batch-report.ts --artifact-dir ROOT --manifest PATH',
    );
  void buildBatchReport(
    resolve(flags['artifact-dir'] ?? 'uploads/db4'),
    manifest,
    flags['repair-manifest'],
  )
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error: unknown) => {
      console.error(
        JSON.stringify({
          errorType: error instanceof Error ? error.name : 'Error',
          message:
            error instanceof Error
              ? error.message.slice(0, 1000)
              : 'Unknown report error',
        }),
      );
      process.exitCode = 1;
    });
}
