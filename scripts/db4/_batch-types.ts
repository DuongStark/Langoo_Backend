// DB4-D4/D5: orchestration contracts for resumable offline mapping batches.
// These records wrap D1 artifacts; they do not change D1 or authorize DB writes.
import { z } from 'zod';
import {
  ArtifactRefSchema,
  Count,
  Sha256Schema,
  Text,
  Timestamp,
  canonicalJson,
  hashJson,
} from './_mapping-types';

const Slug = z
  .string()
  .min(1)
  .max(96)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
const Level = z.number().int().min(1).max(5).nullable();
const PositiveCount = z.number().int().positive();
const CohortStrataSchema = z
  .object({
    level: Level,
    posFamily: z.enum([
      'noun',
      'verb',
      'adjective_adverb',
      'expression',
      'other',
    ]),
    glossCount: z.enum(['zero', 'one', 'multiple']),
    fieldInfo: z.enum(['present', 'absent']),
    originalStatus: z.enum(['unlinked', 'existing_nonexact', 'existing_exact']),
  })
  .strict();

export const BatchManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    task: z.literal('db4_automated_mapping_batch'),
    runId: Slug,
    createdAt: Timestamp,
    mode: z.literal('shadow'),
    apply: z.literal(false),
    promotionReady: z.literal(false),
    git: z
      .object({
        revision: z.string().regex(/^[0-9a-f]{7,40}$/),
        dirtySourceSha256: Sha256Schema.nullable(),
      })
      .strict(),
    snapshot: ArtifactRefSchema,
    cohort: z
      .object({
        selectorVersion: Text,
        seed: Text,
        population: ArtifactRefSchema,
        selected: ArtifactRefSchema,
        sampling: ArtifactRefSchema,
        counts: z
          .object({
            population: Count,
            selected: Count,
            development: Count,
            holdout: Count,
            shards: PositiveCount,
          })
          .strict(),
      })
      .strict(),
    sources: z
      .object({
        cohortExport: ArtifactRefSchema,
        export: ArtifactRefSchema,
        audit: ArtifactRefSchema,
      })
      .strict(),
    retrieval: z
      .object({
        generationManifest: ArtifactRefSchema,
        searchManifest: ArtifactRefSchema,
        candidates: ArtifactRefSchema,
        bundles: ArtifactRefSchema,
        statuses: ArtifactRefSchema,
        readyCount: Count,
        noCandidateCount: Count,
      })
      .strict(),
    prompt: z
      .object({
        revision: z.enum(['v1', 'v2', 'v2.1']),
        system: ArtifactRefSchema,
        r1: ArtifactRefSchema,
        r2: ArtifactRefSchema,
      })
      .strict(),
    artifacts: z
      .object({
        preparationIntent: ArtifactRefSchema,
        targets: ArtifactRefSchema,
        schedule: ArtifactRefSchema,
        initialTargetResults: ArtifactRefSchema,
        preparationReport: ArtifactRefSchema,
      })
      .strict(),
    versions: z
      .object({
        retrieval: Text,
        prompt: Text,
        adapter: Text,
        decision: Text,
        audit: Text,
      })
      .strict(),
    caps: z
      .object({
        selectedTargets: z.number().int().min(1).max(1000),
        shardTargets: z.number().int().min(1).max(100),
        generationTargets: z.number().int().min(1).max(500),
        artifactBytes: z
          .number()
          .int()
          .positive()
          .max(64 * 1024 * 1024),
        workers: z.number().int().min(1).max(8),
        semanticGenerations: z.literal(2),
        formatRepairsPerTarget: z.literal(1),
        expansionsPerTarget: z.literal(1),
        mappingDispatches: z.number().int().min(1).max(5000),
        auditDispatches: z.number().int().min(0).max(250),
        requestTimeoutSeconds: z.number().int().min(30).max(240),
      })
      .strict(),
    shards: z
      .array(
        z
          .object({
            shardId: Slug,
            targets: ArtifactRefSchema,
            candidates: ArtifactRefSchema,
            requests: z
              .object({ r1: ArtifactRefSchema, r2: ArtifactRefSchema })
              .strict(),
            readyCount: Count,
            noCandidateCount: Count,
            count: z.number().int().min(1).max(100),
          })
          .strict(),
      )
      .min(1)
      .max(10),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const ids = manifest.shards.map((shard) => shard.shardId);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate shard id' });
    const shardTotal = manifest.shards.reduce(
      (total, shard) => total + shard.count,
      0,
    );
    if (
      shardTotal !== manifest.cohort.counts.selected ||
      shardTotal !== manifest.caps.selectedTargets ||
      manifest.shards.length !== manifest.cohort.counts.shards ||
      manifest.cohort.counts.development + manifest.cohort.counts.holdout !==
        manifest.cohort.counts.selected
    )
      ctx.addIssue({ code: 'custom', message: 'Batch denominator mismatch' });
    if (
      manifest.retrieval.readyCount + manifest.retrieval.noCandidateCount !==
      manifest.cohort.counts.selected
    )
      ctx.addIssue({
        code: 'custom',
        path: ['retrieval'],
        message: 'Retrieval status denominator mismatch',
      });
    if (
      manifest.caps.shardTargets > manifest.caps.generationTargets ||
      manifest.caps.mappingDispatches < manifest.cohort.counts.selected
    )
      ctx.addIssue({ code: 'custom', message: 'Inconsistent batch caps' });
  });
export type BatchManifest = z.infer<typeof BatchManifestSchema>;

export const BatchTargetSchema = z
  .object({
    targetKey: Sha256Schema,
    senseKey: Text,
    senseId: z.string().regex(/^[1-9][0-9]*$/),
    lexemeId: z.string().regex(/^[1-9][0-9]*$/),
    lexemeKey: Text,
    level: Level,
    pos: z.array(Text),
    enGlossCount: Count,
    hasFieldInfo: z.boolean(),
    hasExistingExact: z.boolean(),
    originalStatus: z.enum(['unlinked', 'existing_nonexact', 'existing_exact']),
    strata: CohortStrataSchema,
    sourceRef: z
      .object({
        file: ArtifactRefSchema,
        line: PositiveCount,
        rowSha256: Sha256Schema,
      })
      .strict(),
    split: z.enum(['development', 'holdout']),
    shardId: Slug,
  })
  .strict()
  .superRefine((target, ctx) => {
    if (
      target.hasExistingExact !==
      (target.originalStatus === 'existing_exact')
    )
      ctx.addIssue({
        code: 'custom',
        path: ['originalStatus'],
        message: 'Existing exact status does not match link flag',
      });
    if (
      target.strata.level !== target.level ||
      target.strata.originalStatus !== target.originalStatus ||
      target.strata.fieldInfo !==
        (target.hasFieldInfo ? 'present' : 'absent') ||
      target.strata.glossCount !==
        (target.enGlossCount === 0
          ? 'zero'
          : target.enGlossCount > 1
            ? 'multiple'
            : 'one')
    )
      ctx.addIssue({
        code: 'custom',
        path: ['strata'],
        message: 'Target strata do not match the source summary',
      });
  });
export type BatchTarget = z.infer<typeof BatchTargetSchema>;

export const BatchScheduleSchema = z
  .object({
    schemaVersion: z.literal(1),
    task: z.literal('db4_batch_schedule'),
    runId: Slug,
    waveId: Slug,
    createdAt: Timestamp,
    jobs: z
      .array(
        z
          .object({
            jobKey: Sha256Schema,
            targetKey: Sha256Schema,
            senseKey: Text,
            shardId: Slug,
            generation: z.number().int().min(1).max(2),
            kind: z.enum(['review', 'format_repair', 'audit']),
            phase: z.enum(['r1', 'r2']).nullable(),
            attempt: z.number().int().min(1).max(2),
            bundleKey: Sha256Schema.nullable(),
            inputHash: Sha256Schema,
            promptHash: Sha256Schema,
            renderedHash: Sha256Schema.nullable(),
            dependsOn: Sha256Schema.nullable(),
            dispatchBudget: z.literal(1),
          })
          .strict(),
      )
      .max(5000),
  })
  .strict()
  .superRefine((schedule, ctx) => {
    const jobKeys = schedule.jobs.map((job) => job.jobKey);
    if (new Set(jobKeys).size !== jobKeys.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate batch job key' });
    for (const [index, job] of schedule.jobs.entries()) {
      if ((job.kind === 'audit') !== (job.phase === null))
        ctx.addIssue({
          code: 'custom',
          path: ['jobs', index, 'phase'],
          message: 'Audit jobs have no mapping phase; mapping jobs require one',
        });
      if (job.kind === 'format_repair' && !job.dependsOn)
        ctx.addIssue({
          code: 'custom',
          path: ['jobs', index, 'dependsOn'],
          message: 'Format repair must bind its original request',
        });
    }
  });
export type BatchSchedule = z.infer<typeof BatchScheduleSchema>;
export type BatchJob = BatchSchedule['jobs'][number];

export function createBatchJob(
  runId: string,
  input: Omit<BatchJob, 'jobKey' | 'dispatchBudget'>,
): BatchJob {
  const identity = {
    runId: Slug.parse(runId),
    targetKey: Sha256Schema.parse(input.targetKey),
    generation: input.generation,
    kind: input.kind,
    phase: input.phase,
    attempt: input.attempt,
    inputHash: Sha256Schema.parse(input.inputHash),
    promptHash: Sha256Schema.parse(input.promptHash),
  };
  return {
    ...input,
    dispatchBudget: 1,
    jobKey: hashJson({ schemaVersion: 1, task: 'db4_batch_job', ...identity }),
  };
}

export const BatchEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    task: z.literal('db4_batch_event'),
    runId: Slug,
    sequence: Count,
    eventId: Sha256Schema,
    previousEventSha256: Sha256Schema.nullable(),
    eventSha256: Sha256Schema,
    at: Timestamp,
    jobKey: Sha256Schema.nullable(),
    type: z.enum([
      'run_started',
      'job_planned',
      'dispatch_intent_persisted',
      'dispatch_acknowledged',
      'transport_unknown',
      'response_saved',
      'response_validated',
      'response_invalid',
      'job_skipped',
      'breaker_opened',
      'breaker_recovered',
      'breaker_cleared',
      'run_paused',
      'run_finalized',
    ]),
    details: z.record(
      z.union([z.boolean(), z.number().finite(), z.string().max(512)]),
    ),
  })
  .strict()
  .superRefine((event, ctx) => {
    const forbidden =
      /(?:api.?key|secret|credential|cookie|authorization|password|session.?id|token)/i;
    for (const key of Object.keys(event.details))
      if (forbidden.test(key))
        ctx.addIssue({
          code: 'custom',
          path: ['details', key],
          message: 'Sensitive values are not allowed in public batch events',
        });
  });
export type BatchEvent = z.infer<typeof BatchEventSchema>;

function batchEventHash(event: Omit<BatchEvent, 'eventSha256'>): string {
  return hashJson({ family: 'db4_batch_event_content', event });
}
function batchEventId(
  event: Omit<BatchEvent, 'eventId' | 'eventSha256'>,
): string {
  return hashJson({ family: 'db4_batch_event_id', event });
}

export function createBatchEvent(
  input: Omit<BatchEvent, 'schemaVersion' | 'task' | 'eventId' | 'eventSha256'>,
): BatchEvent {
  const content = {
    schemaVersion: 1 as const,
    task: 'db4_batch_event' as const,
    ...input,
  };
  const eventId = batchEventId(content);
  const withId = { ...content, eventId };
  return BatchEventSchema.parse({
    ...withId,
    eventSha256: batchEventHash(withId),
  });
}

export function verifyBatchEventChain(values: unknown[]): BatchEvent[] {
  const events = values.map((value) => BatchEventSchema.parse(value));
  let previous: string | null = null;
  events.forEach((event, index) => {
    const { eventId: _eventId, eventSha256: _eventSha256, ...identity } = event;
    void _eventId;
    void _eventSha256;
    if (
      event.sequence !== index ||
      event.previousEventSha256 !== previous ||
      event.eventId !== batchEventId(identity)
    )
      throw new Error('Batch event sequence/link mismatch');
    const { eventSha256: _contentSha256, ...content } = event;
    void _contentSha256;
    if (event.eventSha256 !== batchEventHash(content))
      throw new Error('Batch event hash mismatch');
    if (index > 0 && event.runId !== events[0].runId)
      throw new Error('Batch event belongs to another run');
    previous = event.eventSha256;
  });
  return events;
}

export const BatchTargetResultSchema = z
  .object({
    runId: Slug,
    targetKey: Sha256Schema,
    senseKey: Text,
    status: z.enum([
      'pending',
      'blocked_source',
      'source_identity_lane',
      'existing_exact_requires_audit',
      'no_candidates',
      'r1_pending',
      'r2_pending',
      'expansion_pending',
      'audit_pending',
      'proposed_exact',
      'proposed_nonexact',
      'unresolved_no_exact',
      'unresolved_ambiguous',
      'unresolved_compound',
      'unresolved_disagreement',
      'unresolved_invalid_output',
      'transport_unknown',
      'blocked_transport',
      'unaudited',
      'audit_pass',
      'audit_fail',
      'audit_deferred',
      'stale_input',
      'budget_exhausted',
    ]),
    finalGeneration: z.number().int().min(1).max(2).nullable(),
    d1Decision: ArtifactRefSchema.nullable(),
    auditResult: ArtifactRefSchema.nullable(),
    reason: Text.nullable(),
  })
  .strict();
export type BatchTargetResult = z.infer<typeof BatchTargetResultSchema>;

export function canonicalBatchRecord(value: unknown): string {
  return canonicalJson(value);
}
