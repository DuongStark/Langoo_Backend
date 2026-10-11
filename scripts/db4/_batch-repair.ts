// DB4-D4: immutable format-only waves. D1 semantic policy remains unchanged.
import { readFileSync, statSync } from 'node:fs';
import { z } from 'zod';
import { BatchJob, BatchScheduleSchema, createBatchJob } from './_batch-types';
import {
  ArtifactRef,
  ArtifactRefSchema,
  MappingBundle,
  MappingOutput,
  Sha256Schema,
  Text,
  Timestamp,
  canonicalJson,
  hashBytes,
  hashJson,
  parseMappingOutput,
} from './_mapping-types';
import {
  RequestSchema,
  cleanReply,
  renderedIntegrityBundle,
} from './_batch-requests';
import { artifactPath, readArtifact } from './_retrieval';
import { scanBatchJsonl } from './_batch-jsonl';

export const FORMAT_REPAIR_POLICY = 'db4-format-only-repair-v1' as const;
const RepairContextSchema = z
  .object({
    policyVersion: z.literal(FORMAT_REPAIR_POLICY),
    originalJobKey: Sha256Schema,
    originalPromptHash: Sha256Schema,
    originalRenderedHash: Sha256Schema,
    originalRawResponse: ArtifactRefSchema,
    originalRawText: z
      .string()
      .min(1)
      .max(64 * 1024 * 1024),
    parserError: z.string().min(1).max(4000),
  })
  .strict();
export const RepairRequestSchema = RequestSchema.extend({
  repair: RepairContextSchema,
}).strict();
export type RepairRequest = z.infer<typeof RepairRequestSchema>;
export const RepairWaveSchema = z
  .object({
    schemaVersion: z.literal(1),
    task: z.literal('db4_batch_format_repair_wave'),
    policyVersion: z.literal(FORMAT_REPAIR_POLICY),
    runId: Text,
    createdAt: Timestamp,
    runManifest: ArtifactRefSchema,
    parent: ArtifactRefSchema.nullable(),
    git: z
      .object({
        revision: z.string().regex(/^[0-9a-f]{7,40}$/),
        dirtySourceSha256: z.null(),
      })
      .strict(),
    originalValidations: z
      .object({ r1: ArtifactRefSchema, r2: ArtifactRefSchema })
      .strict(),
    requests: ArtifactRefSchema,
    jobs: z.array(z.unknown()).min(1).max(1000),
    count: z.number().int().min(1).max(1000),
    apply: z.literal(false),
  })
  .strict();
export type RepairWave = z.infer<typeof RepairWaveSchema>;

/** Preserve every understood field, including explanation/evidence, from the rejected reply. */
export function validateFormatRepair(
  raw: string,
  value: unknown,
  bundle: MappingBundle,
  order?: string[],
): MappingOutput {
  const output = parseMappingOutput(value, bundle);
  const expectedOrder =
    order ?? bundle.candidates.map((candidate) => candidate.candidateKey);
  if (
    canonicalJson(output.reviews.map((review) => review.candidateKey)) !==
    canonicalJson(expectedOrder)
  )
    throw new Error('Repair candidate order mismatch');
  let original: unknown;
  try {
    original = cleanReply(raw);
  } catch {
    return output;
  }
  if (!original || typeof original !== 'object' || Array.isArray(original))
    return output;
  const record = original as Record<string, unknown>;
  for (const key of ['noSuitableCandidate', 'unresolvedReason'] as const) {
    if (
      record[key] !== undefined &&
      canonicalJson(record[key]) !== canonicalJson(output[key])
    )
      throw new Error('semantic_change_during_repair');
  }
  if (Array.isArray(record.reviews))
    for (const item of record.reviews) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const claim = item as Record<string, unknown>;
      const review = output.reviews.find(
        (row) =>
          row.candidateKey === claim.candidateKey ||
          row.conceptId === claim.conceptId,
      );
      if (!review) {
        if (
          [
            'relation',
            'coveredBranches',
            'missingBranches',
            'conflicts',
            'reason',
          ].some((key) => claim[key] !== undefined)
        )
          throw new Error('semantic_change_during_repair');
        continue;
      }
      for (const key of [
        'relation',
        'coveredBranches',
        'missingBranches',
        'conflicts',
        'reason',
        'confidence',
      ] as const)
        if (
          claim[key] !== undefined &&
          canonicalJson(claim[key]) !== canonicalJson(review[key])
        )
          throw new Error('semantic_change_during_repair');
    }
  return output;
}

export function repairJob(
  runId: string,
  original: BatchJob,
  request: RepairRequest,
): BatchJob {
  return createBatchJob(runId, {
    targetKey: original.targetKey,
    senseKey: original.senseKey,
    shardId: original.shardId,
    generation: original.generation,
    kind: 'format_repair',
    phase: original.phase,
    attempt: 2,
    bundleKey: original.bundleKey,
    inputHash: hashJson({
      policyVersion: FORMAT_REPAIR_POLICY,
      originalJobKey: original.jobKey,
      rawResponse: request.repair.originalRawResponse,
      parserError: request.repair.parserError,
    }),
    promptHash: request.promptHash,
    renderedHash: request.renderedContextHash,
    dependsOn: original.jobKey,
  });
}

export type LoadedRepairWaves = {
  ref: ArtifactRef;
  wave: RepairWave;
  jobs: BatchJob[];
  requests: RepairRequest[];
};
export async function loadRepairWaves(
  root: string,
  path: string,
  runManifest: ArtifactRef,
  baseJobs: BatchJob[],
  visited = new Set<string>(),
): Promise<LoadedRepairWaves> {
  if (visited.has(path) || visited.size >= 1000)
    throw new Error('Repair wave cycle/depth limit');
  visited.add(path);
  const prefix = runManifest.path.slice(0, runManifest.path.lastIndexOf('/'));
  if (!path.startsWith(`${prefix}/repairs/`))
    throw new Error('Repair wave is outside this run');
  const waveFile = artifactPath(root, path);
  if (statSync(waveFile).size > 16 * 1024 * 1024)
    throw new Error('Repair manifest exceeds cap');
  const bytes = readFileSync(waveFile);
  const ref = { path, sha256: hashBytes(bytes) };
  const wave = RepairWaveSchema.parse(
    JSON.parse(bytes.toString('utf8')) as unknown,
  );
  const baseManifest = JSON.parse(
    readArtifact(root, runManifest).toString('utf8'),
  ) as { runId: string };
  if (wave.runId !== baseManifest.runId)
    throw new Error('Repair wave run ID mismatch');
  if (canonicalJson(wave.runManifest) !== canonicalJson(runManifest))
    throw new Error('Repair wave run binding mismatch');
  const jobs = BatchScheduleSchema.parse({
    schemaVersion: 1,
    task: 'db4_batch_schedule',
    runId: wave.runId,
    waveId: 'format-repair',
    createdAt: wave.createdAt,
    jobs: wave.jobs,
  }).jobs;
  if (jobs.length !== wave.count)
    throw new Error('Repair wave denominator mismatch');
  const parents = wave.parent
    ? await loadRepairWaves(
        root,
        wave.parent.path,
        runManifest,
        baseJobs,
        visited,
      )
    : null;
  if (
    parents &&
    (parents.ref.sha256 !== wave.parent!.sha256 ||
      parents.wave.runId !== wave.runId)
  )
    throw new Error('Repair parent binding mismatch');
  if (parents && canonicalJson(parents.wave.git) !== canonicalJson(wave.git))
    throw new Error('Repair parent source pin mismatch');
  const allJobs = [...(parents?.jobs ?? [])];
  const allRequests = [...(parents?.requests ?? [])];
  const usedTargets = new Set(allJobs.map((job) => job.targetKey));
  const byJob = new Map(jobs.map((job) => [job.jobKey, job]));
  const originals = new Map(baseJobs.map((job) => [job.jobKey, job]));
  const validations = new Map<string, Record<string, unknown>>();
  for (const phase of ['r1', 'r2'] as const) {
    const validation = JSON.parse(
      readArtifact(root, wave.originalValidations[phase]).toString('utf8'),
    ) as {
      runId: string;
      phase: string;
      runManifest: ArtifactRef;
      results: ArtifactRef;
    };
    if (
      validation.runId !== wave.runId ||
      validation.phase !== phase ||
      canonicalJson(validation.runManifest) !== canonicalJson(runManifest)
    )
      throw new Error('Repair original validation is foreign');
    await scanBatchJsonl(
      root,
      validation.results,
      z.record(z.unknown()),
      'Original repair validation',
      (row) => {
        if (typeof row.jobKey !== 'string' || validations.has(row.jobKey))
          throw new Error('Duplicate validation identity');
        validations.set(row.jobKey, row);
      },
    );
  }
  const requestCount = await scanBatchJsonl(
    root,
    wave.requests,
    RepairRequestSchema,
    'Repair requests',
    (request) => {
      const job = byJob.get(request.jobKey);
      const original = originals.get(request.repair.originalJobKey);
      const rejected = validations.get(request.repair.originalJobKey);
      const raw = readArtifact(root, request.repair.originalRawResponse);
      if (
        !job ||
        !original ||
        original.kind !== 'review' ||
        !rejected ||
        rejected.state !== 'invalid_output' ||
        rejected.targetKey !== original.targetKey ||
        rejected.senseKey !== original.senseKey ||
        rejected.phase !== original.phase ||
        canonicalJson(rejected.rawResponse) !==
          canonicalJson(request.repair.originalRawResponse) ||
        raw.toString('utf8') !== request.repair.originalRawText ||
        usedTargets.has(request.targetKey) ||
        request.targetKey !== original.targetKey ||
        request.senseKey !== original.senseKey ||
        request.phase !== original.phase ||
        request.payload.phase !== original.phase ||
        request.payload.promptVersion !== request.promptVersion ||
        request.generation !== original.generation ||
        request.bundleKey !== original.bundleKey ||
        request.repair.originalPromptHash !== original.promptHash ||
        request.repair.originalRenderedHash !== original.renderedHash ||
        request.dependencyJobKey !== original.jobKey ||
        hashJson(request.payload) !== original.renderedHash ||
        request.promptHash !==
          hashJson({
            originalPromptHash: original.promptHash,
            policyVersion: FORMAT_REPAIR_POLICY,
          }) ||
        request.renderedContextHash !==
          hashJson({ payload: request.payload, repair: request.repair }) ||
        canonicalJson(job) !==
          canonicalJson(repairJob(wave.runId, original, request))
      )
        throw new Error(
          'Repair request binding or one-repair-per-target limit violated',
        );
      const bundle = renderedIntegrityBundle(request.payload.bundle);
      // The original output must still fail D1/order. A valid semantic answer cannot be repaired.
      let invalid = false;
      try {
        const parsed = parseMappingOutput(
          cleanReply(request.repair.originalRawText),
          bundle,
        );
        invalid =
          canonicalJson(parsed.reviews.map((row) => row.candidateKey)) !==
          canonicalJson(
            request.payload.bundle.candidates.map((row) => row.candidateKey),
          );
      } catch {
        invalid = true;
      }
      if (!invalid) throw new Error('Format repair original is already valid');
      usedTargets.add(request.targetKey);
      allJobs.push(job);
      allRequests.push(request);
    },
  );
  if (requestCount !== wave.count || allJobs.length !== usedTargets.size)
    throw new Error('Repair request denominator mismatch');
  return { ref, wave, jobs: allJobs, requests: allRequests };
}
