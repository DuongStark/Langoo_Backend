import { z } from 'zod';
import {
  ArtifactRefSchema,
  Count,
  Positive,
  Sha256Schema,
  Text,
  Timestamp,
  assertSorted,
  assertUnique,
  canonicalJson,
  hashJson,
  mappingTargetKey,
} from './_primitives';

const phase = z.enum(['r1', 'r2']);
const ProviderSchema = z
  .object({
    provider: z.enum(['stub', 'openai-compatible']),
    model: Text,
    endpoint: z
      .string()
      .url()
      .refine((s) => {
        const u = new URL(s);
        return (
          ['https:', 'http:'].includes(u.protocol) &&
          !u.username &&
          !u.password &&
          !u.search &&
          !u.hash
        );
      })
      .nullable(),
    protocol: z.enum(['stub', 'chat-completions', 'responses']),
    promptVersion: Text,
    responseSchemaVersion: z.literal(1),
    reasoningConfig: z
      .object({ effort: Text.nullable(), maxTokens: Count })
      .strict(),
    sessionId: Text,
    rate: z
      .object({
        inputMicrousdPerMillion: Count,
        outputMicrousdPerMillion: Count,
        reasoningMicrousdPerMillion: Count,
        verifiedAt: Timestamp,
        evidence: ArtifactRefSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (
      (p.provider === 'stub') !== (p.protocol === 'stub') ||
      (p.provider === 'stub') !== (p.endpoint === null)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Provider/protocol/endpoint mismatch',
      });
  });
export const MappingProviderSchema = ProviderSchema;
export type MappingProvider = z.infer<typeof ProviderSchema>;
export function mappingCacheKey(
  provider: MappingProvider,
  reviewPhase: 'r1' | 'r2',
  renderedContextHash: string,
): string {
  ProviderSchema.parse(provider);
  phase.parse(reviewPhase);
  Sha256Schema.parse(renderedContextHash);
  return hashJson({
    schemaVersion: 1,
    family: 'db4-provider-cache',
    phase: reviewPhase,
    provider: provider.provider,
    endpoint: provider.endpoint,
    model: provider.model,
    protocol: provider.protocol,
    promptVersion: provider.promptVersion,
    renderedContextHash,
    responseSchemaVersion: provider.responseSchemaVersion,
    reasoningConfig: provider.reasoningConfig,
  });
}
export const TargetStateSchema = z.enum([
  'queued',
  'r1_running',
  'r1_received',
  'r1_validated',
  'r2_running',
  'r2_received',
  'r2_validated',
  'decision_ready',
  'awaiting_audit',
  'eligible',
  'imported',
  'promoted',
  'blocked',
  'rejected',
  'deferred',
  'error',
  'stale',
]);
export type TargetState = z.infer<typeof TargetStateSchema>;
const pipeline: TargetState[] = [
  'queued',
  'r1_running',
  'r1_received',
  'r1_validated',
  'r2_running',
  'r2_received',
  'r2_validated',
  'decision_ready',
  'awaiting_audit',
  'eligible',
  'imported',
  'promoted',
];
export function assertTargetTransition(
  from: TargetState,
  to: TargetState,
): void {
  TargetStateSchema.parse(from);
  TargetStateSchema.parse(to);
  const index = pipeline.indexOf(from);
  const terminal = ['blocked', 'rejected', 'deferred', 'error', 'stale'];
  const forward =
    index >= 0 && index < pipeline.length - 1 && pipeline[index + 1] === to;
  const retry =
    (from === 'r1_received' && to === 'r1_running') ||
    (from === 'r2_received' && to === 'r2_running') ||
    (from === to && ['r1_running', 'r2_running'].includes(from));
  const cacheHit =
    (from === 'queued' && to === 'r1_received') ||
    (from === 'r1_validated' && to === 'r2_received');
  const branch =
    index >= 0 &&
    from !== 'promoted' &&
    terminal.includes(to) &&
    (to !== 'rejected' || index >= pipeline.indexOf('decision_ready'));
  if (
    !forward &&
    !retry &&
    !cacheHit &&
    !branch &&
    !(to === 'stale' && from !== 'stale')
  )
    throw new Error(`Illegal target transition ${from} -> ${to}`);
}
const UsageSchema = z.object({ tokens: Count, costMicrousd: Count }).strict();
const ReservationSchema = z
  .object({
    inputTokens: Count,
    outputTokens: Count,
    reasoningTokens: Count,
    tokens: Count,
    costMicrousd: Count,
  })
  .strict();
export type MappingReservation = z.infer<typeof ReservationSchema>;
export function createMappingReservation(
  providerValue: unknown,
  limitsValue: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
  },
) {
  const provider = ProviderSchema.parse(providerValue);
  const limits = z
    .object({
      inputTokens: Count,
      outputTokens: Positive,
      reasoningTokens: Count,
    })
    .strict()
    .parse(limitsValue);
  const tokens = Positive.parse(
    limits.inputTokens + limits.outputTokens + limits.reasoningTokens,
  );
  const numerator =
    BigInt(limits.inputTokens) * BigInt(provider.rate.inputMicrousdPerMillion) +
    BigInt(limits.outputTokens) *
      BigInt(provider.rate.outputMicrousdPerMillion) +
    BigInt(limits.reasoningTokens) *
      BigInt(provider.rate.reasoningMicrousdPerMillion);
  const costMicrousd = Count.parse(Number((numerator + 999999n) / 1000000n));
  return { ...limits, tokens, costMicrousd };
}
export const MappingAttemptSchema = z
  .object({
    index: Positive,
    phase,
    kind: z.enum(['review', 'preflight', 'cache']),
    cacheOrigin: ArtifactRefSchema.nullable(),
    targetKey: Sha256Schema.nullable(),
    renderedContextHash: Sha256Schema,
    cacheKey: Sha256Schema,
    startedAt: Timestamp,
    finishedAt: Timestamp.nullable(),
    outcome: z.enum(['in_flight', 'response', 'unknown', 'failed']),
    retryReason: Text.nullable(),
    reservation: ReservationSchema,
    actualUsage: UsageSchema.nullable(),
    rawResponse: ArtifactRefSchema.nullable(),
    validatedOutput: ArtifactRefSchema.nullable(),
  })
  .strict();
const EntrySchema = z
  .object({
    targetKey: Sha256Schema,
    senseKey: Text,
    bundleKey: Sha256Schema,
    contextHash: Sha256Schema,
    bundle: ArtifactRefSchema,
    renderedR1: Sha256Schema,
    renderedR2: Sha256Schema,
    state: TargetStateSchema,
    decision: ArtifactRefSchema.nullable(),
    audit: ArtifactRefSchema.nullable(),
    gate: ArtifactRefSchema.nullable(),
    journal: ArtifactRefSchema.nullable(),
    reason: Text.nullable(),
  })
  .strict();
export type MappingAttempt = z.infer<typeof MappingAttemptSchema>;
const JobConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    task: z.literal('sense_concept_review'),
    mode: z.enum(['fixture', 'production']),
    semanticInputFingerprint: Sha256Schema,
    snapshot: ArtifactRefSchema,
    pilotManifest: ArtifactRefSchema,
    providers: z.object({ r1: ProviderSchema, r2: ProviderSchema }).strict(),
    policyVersions: z
      .object({ source: Text, retrieval: Text, decision: Text, audit: Text })
      .strict(),
    seed: Text,
    caps: z
      .object({
        maxRequests: Positive,
        maxTokens: Positive,
        maxCostMicrousd: Count,
        maxOutputTokens: Positive,
        maxContextBytes: Positive,
        maxRetries: z.number().int().min(0).max(2),
        concurrency: z.literal(1),
      })
      .strict(),
  })
  .strict();
export const MappingJobSchema = JobConfigSchema.extend({
  jobKey: Sha256Schema,
  entries: z.array(EntrySchema).min(1),
  attempts: z.array(MappingAttemptSchema),
  children: z.array(
    z
      .object({
        key: Text,
        journal: ArtifactRefSchema,
        state: z.enum([
          'registered',
          'prepared',
          'applied',
          'verified',
          'rolled_back',
          'error',
        ]),
      })
      .strict(),
  ),
  status: z.enum([
    'prepared',
    'running',
    'awaiting_audit',
    'budget_exhausted',
    'completed',
    'failed',
    'stale',
  ]),
}).strict();
export type MappingJob = z.infer<typeof MappingJobSchema>;
export type MappingJobConfig = z.infer<typeof JobConfigSchema>;
export type MappingJobEntry = z.infer<typeof EntrySchema>;
export const MappingRunStatusSchema = z.enum([
  'running',
  'dry_run',
  'completed',
  'failed',
  'rolled_back',
]);
export function jobBudgetUsage(job: MappingJob) {
  return job.attempts.reduce(
    (usage, a) => ({
      requests: usage.requests + (a.kind === 'cache' ? 0 : 1),
      tokens: usage.tokens + (a.actualUsage?.tokens ?? a.reservation.tokens),
      costMicrousd:
        usage.costMicrousd +
        (a.actualUsage?.costMicrousd ?? a.reservation.costMicrousd),
      unknownRequests:
        usage.unknownRequests + (a.outcome === 'unknown' ? 1 : 0),
    }),
    { requests: 0, tokens: 0, costMicrousd: 0, unknownRequests: 0 },
  );
}
function jobKeyFor(
  config: MappingJobConfig,
  entries: MappingJobEntry[],
): string {
  return hashJson({
    family: 'db4-job',
    config,
    entries: entries.map(
      ({
        targetKey,
        senseKey,
        bundleKey,
        contextHash,
        bundle,
        renderedR1,
        renderedR2,
      }) => ({
        targetKey,
        senseKey,
        bundleKey,
        contextHash,
        bundle,
        renderedR1,
        renderedR2,
      }),
    ),
  });
}
export function createMappingJob(
  configValue: unknown,
  entriesValue: unknown,
): MappingJob {
  canonicalJson(configValue);
  canonicalJson(entriesValue);
  const config = JobConfigSchema.parse(configValue);
  const entries = z.array(EntrySchema).min(1).parse(entriesValue);
  if (
    entries.some(
      (e) =>
        e.state !== 'queued' ||
        e.decision ||
        e.audit ||
        e.gate ||
        e.journal ||
        e.reason,
    )
  )
    throw new Error('New job must have clean queued entries');
  return parseMappingJob({
    ...config,
    jobKey: jobKeyFor(config, entries),
    entries,
    attempts: [],
    children: [],
    status: 'prepared',
  });
}
export function parseMappingJob(value: unknown): MappingJob {
  canonicalJson(value);
  const job = MappingJobSchema.parse(value);
  const {
    jobKey,
    entries,
    attempts,
    children: _children,
    status: _status,
    ...config
  } = job;
  void _children;
  void _status;
  assertSorted(
    entries.map((e) => e.targetKey),
    'job target keys',
  );
  assertUnique(
    entries.map((e) => e.senseKey),
    'job senses',
  );
  assertUnique(
    job.children.map((c) => c.key),
    'child journal keys',
  );
  if (jobKey !== jobKeyFor(config, entries))
    throw new Error('Job configuration/target hash mismatch');
  if (
    entries.some(
      (e) =>
        e.targetKey !==
        mappingTargetKey(e.senseKey, job.semanticInputFingerprint),
    )
  )
    throw new Error('Target key is not bound to sense/snapshot');
  if (job.providers.r1.sessionId === job.providers.r2.sessionId)
    throw new Error('R1/R2 sessions must be separate');
  if (attempts.filter((a) => a.outcome === 'in_flight').length > 1)
    throw new Error('Pilot concurrency exceeds one');
  const budget = jobBudgetUsage(job);
  if (
    !Number.isSafeInteger(budget.tokens) ||
    !Number.isSafeInteger(budget.costMicrousd) ||
    budget.requests > job.caps.maxRequests ||
    budget.tokens > job.caps.maxTokens ||
    budget.costMicrousd > job.caps.maxCostMicrousd
  )
    throw new Error('Job budget exceeded');
  for (const [i, a] of attempts.entries()) {
    const previous = attempts[i - 1];
    if (previous?.outcome === 'unknown')
      throw new Error('Dispatch after unresolved dispatch');
    if (
      previous &&
      (!previous.finishedAt ||
        Date.parse(a.startedAt) < Date.parse(previous.finishedAt))
    )
      throw new Error('Overlapping or out-of-order attempts');
    if (a.index !== i + 1)
      throw new Error('Attempt indices must be contiguous and monotonic');
    if (a.kind === 'cache') {
      if (
        !a.cacheOrigin ||
        a.outcome !== 'response' ||
        !a.validatedOutput ||
        !a.actualUsage ||
        Object.values(a.reservation).some((n) => n !== 0) ||
        a.actualUsage.tokens !== 0 ||
        a.actualUsage.costMicrousd !== 0
      )
        throw new Error(
          'Cache hit requires validated provenance and zero dispatch usage',
        );
    } else {
      if (a.cacheOrigin)
        throw new Error('Dispatch attempt cannot claim cache origin');
      const expectedReservation = createMappingReservation(
        job.providers[a.phase],
        {
          inputTokens: a.reservation.inputTokens,
          outputTokens: a.reservation.outputTokens,
          reasoningTokens: a.reservation.reasoningTokens,
        },
      );
      if (
        a.reservation.tokens !== expectedReservation.tokens ||
        a.reservation.costMicrousd < expectedReservation.costMicrousd ||
        a.reservation.outputTokens !== job.caps.maxOutputTokens ||
        a.reservation.reasoningTokens <
          job.providers[a.phase].reasoningConfig.maxTokens
      )
        throw new Error('Insufficient/inconsistent request reservation');
    }
    const entry = entries.find((e) => e.targetKey === a.targetKey);
    if (
      (a.kind !== 'preflight' && !entry) ||
      (a.kind === 'preflight' && a.targetKey !== null)
    )
      throw new Error('Unbound attempt target');
    const rendered = entry
      ? a.phase === 'r1'
        ? entry.renderedR1
        : entry.renderedR2
      : a.renderedContextHash;
    if (
      rendered !== a.renderedContextHash ||
      a.cacheKey !== mappingCacheKey(job.providers[a.phase], a.phase, rendered)
    )
      throw new Error('Attempt phase/render/cache mismatch');
    if (
      (a.outcome === 'in_flight') !== (a.finishedAt === null) ||
      (a.finishedAt && Date.parse(a.finishedAt) < Date.parse(a.startedAt))
    )
      throw new Error('Invalid attempt times');
    if (
      (a.outcome === 'response') !== (a.rawResponse !== null) ||
      (a.validatedOutput && a.outcome !== 'response')
    )
      throw new Error('Attempt response/output mismatch');
    if (
      (a.outcome === 'in_flight' || a.outcome === 'unknown') &&
      a.actualUsage !== null
    )
      throw new Error('Unknown dispatch must keep reservation');
    if (
      a.actualUsage &&
      (a.actualUsage.tokens > a.reservation.tokens ||
        a.actualUsage.costMicrousd > a.reservation.costMicrousd)
    )
      throw new Error('Actual usage exceeded reserved upper bound');
    const preceding = attempts
      .slice(0, i)
      .filter(
        (p) =>
          (p.kind === 'preflight') === (a.kind === 'preflight') &&
          p.phase === a.phase &&
          p.targetKey === a.targetKey,
      );
    if (
      preceding.some(
        (p) =>
          p.outcome === 'unknown' ||
          p.outcome === 'in_flight' ||
          p.validatedOutput,
      )
    )
      throw new Error('Retry after unresolved dispatch or validated result');
    if (
      preceding.length > job.caps.maxRetries ||
      (preceding.length > 0 && !a.retryReason)
    )
      throw new Error('Retry policy violated');
    if (
      entry &&
      a.phase === 'r2' &&
      !attempts
        .slice(0, i)
        .some(
          (p) =>
            p.targetKey === entry.targetKey &&
            p.phase === 'r1' &&
            p.validatedOutput,
        )
    )
      throw new Error('R2 before validated R1');
  }
  for (const e of entries) {
    const perTarget = attempts.filter(
      (a) => a.targetKey === e.targetKey && a.kind !== 'preflight',
    );
    const latest = (p: 'r1' | 'r2') =>
      perTarget.filter((a) => a.phase === p).at(-1);
    const step = pipeline.indexOf(e.state);
    for (const p of ['r1', 'r2'] as const) {
      const a = latest(p);
      if (e.state === `${p}_running` && a?.outcome !== 'in_flight')
        throw new Error('Running state needs in-flight attempt');
      if (e.state === `${p}_received` && !a?.rawResponse)
        throw new Error('Received state needs response');
      const threshold = pipeline.indexOf(`${p}_validated`);
      if (step >= threshold && !a?.validatedOutput)
        throw new Error('State advanced before validation');
    }
    if (step >= pipeline.indexOf('decision_ready') && !e.decision)
      throw new Error('Missing decision artifact');
    if (step >= pipeline.indexOf('eligible') && (!e.audit || !e.gate))
      throw new Error('Eligibility requires audit and gate');
    if (step >= pipeline.indexOf('imported') && !e.journal)
      throw new Error('Import requires journal');
    if (
      ['blocked', 'rejected', 'deferred', 'error', 'stale'].includes(e.state) &&
      !e.reason
    )
      throw new Error('Terminal state needs reason');
    if (
      perTarget.some((a) => a.outcome === 'in_flight') &&
      !['r1_running', 'r2_running'].includes(e.state)
    )
      throw new Error('In-flight attempt in non-running target');
    if (e.state === 'queued' && perTarget.length)
      throw new Error('Queued target already dispatched');
  }
  if (
    job.status === 'completed' &&
    (attempts.some((a) => ['in_flight', 'unknown'].includes(a.outcome)) ||
      entries.some(
        (e) =>
          !['promoted', 'rejected', 'deferred', 'blocked'].includes(e.state),
      ))
  )
    throw new Error('Incomplete job marked completed');
  return job;
}
/** Artifact registration is runner responsibility; this checks one transition and the whole resulting checkpoint. */
export function transitionMappingTarget(
  jobValue: unknown,
  targetKey: string,
  nextState: TargetState,
  patch: {
    attempts?: MappingJob['attempts'];
    artifacts?: Partial<
      Pick<
        MappingJobEntry,
        'decision' | 'audit' | 'gate' | 'journal' | 'reason'
      >
    >;
    status?: MappingJob['status'];
  } = {},
): MappingJob {
  const job = parseMappingJob(jobValue);
  const entry = job.entries.find((e) => e.targetKey === targetKey);
  if (!entry) throw new Error('Unknown job target');
  assertTargetTransition(entry.state, nextState);
  if (
    (entry.state === 'queued' && nextState === 'r1_received') ||
    (entry.state === 'r1_validated' && nextState === 'r2_received')
  ) {
    const p = nextState === 'r1_received' ? 'r1' : 'r2';
    if (
      patch.attempts
        ?.filter((a) => a.targetKey === targetKey && a.phase === p)
        .at(-1)?.kind !== 'cache'
    )
      throw new Error('Skipping dispatch requires validated cache hit');
  }
  if (patch.attempts) {
    if (patch.attempts.length < job.attempts.length)
      throw new Error('Attempt history cannot shrink');
    for (const [i, old] of job.attempts.entries()) {
      const updated = patch.attempts[i];
      const immutable = (a: MappingJob['attempts'][number]) => ({
        index: a.index,
        phase: a.phase,
        kind: a.kind,
        cacheOrigin: a.cacheOrigin,
        targetKey: a.targetKey,
        renderedContextHash: a.renderedContextHash,
        cacheKey: a.cacheKey,
        startedAt: a.startedAt,
        retryReason: a.retryReason,
        reservation: a.reservation,
      });
      if (
        canonicalJson(immutable(old)) !== canonicalJson(immutable(updated)) ||
        (old.rawResponse &&
          canonicalJson(old.rawResponse) !==
            canonicalJson(updated.rawResponse)) ||
        (old.validatedOutput &&
          canonicalJson(old.validatedOutput) !==
            canonicalJson(updated.validatedOutput)) ||
        (old.actualUsage &&
          canonicalJson(old.actualUsage) !==
            canonicalJson(updated.actualUsage)) ||
        (old.finishedAt && old.finishedAt !== updated.finishedAt) ||
        (old.outcome !== 'in_flight' && old.outcome !== updated.outcome)
      )
        throw new Error('Attempt history cannot be overwritten');
    }
    job.attempts = patch.attempts;
  }
  if (patch.artifacts) Object.assign(entry, patch.artifacts);
  if (patch.status) job.status = patch.status;
  entry.state = nextState;
  return parseMappingJob(job);
}

export const PilotManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.enum(['fixture', 'production']),
    pilot: z.enum(['A', 'B']),
    semanticInputFingerprint: Sha256Schema,
    policyVersion: Text,
    seed: Text,
    targetKeys: z.array(Sha256Schema),
    positiveTargetKeys: z.array(Sha256Schema),
    hardNegativeTargetKeys: z.array(Sha256Schema),
    strata: z.array(
      z
        .object({
          targetKey: Sha256Schema,
          jlptLevel: z.number().int().min(1).max(5).nullable(),
          isPrimary: z.boolean(),
          lexemeKey: Text,
        })
        .strict(),
    ),
    exclusions: z.array(
      z.object({ targetKey: Sha256Schema, reason: Text }).strict(),
    ),
  })
  .strict();
export const GateSchema = z
  .object({
    schemaVersion: z.literal(1),
    pilotManifestHash: Sha256Schema,
    policyVersion: Text,
    report: ArtifactRefSchema,
    budgetReport: ArtifactRefSchema,
    targetAudits: z.array(
      z
        .object({
          targetKey: Sha256Schema,
          verdict: z.enum(['pass', 'fail', 'deferred']),
          severity: z.enum(['none', 'minor', 'severe']),
          audit: ArtifactRefSchema,
          twoPassValidated: z.boolean(),
          noCandidatesAudited: z.boolean(),
          proposalAudited: z.boolean(),
        })
        .strict(),
    ),
    budgetWithinCaps: z.boolean(),
    unknownRequests: Count,
  })
  .strict();
export type PilotManifest = z.infer<typeof PilotManifestSchema>;
export type MappingGate = z.infer<typeof GateSchema>;
export function parsePilotManifest(value: unknown) {
  canonicalJson(value);
  const manifest = PilotManifestSchema.parse(value);
  assertSorted(manifest.targetKeys, 'pilot target keys');
  assertSorted(manifest.positiveTargetKeys, 'positive target keys');
  assertSorted(manifest.hardNegativeTargetKeys, 'negative target keys');
  assertUnique(
    [...manifest.positiveTargetKeys, ...manifest.hardNegativeTargetKeys],
    'positive/negative cohorts',
  );
  assertUnique(
    manifest.strata.map((s) => s.targetKey),
    'pilot strata',
  );
  assertUnique(
    manifest.exclusions.map((s) => s.targetKey),
    'pilot exclusions',
  );
  if (
    manifest.strata.length !== manifest.targetKeys.length ||
    manifest.strata.some((s) => !manifest.targetKeys.includes(s.targetKey)) ||
    [...manifest.positiveTargetKeys, ...manifest.hardNegativeTargetKeys].some(
      (key) => !manifest.targetKeys.includes(key),
    ) ||
    manifest.exclusions.some((e) => manifest.targetKeys.includes(e.targetKey))
  )
    throw new Error('Manifest cohort/stratum binding mismatch');
  return manifest;
}
/** Computes eligibility; a caller cannot set passed=true or shrink the denominator. D5 binds report/audit file contents. */
export function evaluateMappingGate(
  manifestValue: unknown,
  gateValue: unknown,
) {
  const manifest = parsePilotManifest(manifestValue);
  canonicalJson(gateValue);
  const gate = GateSchema.parse(gateValue);
  if (
    gate.pilotManifestHash !== hashJson(manifest) ||
    gate.policyVersion !== manifest.policyVersion
  )
    throw new Error('Gate manifest/policy mismatch');
  assertUnique(
    gate.targetAudits.map((a) => a.targetKey),
    'gate audits',
  );
  if (
    gate.targetAudits.length !== manifest.targetKeys.length ||
    gate.targetAudits.some((a) => !manifest.targetKeys.includes(a.targetKey))
  )
    throw new Error('Gate audit denominator mismatch');
  if (
    gate.targetAudits.some(
      (a) => a.verdict === 'pass' && a.severity === 'severe',
    )
  )
    throw new Error('Severe audit cannot pass');
  const pass = gate.targetAudits.filter((a) => a.verdict === 'pass').length;
  const severe = gate.targetAudits.filter(
    (a) => a.severity === 'severe',
  ).length;
  const positivePass = gate.targetAudits.filter(
    (a) =>
      manifest.positiveTargetKeys.includes(a.targetKey) && a.verdict === 'pass',
  ).length;
  const reasons: string[] = [];
  if (manifest.mode === 'fixture') reasons.push('fixture_only');
  if (
    manifest.pilot === 'A' &&
    (manifest.targetKeys.length !== 100 || pass < 98)
  )
    reasons.push('pilot_a_sample_or_accuracy');
  if (
    manifest.pilot === 'B' &&
    (manifest.positiveTargetKeys.length < 100 ||
      manifest.hardNegativeTargetKeys.length < 50 ||
      positivePass / manifest.positiveTargetKeys.length < 0.99)
  )
    reasons.push('pilot_b_sample_or_precision');
  if (severe) reasons.push('severe_error');
  if (
    gate.targetAudits.some(
      (a) =>
        (!a.twoPassValidated && !a.noCandidatesAudited) || !a.proposalAudited,
    )
  )
    reasons.push('incomplete_audit');
  if (!gate.budgetWithinCaps || gate.unknownRequests)
    reasons.push('budget_or_unknown_usage');
  return {
    eligible: reasons.length === 0,
    reasons,
    targets: manifest.targetKeys.length,
    pass,
    severe,
    positiveTargets: manifest.positiveTargetKeys.length,
    positivePass,
  };
}
