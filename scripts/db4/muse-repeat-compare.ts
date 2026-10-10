// DB4-D5: compare one fresh R2 pass with the frozen R1/R2 and AI audit labels.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  ArtifactRefSchema,
  MappingAuditSchema,
  MappingOutputSchema,
  MappingBundleSchema,
  DecisionSchema,
  hashBytes,
  hashJson,
  parseMappingAudit,
  parseMappingOutput,
} from './_mapping-types';
import { artifactPath, jsonLines, readArtifact } from './_retrieval';
import { storeAuditArtifact } from './mapping-audit';
import { prepareMuseRepeat } from './muse-repeat-prepare';

const RefFiles = z.object({ r1: ArtifactRefSchema, r2: ArtifactRefSchema });
export function compareMuseRepeat(
  root: string,
  prefix: string,
  validationPath: string,
  auditFile: string,
) {
  const repeatBytes = readFileSync(
    artifactPath(root, `${prefix}/manifest.json`),
  );
  const repeat = z
    .object({
      repeat: z.object({ originalDecisions: ArtifactRefSchema }),
      requests: ArtifactRefSchema,
    })
    .parse(JSON.parse(repeatBytes.toString()));
  // Rebuild the subset from original, fully bound D3. Same prompt/render/order.
  const verified = prepareMuseRepeat(
    root,
    repeat.repeat.originalDecisions.path,
    prefix,
  );
  if (verified.manifest.sha256 !== hashBytes(repeatBytes))
    throw new Error('Repeat manifest changed');
  const original = z
    .object({
      inputs: z.object({ outputs: RefFiles, generation: ArtifactRefSchema }),
      files: z.object({
        exactProposals: ArtifactRefSchema,
        decisions: ArtifactRefSchema,
      }),
    })
    .parse(
      JSON.parse(
        readArtifact(root, repeat.repeat.originalDecisions).toString(),
      ),
    );
  const generation = z
    .object({ files: z.object({ bundles: ArtifactRefSchema }) })
    .parse(
      JSON.parse(readArtifact(root, original.inputs.generation).toString()),
    );
  const bundles = new Map(
    jsonLines(
      readArtifact(root, generation.files.bundles),
      MappingBundleSchema,
    ).map((b) => [b.bundleKey, b]),
  );
  const proposals = jsonLines(
    readArtifact(root, original.files.exactProposals),
    z.object({
      candidateKey: z.string(),
      senseId: z.string(),
      conceptId: z.string(),
      bundleKey: z.string(),
    }),
  );
  const decisions = new Map(
    jsonLines(
      readArtifact(root, original.files.decisions),
      z.object({ decision: DecisionSchema }),
    ).map((r) => [r.decision.candidateKey, r.decision]),
  );
  const auditBytes = readFileSync(resolve(auditFile));
  const audits = jsonLines(auditBytes, MappingAuditSchema);
  if (
    audits.length !== proposals.length ||
    new Set(audits.map((a) => a.candidateKey)).size !== proposals.length
  )
    throw new Error('Audit denominator mismatch');
  const auditByKey = new Map(
    audits.map((a) => {
      const d = decisions.get(a.candidateKey);
      if (!d || !proposals.some((p) => p.candidateKey === a.candidateKey))
        throw new Error('Foreign audit');
      return [a.candidateKey, parseMappingAudit(a, d)];
    }),
  );
  const old = {
    r1: new Map(
      jsonLines(
        readArtifact(root, original.inputs.outputs.r1),
        MappingOutputSchema,
      ).map((o) => [o.bundleKey, o]),
    ),
    r2: new Map(
      jsonLines(
        readArtifact(root, original.inputs.outputs.r2),
        MappingOutputSchema,
      ).map((o) => [o.bundleKey, o]),
    ),
  };
  const validationBytes = readFileSync(artifactPath(root, validationPath));
  const validation = z
    .object({
      pilotManifest: ArtifactRefSchema,
      responses: ArtifactRefSchema,
      files: RefFiles,
    })
    .parse(JSON.parse(validationBytes.toString()));
  if (
    validation.pilotManifest.path !== verified.manifest.path ||
    validation.pilotManifest.sha256 !== verified.manifest.sha256
  )
    throw new Error('Validation belongs to another repeat');
  const requests = jsonLines(
    readArtifact(root, repeat.requests),
    z.object({
      requestId: z.string(),
      phase: z.literal('r2'),
      bundleKey: z.string(),
      senseId: z.string(),
      contextHash: z.string(),
      renderedContextHash: z.string(),
      payload: z.object({ bundle: MappingBundleSchema }),
    }),
  );
  const responses = jsonLines(
    readArtifact(root, validation.responses),
    z.object({
      requestId: z.string(),
      phase: z.string(),
      bundleKey: z.string(),
      senseId: z.string(),
      contextHash: z.string(),
      renderedContextHash: z.string(),
      state: z.string(),
      rawReply: z.string().optional(),
      elapsedMs: z.number().optional(),
    }),
  );
  if (
    responses.length !== requests.length ||
    new Set(responses.map((r) => r.requestId)).size !== responses.length
  )
    throw new Error('Response denominator mismatch');
  const responsesByKey = new Map(responses.map((r) => [r.requestId, r]));
  const normalized = new Map(
    jsonLines(readArtifact(root, validation.files.r2), MappingOutputSchema).map(
      (o) => [o.bundleKey, o],
    ),
  );
  const fresh = new Map<string, z.infer<typeof MappingOutputSchema>>();
  for (const request of requests) {
    const response = responsesByKey.get(request.requestId);
    if (
      !response ||
      [
        'phase',
        'bundleKey',
        'senseId',
        'contextHash',
        'renderedContextHash',
      ].some(
        (k) =>
          response[k as keyof typeof response] !==
          request[k as keyof typeof request],
      )
    )
      throw new Error('Unbound response');
    let actual = null;
    if (response.state === 'complete' && response.rawReply !== undefined) {
      try {
        const raw: unknown = JSON.parse(
          response.rawReply
            .trim()
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```$/, ''),
        );
        actual = parseMappingOutput(raw, bundles.get(request.bundleKey)!);
        if (
          actual.reviews.map((r) => r.candidateKey).join('\n') !==
          request.payload.bundle.candidates
            .map((c) => c.candidateKey)
            .join('\n')
        )
          actual = null;
      } catch {
        /* Preserve invalid/incomplete; never interpret as no-match. */
      }
    }
    const saved = normalized.get(request.bundleKey);
    if (
      (actual !== null) !== (saved !== undefined) ||
      (actual && saved && hashJson(actual) !== hashJson(saved))
    )
      throw new Error('Normalized repeat differs from raw response');
    if (actual) fresh.set(request.bundleKey, actual);
  }
  if (fresh.size !== normalized.size)
    throw new Error('Foreign normalized repeat');
  const rows = proposals.map((p) => {
    const b = bundles.get(p.bundleKey)!;
    const before1 = old.r1.get(p.bundleKey)!;
    const before2 = old.r2.get(p.bundleKey)!;
    const after = fresh.get(p.bundleKey);
    const selected = after?.reviews.find(
      (r) => r.candidateKey === p.candidateKey,
    );
    const exacts = after?.reviews.filter((r) => r.relation === 'exact') ?? [];
    const audit = auditByKey.get(p.candidateKey)!;
    return {
      senseId: p.senseId,
      senseKey: b.sense.identity?.senseKey ?? b.sense.semanticKey,
      lemma: b.sense.lemma,
      reading: b.sense.reading,
      candidateKey: p.candidateKey,
      conceptId: p.conceptId,
      beforeR1: before1.reviews.find((r) => r.candidateKey === p.candidateKey)!
        .relation,
      beforeR2: before2.reviews.find((r) => r.candidateKey === p.candidateKey)!
        .relation,
      afterRelation: selected?.relation ?? null,
      retainedExactSelection:
        selected?.relation === 'exact' &&
        exacts.length === 1 &&
        after?.unresolvedReason === null,
      afterUnresolvedReason: after?.unresolvedReason ?? null,
      afterReason: selected?.reason ?? null,
      validRepeat: after !== undefined,
      auditVerdict: audit.verdict,
      auditSeverity: audit.severity,
      auditReason: audit.reason,
      candidateComparison: before2.reviews.map((r) => ({
        candidateKey: r.candidateKey,
        conceptId: r.conceptId,
        beforeRelation: r.relation,
        afterRelation:
          after?.reviews.find((n) => n.candidateKey === r.candidateKey)
            ?.relation ?? null,
      })),
    };
  });
  const comparisons = rows.flatMap((r) =>
    r.validRepeat ? r.candidateComparison : [],
  );
  const report = {
    schemaVersion: 1,
    task: 'DB4-D5',
    experiment: 'same-prompt-r2-repeat-v1',
    inputs: {
      repeat: verified.manifest,
      validation: { path: validationPath, sha256: hashBytes(validationBytes) },
      auditSha256: hashBytes(auditBytes),
    },
    counts: {
      proposals: rows.length,
      validRepeats: fresh.size,
      invalidOrIncomplete: rows.length - fresh.size,
      retainedExactSelection: rows.filter((r) => r.retainedExactSelection)
        .length,
      changedOrUnresolvedValid: rows.filter(
        (r) => r.validRepeat && !r.retainedExactSelection,
      ).length,
      comparedCandidates: comparisons.length,
      sameCandidateRelation: comparisons.filter(
        (r) => r.beforeRelation === r.afterRelation,
      ).length,
      auditSevereStillExact: rows.filter(
        (r) => r.auditSeverity === 'severe' && r.retainedExactSelection,
      ).length,
      auditDeferredStillExact: rows.filter(
        (r) => r.auditVerdict === 'deferred' && r.retainedExactSelection,
      ).length,
      auditPassedStillExact: rows.filter(
        (r) => r.auditVerdict === 'pass' && r.retainedExactSelection,
      ).length,
    },
    independentJudges: false,
    semanticQualityValidated: false,
    promotionReady: false,
    apply: false,
    tokenUsage: null,
    tokenUsageReason: 'Native Muse transport exposes no token usage telemetry.',
    rows,
  };
  const resultRef = storeAuditArtifact(
    root,
    `${prefix}/comparison.json`,
    JSON.stringify(report, null, 2) + '\n',
  );
  return { report: resultRef, counts: report.counts };
}

if (require.main === module) {
  const [root, prefix, validation, audit] = process.argv.slice(2);
  if (!root || !prefix || !validation || !audit || process.argv.length !== 6)
    throw new Error(
      'Usage: tsx scripts/db4/muse-repeat-compare.ts ARTIFACT_ROOT REPEAT_PREFIX VALIDATION_SUMMARY AUDIT_JSONL',
    );
  console.log(
    JSON.stringify(compareMuseRepeat(resolve(root), prefix, validation, audit)),
  );
}
