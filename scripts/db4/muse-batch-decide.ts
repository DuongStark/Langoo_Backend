// DB4-D3/D4: conditional R2 orchestration around the frozen D1/D3 policy.
// This module never calls a provider or writes/imports the database.
import {
  MappingOutput,
  hashJson,
  mappingTargetKey,
  parseMappingBundle,
  parseMappingCandidates,
  parseMappingOutput,
} from './_mapping-types';
import { decideMappingBundle } from './_decisions';
import { BatchTargetResult, BatchTargetResultSchema } from './_batch-types';
import { ArtifactRef, ArtifactRefSchema } from './_mapping-types';

export const CONDITIONAL_R2_POLICY_VERSION =
  'db4-d4-conditional-r2-v1' as const;

export type PhaseState =
  | { state: 'pending' }
  | { state: 'transport_unknown' }
  | { state: 'blocked_transport'; reason: string }
  | { state: 'invalid'; reason: string; rawResponse: ArtifactRef }
  | { state: 'ready'; output: unknown; rawResponse: ArtifactRef }
  | { state: 'skipped'; reason: string };

export type BatchTargetEvaluation = {
  schemaVersion: 1;
  task: 'db4_batch_target_evaluation';
  policyVersion: typeof CONDITIONAL_R2_POLICY_VERSION;
  target: BatchTargetResult;
  r1OutputHash: string | null;
  r2OutputHash: string | null;
  r1RawResponse: ArtifactRef | null;
  r2RawResponse: ArtifactRef | null;
  r2Eligibility:
    'eligible' | 'skipped' | 'pending' | 'unknown' | 'blocked' | 'invalid';
  r2Reason: string | null;
  d3Decision: ReturnType<typeof decideMappingBundle> | null;
};

function terminalWithoutR2(
  r1: MappingOutput,
  expansionEvidence: ArtifactRef | null,
): { status: BatchTargetResult['status']; reason: string } {
  const exactCount = r1.reviews.filter(
    (review) => review.relation === 'exact',
  ).length;
  const unresolvedCode = r1.unresolvedReason?.code;
  if (exactCount > 1 || unresolvedCode === 'ambiguous_concepts')
    return {
      status: 'unresolved_ambiguous',
      reason: unresolvedCode ?? 'R1 returned competing exact candidates.',
    };
  if (unresolvedCode === 'compound_sense')
    return { status: 'unresolved_compound', reason: unresolvedCode };
  if (exactCount === 0 && expansionEvidence) {
    ArtifactRefSchema.parse(expansionEvidence);
    return {
      status: 'expansion_pending',
      reason: `R1 has no exact candidate; expansion evidence ${expansionEvidence.sha256} is bound for review.`,
    };
  }
  if (exactCount === 0)
    return {
      status: 'unresolved_no_exact',
      reason:
        unresolvedCode ??
        (r1.noSuitableCandidate
          ? 'R1 rejected every candidate in this shortlist.'
          : 'R1 found no unique whole-sense exact candidate.'),
    };
  return {
    status: 'unresolved_disagreement',
    reason:
      unresolvedCode ?? 'R1 has an unresolved reason; R2 is not scheduled.',
  };
}

/** Decide whether R2 is eligible, then reuse D3 only when both phases are valid. */
export function evaluateBatchTarget(input: {
  runId: string;
  generation: 1 | 2;
  bundleValue: unknown;
  candidateValues: unknown;
  r1: PhaseState;
  r2: PhaseState;
  expansionEvidence?: ArtifactRef | null;
}): BatchTargetEvaluation {
  const candidates = parseMappingCandidates(input.candidateValues);
  const bundle = parseMappingBundle(input.bundleValue, candidates);
  const expansionEvidence = input.expansionEvidence ?? null;
  const targetKey = mappingTargetKey(
    bundle.sense.semanticKey,
    bundle.semanticInputFingerprint,
  );
  const expected = (
    status: BatchTargetResult['status'],
    reason: string | null,
  ) =>
    BatchTargetResultSchema.parse({
      runId: input.runId,
      targetKey,
      senseKey: bundle.sense.semanticKey,
      status,
      finalGeneration: input.generation,
      d1Decision: null,
      auditResult: null,
      reason,
    });
  const result = (
    target: BatchTargetResult,
    r1OutputHash: string | null,
    r2OutputHash: string | null,
    r2Eligibility: BatchTargetEvaluation['r2Eligibility'],
    r2Reason: string | null,
    d3Decision: BatchTargetEvaluation['d3Decision'] = null,
    r1RawResponse: ArtifactRef | null = null,
    r2RawResponse: ArtifactRef | null = null,
  ): BatchTargetEvaluation => ({
    schemaVersion: 1,
    task: 'db4_batch_target_evaluation',
    policyVersion: CONDITIONAL_R2_POLICY_VERSION,
    target,
    r1OutputHash,
    r2OutputHash,
    r1RawResponse,
    r2RawResponse,
    r2Eligibility,
    r2Reason,
    d3Decision,
  });

  if (input.r1.state !== 'ready' && input.r2.state !== 'skipped')
    throw new Error('R2 must be skipped unless a validated R1 is available');
  if (input.r1.state === 'pending')
    return result(expected('r1_pending', null), null, null, 'pending', null);
  if (input.r1.state === 'transport_unknown')
    return result(
      expected(
        'transport_unknown',
        'R1 dispatch outcome is unknown; do not resend.',
      ),
      null,
      null,
      'unknown',
      'R1 dispatch outcome is unknown.',
    );
  if (input.r1.state === 'blocked_transport')
    return result(
      expected('blocked_transport', input.r1.reason),
      null,
      null,
      'blocked',
      input.r1.reason,
    );
  if (input.r1.state === 'invalid')
    return result(
      expected('unresolved_invalid_output', input.r1.reason),
      null,
      null,
      'invalid',
      input.r1.reason,
      null,
      ArtifactRefSchema.parse(input.r1.rawResponse),
    );
  if (input.r1.state === 'skipped')
    throw new Error('R1 may not be skipped for a scheduled mapping target');

  const r1 = parseMappingOutput(input.r1.output, bundle);
  const r1OutputHash = hashJson(r1);
  const r1RawResponse = ArtifactRefSchema.parse(input.r1.rawResponse);
  const exactCount = r1.reviews.filter(
    (review) => review.relation === 'exact',
  ).length;
  const eligibleForR2 = exactCount === 1 && r1.unresolvedReason === null;

  if (!eligibleForR2) {
    if (input.r2.state !== 'skipped')
      throw new Error('R2 must be explicitly skipped when R1 is not eligible');
    const terminal = terminalWithoutR2(r1, expansionEvidence);
    return result(
      expected(terminal.status, terminal.reason),
      r1OutputHash,
      null,
      'skipped',
      input.r2.reason,
      null,
      r1RawResponse,
    );
  }

  if (expansionEvidence)
    throw new Error(
      'An R1-eligible exact candidate cannot also expand retrieval',
    );
  if (input.r2.state === 'skipped')
    throw new Error(
      'R2 may not be skipped after a unique unresolved-free R1 exact',
    );
  if (input.r2.state === 'pending')
    return result(
      expected('r2_pending', null),
      r1OutputHash,
      null,
      'pending',
      null,
      null,
      r1RawResponse,
    );
  if (input.r2.state === 'transport_unknown')
    return result(
      expected(
        'transport_unknown',
        'R2 dispatch outcome is unknown; do not resend.',
      ),
      r1OutputHash,
      null,
      'unknown',
      'R2 dispatch outcome is unknown.',
      null,
      r1RawResponse,
    );
  if (input.r2.state === 'blocked_transport')
    return result(
      expected('blocked_transport', input.r2.reason),
      r1OutputHash,
      null,
      'blocked',
      input.r2.reason,
      null,
      r1RawResponse,
    );
  if (input.r2.state === 'invalid')
    return result(
      expected('unresolved_invalid_output', input.r2.reason),
      r1OutputHash,
      null,
      'invalid',
      input.r2.reason,
      null,
      r1RawResponse,
      ArtifactRefSchema.parse(input.r2.rawResponse),
    );

  const r2RawResponse = ArtifactRefSchema.parse(input.r2.rawResponse);
  const r2 = parseMappingOutput(input.r2.output, bundle);
  const d3Decision = decideMappingBundle(bundle, candidates, r1, r2);
  const r2OutputHash = hashJson(r2);
  if (d3Decision.status === 'accept_exact')
    return result(
      expected('proposed_exact', null),
      r1OutputHash,
      r2OutputHash,
      'eligible',
      null,
      d3Decision,
      r1RawResponse,
      r2RawResponse,
    );
  if (d3Decision.status === 'no_suitable_shortlist')
    return result(
      expected('unresolved_no_exact', 'Both phases rejected every candidate.'),
      r1OutputHash,
      r2OutputHash,
      'eligible',
      null,
      d3Decision,
      r1RawResponse,
      r2RawResponse,
    );
  const hasNonexactProposal = d3Decision.decisions.some(
    (decision) => decision.proposal === 'accept_nonexact',
  );
  const hasDeferredCandidate = d3Decision.decisions.some(
    (decision) => decision.proposal === 'defer',
  );
  if (
    hasNonexactProposal &&
    !hasDeferredCandidate &&
    !r1.unresolvedReason &&
    !r2.unresolvedReason
  )
    return result(
      expected(
        'proposed_nonexact',
        'Non-exact D3 proposals are held separately.',
      ),
      r1OutputHash,
      r2OutputHash,
      'eligible',
      null,
      d3Decision,
      r1RawResponse,
      r2RawResponse,
    );
  const multipleExact =
    r1.reviews.filter((review) => review.relation === 'exact').length > 1 ||
    r2.reviews.filter((review) => review.relation === 'exact').length > 1;
  const compound =
    r1.unresolvedReason?.code === 'compound_sense' ||
    r2.unresolvedReason?.code === 'compound_sense';
  return result(
    expected(
      multipleExact
        ? 'unresolved_ambiguous'
        : compound
          ? 'unresolved_compound'
          : 'unresolved_disagreement',
      d3Decision.reasons.map((reason) => reason.code).join(', ') ||
        'D3 deferred.',
    ),
    r1OutputHash,
    r2OutputHash,
    'eligible',
    null,
    d3Decision,
    r1RawResponse,
    r2RawResponse,
  );
}
