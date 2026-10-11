import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMappingBundle, createMappingCandidate } from './_mapping-types';
import { candidateInputFixture } from './fixtures/build';
import { validateFormatRepair } from './_batch-repair';

function fixture() {
  const candidates = [createMappingCandidate(candidateInputFixture())];
  const bundle = createMappingBundle(candidates, 'repair-test');
  const output = {
    schemaVersion: 1,
    task: 'sense_concept_review',
    bundleKey: bundle.bundleKey,
    senseId: bundle.sense.id,
    contextHash: bundle.contextHash,
    reviews: bundle.candidates.map((candidate) => ({
      candidateKey: candidate.candidateKey,
      conceptId: candidate.concept.id,
      relation: 'exact',
      coveredBranches: bundle.sourceBranches,
      missingBranches: [],
      conflicts: [],
      reason: 'All source branches match.',
      confidence: null,
    })),
    noSuitableCandidate: false,
    unresolvedReason: null,
  };
  return { bundle, output };
}

void test('format repair fills missing fields but preserves every parsed semantic claim', () => {
  const { bundle, output } = fixture();
  const broken = structuredClone(output) as Record<string, unknown>;
  delete (broken.reviews as Record<string, unknown>[])[0].confidence;
  assert.equal(
    validateFormatRepair(JSON.stringify(broken), output, bundle).reviews[0]
      .relation,
    'exact',
  );
  const altered = structuredClone(output);
  altered.reviews[0].relation = 'related';
  assert.throws(
    () => validateFormatRepair(JSON.stringify(broken), altered, bundle),
    /semantic_change_during_repair/,
  );
  const changedReason = structuredClone(output);
  changedReason.reviews[0].reason = 'Different meaning claim.';
  assert.throws(
    () => validateFormatRepair(JSON.stringify(broken), changedReason, bundle),
    /semantic_change_during_repair/,
  );
});

void test('format repair can restore malformed JSON but cannot invent or omit verdicts', () => {
  const { bundle, output } = fixture();
  assert.equal(
    validateFormatRepair('{broken', output, bundle).reviews.length,
    1,
  );
  assert.throws(() =>
    validateFormatRepair('{broken', { ...output, reviews: [] }, bundle),
  );
  const foreign = structuredClone(output);
  foreign.reviews[0].candidateKey = 'f'.repeat(64);
  assert.throws(
    () => validateFormatRepair('{broken', foreign, bundle),
    /Unknown candidate/,
  );
});
