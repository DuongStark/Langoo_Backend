// DB4-D5: verify a complete AI audit of D3 exact proposals. Never grants apply.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  ArtifactRef,
  ArtifactRefSchema,
  BigintIdSchema,
  Count,
  DecisionSchema,
  MappingAuditSchema,
  Sha256Schema,
  Text,
  assertUnique,
  hashBytes,
  hashJson,
  parseMappingAudit,
} from './_mapping-types';
import {
  artifactPath,
  jsonLines,
  readArtifact,
  writeArtifact,
} from './_retrieval';
import {
  MAX_DECISION_ARTIFACT_BYTES,
  decideMuseReview,
} from './muse-review-decide';

export const AUDIT_POLICY_VERSION = 'db4-d5-exact-proposal-audit-v1';
const ProposalSchema = z
  .object({
    bundleKey: Sha256Schema,
    senseId: BigintIdSchema,
    senseKey: Text,
    candidateKey: Sha256Schema,
    conceptId: BigintIdSchema,
    decisionHash: Sha256Schema,
    policyVersion: Text,
    verified: z.literal(false),
    calibratedScore: z.null(),
  })
  .strict();
const DecisionRowSchema = z
  .object({
    bundleKey: Sha256Schema,
    senseId: BigintIdSchema,
    decision: DecisionSchema,
    decisionHash: Sha256Schema,
  })
  .strict();
const ManifestSchema = z.object({
  schemaVersion: z.literal(1),
  task: z.literal('db4_d3_muse_decisions'),
  mode: z.enum(['fixture', 'production']),
  inputs: z.object({ pilot: ArtifactRefSchema, validation: ArtifactRefSchema }),
  files: z.object({
    decisions: ArtifactRefSchema,
    exactProposals: ArtifactRefSchema,
  }),
  counts: z.object({ retrievalTargets: Count, exactProposals: Count }),
});

/** Statistical uncertainty for the observed AI audit labels, not expert gold. */
function wilson(pass: number, total: number) {
  if (!total) return null;
  const z95 = 1.959963984540054;
  const p = pass / total;
  const denominator = 1 + (z95 * z95) / total;
  const middle = (p + (z95 * z95) / (2 * total)) / denominator;
  const radius =
    (z95 *
      Math.sqrt((p * (1 - p)) / total + (z95 * z95) / (4 * total * total))) /
    denominator;
  return { lower: middle - radius, upper: middle + radius };
}

/** Caller must first validate D3 lineage. Missing audits cannot shrink precision denominator. */
export function evaluateExactProposalAudits(
  proposalValues: unknown[],
  decisionValues: unknown[],
  auditValues: unknown[],
  targetCount: number,
) {
  Count.parse(targetCount);
  const proposals = proposalValues.map((p) => ProposalSchema.parse(p));
  const rows = decisionValues.map((d) => DecisionRowSchema.parse(d));
  assertUnique(
    proposals.map((p) => p.candidateKey),
    'exact proposal candidates',
  );
  assertUnique(
    proposals.map((p) => p.senseId),
    'exact proposal senses',
  );
  assertUnique(
    rows.map((d) => d.decision.candidateKey),
    'decision candidates',
  );
  if (proposals.length > targetCount)
    throw new Error('Proposal exceeds target denominator');
  const byDecision = new Map(rows.map((r) => [r.decision.candidateKey, r]));
  if (
    rows.filter((r) => r.decision.proposal === 'accept_exact').length !==
    proposals.length
  )
    throw new Error('Exact proposal/decision count mismatch');
  for (const p of proposals) {
    const row = byDecision.get(p.candidateKey);
    if (
      !row ||
      row.bundleKey !== p.bundleKey ||
      row.senseId !== p.senseId ||
      row.decision.proposal !== 'accept_exact' ||
      row.decision.relation !== 'exact' ||
      row.decision.policyVersion !== p.policyVersion ||
      row.decisionHash !== hashJson(row.decision) ||
      p.decisionHash !== row.decisionHash
    )
      throw new Error('Exact proposal/decision binding mismatch');
  }
  const rawAudits = auditValues.map((a) => MappingAuditSchema.parse(a));
  assertUnique(
    rawAudits.map((a) => a.candidateKey),
    'proposal audits',
  );
  const byProposal = new Map(proposals.map((p) => [p.candidateKey, p]));
  if (
    rawAudits.length !== proposals.length ||
    rawAudits.some((a) => !byProposal.has(a.candidateKey))
  )
    throw new Error(
      'Audit must cover every exact proposal, with no foreign rows',
    );
  const audits = rawAudits
    .map((a) => {
      const audit = parseMappingAudit(
        a,
        byDecision.get(a.candidateKey)!.decision,
      );
      if (
        (audit.verdict === 'pass' &&
          audit.suggestedDecision !== 'accept_exact') ||
        (audit.verdict !== 'pass' &&
          audit.suggestedDecision === 'accept_exact') ||
        (audit.verdict === 'deferred' && audit.severity === 'severe') ||
        (audit.verdict === 'fail' && audit.severity === 'none')
      )
        throw new Error('Contradictory semantic audit verdict');
      if (audit.verdict === 'pass' && audit.reviewerKind === 'rule')
        throw new Error(
          'Structural rule review cannot establish semantic pass',
        );
      return audit;
    })
    .sort((a, b) => a.candidateKey.localeCompare(b.candidateKey));
  const counts = {
    retrievalTargets: targetCount,
    exactProposals: proposals.length,
    audited: audits.length,
    pass: audits.filter((a) => a.verdict === 'pass').length,
    fail: audits.filter((a) => a.verdict === 'fail').length,
    deferred: audits.filter((a) => a.verdict === 'deferred').length,
    severe: audits.filter((a) => a.severity === 'severe').length,
    unauditedTargets: targetCount - proposals.length,
  };
  const passedProposals = proposals
    .filter((p) =>
      audits.some(
        (a) => a.candidateKey === p.candidateKey && a.verdict === 'pass',
      ),
    )
    .sort((a, b) => a.candidateKey.localeCompare(b.candidateKey))
    .map((p) => ({
      ...p,
      auditPassed: true,
      auditHash: hashJson(
        audits.find((a) => a.candidateKey === p.candidateKey)!,
      ),
    }));
  return {
    audits,
    passedProposals,
    report: {
      schemaVersion: 1,
      task: 'db4_d5_exact_proposal_audit',
      policyVersion: AUDIT_POLICY_VERSION,
      scope: 'exact_proposals_only',
      counts,
      observedAiAuditPassRate: proposals.length
        ? counts.pass / proposals.length
        : null,
      observedLabelWilson95: wilson(counts.pass, proposals.length),
      expertGoldAvailable: false,
      fullTargetGateEvaluated: false,
      fullPilotGatePassed: false,
      promotionReady: false,
      apply: false,
      needsHumanApprovalPerMapping: false,
      remainingGates: [
        'DB4-D5_full_target_audit',
        ...(proposals.length < 100 ? ['insufficient_positive_sample'] : []),
        'DB4-D5_hard_negative_holdout_recall_budget',
        ...(counts.severe ? ['severe_error'] : []),
        ...(counts.deferred ? ['unresolved_positive_audit'] : []),
        'DB4-D6_preflight_journal',
        'DB4-D7_serving',
      ],
    },
  };
}

function boundedRead(file: string): Buffer {
  if (statSync(file).size > MAX_DECISION_ARTIFACT_BYTES)
    throw new Error('D5 artifact exceeds 64 MiB');
  return readFileSync(file);
}
function boundArtifact(root: string, ref: ArtifactRef): Buffer {
  const bytes = boundedRead(artifactPath(root, ref.path));
  if (hashBytes(bytes) !== ref.sha256)
    throw new Error('D5 artifact hash mismatch');
  return bytes;
}

export function storeAuditArtifact(
  root: string,
  path: string,
  content: string,
) {
  const ref = { path, sha256: hashBytes(content) };
  if (existsSync(artifactPath(root, path))) boundArtifact(root, ref);
  else writeArtifact(root, path, content);
  return ref;
}

export function auditMuseProposals(
  root: string,
  manifestPath: string,
  auditFile: string,
) {
  const manifestBytes = boundedRead(artifactPath(root, manifestPath));
  const manifest = ManifestSchema.parse(JSON.parse(manifestBytes.toString()));
  // Recompute from raw D4 responses and frozen D2 source proofs. No untrusted
  // manifest flag, edited normalized reply or fabricated decision can skip this.
  const replay = decideMuseReview(
    root,
    manifest.inputs.pilot.path,
    manifest.inputs.validation.path,
  );
  if (
    replay.manifest.path !== manifestPath ||
    replay.manifest.sha256 !== hashBytes(manifestBytes)
  )
    throw new Error('D5 manifest differs from bound D3 replay');
  const auditBytes = boundedRead(resolve(auditFile));
  const proposals = jsonLines(
    boundArtifact(root, manifest.files.exactProposals),
    z.unknown(),
  );
  if (proposals.length !== manifest.counts.exactProposals)
    throw new Error('D5 proposal count mismatch');
  const result = evaluateExactProposalAudits(
    proposals,
    jsonLines(boundArtifact(root, manifest.files.decisions), z.unknown()),
    jsonLines(auditBytes, z.unknown()),
    manifest.counts.retrievalTargets,
  );
  const inputs = {
    decisions: { path: manifestPath, sha256: hashBytes(manifestBytes) },
    auditSha256: hashBytes(auditBytes),
  };
  const runKey = hashJson({ policyVersion: AUDIT_POLICY_VERSION, inputs });
  const prefix = `muse-d5-v1/${runKey}`;
  const files = {
    audits: storeAuditArtifact(
      root,
      `${prefix}/audits.jsonl`,
      auditBytes.toString(),
    ),
    passedProposals: storeAuditArtifact(
      root,
      `${prefix}/passed-proposals.jsonl`,
      result.passedProposals.map((p) => JSON.stringify(p) + '\n').join(''),
    ),
    report: storeAuditArtifact(
      root,
      `${prefix}/report.json`,
      JSON.stringify(result.report, null, 2) + '\n',
    ),
  };
  const ref = storeAuditArtifact(
    root,
    `${prefix}/manifest.json`,
    JSON.stringify(
      {
        schemaVersion: 1,
        task: 'db4_d5_exact_audit_run',
        mode: manifest.mode,
        runKey,
        policyVersion: AUDIT_POLICY_VERSION,
        inputs,
        files,
        counts: result.report.counts,
        apply: false,
        promotionReady: false,
        fullPilotGatePassed: false,
      },
      null,
      2,
    ) + '\n',
  );
  // Verify the manifest ref as readArtifact consumers will do.
  readArtifact(root, ref);
  return { manifest: ref, report: result.report };
}

if (require.main === module) {
  const [root, manifest, audit] = process.argv.slice(2);
  if (!root || !manifest || !audit || process.argv.length !== 5)
    throw new Error(
      'Usage: tsx scripts/db4/mapping-audit.ts ARTIFACT_ROOT D3_MANIFEST AUDIT_JSONL',
    );
  console.log(
    JSON.stringify(auditMuseProposals(resolve(root), manifest, audit)),
  );
}
