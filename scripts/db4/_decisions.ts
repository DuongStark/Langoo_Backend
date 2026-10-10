// DB4-D3: deterministic proposals from two bound LLM outputs; never writes a DB.
import {
  MappingBundle,
  MappingDecision,
  Phase,
  hashJson,
  parseMappingBundle,
  parseMappingCandidates,
  createMappingDecisionParser,
  parseMappingOutput,
} from './_mapping-types';

export const DECISION_POLICY_VERSION = 'db4-d3-consensus-exact-v1';
type Reasons = MappingDecision['reasons'];
export type BundleDecision = {
  schemaVersion: 1;
  task: 'db4_mapping_bundle_decision';
  policyVersion: string;
  mode: MappingBundle['mode'];
  bundleKey: string;
  contextHash: string;
  senseId: string;
  senseKey: string;
  status: 'accept_exact' | 'no_suitable_shortlist' | 'deferred' | 'incomplete';
  selectedCandidateKey: string | null;
  selectedConceptId: string | null;
  outputHashR1: string | null;
  outputHashR2: string | null;
  incompletePhases: Phase[];
  reasons: Reasons;
  decisions: MappingDecision[];
};

export function decideMappingBundle(
  bundleValue: unknown,
  candidateValues: unknown,
  r1Value: unknown,
  r2Value: unknown,
): BundleDecision {
  const candidates = parseMappingCandidates(candidateValues);
  const bundle = parseMappingBundle(bundleValue, candidates);
  // Invalid supplied outputs are integrity failures. Missing phases are explicit
  // sidecars, never counterfeit D1 decisions with invented output hashes.
  const r1 = r1Value === null ? null : parseMappingOutput(r1Value, bundle);
  const r2 = r2Value === null ? null : parseMappingOutput(r2Value, bundle);
  const result: BundleDecision = {
    schemaVersion: 1,
    task: 'db4_mapping_bundle_decision',
    policyVersion: DECISION_POLICY_VERSION,
    mode: bundle.mode,
    bundleKey: bundle.bundleKey,
    contextHash: bundle.contextHash,
    senseId: bundle.sense.id!,
    senseKey: bundle.sense.semanticKey,
    status: 'incomplete',
    selectedCandidateKey: null,
    selectedConceptId: null,
    outputHashR1: r1 ? hashJson(r1) : null,
    outputHashR2: r2 ? hashJson(r2) : null,
    incompletePhases: [],
    reasons: [],
    decisions: [],
  };
  if (!r1) result.incompletePhases.push('r1');
  if (!r2) result.incompletePhases.push('r2');
  if (!r1 || !r2) {
    result.reasons.push({
      code: 'missing_context',
      detail: `No validated output for ${result.incompletePhases.join(', ')}; no two-pass decision was created.`,
    });
    return result;
  }

  const unresolved: Reasons = [];
  for (const [phase, output] of [
    ['r1', r1],
    ['r2', r2],
  ] as const)
    if (output.unresolvedReason)
      unresolved.push({
        ...output.unresolvedReason,
        detail: `${phase}: ${output.unresolvedReason.detail}`,
      });
  const leftByKey = new Map(r1.reviews.map((r) => [r.candidateKey, r]));
  const rightByKey = new Map(r2.reviews.map((r) => [r.candidateKey, r]));
  const parseDecision = createMappingDecisionParser(candidates, bundle, r1, r2);
  for (const candidate of candidates.sort((a, b) =>
    a.candidateKey.localeCompare(b.candidateKey),
  )) {
    const left = leftByKey.get(candidate.candidateKey)!;
    const right = rightByKey.get(candidate.candidateKey)!;
    const agrees = left.relation === right.relation;
    const reasons: Reasons = [...unresolved];
    if (!agrees)
      reasons.push({
        code: 'review_disagreement',
        detail: `r1=${left.relation}; r2=${right.relation}.`,
      });
    const relation = agrees ? left.relation : 'uncertain';
    let proposal: MappingDecision['proposal'] = 'defer';
    if (!reasons.length) {
      if (relation === 'exact') proposal = 'accept_exact';
      else if (relation === 'none') proposal = 'reject_pair';
      else if (relation !== 'uncertain') proposal = 'accept_nonexact';
      else
        reasons.push({ code: 'missing_context', detail: 'Uncertain review.' });
    }
    const decision = parseDecision({
      schemaVersion: 1,
      candidateKey: candidate.candidateKey,
      inputHash: candidate.inputHash,
      outputHashR1: result.outputHashR1,
      outputHashR2: result.outputHashR2,
      policyVersion: DECISION_POLICY_VERSION,
      proposal,
      relation,
      reasons,
    });
    result.decisions.push(decision);
    if (decision.proposal === 'accept_exact') {
      result.selectedCandidateKey = candidate.candidateKey;
      result.selectedConceptId = candidate.concept.id;
    }
  }
  result.status = result.selectedCandidateKey
    ? 'accept_exact'
    : r1.noSuitableCandidate && r2.noSuitableCandidate
      ? 'no_suitable_shortlist'
      : 'deferred';
  if (result.status !== 'accept_exact') {
    result.reasons = [...unresolved];
    for (const decision of result.decisions)
      for (const reason of decision.reasons)
        if (!result.reasons.some((r) => hashJson(r) === hashJson(reason)))
          result.reasons.push(reason);
    if (!result.reasons.length)
      result.reasons.push({
        code: 'no_suitable_concept',
        detail:
          'No agreed unique exact in this shortlist; this is not a claim about the whole concept corpus.',
      });
  }
  return result;
}
