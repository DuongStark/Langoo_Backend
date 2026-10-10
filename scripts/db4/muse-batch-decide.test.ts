import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MappingBundle,
  MappingOutput,
  conceptSemanticKey,
  createMappingBundle,
  createMappingCandidate,
} from './_mapping-types';
import { createBatchEvent, verifyBatchEventChain } from './_batch-types';
import {
  BatchTargetEvaluation,
  PhaseState,
  evaluateBatchTarget,
} from './muse-batch-decide';
import { candidateInputFixture } from './fixtures/build';

const responseRef = {
  path: 'responses/raw/fixture.txt',
  sha256: 'a'.repeat(64),
};

function fixture() {
  const first = candidateInputFixture();
  const second = structuredClone(first);
  second.concept.id = '999';
  second.concept.synsetKeys[0].synsetId = 'alternative-n';
  second.concept.semanticKey = conceptSemanticKey(
    second.concept.synsetKeys,
    null,
  );
  second.evidence
    .filter((item) => item.owner.type === 'concept')
    .forEach((item) => {
      item.owner.semanticKey = second.concept.semanticKey;
    });
  const candidates = [
    createMappingCandidate(first),
    createMappingCandidate(second),
  ];
  const bundle = createMappingBundle(candidates, 'conditional-r2-fixture');
  return { bundle, candidates };
}

function output(
  bundle: MappingBundle,
  relations: MappingOutput['reviews'][number]['relation'][],
): MappingOutput {
  return {
    schemaVersion: 1,
    task: 'sense_concept_review',
    bundleKey: bundle.bundleKey,
    senseId: bundle.sense.id!,
    contextHash: bundle.contextHash,
    reviews: bundle.candidates.map((candidate, index) => ({
      candidateKey: candidate.candidateKey,
      conceptId: candidate.concept.id!,
      relation: relations[index],
      coveredBranches: relations[index] === 'none' ? [] : bundle.sourceBranches,
      missingBranches: relations[index] === 'none' ? bundle.sourceBranches : [],
      conflicts: [],
      reason: 'Synthetic orchestration fixture; not a semantic label.',
      confidence: null,
    })),
    noSuitableCandidate: relations.every((relation) => relation === 'none'),
    unresolvedReason:
      relations.filter((relation) => relation === 'exact').length > 1
        ? { code: 'ambiguous_concepts', detail: 'Multiple exact candidates.' }
        : relations.includes('uncertain')
          ? { code: 'missing_context', detail: 'Candidate scope is uncertain.' }
          : null,
  };
}

function ready(outputValue: MappingOutput): PhaseState {
  return { state: 'ready', output: outputValue, rawResponse: responseRef };
}

function evaluate(r1: PhaseState, r2: PhaseState): BatchTargetEvaluation {
  const { bundle, candidates } = fixture();
  return evaluateBatchTarget({
    runId: 'db4-conditional-test',
    generation: 1,
    bundleValue: bundle,
    candidateValues: candidates,
    r1,
    r2,
  });
}

void test('R2 only runs after a unique unresolved-free R1 exact and reuses D3', () => {
  const { bundle } = fixture();
  const r1 = ready(output(bundle, ['exact', 'related']));
  const r2 = ready(output(bundle, ['exact', 'related']));
  const result = evaluate(r1, r2);

  assert.equal(result.r2Eligibility, 'eligible');
  assert.equal(result.target.status, 'proposed_exact');
  assert.equal(result.d3Decision?.status, 'accept_exact');
  assert.equal(result.r1RawResponse?.sha256, responseRef.sha256);
  assert.equal(result.r2RawResponse?.sha256, responseRef.sha256);
});

void test('R1 with no exact must explicitly skip R2 and remains in denominator', () => {
  const { bundle } = fixture();
  const result = evaluate(ready(output(bundle, ['none', 'none'])), {
    state: 'skipped',
    reason: 'R1 contains no exact candidate.',
  });

  assert.equal(result.r2Eligibility, 'skipped');
  assert.equal(result.target.status, 'unresolved_no_exact');
  assert.equal(result.r2OutputHash, null);
  assert.equal(result.d3Decision, null);
});

void test('multiple exact results stay ambiguous and cannot schedule R2', () => {
  const { bundle } = fixture();
  const result = evaluate(ready(output(bundle, ['exact', 'exact'])), {
    state: 'skipped',
    reason: 'R1 returned multiple exact candidates.',
  });

  assert.equal(result.target.status, 'unresolved_ambiguous');
  assert.equal(result.r2Eligibility, 'skipped');
  assert.equal(result.d3Decision, null);
});

void test('an unresolved R1 cannot qualify for R2 even with one exact row', () => {
  const { bundle } = fixture();
  const result = evaluate(ready(output(bundle, ['exact', 'uncertain'])), {
    state: 'skipped',
    reason: 'R1 reported unresolved scope.',
  });

  assert.equal(result.target.status, 'unresolved_disagreement');
  assert.equal(result.r2Eligibility, 'skipped');
  assert.equal(result.r2Reason, 'R1 reported unresolved scope.');
});

void test('unknown R1 dispatch is parked and is never interpreted as no match', () => {
  const result = evaluate(
    { state: 'transport_unknown' },
    { state: 'skipped', reason: 'R1 outcome is unknown.' },
  );

  assert.equal(result.target.status, 'transport_unknown');
  assert.equal(result.r2Eligibility, 'unknown');
  assert.equal(result.r2OutputHash, null);
});

void test('completed invalid R1 output stays invalid and keeps its raw response', () => {
  const result = evaluate(
    {
      state: 'invalid',
      reason: 'Missing candidate row.',
      rawResponse: responseRef,
    },
    { state: 'skipped', reason: 'R1 output failed D1 validation.' },
  );

  assert.equal(result.target.status, 'unresolved_invalid_output');
  assert.equal(result.r2Eligibility, 'invalid');
  assert.equal(result.r1RawResponse?.sha256, responseRef.sha256);
});

void test('R2 dispatch state is constrained by the R1 decision', () => {
  const { bundle } = fixture();
  const noExact = ready(output(bundle, ['none', 'none']));
  assert.throws(
    () =>
      evaluate(noExact, {
        state: 'ready',
        output: output(bundle, ['exact', 'related']),
        rawResponse: responseRef,
      }),
    /R2 must be explicitly skipped/,
  );

  const uniqueExact = ready(output(bundle, ['exact', 'related']));
  assert.throws(
    () => evaluate(uniqueExact, { state: 'skipped', reason: 'unexpected' }),
    /R2 may not be skipped/,
  );
});

void test('batch events form a verifiable hash chain and reject changed details', () => {
  const first = createBatchEvent({
    runId: 'db4-event-test',
    sequence: 0,
    previousEventSha256: null,
    at: '2026-10-10T12:00:00.000Z',
    jobKey: null,
    type: 'run_started',
    details: { selectedTargets: 1 },
  });
  const second = createBatchEvent({
    runId: first.runId,
    sequence: 1,
    previousEventSha256: first.eventSha256,
    at: '2026-10-10T12:00:01.000Z',
    jobKey: 'b'.repeat(64),
    type: 'job_planned',
    details: { phase: 'r1' },
  });

  assert.deepEqual(verifyBatchEventChain([first, second]), [first, second]);
  const altered = structuredClone(second);
  altered.details.phase = 'r2';
  assert.throws(
    () => verifyBatchEventChain([first, altered]),
    /sequence\/link mismatch/,
  );
  assert.throws(
    () =>
      verifyBatchEventChain([
        first,
        { ...second, eventSha256: 'c'.repeat(64) },
      ]),
    /hash mismatch/,
  );
  assert.throws(
    () =>
      createBatchEvent({
        runId: first.runId,
        sequence: 2,
        previousEventSha256: second.eventSha256,
        at: '2026-10-10T12:00:02.000Z',
        jobKey: 'c'.repeat(64),
        type: 'dispatch_intent_persisted',
        details: { session_id: 'private-session' },
      }),
    /Sensitive values/,
  );
});
