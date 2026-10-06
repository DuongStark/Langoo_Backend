import { createHash } from 'node:crypto';
import { z } from 'zod';

/** Frozen DB3-B artifact contract. A new incompatible shape needs a new version. */
export const GLOSS_SCHEMA_VERSION = 1 as const;
export const BigintIdSchema = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .refine(
    (id) =>
      id.length <= 19 &&
      /^[1-9][0-9]*$/.test(id) &&
      BigInt(id) <= 9223372036854775807n,
    'ID exceeds PG bigint',
  );
export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().refine((s) => s.trim().length > 0, 'Empty text');
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positive = integer.refine((n) => n > 0, 'Must be positive');
const rank = z.number().int().min(1).max(32767);
const language = z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]+)*$/);
const url = z
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
  }, 'URL must not contain credentials/query/fragment');
const artifactPath = text.refine(
  (s) =>
    !s.startsWith('/') &&
    !s.includes('\\') &&
    !s.split('/').some((p) => p === '..' || p === '.' || p === ''),
  'Artifact path must be relative to artifact-dir without traversal',
);
const artifact = z
  .object({ path: artifactPath, sha256: Sha256Schema })
  .strict();

export const GlossSourceSchema = z
  .object({
    sourceId: z.number().int().positive().max(2147483647).nullable(),
    code: text,
    version: text.nullable(),
    snapshot: text.nullable(),
    sha256: Sha256Schema.nullable(),
    license: text.nullable(),
    attribution: text.nullable(),
    url: url.nullable(),
    batchIds: z.array(z.string().uuid()),
    audit: z
      .object({
        status: z.enum(['verified', 'blocked']),
        evidence: z.array(artifact),
        reasons: z.array(text),
      })
      .strict(),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (new Set(s.batchIds).size !== s.batchIds.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate source batch IDs' });
    if (
      s.audit.status === 'verified' &&
      (!s.sha256 ||
        !s.license ||
        !s.attribution ||
        !s.url ||
        (!s.version && !s.snapshot) ||
        !s.audit.evidence.length ||
        s.audit.reasons.length ||
        /CẦN XÁC MINH/i.test(s.license))
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'Verified source needs license, attribution, snapshot/version, hash and audit evidence',
      });
    if (s.audit.status === 'blocked' && !s.audit.reasons.length)
      ctx.addIssue({ code: 'custom', message: 'Blocked source needs reasons' });
  });

const senseTarget = z
  .object({
    targetType: z.literal('sense'),
    targetId: BigintIdSchema,
    semanticKey: text,
    language: language,
    lexemeId: BigintIdSchema,
    senseNo: rank,
    lemma: text,
    reading: text.nullable(),
    pos: text.nullable(),
    forms: z.array(text),
    register: text.nullable(),
    domain: text.nullable(),
    jlptLevel: z.number().int().min(1).max(5).nullable(),
    isPrimary: z.boolean(),
  })
  .strict();
const conceptTarget = z
  .object({
    targetType: z.literal('concept'),
    targetId: BigintIdSchema,
    semanticKey: text,
    ili: text.nullable(),
    synsetKeys: z.array(text),
  })
  .strict();
export const GlossTargetSchema = z.discriminatedUnion('targetType', [
  senseTarget,
  conceptTarget,
]);

const rowBase = {
  text,
  textHash: Sha256Schema,
  sourceCode: text.nullable(),
  batchId: z.string().uuid().nullable(),
};
export const GlossContextRowSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...rowBase,
      kind: z.literal('sense_gloss'),
      senseId: BigintIdSchema,
      glossId: BigintIdSchema,
      rank,
      language: z.literal('en'),
    })
    .strict(),
  z
    .object({
      ...rowBase,
      kind: z.literal('sense_definition'),
      senseId: BigintIdSchema,
      language,
    })
    .strict(),
  z
    .object({
      ...rowBase,
      kind: z.literal('concept_definition'),
      conceptId: BigintIdSchema,
      language,
    })
    .strict(),
]);
export const GlossContextSchema = z
  .object({
    context_kind: z.enum([
      'sense_gloss_en',
      'sense_definition',
      'concept_definition',
      'combined',
    ]),
    context_language: language.nullable(),
    rows: z.array(GlossContextRowSchema).min(1),
  })
  .strict();
const alignment = z
  .object({
    method: z.enum([
      'same_sense_gloss',
      'direct_source',
      'accepted_mapping',
      'existing_alignment',
      'lexical_only',
      'none',
    ]),
    // These are evidence identities, never table names or executable SQL.
    evidenceKeys: z.array(text),
  })
  .strict();
export const GlossTextSchema = text.refine(
  (s) => Array.from(s).length <= 500,
  'Gloss exceeds 500 Unicode characters',
);
const base = {
  schemaVersion: z.literal(GLOSS_SCHEMA_VERSION),
  candidateKey: Sha256Schema,
  inputHash: Sha256Schema,
  datasetFingerprint: Sha256Schema,
  target: GlossTargetSchema.nullable(),
  context: GlossContextSchema.nullable(),
  sources: z.array(GlossSourceSchema),
  alignment,
  sourceGlossVi: GlossTextSchema.nullable(),
  notes: z.array(text),
};
export const GlossCandidateSchema = z
  .discriminatedUnion('classification', [
    z
      .object({
        ...base,
        classification: z.literal('needs_translation'),
        target: GlossTargetSchema,
        context: GlossContextSchema,
        sourceGlossVi: z.null(),
        blockedReasons: z.array(text).length(0),
      })
      .strict(),
    z
      .object({
        ...base,
        classification: z.literal('eligible_source'),
        target: GlossTargetSchema,
        sourceGlossVi: GlossTextSchema,
        blockedReasons: z.array(text).length(0),
      })
      .strict(),
    z
      .object({
        ...base,
        classification: z.literal('ambiguous'),
        blockedReasons: z.array(text).min(1),
      })
      .strict(),
    z
      .object({
        ...base,
        classification: z.literal('missing_context'),
        context: z.null(),
        blockedReasons: z.array(text).min(1),
      })
      .strict(),
    z
      .object({
        ...base,
        classification: z.literal('blocked_source'),
        blockedReasons: z.array(text).min(1),
      })
      .strict(),
  ])
  .superRefine((c, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    const codes = c.sources.map((s) => s.code);
    if (new Set(codes).size !== codes.length) fail('Duplicate source codes');
    const ready =
      c.classification === 'needs_translation' ||
      c.classification === 'eligible_source';
    if (
      ready &&
      (!c.sources.length ||
        c.sources.some((s) => s.audit.status !== 'verified'))
    )
      fail('Ready candidate requires audited sources');
    if (
      ready &&
      (![
        'same_sense_gloss',
        'direct_source',
        'accepted_mapping',
        'existing_alignment',
      ].includes(c.alignment.method) ||
        !c.alignment.evidenceKeys.length)
    )
      fail('Lexical-only/absent alignment cannot enter translation/apply');
    if (
      c.classification === 'eligible_source' &&
      c.alignment.method === 'same_sense_gloss'
    )
      fail('EN context alone cannot establish a source VI gloss');
    if (c.context) {
      const rows = c.context.rows;
      const languages = new Set(rows.map((r) => r.language));
      if (
        c.context.context_language !==
        (languages.size === 1 ? rows[0].language : null)
      )
        fail('Context language must describe its rows');
      const kinds = new Set(rows.map((r) => r.kind));
      const expectedKind =
        kinds.size > 1
          ? 'combined'
          : rows[0].kind === 'sense_gloss'
            ? 'sense_gloss_en'
            : rows[0].kind;
      if (c.context.context_kind !== expectedKind)
        fail('Context kind must describe its rows');
      const identities = rows.map((r) =>
        r.kind === 'sense_gloss'
          ? `gloss:${r.glossId}`
          : `${r.kind}:${r.kind === 'sense_definition' ? r.senseId : r.conceptId}`,
      );
      if (new Set(identities).size !== identities.length)
        fail('Duplicate context row identity');
      const glossRows = rows.filter((r) => r.kind === 'sense_gloss');
      for (let i = 1; i < glossRows.length; i++) {
        const a = glossRows[i - 1],
          b = glossRows[i];
        if (
          a.rank > b.rank ||
          (a.rank === b.rank && BigInt(a.glossId) >= BigInt(b.glossId))
        )
          fail('EN gloss rows must be ordered by rank then bigint ID');
      }
      for (const r of rows) {
        if (r.textHash !== hashGlossText(r.text))
          fail('Context text hash mismatch');
        if (
          c.target &&
          (c.target.targetType === 'sense'
            ? r.kind === 'concept_definition' || r.senseId !== c.target.targetId
            : r.kind !== 'concept_definition' ||
              r.conceptId !== c.target.targetId)
        )
          fail('Context belongs to a different target');
        const source = c.sources.find((s) => s.code === r.sourceCode);
        if (r.sourceCode !== null && !source)
          fail('Context source missing from lineage');
        if (
          r.batchId !== null &&
          source &&
          !source.batchIds.includes(r.batchId)
        )
          fail('Context batch missing from source lineage');
        if (ready && (!source || r.batchId === null))
          fail('Ready context needs source and batch lineage');
      }
    }
    if (c.inputHash !== computeGlossInputHash(c))
      fail('Candidate input hash mismatch');
    if (c.candidateKey !== computeGlossCandidateKey(c))
      fail('Candidate key mismatch');
  });
export type GlossSource = z.infer<typeof GlossSourceSchema>;
export type GlossTarget = z.infer<typeof GlossTargetSchema>;
export type GlossContextRow = z.infer<typeof GlossContextRowSchema>;
export type GlossContext = z.infer<typeof GlossContextSchema>;
export type GlossCandidate = z.infer<typeof GlossCandidateSchema>;
type WithoutHashes<T> = T extends unknown
  ? Omit<T, 'candidateKey' | 'inputHash'>
  : never;
export type GlossCandidateInput = WithoutHashes<GlossCandidate>;

/** Canonical JSON: sorted object keys, preserved array order, no normalization of source text. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((v: unknown) => canonicalJson(v)).join(',')}]`;
  if (
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(',')}}`;
  }
  throw new Error(
    'Hash input must be plain JSON (no undefined/bigint/non-finite numbers)',
  );
}
function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
export function hashGlossText(value: string): string {
  return hash(value);
}
export function computeGlossInputHash(c: GlossCandidateInput): string {
  return hash(
    canonicalJson({
      schemaVersion: c.schemaVersion,
      datasetFingerprint: c.datasetFingerprint,
      target: c.target,
      context: c.context,
      sources: c.sources,
      alignment: c.alignment,
      sourceGlossVi: c.sourceGlossVi,
    }),
  );
}
export function computeGlossCandidateKey(c: GlossCandidateInput): string {
  return hash(
    canonicalJson({
      schemaVersion: c.schemaVersion,
      datasetFingerprint: c.datasetFingerprint,
      target: c.target,
      inputHash: computeGlossInputHash(c),
    }),
  );
}
export function createGlossCandidate(
  input: GlossCandidateInput,
): GlossCandidate {
  return GlossCandidateSchema.parse({
    ...input,
    inputHash: computeGlossInputHash(input),
    candidateKey: computeGlossCandidateKey(input),
  });
}
export function parseGlossCandidate(input: unknown): GlossCandidate {
  return GlossCandidateSchema.parse(input);
}

export const GlossOutputSchema = z
  .object({
    target_type: z.enum(['sense', 'concept']),
    target_id: BigintIdSchema,
    gloss_vi: GlossTextSchema.nullable(),
    reason: text.nullable(),
  })
  .strict()
  .superRefine((output, ctx) => {
    if (output.gloss_vi === null && output.reason === null)
      ctx.addIssue({ code: 'custom', message: 'Null gloss needs a reason' });
  });
export type GlossOutput = z.infer<typeof GlossOutputSchema>;
export function parseGlossOutput(
  input: unknown,
  target: GlossTarget,
): GlossOutput {
  const output = GlossOutputSchema.parse(input);
  if (
    output.target_type !== target.targetType ||
    output.target_id !== target.targetId
  )
    throw new Error('Output target does not match requested target');
  return output;
}

const entry = z
  .object({
    candidateKey: Sha256Schema,
    inputHash: Sha256Schema,
    state: z.enum([
      'pending',
      'running',
      'generated',
      'validated',
      'rejected',
      'applied',
      'failed',
    ]),
    attemptCount: integer,
    attempts: z.array(
      z
        .object({
          attempt: positive,
          startedAt: z.string().datetime({ offset: true }),
          outcome: z.enum(['in_flight', 'response', 'unknown', 'failed']),
          response: artifact.nullable(),
        })
        .strict(),
    ),
    output: GlossOutputSchema.nullable(),
    validation: z.enum(['pending', 'passed', 'failed']),
    error: text.nullable(),
    childRunKey: text.nullable(),
  })
  .strict();
export const GlossJobSchema = z
  .object({
    schemaVersion: z.literal(GLOSS_SCHEMA_VERSION),
    jobKey: Sha256Schema,
    snapshot: z
      .object({
        datasetFingerprint: Sha256Schema,
        inventory: artifact,
        host: z.string().regex(/^[A-Za-z0-9.:[\]-]+$/),
        port: z.number().int().min(1).max(65535),
        database: z.string().regex(/^[A-Za-z0-9_-]+$/),
      })
      .strict(),
    provider: z
      .object({
        name: z.enum(['stub', 'opencode-go', 'opencode-zen']),
        baseUrl: url,
        protocol: z.enum(['chat_completions', 'responses']),
        model: text,
        promptVersion: text,
      })
      .strict(),
    sessionId: z.string().uuid(),
    caps: z
      .object({
        maxRequests: positive,
        maxTokens: positive.nullable(),
        maxCostUsd: z.number().finite().nonnegative(),
        concurrency: z.literal(1),
      })
      .strict(),
    usage: z
      .object({
        attemptCount: integer,
        tokens: integer,
        costUsd: z.number().finite().nonnegative(),
      })
      .strict(),
    entries: z.array(entry),
    children: z.array(
      z
        .object({
          runKey: text,
          journalPath: artifactPath,
          inputHash: Sha256Schema,
          state: z.enum([
            'registered',
            'prepared',
            'applied',
            'failed',
            'rolled_back',
          ]),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((job, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (job.jobKey !== computeGlossJobKey(job))
      fail('Job configuration hash mismatch');
    if (
      new Set(job.entries.map((e) => e.candidateKey)).size !==
      job.entries.length
    )
      fail('Duplicate job candidate');
    if (
      new Set(job.children.map((c) => c.runKey)).size !== job.children.length ||
      new Set(job.children.map((c) => c.journalPath)).size !==
        job.children.length
    )
      fail('Duplicate child run/path');
    if (
      job.usage.attemptCount !==
      job.entries.reduce((n, e) => n + e.attemptCount, 0)
    )
      fail('Usage attempt count must include every recorded attempt');
    if (job.usage.attemptCount > job.caps.maxRequests)
      fail('Request cap exceeded');
    // Actual observed token/cost can exceed a cap; retain that evidence, runner must stop.
    for (const e of job.entries) {
      if (
        e.attemptCount !== e.attempts.length ||
        e.attempts.some((a, i) => a.attempt !== i + 1)
      )
        fail(
          'Attempts must be complete and sequential, including unknown outcomes',
        );
      if (
        e.attempts.some(
          (a) => (a.outcome === 'response') !== (a.response !== null),
        )
      )
        fail('Response outcome needs exactly one response artifact');
      const inFlight = e.attempts.filter((a) => a.outcome === 'in_flight');
      if (
        inFlight.length !== (e.state === 'running' ? 1 : 0) ||
        (inFlight.length && e.attempts.at(-1)?.outcome !== 'in_flight')
      )
        fail('Only running entry can have a final in-flight attempt');
      if (['generated', 'validated', 'applied'].includes(e.state) && !e.output)
        fail('Generated/validated/applied state needs output');
      if (
        ['validated', 'applied'].includes(e.state) &&
        (e.validation !== 'passed' || !e.output?.gloss_vi)
      )
        fail('Validated/applied state needs a valid non-null gloss');
      if (
        e.state === 'pending' &&
        (e.attemptCount || e.output || e.validation !== 'pending')
      )
        fail('Pending entry must be untouched');
      if (e.state === 'failed' && e.error === null)
        fail('Failed entry needs an error');
      if (
        e.childRunKey !== null &&
        !job.children.some((c) => c.runKey === e.childRunKey)
      )
        fail('Child must be registered before mutation');
      if (
        e.state === 'applied' &&
        !job.children.some(
          (c) => c.runKey === e.childRunKey && c.state === 'applied',
        )
      )
        fail('Applied entry needs applied child journal');
    }
    if (
      job.entries.filter((e) => e.state === 'running').length >
      job.caps.concurrency
    )
      fail('Concurrency cap exceeded');
  });
export type GlossJob = z.infer<typeof GlossJobSchema>;
export function computeGlossJobKey(job: Omit<GlossJob, 'jobKey'>): string {
  return hash(
    canonicalJson({
      schemaVersion: job.schemaVersion,
      snapshot: job.snapshot,
      provider: job.provider,
      sessionId: job.sessionId,
      caps: job.caps,
      entries: job.entries.map((e) => ({
        candidateKey: e.candidateKey,
        inputHash: e.inputHash,
      })),
    }),
  );
}
export function createGlossJob(input: Omit<GlossJob, 'jobKey'>): GlossJob {
  return GlossJobSchema.parse({ ...input, jobKey: computeGlossJobKey(input) });
}
export function parseGlossJob(input: unknown): GlossJob {
  return GlossJobSchema.parse(input);
}

/** B2 must bind checkpoints to the parsed B1 candidates before calling/applying. */
export function validateGlossJobCandidates(
  job: GlossJob,
  candidates: GlossCandidate[],
): void {
  const checkedJob = parseGlossJob(job);
  const parsed = candidates.map(parseGlossCandidate);
  const byKey = new Map(parsed.map((c) => [c.candidateKey, c]));
  if (byKey.size !== parsed.length)
    throw new Error('Duplicate candidate key in input');
  for (const entry of checkedJob.entries) {
    const candidate = byKey.get(entry.candidateKey);
    if (
      !candidate ||
      candidate.inputHash !== entry.inputHash ||
      candidate.datasetFingerprint !== checkedJob.snapshot.datasetFingerprint
    )
      throw new Error('Job candidate/input/snapshot mismatch');
    if (candidate.classification !== 'needs_translation')
      throw new Error(
        'Translation job only accepts needs_translation candidates',
      );
    if (entry.output) parseGlossOutput(entry.output, candidate.target);
  }
}

/** Provider/model/protocol/prompt or semantic input changes invalidate cached results. */
export function computeGlossCacheKey(
  candidate: GlossCandidate,
  provider: GlossJob['provider'],
): string {
  const parsed = parseGlossCandidate(candidate);
  const checkedProvider =
    GlossJobSchema.innerType().shape.provider.parse(provider);
  return hash(
    canonicalJson({
      candidateKey: parsed.candidateKey,
      inputHash: parsed.inputHash,
      provider: checkedProvider,
    }),
  );
}

/** Human audit artifact is separate from code validation and DB reviewed fields. */
export const GlossReviewSchema = z
  .object({
    schemaVersion: z.literal(GLOSS_SCHEMA_VERSION),
    jobKey: Sha256Schema,
    entries: z
      .array(
        z
          .object({
            candidateKey: Sha256Schema,
            inputHash: Sha256Schema,
            outputHash: Sha256Schema,
            verdict: z.enum(['pass', 'fail']),
            severity: z.enum(['none', 'minor', 'severe']),
            reviewer: text,
            reviewedAt: z.string().datetime({ offset: true }),
            reason: text.nullable(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((review, ctx) => {
    if (
      new Set(review.entries.map((e) => e.candidateKey)).size !==
      review.entries.length
    )
      ctx.addIssue({ code: 'custom', message: 'Duplicate review candidate' });
    for (const e of review.entries) {
      if (e.verdict === 'fail' && e.reason === null)
        ctx.addIssue({ code: 'custom', message: 'Failed review needs reason' });
      if (e.verdict === 'pass' && e.severity === 'severe')
        ctx.addIssue({
          code: 'custom',
          message: 'Severe error cannot pass review',
        });
    }
  });
export type GlossReview = z.infer<typeof GlossReviewSchema>;
export function parseGlossReview(input: unknown): GlossReview {
  return GlossReviewSchema.parse(input);
}
export function hashGlossOutput(output: GlossOutput): string {
  return hash(canonicalJson(GlossOutputSchema.parse(output)));
}
/** Keep reviewed rejects in the cohort after partial apply; omit invalid translations. */
export function glossReviewEntries(
  job: GlossJob,
  allowPartial = false,
): GlossJob['entries'] {
  return allowPartial
    ? job.entries.filter(
        (entry) => entry.state !== 'rejected' || entry.validation === 'passed',
      )
    : job.entries;
}
export function validateGlossReview(
  job: GlossJob,
  candidates: GlossCandidate[],
  input: unknown,
  options: { allowPartial?: boolean } = {},
): GlossReview {
  validateGlossJobCandidates(job, candidates);
  const review = parseGlossReview(input);
  const partial = options.allowPartial === true;
  const active = glossReviewEntries(job, partial);
  if (
    review.jobKey !== job.jobKey ||
    review.entries.length !== active.length ||
    (!partial && active.length !== 100)
  )
    throw new Error('Pilot review needs exactly 100 outputs bound to the job');
  const targets = new Map(candidates.map((c) => [c.candidateKey, c.target]));
  if (
    new Set(
      active.map((e) => {
        const target = targets.get(e.candidateKey)!;
        return `${target.targetType}:${target.targetId}`;
      }),
    ).size !== active.length
  )
    throw new Error('Pilot requires 100 distinct target identities');
  if (
    review.entries.some((e) => e.reviewer.trim().toUpperCase() === 'UNREVIEWED')
  )
    throw new Error('Every output needs a completed semantic review');
  if (
    !partial &&
    (review.entries.filter((e) => e.verdict === 'pass').length < 98 ||
      review.entries.some(
        (e) => e.severity === 'severe' || e.reviewer === 'UNREVIEWED',
      ))
  )
    throw new Error('Pilot review gate failed (98/100, zero severe)');
  for (const e of active) {
    const record = review.entries.find(
      (r) => r.candidateKey === e.candidateKey,
    );
    if (
      !record ||
      record.inputHash !== e.inputHash ||
      !e.output?.gloss_vi ||
      !(
        ['validated', 'applied'].includes(e.state) ||
        (partial &&
          e.state === 'rejected' &&
          e.validation === 'passed' &&
          record.verdict === 'fail')
      ) ||
      (e.childRunKey !== null && record.verdict !== 'pass') ||
      record.outputHash !== hashGlossOutput(e.output)
    )
      throw new Error('Review input/output/status mismatch');
  }
  return review;
}

export const GlossResponseArtifactSchema = z
  .object({
    schemaVersion: z.literal(GLOSS_SCHEMA_VERSION),
    jobKey: Sha256Schema,
    candidateKey: Sha256Schema,
    inputHash: Sha256Schema,
    cacheKey: Sha256Schema,
    attempt: positive,
    output: GlossOutputSchema.nullable(),
    validationError: text.nullable(),
    usage: z
      .object({
        inputTokens: integer,
        outputTokens: integer,
        tokens: integer,
        costUsd: z.number().finite().nonnegative(),
        estimated: z.boolean(),
      })
      .strict(),
    raw: z.record(z.unknown()),
  })
  .strict()
  .superRefine((response, ctx) => {
    if (
      response.usage.tokens !==
      response.usage.inputTokens + response.usage.outputTokens
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Response usage total mismatch',
      });
    if ((response.output === null) !== (response.validationError !== null))
      ctx.addIssue({
        code: 'custom',
        message: 'Rejected response needs validation error',
      });
  });
export type GlossResponseArtifact = z.infer<typeof GlossResponseArtifactSchema>;
export function parseGlossResponseArtifact(
  input: unknown,
): GlossResponseArtifact {
  return GlossResponseArtifactSchema.parse(input);
}
