import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  MappingBundle,
  MappingOutput,
  conceptSemanticKey,
  createMappingBundle,
  createMappingCandidate,
  createMappingDecisionParser,
  hashBytes,
  hashJson,
  parseMappingDecision,
  renderMappingBundle,
  semanticInputFingerprint,
} from './_mapping-types';
import { DECISION_POLICY_VERSION, decideMappingBundle } from './_decisions';
import {
  MAX_DECISION_ARTIFACT_BYTES,
  MAX_DECISION_TARGETS,
  decideMuseReview,
} from './muse-review-decide';
import { readArtifact, writeArtifact, writeJson } from './_retrieval';
import { candidateInputFixture, snapshotFixture } from './fixtures/build';

function pair(root?: string) {
  const input = candidateInputFixture();
  if (root)
    input.sources[0].audit.evidence = [
      writeJson(root, 'source-proof.json', { fixture: true }),
    ];
  const other = structuredClone(input);
  other.concept.id = '999';
  other.concept.synsetKeys[0].synsetId = 'alternative-n';
  other.concept.semanticKey = conceptSemanticKey(
    other.concept.synsetKeys,
    null,
  );
  other.evidence
    .filter((e) => e.owner.type === 'concept')
    .forEach((e) => {
      e.owner.semanticKey = other.concept.semanticKey;
    });
  const candidates = [
    createMappingCandidate(input),
    createMappingCandidate(other),
  ];
  const bundle = createMappingBundle(candidates, 'fixture-bundle-v1');
  return { candidates, bundle };
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
    reviews: bundle.candidates.map((c, i) => ({
      candidateKey: c.candidateKey,
      conceptId: c.concept.id!,
      relation: relations[i],
      coveredBranches: relations[i] === 'none' ? [] : bundle.sourceBranches,
      missingBranches: relations[i] === 'none' ? bundle.sourceBranches : [],
      conflicts: [],
      reason: 'Synthetic contract test, not a semantic gold label.',
      confidence: null,
    })),
    noSuitableCandidate: relations.every((r) => r === 'none'),
    unresolvedReason:
      relations.filter((r) => r === 'exact').length > 1
        ? { code: 'ambiguous_concepts', detail: 'Multiple exact candidates.' }
        : relations.includes('uncertain')
          ? { code: 'missing_context', detail: 'Uncertain scope.' }
          : null,
  };
}
function adapterFixture(root: string, incomplete = false) {
  const { candidates, bundle } = pair(root);
  const generation = writeJson(root, 'generation.json', {
    schemaVersion: 1,
    task: 'db4_retrieval_generation',
    snapshot: snapshotFixture,
    semanticInputFingerprint: semanticInputFingerprint(snapshotFixture),
    inputs: {
      audit: {
        path: 'source-proof.json',
        sha256: hashBytes(readFileSync(join(root, 'source-proof.json'))),
      },
    },
    files: {
      candidates: writeArtifact(
        root,
        'candidates.jsonl',
        candidates.map((c) => JSON.stringify(c) + '\n').join(''),
      ),
      bundles: writeArtifact(
        root,
        'bundles.jsonl',
        JSON.stringify(bundle) + '\n',
      ),
      status: writeArtifact(
        root,
        'status.jsonl',
        [
          {
            senseKey: bundle.sense.semanticKey,
            senseId: bundle.sense.id,
            status: 'ready',
            bundleKey: bundle.bundleKey,
          },
          {
            senseKey: 'missing-fixture',
            senseId: '101',
            status: 'no_candidates',
            bundleKey: null,
          },
        ]
          .map((s) => JSON.stringify(s) + '\n')
          .join(''),
      ),
    },
    counts: { senses: 2, candidates: candidates.length, bundles: 1 },
  });
  const versions = { r1: 'fixture-r1', r2: 'fixture-r2' };
  const texts = {
    system: 'Fixture system.',
    r1: 'Fixture phase one.',
    r2: 'Fixture phase two.',
  };
  const prompt = writeJson(root, 'prompt.json', {
    system: texts.system,
    phases: { r1: texts.r1, r2: texts.r2 },
    versions,
    hashes: {
      system: hashBytes(texts.system),
      r1: hashBytes(texts.r1),
      r2: hashBytes(texts.r2),
    },
  });
  const outputs: Record<'r1' | 'r2', MappingOutput> = {
    r1: output(bundle, ['exact', 'none']),
    r2: output(bundle, ['exact', 'related']),
  };
  const requests = (['r1', 'r2'] as const).map((phase) => {
    const rendered = renderMappingBundle(
      bundle,
      phase,
      'fixture-seed',
      versions[phase],
    );
    outputs[phase].reviews.sort(
      (a, b) =>
        rendered.payload.bundle.candidates.findIndex(
          (c) => c.candidateKey === a.candidateKey,
        ) -
        rendered.payload.bundle.candidates.findIndex(
          (c) => c.candidateKey === b.candidateKey,
        ),
    );
    return {
      requestId: `${bundle.bundleKey}:${phase}`,
      phase,
      promptVersion: versions[phase],
      bundleKey: bundle.bundleKey,
      senseId: bundle.sense.id,
      contextHash: bundle.contextHash,
      renderedContextHash: rendered.renderedContextHash,
      payload: rendered.payload,
    };
  });
  const responses = writeArtifact(
    root,
    'responses.jsonl',
    requests
      .map(
        (r) =>
          JSON.stringify({
            ...r,
            state:
              incomplete && r.phase === 'r1' ? 'invalid_output' : 'complete',
            rawReply: JSON.stringify(outputs[r.phase]),
          }) + '\n',
      )
      .join(''),
  );
  const pilot = writeJson(root, 'pilot.json', {
    schemaVersion: 1,
    task: 'db4_d4_muse_pilot',
    generation: {
      ...generation,
      bundleFileSha256: hashBytes(readFileSync(join(root, 'bundles.jsonl'))),
    },
    prompt,
    requests: writeArtifact(
      root,
      'requests.jsonl',
      requests.map((r) => JSON.stringify(r) + '\n').join(''),
    ),
    counts: { bundles: 1, requests: 2, candidatesPerPhase: candidates.length },
  });
  const validation = {
    schemaVersion: 1,
    task: 'db4_d4_muse_validation',
    pilotManifest: pilot,
    responses,
    files: {
      r1: writeArtifact(
        root,
        'r1.jsonl',
        incomplete ? '' : JSON.stringify(outputs.r1) + '\n',
      ),
      r2: writeArtifact(root, 'r2.jsonl', JSON.stringify(outputs.r2) + '\n'),
    },
    counts: {
      bundlesPlanned: 1,
      requests: 2,
      validatedRequests: incomplete ? 1 : 2,
      unresolvedRequests: incomplete ? 1 : 0,
      bundlesWithBothValidatedPasses: incomplete ? 0 : 1,
    },
  };
  writeJson(root, 'validation.json', validation);
  return { candidates, bundle, validation, pilot };
}

void test('accepts only unique exact by candidate key, regardless of order/reason/confidence', () => {
  const { bundle, candidates } = pair();
  const r1 = output(bundle, ['exact', 'none']);
  const r2 = output(bundle, ['exact', 'related']);
  r2.reviews[0].reason = 'Different explanation.';
  r2.reviews[0].confidence = 0.01;
  r2.reviews.reverse();
  const result = decideMappingBundle(bundle, candidates, r1, r2);
  assert.equal(result.status, 'accept_exact');
  assert.equal(result.selectedCandidateKey, bundle.candidates[0].candidateKey);
  assert.equal(
    result.decisions.filter((d) => d.proposal === 'accept_exact').length,
    1,
  );
  assert.equal(
    result.decisions.filter((d) => d.proposal === 'defer').length,
    1,
  );
  for (const d of result.decisions)
    parseMappingDecision(
      d,
      candidates.find((c) => c.candidateKey === d.candidateKey)!,
      bundle,
      r1,
      r2,
    );
  assert.equal(result.outputHashR2, hashJson(r2));
  assert.equal(result.policyVersion, DECISION_POLICY_VERSION);
});
void test('exact/nonexact disagreement never selects a concept', () => {
  const { bundle, candidates } = pair();
  const result = decideMappingBundle(
    bundle,
    candidates,
    output(bundle, ['exact', 'none']),
    output(bundle, ['narrower', 'none']),
  );
  assert.equal(result.status, 'deferred');
  assert.equal(result.selectedConceptId, null);
  assert(
    result.decisions.some(
      (d) =>
        d.proposal === 'defer' &&
        d.reasons.some((r) => r.code === 'review_disagreement'),
    ),
  );
});

void test('batch parser pins private context and enforces the same D1 decision rules', () => {
  const { bundle, candidates } = pair();
  const r1 = output(bundle, ['exact', 'none']);
  const r2 = output(bundle, ['exact', 'none']);
  const expected = decideMappingBundle(bundle, candidates, r1, r2);
  const parse = createMappingDecisionParser(candidates, bundle, r1, r2);
  for (const decision of expected.decisions) {
    assert.deepEqual(
      parse(decision),
      parseMappingDecision(
        decision,
        candidates.find((c) => c.candidateKey === decision.candidateKey)!,
        bundle,
        r1,
        r2,
      ),
    );
  }
  const d = expected.decisions.find((d) => d.proposal === 'accept_exact')!;
  assert.throws(
    () => parse({ ...d, candidateKey: hashJson('foreign') }),
    /generation/,
  );
  assert.throws(
    () => parse({ ...d, outputHashR1: hashJson('different') }),
    /Unbound/,
  );
  assert.throws(
    () => parse({ ...d, relation: 'none', proposal: 'reject_pair' }),
    /Non-consensus/,
  );
  r1.reviews[0].relation = 'none';
  candidates[0].inputHash = hashJson('mutated caller input');
  assert.deepEqual(parse(d), d);
});
void test('a different exact per phase never breaks the tie by rank or ID', () => {
  const { bundle, candidates } = pair();
  const result = decideMappingBundle(
    bundle,
    candidates,
    output(bundle, ['exact', 'none']),
    output(bundle, ['none', 'exact']),
  );
  assert.equal(result.status, 'deferred');
  assert(result.decisions.every((d) => d.proposal === 'defer'));
});
void test('ambiguity or unresolved scope blocks every decision in the bundle', () => {
  const { bundle, candidates } = pair();
  for (const r2 of [
    output(bundle, ['exact', 'exact']),
    output(bundle, ['exact', 'uncertain']),
  ]) {
    const result = decideMappingBundle(
      bundle,
      candidates,
      output(bundle, ['exact', 'none']),
      r2,
    );
    assert.equal(result.selectedCandidateKey, null);
    assert(result.decisions.every((d) => d.proposal === 'defer'));
  }
});
void test('agreed nonexact stays a separate proposal, never selects an equivalent', () => {
  const { bundle, candidates } = pair();
  for (const relation of ['broader', 'narrower', 'related'] as const) {
    const o = output(bundle, [relation, 'none']);
    const result = decideMappingBundle(bundle, candidates, o, o);
    assert.equal(result.selectedConceptId, null);
    assert.equal(
      result.decisions.filter((d) => d.proposal === 'accept_nonexact').length,
      1,
    );
  }
});
void test('all-none scopes no-match to shortlist and preserves output unresolved reasons', () => {
  const { bundle, candidates } = pair();
  const o = output(bundle, ['none', 'none']);
  const rejected = decideMappingBundle(bundle, candidates, o, o);
  assert.equal(rejected.status, 'no_suitable_shortlist');
  assert(rejected.decisions.every((d) => d.proposal === 'reject_pair'));
  o.unresolvedReason = {
    code: 'no_suitable_concept',
    detail: 'No match in the supplied shortlist.',
  };
  const deferred = decideMappingBundle(bundle, candidates, o, o);
  assert.equal(deferred.status, 'no_suitable_shortlist');
  assert(deferred.decisions.every((d) => d.proposal === 'defer'));
});
void test('missing phase has no D1 decisions or invented hashes', () => {
  const { bundle, candidates } = pair();
  const result = decideMappingBundle(
    bundle,
    candidates,
    null,
    output(bundle, ['exact', 'none']),
  );
  assert.equal(result.status, 'incomplete');
  assert.equal(result.outputHashR1, null);
  assert.deepEqual(result.incompletePhases, ['r1']);
  assert.deepEqual(result.decisions, []);
});
void test('invalid coverage, foreign output and stale source context fail closed', () => {
  const { bundle, candidates } = pair();
  const o = output(bundle, ['exact', 'none']);
  assert.throws(() =>
    decideMappingBundle(
      bundle,
      candidates,
      { ...o, bundleKey: hashJson('foreign') },
      o,
    ),
  );
  const missing = structuredClone(o);
  missing.reviews[0].coveredBranches = [];
  assert.throws(() => decideMappingBundle(bundle, candidates, missing, o));
  const altered = structuredClone(bundle);
  altered.senseContext.enGlosses[0].text = 'Different sense.';
  assert.throws(() => decideMappingBundle(altered, candidates, o, o));
});
void test('artifact adapter preserves all targets and is deterministic/idempotent', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'langoo-db4-d3-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  adapterFixture(root);
  const result = decideMuseReview(root, 'pilot.json', 'validation.json');
  assert.deepEqual(
    decideMuseReview(root, 'pilot.json', 'validation.json'),
    result,
  );
  assert.equal(result.counts.retrievalTargets, 2);
  assert.equal(result.counts.targetsWithoutBundle, 1);
  assert.equal(result.counts.exactProposals, 1);
  const saved = JSON.parse(readArtifact(root, result.manifest).toString()) as {
    files: { exactProposals: { path: string; sha256: string } };
    apply: boolean;
    promotionReady: boolean;
    semanticQualityValidated: boolean;
  };
  assert.equal(saved.apply, false);
  assert.equal(saved.promotionReady, false);
  assert.equal(saved.semanticQualityValidated, false);
  const exact = JSON.parse(
    readArtifact(root, saved.files.exactProposals).toString(),
  ) as { verified: boolean; calibratedScore: null };
  assert.equal(exact.verified, false);
  assert.equal(exact.calibratedScore, null);
});
void test('incomplete source response never borrows another phase to manufacture consensus', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'langoo-db4-d3-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  adapterFixture(root, true);
  const result = decideMuseReview(root, 'pilot.json', 'validation.json');
  assert.equal(result.counts.exactProposals, 0);
  assert.equal(result.counts.candidateDecisions, 0);
  assert.equal(result.counts.bundleStatuses.incomplete, 1);
});
void test('altered normalized verdict is rejected even when its file hash is updated', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'langoo-db4-d3-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { validation } = adapterFixture(root);
  const value = JSON.parse(
    readFileSync(join(root, 'r1.jsonl'), 'utf8'),
  ) as MappingOutput;
  value.reviews[0].reason = 'Edited after validation.';
  const content = JSON.stringify(value) + '\n';
  writeFileSync(join(root, 'r1.jsonl'), content);
  validation.files.r1.sha256 = hashBytes(content);
  writeFileSync(join(root, 'validation.json'), JSON.stringify(validation));
  assert.throws(
    () => decideMuseReview(root, 'pilot.json', 'validation.json'),
    /differs from source/,
  );
  assert.equal(existsSync(join(root, 'muse-d3-v1')), false);
});
void test('source proof drift and dishonest validated counts are integrity failures', (t) => {
  for (const mode of ['proof', 'counts'] as const) {
    const root = mkdtempSync(join(tmpdir(), 'langoo-db4-d3-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const { validation } = adapterFixture(root);
    if (mode === 'proof')
      writeFileSync(join(root, 'source-proof.json'), 'changed');
    else {
      validation.counts.validatedRequests = 1;
      writeFileSync(join(root, 'validation.json'), JSON.stringify(validation));
    }
    assert.throws(
      () => decideMuseReview(root, 'pilot.json', 'validation.json'),
      mode === 'proof' ? /hash mismatch/ : /count mismatch/,
    );
    assert.equal(existsSync(join(root, 'muse-d3-v1')), false);
  }
});

void test('oversized batches and files stop before producing decision artifacts', (t) => {
  for (const mode of ['batch', 'file'] as const) {
    const root = mkdtempSync(join(tmpdir(), 'langoo-db4-d3-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const { validation } = adapterFixture(root);
    if (mode === 'file')
      truncateSync(
        join(root, 'validation.json'),
        MAX_DECISION_ARTIFACT_BYTES + 1,
      );
    else {
      const generation = JSON.parse(
        readFileSync(join(root, 'generation.json'), 'utf8'),
      ) as { counts: { senses: number } };
      generation.counts.senses = MAX_DECISION_TARGETS + 1;
      const generationBytes = JSON.stringify(generation);
      writeFileSync(join(root, 'generation.json'), generationBytes);
      const pilot = JSON.parse(
        readFileSync(join(root, 'pilot.json'), 'utf8'),
      ) as { generation: { sha256: string } };
      pilot.generation.sha256 = hashBytes(generationBytes);
      const pilotBytes = JSON.stringify(pilot);
      writeFileSync(join(root, 'pilot.json'), pilotBytes);
      validation.pilotManifest.sha256 = hashBytes(pilotBytes);
      writeFileSync(join(root, 'validation.json'), JSON.stringify(validation));
    }
    assert.throws(
      () => decideMuseReview(root, 'pilot.json', 'validation.json'),
      /exceeds/,
    );
    assert.equal(existsSync(join(root, 'muse-d3-v1')), false);
  }
});
