// DB4-D5: replay sample replies, use D3's pure policy, compare blind AI scope labels.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  ArtifactRefSchema,
  MappingBundle,
  MappingBundleSchema,
  MappingCandidateSchema,
  MappingOutput,
  MappingOutputSchema,
  Sha256Schema,
  hashBytes,
  hashJson,
  parseMappingBundleIntegrity,
  parseMappingCandidates,
  parseMappingOutput,
  renderMappingBundle,
} from './_mapping-types';
import { artifactPath, jsonLines, readArtifact } from './_retrieval';
import { decideMappingBundle } from './_decisions';
import { storeAuditArtifact } from './mapping-audit';
import { buildSampleAuditInput } from './muse-v2-sample-prepare';

const SummarySchema = z.object({
  task: z.literal('db4_d4_muse_validation'),
  pilotManifest: ArtifactRefSchema,
  responses: ArtifactRefSchema,
  files: z.object({ r1: ArtifactRefSchema, r2: ArtifactRefSchema }),
  counts: z
    .object({ requests: z.number(), validatedRequests: z.number() })
    .passthrough(),
});
const AuditRowSchema = z.object({
  senseId: z.string(),
  bundleKey: Sha256Schema,
  contextHash: Sha256Schema,
  supportedExactConceptIds: z.array(z.string()),
  uncertainExactConceptIds: z.array(z.string()),
  excludedExactConceptIds: z.array(z.string()),
  reason: z.string().min(1),
});
const RequestSchema = z
  .object({
    requestId: z.string(),
    phase: z.enum(['r1', 'r2']),
    promptVersion: z.string(),
    bundleKey: Sha256Schema,
    senseId: z.string(),
    contextHash: Sha256Schema,
    renderedContextHash: Sha256Schema,
    payload: z
      .object({ seed: z.string(), bundle: MappingBundleSchema })
      .passthrough(),
  })
  .passthrough();
const ResponseSchema = z.object({
  requestId: z.string(),
  phase: z.enum(['r1', 'r2']),
  bundleKey: Sha256Schema,
  senseId: z.string(),
  contextHash: Sha256Schema,
  renderedContextHash: Sha256Schema,
  state: z.string(),
  rawReply: z.string().optional(),
  elapsedMs: z.number().optional(),
});
function unique<T>(rows: T[], key: (row: T) => string) {
  const map = new Map(rows.map((row) => [key(row), row]));
  if (map.size !== rows.length) throw new Error('Duplicate ledger identity');
  return map;
}
function rawObject(raw: string) {
  return JSON.parse(
    raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, ''),
  ) as unknown;
}
function scopeLabel(audit: z.infer<typeof AuditRowSchema>, id: string | null) {
  if (id === null) throw new Error('Sample requires production concept IDs');
  return audit.supportedExactConceptIds.includes(id)
    ? 'supported'
    : audit.uncertainExactConceptIds.includes(id)
      ? 'unclear'
      : 'excluded';
}
export function reportMuseV2Sample(
  root: string,
  prefix: string,
  validationPath: string,
  auditPath: string,
  baselinePath: string,
) {
  const sampleBytes = readFileSync(
    artifactPath(root, `${prefix}/manifest.json`),
  );
  const sample = z
    .object({
      task: z.literal('db4_d4_muse_pilot'),
      apply: z.literal(false),
      prompt: ArtifactRefSchema,
      requests: ArtifactRefSchema,
      generation: z.object({ path: z.string(), sha256: Sha256Schema }),
      counts: z.object({
        bundles: z.literal(30),
        requests: z.literal(60),
        candidatesPerPhase: z.number(),
      }),
    })
    .passthrough()
    .parse(JSON.parse(sampleBytes.toString()));
  const prompt = z
    .object({
      system: z.string(),
      phases: z.object({ r1: z.string(), r2: z.string() }),
      versions: z.object({
        r1: z.literal('db4-d4-semantic-match-v2-r1'),
        r2: z.literal('db4-d4-semantic-match-v2-r2'),
      }),
      hashes: z.object({
        system: Sha256Schema,
        r1: Sha256Schema,
        r2: Sha256Schema,
      }),
    })
    .parse(JSON.parse(readArtifact(root, sample.prompt).toString()));
  if (
    hashBytes(prompt.system) !== prompt.hashes.system ||
    hashBytes(prompt.phases.r1) !== prompt.hashes.r1 ||
    hashBytes(prompt.phases.r2) !== prompt.hashes.r2
  )
    throw new Error('Prompt text hash mismatch');
  const requests = jsonLines(
    readArtifact(root, sample.requests),
    RequestSchema,
  );
  unique(requests, (r) => r.requestId);
  const generation = z
    .object({ files: z.object({ candidates: ArtifactRefSchema }) })
    .parse(JSON.parse(readArtifact(root, sample.generation).toString()));
  const fullCandidates = parseMappingCandidates(
    jsonLines(
      readArtifact(root, generation.files.candidates),
      MappingCandidateSchema,
    ),
  );
  const byCandidate = unique(fullCandidates, (c) => c.candidateKey);
  const bundles = new Map<string, MappingBundle>();
  for (const r of requests) {
    const b = parseMappingBundleIntegrity({
      ...r.payload.bundle,
      candidates: [...r.payload.bundle.candidates].sort((a, b) =>
        a.candidateKey < b.candidateKey
          ? -1
          : a.candidateKey > b.candidateKey
            ? 1
            : 0,
      ),
    });
    const render = renderMappingBundle(
      b,
      r.phase,
      r.payload.seed,
      prompt.versions[r.phase],
    );
    if (
      r.bundleKey !== b.bundleKey ||
      r.senseId !== b.sense.id ||
      r.contextHash !== b.contextHash ||
      r.promptVersion !== prompt.versions[r.phase] ||
      render.renderedContextHash !== r.renderedContextHash ||
      hashJson(r.payload) !== render.renderedContextHash
    )
      throw new Error('Sample request render mismatch');
    bundles.set(b.bundleKey, b);
  }
  if (
    requests.length !== 60 ||
    bundles.size !== 30 ||
    [...bundles.values()].some(
      (b) =>
        requests.filter((r) => r.bundleKey === b.bundleKey && r.phase === 'r1')
          .length !== 1 ||
        requests.filter((r) => r.bundleKey === b.bundleKey && r.phase === 'r2')
          .length !== 1,
    )
  )
    throw new Error('Sample denominator mismatch');
  const auditBytes = readFileSync(resolve(auditPath));
  const audit = z
    .object({
      reviewerKind: z.literal('llm'),
      scope: z.literal('exact_eligibility_only_not_six_relation_gold'),
      sampleManifestSha256: Sha256Schema,
      auditInputSha256: Sha256Schema,
      responsesSeenBeforeAudit: z.literal(false),
      sentToMuse: z.literal(false),
      apply: z.literal(false),
      rows: z.array(AuditRowSchema).length(30),
    })
    .parse(JSON.parse(auditBytes.toString()));
  const auditInputBytes = readFileSync(
    artifactPath(root, `${prefix}/audit-input.json`),
  );
  if (
    hashJson(JSON.parse(auditInputBytes.toString())) !==
    hashJson(buildSampleAuditInput(requests))
  )
    throw new Error('Scope audit input differs from frozen request contexts');
  if (
    audit.sampleManifestSha256 !== hashBytes(sampleBytes) ||
    audit.auditInputSha256 !== hashBytes(auditInputBytes)
  )
    throw new Error('Scope audit source hash mismatch');
  const audits = unique(audit.rows, (r) => r.bundleKey);
  for (const b of bundles.values()) {
    const a = audits.get(b.bundleKey);
    if (!a || a.contextHash !== b.contextHash || a.senseId !== b.sense.id)
      throw new Error('Scope audit identity mismatch');
    const ids = [
      ...a.supportedExactConceptIds,
      ...a.uncertainExactConceptIds,
      ...a.excludedExactConceptIds,
    ];
    if (
      ids.length !== b.candidates.length ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !b.candidates.some((c) => c.concept.id === id))
    )
      throw new Error('Scope audit must partition the candidate IDs');
  }
  const validationBytes = readFileSync(artifactPath(root, validationPath));
  const validation = SummarySchema.parse(
    JSON.parse(validationBytes.toString()),
  );
  if (
    validation.pilotManifest.path !== `${prefix}/manifest.json` ||
    validation.pilotManifest.sha256 !== hashBytes(sampleBytes)
  )
    throw new Error('Validation sample mismatch');
  const baselineBytes = readFileSync(artifactPath(root, baselinePath));
  const baseline = SummarySchema.parse(JSON.parse(baselineBytes.toString()));
  const normalized = {
    r1: unique(
      jsonLines(readArtifact(root, validation.files.r1), MappingOutputSchema),
      (o) => o.bundleKey,
    ),
    r2: unique(
      jsonLines(readArtifact(root, validation.files.r2), MappingOutputSchema),
      (o) => o.bundleKey,
    ),
  };
  const old = {
    r1: unique(
      jsonLines(readArtifact(root, baseline.files.r1), MappingOutputSchema),
      (o) => o.bundleKey,
    ),
    r2: unique(
      jsonLines(readArtifact(root, baseline.files.r2), MappingOutputSchema),
      (o) => o.bundleKey,
    ),
  };
  const responses = jsonLines(
    readArtifact(root, validation.responses),
    ResponseSchema,
  );
  const byResponse = unique(responses, (r) => r.requestId);
  if (responses.length !== 60 || validation.counts.requests !== 60)
    throw new Error('Response denominator mismatch');
  const invalid: {
    requestId: string;
    senseId: string;
    phase: string;
    error: string;
  }[] = [];
  let parsed = 0;
  for (const r of requests) {
    const response = byResponse.get(r.requestId);
    if (
      !response ||
      [
        'phase',
        'bundleKey',
        'senseId',
        'contextHash',
        'renderedContextHash',
      ].some((key) => response[key as keyof typeof response] !== r[key])
    )
      throw new Error('Response render binding mismatch');
    const expected = normalized[r.phase].get(r.bundleKey);
    let value: MappingOutput | undefined;
    try {
      if (response.state !== 'complete' || !response.rawReply)
        throw new Error('Reply not complete');
      value = parseMappingOutput(
        rawObject(response.rawReply),
        bundles.get(r.bundleKey)!,
      );
      if (
        value.reviews.map((v) => v.candidateKey).join('\n') !==
        r.payload.bundle.candidates.map((c) => c.candidateKey).join('\n')
      )
        throw new Error('Candidate order mismatch');
    } catch (error) {
      if (expected)
        throw new Error('Normalized output exists for invalid reply');
      invalid.push({
        requestId: r.requestId,
        senseId: r.senseId,
        phase: r.phase,
        error: error instanceof Error ? error.message : 'InvalidOutput',
      });
      continue;
    }
    if (!expected || hashJson(value) !== hashJson(expected))
      throw new Error('Normalized/raw output mismatch');
    parsed++;
  }
  if (
    parsed !== validation.counts.validatedRequests ||
    normalized.r1.size + normalized.r2.size !== parsed
  )
    throw new Error('Validated output denominator mismatch');
  const rows = [...bundles.values()]
    .map((b) => {
      const a = audits.get(b.bundleKey)!;
      const senseId = b.sense.id;
      if (senseId === null)
        throw new Error('Sample requires production sense IDs');
      const candidates = b.candidates.map((c) => {
        const full = byCandidate.get(c.candidateKey);
        if (!full) throw new Error('Candidate missing from frozen generation');
        return full;
      });
      const r1 = normalized.r1.get(b.bundleKey) ?? null;
      const r2 = normalized.r2.get(b.bundleKey) ?? null;
      const decision = decideMappingBundle(b, candidates, r1, r2);
      const oldR1 = old.r1.get(b.bundleKey) ?? null;
      const oldR2 = old.r2.get(b.bundleKey) ?? null;
      const baselineDecision = decideMappingBundle(b, candidates, oldR1, oldR2);
      const selectionScope = decision.selectedConceptId
        ? scopeLabel(a, decision.selectedConceptId)
        : null;
      return {
        senseId,
        lemma: b.sense.lemma,
        reading: b.sense.reading,
        senseNo: b.sense.senseNo,
        bundleKey: b.bundleKey,
        contextHash: b.contextHash,
        sourceGlosses: b.senseContext.enGlosses.map((r) => r.text),
        sourceMetadata: b.senseContext.metadata,
        scopeAudit: a,
        decision,
        baselineDecision,
        selectionScope,
        phaseExact: {
          r1:
            r1?.reviews
              .filter((r) => r.relation === 'exact')
              .map((r) => r.conceptId) ?? null,
          r2:
            r2?.reviews
              .filter((r) => r.relation === 'exact')
              .map((r) => r.conceptId) ?? null,
        },
        phaseUnresolved: {
          r1: r1?.unresolvedReason ?? null,
          r2: r2?.unresolvedReason ?? null,
        },
        candidates: b.candidates.map((c) => ({
          candidateKey: c.candidateKey,
          conceptId: c.concept.id,
          definitions: c.conceptContext.definitions.map((r) => r.text),
          scopeAudit: scopeLabel(a, c.concept.id),
          v2: {
            r1:
              r1?.reviews.find((r) => r.candidateKey === c.candidateKey) ??
              null,
            r2:
              r2?.reviews.find((r) => r.candidateKey === c.candidateKey) ??
              null,
          },
          v1: {
            r1:
              oldR1?.reviews.find((r) => r.candidateKey === c.candidateKey)
                ?.relation ?? null,
            r2:
              oldR2?.reviews.find((r) => r.candidateKey === c.candidateKey)
                ?.relation ?? null,
          },
        })),
      };
    })
    .sort((a, b) => (BigInt(a.senseId) < BigInt(b.senseId) ? -1 : 1));
  const countStatus = (field: 'decision' | 'baselineDecision') => {
    const counts: Record<string, number> = {};
    for (const row of rows)
      counts[row[field].status] = (counts[row[field].status] ?? 0) + 1;
    return counts;
  };
  const claims = rows.flatMap((row) =>
    row.candidates.flatMap((c) =>
      (['r1', 'r2'] as const)
        .filter((phase) => c.v2[phase]?.relation === 'exact')
        .map((phase) => ({
          senseId: row.senseId,
          lemma: row.lemma,
          conceptId: c.conceptId,
          phase,
          scopeAudit: c.scopeAudit,
        })),
    ),
  );
  const startedBytes = readFileSync(
    artifactPath(root, `${prefix}/runner-started.json`),
  );
  const started = z
    .object({
      manifest_sha256: Sha256Schema,
      request_sha256: Sha256Schema,
      prompt_sha256: Sha256Schema,
      started_at: z.number(),
      dispatch_cap: z.literal(60),
      requests: z.literal(60),
      workers: z.literal(8),
    })
    .parse(JSON.parse(startedBytes.toString()));
  if (
    started.manifest_sha256 !== hashBytes(sampleBytes) ||
    started.request_sha256 !== sample.requests.sha256 ||
    started.prompt_sha256 !== sample.prompt.sha256
  )
    throw new Error('Runner startup hash mismatch');
  const progressBytes = readFileSync(
    artifactPath(root, `${prefix}/progress.json`),
  );
  const progress = z
    .object({
      total_requests: z.literal(60),
      settled: z.literal(60),
      workers: z.literal(8),
      states: z.object({ complete: z.literal(60) }).strict(),
      elapsed_s: z.number(),
    })
    .parse(JSON.parse(progressBytes.toString()));
  const elapsed = responses.map((r) => r.elapsedMs ?? 0).sort((a, b) => a - b);
  const report = {
    task: 'DB4-D5',
    policy: 'v2-unseen30-scope-audit-v1',
    inputs: {
      sampleSha256: hashBytes(sampleBytes),
      validation: { path: validationPath, sha256: hashBytes(validationBytes) },
      responses: validation.responses,
      scopeAuditSha256: hashBytes(auditBytes),
      baselineValidation: {
        path: baselinePath,
        sha256: hashBytes(baselineBytes),
      },
      startedSha256: hashBytes(startedBytes),
      progressSha256: hashBytes(progressBytes),
    },
    counts: {
      senses: rows.length,
      candidatePairs: rows.reduce((n, r) => n + r.candidates.length, 0),
      requests: 60,
      transportComplete: responses.filter((r) => r.state === 'complete').length,
      d1Valid: parsed,
      invalid: invalid.length,
      v2Decisions: countStatus('decision'),
      v1DecisionsSameSample: countStatus('baselineDecision'),
      exactClaims: claims.length,
      supportedExactClaims: claims.filter((r) => r.scopeAudit === 'supported')
        .length,
      unclearExactClaims: claims.filter((r) => r.scopeAudit === 'unclear')
        .length,
      excludedExactClaims: claims.filter((r) => r.scopeAudit === 'excluded')
        .length,
      supportedSelections: rows.filter((r) => r.selectionScope === 'supported')
        .length,
      unclearSelections: rows.filter((r) => r.selectionScope === 'unclear')
        .length,
      excludedSelections: rows.filter((r) => r.selectionScope === 'excluded')
        .length,
    },
    timing: {
      wallSeconds: progress.elapsed_s,
      workers: started.workers,
      requestLatencyMs: {
        min: elapsed[0],
        median: elapsed[Math.floor(elapsed.length / 2)],
        p95: elapsed[Math.ceil(elapsed.length * 0.95) - 1],
        max: elapsed[elapsed.length - 1],
      },
      tokenUsage: null,
    },
    reviewerKind: 'llm',
    auditScope: audit.scope,
    sameModelTwoPass: true,
    independentJudges: false,
    fullPilotGatePassed: false,
    promotionReady: false,
    semanticQualityValidated: false,
    apply: false,
    invalid,
    exactClaims: claims,
    rows,
  };
  const ref = storeAuditArtifact(
    root,
    `${prefix}/comparison.json`,
    JSON.stringify(report, null, 2) + '\n',
  );
  return { report: ref, counts: report.counts, timing: report.timing };
}
if (require.main === module) {
  const [root, prefix, validation, audit, baseline] = process.argv.slice(2);
  if (
    !root ||
    !prefix ||
    !validation ||
    !audit ||
    !baseline ||
    process.argv.length !== 7
  )
    throw new Error(
      'Usage: tsx scripts/db4/muse-v2-sample-report.ts ARTIFACT_ROOT SAMPLE_PREFIX VALIDATION_JSON SCOPE_AUDIT_JSON BASELINE_VALIDATION_JSON',
    );
  console.log(
    JSON.stringify(
      reportMuseV2Sample(resolve(root), prefix, validation, audit, baseline),
    ),
  );
}
