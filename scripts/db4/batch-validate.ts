// DB4-D4/D5: validate completed native replies against D1 without dispatching.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  BatchEvent,
  BatchManifestSchema,
  BatchScheduleSchema,
  createBatchJob,
  verifyBatchEventChain,
} from './_batch-types';
import {
  MappingBundle,
  MappingBundleSchema,
  MappingOutput,
  Sha256Schema,
  Text,
  ArtifactRefSchema,
  hashBytes,
  hashJson,
  parseMappingBundleIntegrity,
  parseMappingOutput,
} from './_mapping-types';
import {
  artifactPath,
  readArtifact,
  writeAtomicArtifact,
  writeAtomicJson,
} from './_retrieval';

const Phase = z.enum(['r1', 'r2']);
const RequestSchema = z
  .object({
    jobKey: Sha256Schema,
    targetKey: Sha256Schema,
    senseKey: Text,
    phase: Phase,
    generation: z.number().int().min(1).max(2),
    bundleKey: Sha256Schema,
    promptVersion: Text,
    promptHash: Sha256Schema,
    renderedContextHash: Sha256Schema,
    dependencyJobKey: Sha256Schema.nullable(),
    payload: z
      .object({
        schemaVersion: z.literal(1),
        phase: Phase,
        seed: Text,
        promptVersion: Text,
        bundle: MappingBundleSchema,
      })
      .strict(),
  })
  .strict();
type Request = z.infer<typeof RequestSchema>;
export const ValidationResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    task: z.literal('db4_batch_validation_result'),
    runId: Text,
    jobKey: Sha256Schema,
    targetKey: Sha256Schema,
    senseKey: Text,
    phase: Phase,
    state: z.enum([
      'validated',
      'invalid_output',
      'transport_unknown',
      'blocked_transport',
      'pending',
    ]),
    rawResponse: ArtifactRefSchema.nullable(),
    outputHash: Sha256Schema.nullable(),
    output: z.unknown().nullable(),
    r2Eligible: z.boolean().nullable(),
    errorType: Text.nullable(),
  })
  .strict();
export const BatchValidationManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    task: z.literal('db4_batch_validation'),
    runId: Text,
    phase: Phase,
    runManifest: ArtifactRefSchema,
    schedule: ArtifactRefSchema,
    sourceLedger: ArtifactRefSchema.nullable(),
    sourceLedgerHead: Sha256Schema.nullable(),
    results: ArtifactRefSchema,
    counts: z.record(z.number().int().nonnegative()),
    allRequestsRetained: z.literal(true),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    if (
      (manifest.sourceLedger === null) !==
      (manifest.sourceLedgerHead === null)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['sourceLedgerHead'],
        message: 'Ledger ref and head must both be present or absent',
      });
  });

function parseJsonl<T>(
  bytes: Buffer,
  schema: z.ZodType<T>,
  label: string,
): T[] {
  if (bytes.length === 0) return [];
  const text = bytes.toString('utf8');
  if (!text.endsWith('\n')) throw new Error(`${label} must end with newline`);
  const lines = text.slice(0, -1).split('\n');
  if (lines.some((line) => !line)) throw new Error(`${label} has a blank row`);
  return lines.map((line) => schema.parse(JSON.parse(line) as unknown));
}

function cleanReply(raw: string): unknown {
  const trimmed = raw.trim();
  const clean = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    : trimmed;
  return JSON.parse(clean) as unknown;
}

function renderedIntegrityBundle(bundleValue: unknown): MappingBundle {
  const rendered = MappingBundleSchema.parse(bundleValue);
  return parseMappingBundleIntegrity({
    ...rendered,
    candidates: [...rendered.candidates].sort((a, b) =>
      a.candidateKey < b.candidateKey
        ? -1
        : a.candidateKey > b.candidateKey
          ? 1
          : 0,
    ),
  });
}

function eventRows(root: string, prefix: string, runId: string): BatchEvent[] {
  const path = `${prefix}/ledger/events.jsonl`;
  if (!existsSync(artifactPath(root, path))) return [];
  const bytes = readFileSync(artifactPath(root, path));
  if (bytes.length > 64 * 1024 * 1024)
    throw new Error('Event ledger exceeds 64 MiB');
  const rows = parseJsonl(bytes, z.unknown(), 'Batch events');
  const events = verifyBatchEventChain(rows);
  if (events.some((event) => event.runId !== runId))
    throw new Error('Event ledger run ID mismatch');
  return events;
}

function requireRequestScheduleBinding(
  runId: string,
  expected: Map<string, z.infer<typeof BatchScheduleSchema>['jobs'][number]>,
  request: Request,
  phase: 'r1' | 'r2',
  revision: string,
  promptHashes: { system: string; r1: string; r2: string },
) {
  const job = expected.get(request.jobKey);
  const bundle = renderedIntegrityBundle(request.payload.bundle);
  const promptHash = hashJson({
    revision,
    version: request.promptVersion,
    systemSha256: promptHashes.system,
    phaseSha256: promptHashes[phase],
  });
  if (
    !job ||
    job.targetKey !== request.targetKey ||
    job.senseKey !== request.senseKey ||
    job.bundleKey !== request.bundleKey ||
    job.phase !== request.phase ||
    job.generation !== request.generation ||
    job.renderedHash !== request.renderedContextHash ||
    job.promptHash !== request.promptHash ||
    job.dependsOn !== request.dependencyJobKey ||
    request.payload.phase !== request.phase ||
    request.payload.promptVersion !== request.promptVersion ||
    bundle.bundleKey !== request.bundleKey ||
    job.inputHash !==
      hashJson({
        bundleKey: bundle.bundleKey,
        contextHash: bundle.contextHash,
      }) ||
    request.promptVersion !== `db4-d4-semantic-match-${revision}-${phase}` ||
    request.promptHash !== promptHash ||
    request.jobKey !==
      createBatchJob(runId, {
        targetKey: request.targetKey,
        senseKey: request.senseKey,
        shardId: job.shardId,
        generation: request.generation,
        kind: job.kind,
        phase,
        attempt: job.attempt,
        bundleKey: request.bundleKey,
        inputHash: job.inputHash,
        promptHash: request.promptHash,
        renderedHash: request.renderedContextHash,
        dependsOn: request.dependencyJobKey,
      }).jobKey
  )
    throw new Error(`Request does not bind schedule job ${request.jobKey}`);
  if (request.renderedContextHash !== hashJson(request.payload))
    throw new Error(`Rendered payload hash mismatch for ${request.jobKey}`);
}

export function validateBatchPhase(
  root: string,
  manifestPath: string,
  phase: 'r1' | 'r2',
) {
  const manifestBytes = readFileSync(artifactPath(root, manifestPath));
  const manifestRef = {
    path: manifestPath,
    sha256: hashBytes(manifestBytes),
  };
  const manifest = BatchManifestSchema.parse(
    JSON.parse(manifestBytes.toString('utf8')) as unknown,
  );
  if (manifest.mode !== 'shadow' || manifest.apply || manifest.promotionReady)
    throw new Error('Validation requires an unapplied shadow run');
  const prefix = manifestPath.slice(0, manifestPath.lastIndexOf('/'));
  const promptHashes = {
    system: hashBytes(readArtifact(root, manifest.prompt.system)),
    r1: hashBytes(readArtifact(root, manifest.prompt.r1)),
    r2: hashBytes(readArtifact(root, manifest.prompt.r2)),
  };
  const scheduleBytes = readArtifact(root, manifest.artifacts.schedule);
  const scheduleRows = parseJsonl(scheduleBytes, z.unknown(), 'Schedule jobs');
  const schedule = BatchScheduleSchema.parse({
    schemaVersion: 1,
    task: 'db4_batch_schedule',
    runId: manifest.runId,
    waveId: 'initial',
    createdAt: manifest.createdAt,
    jobs: scheduleRows,
  });
  const expectedRequests = new Map(
    schedule.jobs
      .filter((job) => job.phase === phase)
      .map((job) => [job.jobKey, job]),
  );
  const requestKeys = new Set<string>();
  const ledger = eventRows(root, prefix, manifest.runId);
  const ledgerRef = existsSync(
    artifactPath(root, `${prefix}/ledger/events.jsonl`),
  )
    ? {
        path: `${prefix}/ledger/events.jsonl`,
        sha256: hashBytes(
          readFileSync(artifactPath(root, `${prefix}/ledger/events.jsonl`)),
        ),
      }
    : null;
  const scheduleByJob = new Map(schedule.jobs.map((job) => [job.jobKey, job]));
  const intents = new Set<string>();
  const responses = new Map<string, BatchEvent>();
  for (const event of ledger) {
    if (!event.jobKey) continue;
    const job = scheduleByJob.get(event.jobKey);
    if (!job)
      throw new Error(
        `Ledger event references an unknown job: ${event.jobKey}`,
      );
    const eventPhase = event.details.phase;
    if (
      [
        'job_planned',
        'dispatch_intent_persisted',
        'dispatch_acknowledged',
        'transport_unknown',
        'response_saved',
        'response_validated',
        'response_invalid',
        'job_skipped',
      ].includes(event.type) &&
      eventPhase !== job.phase
    )
      throw new Error(`Ledger event phase mismatch for ${event.jobKey}`);
    if (event.type === 'dispatch_intent_persisted') {
      if (intents.has(event.jobKey))
        throw new Error(`Duplicate dispatch intent: ${event.jobKey}`);
      intents.add(event.jobKey);
    }
    if (event.type === 'response_saved') {
      if (responses.has(event.jobKey))
        throw new Error(
          `Multiple raw responses for one dispatch: ${event.jobKey}`,
        );
      if (!intents.has(event.jobKey))
        throw new Error(
          `Raw response has no prior dispatch intent: ${event.jobKey}`,
        );
      const responsePath = event.details.responsePath;
      const responseSha256 = event.details.responseSha256;
      const expectedPath = `${prefix}/responses/raw/${event.jobKey}.txt`;
      if (responsePath !== expectedPath || typeof responseSha256 !== 'string')
        throw new Error(
          `Raw response path/hash is not bound to its job: ${event.jobKey}`,
        );
      responses.set(event.jobKey, event);
    }
  }

  const rows: z.infer<typeof ValidationResultSchema>[] = [];
  const validateRequest = (request: Request) => {
    requireRequestScheduleBinding(
      manifest.runId,
      expectedRequests,
      request,
      phase,
      manifest.prompt.revision,
      promptHashes,
    );
    if (requestKeys.has(request.jobKey))
      throw new Error(`Duplicate request job key ${request.jobKey}`);
    requestKeys.add(request.jobKey);
    const responseEvent = responses.get(request.jobKey);
    const intent = intents.has(request.jobKey);
    const base = {
      schemaVersion: 1 as const,
      task: 'db4_batch_validation_result' as const,
      runId: manifest.runId,
      jobKey: request.jobKey,
      targetKey: request.targetKey,
      senseKey: request.senseKey,
      phase,
      rawResponse: null as { path: string; sha256: string } | null,
      outputHash: null as string | null,
      output: null as MappingOutput | null,
      r2Eligible: null as boolean | null,
      errorType: null as string | null,
    };
    if (!responseEvent) {
      return ValidationResultSchema.parse({
        ...base,
        state: intent ? 'transport_unknown' : 'pending',
      });
    }
    const responsePath = responseEvent.details.responsePath;
    const responseSha256 = responseEvent.details.responseSha256;
    if (typeof responsePath !== 'string' || typeof responseSha256 !== 'string')
      throw new Error(
        `Response event lacks raw artifact ref: ${request.jobKey}`,
      );
    const rawRef = ArtifactRefSchema.parse({
      path: responsePath,
      sha256: responseSha256,
    });
    const rawBytes = readArtifact(root, rawRef);
    const raw = rawBytes.toString('utf8');
    try {
      const bundle = renderedIntegrityBundle(request.payload.bundle);
      const output = parseMappingOutput(cleanReply(raw), bundle);
      const order = request.payload.bundle.candidates.map(
        (candidate) => candidate.candidateKey,
      );
      if (
        output.reviews.map((review) => review.candidateKey).join('\n') !==
        order.join('\n')
      )
        throw new Error('Review candidate order mismatch');
      const exact = output.reviews.filter(
        (review) => review.relation === 'exact',
      );
      const r2Eligible = exact.length === 1 && output.unresolvedReason === null;
      return ValidationResultSchema.parse({
        ...base,
        state: 'validated',
        rawResponse: rawRef,
        outputHash: hashJson(output),
        output,
        r2Eligible,
      });
    } catch (error) {
      return ValidationResultSchema.parse({
        ...base,
        state: 'invalid_output',
        rawResponse: rawRef,
        errorType: error instanceof Error ? error.name : 'InvalidOutput',
      });
    }
  };
  for (const shard of manifest.shards) {
    const requestPath = artifactPath(root, shard.requests[phase].path);
    if (statSync(requestPath).size > 64 * 1024 * 1024)
      throw new Error(`Requests ${shard.shardId}/${phase} exceed 64 MiB`);
    const requests = parseJsonl(
      readArtifact(root, shard.requests[phase]),
      RequestSchema,
      `Requests ${shard.shardId}/${phase}`,
    );
    if (requests.length !== shard.readyCount)
      throw new Error(
        `Request denominator mismatch for ${shard.shardId}/${phase}`,
      );
    for (const request of requests) rows.push(validateRequest(request));
  }
  if (requestKeys.size !== expectedRequests.size)
    throw new Error(`Schedule/request denominator mismatch for ${phase}`);
  const rowsText = rows.map((row) => JSON.stringify(row) + '\n').join('');
  if (Buffer.byteLength(rowsText) > 64 * 1024 * 1024)
    throw new Error('Validation result exceeds 64 MiB');
  const head = ledger.at(-1)?.eventSha256 ?? 'empty';
  const outputPrefix = `${prefix}/validation/${phase}-${head.slice(0, 16)}`;
  const resultsRef = writeAtomicArtifact(
    root,
    `${outputPrefix}/results.jsonl`,
    rowsText,
  );
  const counts = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.state] = (acc[row.state] ?? 0) + 1;
    if (row.r2Eligible === true) acc.r2_eligible = (acc.r2_eligible ?? 0) + 1;
    return acc;
  }, {});
  const validationManifest = BatchValidationManifestSchema.parse({
    schemaVersion: 1,
    task: 'db4_batch_validation',
    runId: manifest.runId,
    phase,
    runManifest: manifestRef,
    schedule: manifest.artifacts.schedule,
    sourceLedger: ledgerRef,
    sourceLedgerHead: ledger.at(-1)?.eventSha256 ?? null,
    results: resultsRef,
    counts,
    allRequestsRetained: rows.length === expectedRequests.size,
  });
  const validationManifestRef = writeAtomicJson(
    root,
    `${outputPrefix}/manifest.json`,
    validationManifest,
  );
  return {
    manifest: validationManifestRef,
    results: resultsRef,
    counts,
  };
}

if (require.main === module) {
  const flags: Record<string, string> = {};
  const allowed = new Set(['artifact-dir', 'manifest', 'phase']);
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (
      !key?.startsWith('--') ||
      !allowed.has(key.slice(2)) ||
      !value ||
      value.startsWith('--') ||
      flags[key.slice(2)]
    )
      throw new Error(`Unknown/duplicate/missing flag: ${key}`);
    flags[key.slice(2)] = value;
  }
  const root = resolve(flags['artifact-dir'] ?? 'uploads/db4');
  const manifest = flags.manifest;
  const phase = Phase.parse(flags.phase);
  if (!manifest)
    throw new Error(
      'Usage: tsx scripts/db4/batch-validate.ts --artifact-dir ROOT --manifest PATH --phase r1|r2',
    );
  console.log(JSON.stringify(validateBatchPhase(root, manifest, phase)));
}
