import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import {
  BigintIdSchema,
  DisplayPrioritySchema,
  MappingAttemptSchema,
  MappingRunStatusSchema,
  assertMappingDatabaseTarget,
  assertTargetTransition,
  canonicalJson,
  conceptSemanticKey,
  createMappingBundle,
  createMappingCandidate,
  createMappingReservation,
  evaluateMappingGate,
  hashBytes,
  hashJson,
  mappingTargetKey,
  jobBudgetUsage,
  mappingCacheKey,
  parseMappingAudit,
  parseMappingBundle,
  parseMappingCandidates,
  parseMappingCli,
  parseMappingDecision,
  parseMappingJob,
  parseMappingJobBound,
  parseMappingOutput,
  promotionBaselineFingerprint,
  renderMappingBundle,
  semanticInputFingerprint,
  textRowHash,
  transitionMappingTarget,
  verifyArtifactBytes,
} from './_mapping-types';
import {
  candidateInputFixture,
  fixtureCase,
  jobFixture,
  pilotFixture,
  semanticCases,
  snapshotFixture,
} from './fixtures/build';

void test('fixture job binds manifest, phase renders, bundle identity and raw artifact bytes', () => {
  const job = jobFixture();
  const f = fixtureCase();
  parseMappingJobBound(job, [f.bundle], pilotFixture());
  for (const ref of [
    job.snapshot,
    job.pilotManifest,
    job.entries[0].bundle,
    job.providers.r1.rate.evidence,
    ...f.candidate.sources[0].audit.evidence,
  ])
    verifyArtifactBytes(ref, readFileSync(resolve(__dirname, ref.path)));
  assert.throws(() => verifyArtifactBytes(job.snapshot, 'altered file'));
  assert.throws(() => parseMappingJobBound(job, [], pilotFixture()));
  assert.throws(() =>
    parseMappingJobBound(job, [f.bundle], {
      ...pilotFixture(),
      seed: 'other-seed',
    }),
  );
});
void test('multiple equivalent candidates require ambiguity and cannot be accepted exact', () => {
  const f = fixtureCase();
  const input = candidateInputFixture();
  input.concept.id = '999';
  input.concept.synsetKeys[0].synsetId = 'second-cat-n';
  input.concept.semanticKey = conceptSemanticKey(
    input.concept.synsetKeys,
    input.concept.ili,
  );
  input.evidence
    .filter((e) => e.owner.type === 'concept')
    .forEach((e) => {
      e.owner.semanticKey = input.concept.semanticKey;
    });
  const other = createMappingCandidate(input);
  const bundle = createMappingBundle([f.candidate, other], 'fixture-bundle-v1');
  const output = {
    ...f.outputR1,
    bundleKey: bundle.bundleKey,
    contextHash: bundle.contextHash,
    reviews: bundle.candidates.map((c) => ({
      ...f.outputR1.reviews[0],
      candidateKey: c.candidateKey,
      conceptId: c.concept.id!,
    })),
  };
  assert.throws(() => parseMappingOutput(output, bundle), /Ambiguity/);
  const ambiguous = {
    ...output,
    unresolvedReason: {
      code: 'ambiguous_concepts',
      detail: 'Two concepts match equally.',
    },
  };
  parseMappingOutput(ambiguous, bundle);
  assert.throws(
    () =>
      parseMappingDecision(
        {
          ...f.decision,
          outputHashR1: hashJson(ambiguous),
          outputHashR2: hashJson(ambiguous),
        },
        f.candidate,
        bundle,
        ambiguous,
        ambiguous,
      ),
    /Non-consensus/,
  );
});
void test('reservation rounds up using integer rates and includes output and reasoning', () => {
  const provider = jobFixture().providers.r1;
  provider.rate.inputMicrousdPerMillion = 1;
  provider.rate.outputMicrousdPerMillion = 2;
  provider.rate.reasoningMicrousdPerMillion = 3;
  assert.deepEqual(
    createMappingReservation(provider, {
      inputTokens: 1,
      outputTokens: 1,
      reasoningTokens: 1,
    }),
    {
      inputTokens: 1,
      outputTokens: 1,
      reasoningTokens: 1,
      tokens: 3,
      costMicrousd: 1,
    },
  );
  const job = dispatchedJob();
  job.attempts[0].reservation.tokens = 1;
  assert.throws(() => parseMappingJob(job), /reservation/);
});
void test('semantic identity cannot hide changed source anchors or merge lexicons by ILI', () => {
  const input = candidateInputFixture();
  input.sense.identity!.externalId = 'another-entry';
  assert.throws(() => createMappingCandidate(input), /source identity/);
  const sameIli = 'i123';
  assert.notEqual(
    conceptSemanticKey([{ lexicon: 'wn-a', synsetId: '123-n' }], sameIli),
    conceptSemanticKey([{ lexicon: 'wn-b', synsetId: '123-n' }], sameIli),
  );
  const forged = candidateInputFixture();
  forged.concept.synsetKeys[0].lexicon = 'other-lexicon';
  assert.throws(() => createMappingCandidate(forged), /lexicon\/synset\/ILI/);
});
void test('retry transition cannot erase a dispatched attempt or reset its reservation', () => {
  const job = dispatchedJob();
  const key = job.entries[0].targetKey;
  assert.throws(
    () => transitionMappingTarget(job, key, 'r1_running', { attempts: [] }),
    /shrink/,
  );
  const attempts = structuredClone(job.attempts);
  attempts[0].reservation.costMicrousd = 0;
  assert.throws(
    () => transitionMappingTarget(job, key, 'r1_running', { attempts }),
    /overwritten/,
  );
});
void test('validated phase cache can advance a fresh target without charging a new request', () => {
  const job = jobFixture();
  const entry = job.entries[0];
  const ref = { path: 'cache/validated.json', sha256: hashJson('validated') };
  const hit = MappingAttemptSchema.parse({
    index: 1,
    phase: 'r1',
    kind: 'cache',
    cacheOrigin: ref,
    targetKey: entry.targetKey,
    renderedContextHash: entry.renderedR1,
    cacheKey: mappingCacheKey(job.providers.r1, 'r1', entry.renderedR1),
    startedAt: '2026-10-06T00:00:00Z',
    finishedAt: '2026-10-06T00:00:00Z',
    outcome: 'response',
    retryReason: null,
    reservation: {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      tokens: 0,
      costMicrousd: 0,
    },
    actualUsage: { tokens: 0, costMicrousd: 0 },
    rawResponse: ref,
    validatedOutput: ref,
  });
  const received = transitionMappingTarget(
    job,
    entry.targetKey,
    'r1_received',
    { attempts: [hit], status: 'running' },
  );
  const validated = transitionMappingTarget(
    received,
    entry.targetKey,
    'r1_validated',
  );
  assert.equal(validated.entries[0].state, 'r1_validated');
  assert.deepEqual(jobBudgetUsage(validated), {
    requests: 0,
    tokens: 0,
    costMicrousd: 0,
    unknownRequests: 0,
  });
  const missingOrigin = structuredClone(received);
  missingOrigin.attempts[0].cacheOrigin = null;
  assert.throws(() => parseMappingJob(missingOrigin), /Cache hit/);
});
void test('invalid received output can retry within cap; durable validated response cannot', () => {
  const running = dispatchedJob();
  const attempts = structuredClone(running.attempts);
  attempts[0].outcome = 'response';
  attempts[0].finishedAt = '2026-10-06T00:00:01Z';
  attempts[0].rawResponse = {
    path: 'responses/invalid.json',
    sha256: hashJson('invalid'),
  };
  const received = transitionMappingTarget(
    running,
    running.entries[0].targetKey,
    'r1_received',
    { attempts },
  );
  const retry = structuredClone(running.attempts[0]);
  retry.index = 2;
  retry.retryReason = 'schema mismatch';
  retry.startedAt = '2026-10-06T00:00:02Z';
  const retried = transitionMappingTarget(
    received,
    received.entries[0].targetKey,
    'r1_running',
    { attempts: [...attempts, retry] },
  );
  assert.equal(retried.attempts.length, 2);
  attempts[0].validatedOutput = {
    path: 'responses/valid.json',
    sha256: hashJson('valid'),
  };
  assert.throws(
    () =>
      transitionMappingTarget(
        received,
        received.entries[0].targetKey,
        'r1_running',
        { attempts: [...attempts, retry] },
      ),
    /validated result/,
  );
});
void test('pilot A requires 100 targets, at least 98 passing decisions and no severe/unknown requests', () => {
  const keys = Array.from({ length: 100 }, (_, i) =>
    mappingTargetKey(`sense:${i}`, hashJson('snapshot')),
  ).sort();
  const ref = { path: 'reviews/audit.json', sha256: hashJson('audit') };
  const manifest = {
    schemaVersion: 1,
    mode: 'production',
    pilot: 'A',
    semanticInputFingerprint: hashJson('snapshot'),
    policyVersion: 'audit-v1',
    seed: 'sample-1',
    targetKeys: keys,
    positiveTargetKeys: [],
    hardNegativeTargetKeys: [],
    strata: keys.map((targetKey) => ({
      targetKey,
      jlptLevel: 5,
      isPrimary: true,
      lexemeKey: targetKey,
    })),
    exclusions: [],
  };
  const gate = {
    schemaVersion: 1,
    pilotManifestHash: hashJson(manifest),
    policyVersion: manifest.policyVersion,
    report: ref,
    budgetReport: ref,
    targetAudits: keys.map((targetKey, i) => ({
      targetKey,
      verdict: i < 98 ? 'pass' : 'fail',
      severity: 'none',
      audit: ref,
      twoPassValidated: true,
      noCandidatesAudited: false,
      proposalAudited: true,
    })),
    budgetWithinCaps: true,
    unknownRequests: 0,
  };
  assert.equal(evaluateMappingGate(manifest, gate).eligible, true);
  gate.targetAudits[98].severity = 'severe';
  assert.equal(evaluateMappingGate(manifest, gate).eligible, false);
  gate.targetAudits[98].severity = 'none';
  gate.unknownRequests = 1;
  assert.equal(evaluateMappingGate(manifest, gate).eligible, false);
  gate.unknownRequests = 0;
  gate.targetAudits[0].verdict = 'deferred';
  assert.equal(evaluateMappingGate(manifest, gate).eligible, false);
});

void test('canonical JSON has pinned order, preserves original text and rejects lossy values', () => {
  assert.equal(
    canonicalJson({ z: null, a: ['猫', { y: 2, x: 1 }] }),
    '{"a":["猫",{"x":1,"y":2}],"z":null}',
  );
  assert.equal(
    hashBytes('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  assert.equal(hashJson({ b: 1, a: '猫' }), hashJson({ a: '猫', b: 1 }));
  assert.notEqual(hashJson('cat'), hashJson(' cat '));
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  const sparse = new Array<unknown>(2);
  sparse[1] = 'x';
  for (const value of [
    undefined,
    1n,
    NaN,
    Infinity,
    -0,
    new Date(),
    sparse,
    { x: undefined },
    cycle,
  ])
    assert.throws(() => canonicalJson(value));
});
void test('bigint IDs retain precision and reject PG overflow, leading zeros, numeric IDs', () => {
  assert.equal(
    BigintIdSchema.parse('9223372036854775807'),
    '9223372036854775807',
  );
  for (const value of [
    '9223372036854775808',
    '01',
    '0',
    9007199254740992,
    '-1',
  ])
    assert.equal(BigintIdSchema.safeParse(value).success, false);
});
void test('checked-in fixture hashes and all bound contracts match their deterministic builders', () => {
  const directory = resolve(__dirname, 'fixtures');
  const manifest = JSON.parse(
    readFileSync(resolve(directory, 'manifest.json'), 'utf8'),
  ) as { entries: { path: string; sha256: string }[] };
  for (const entry of manifest.entries)
    assert.equal(
      hashBytes(readFileSync(resolve(directory, entry.path))),
      entry.sha256,
    );
  semanticCases.forEach((semanticCase, i) => {
    const disk: unknown = JSON.parse(
      readFileSync(resolve(directory, `${semanticCase.key}.json`), 'utf8'),
    );
    assert.deepEqual(disk, fixtureCase(i));
    const f = fixtureCase(i);
    parseMappingCandidates([f.candidate]);
    parseMappingBundle(f.bundle, [f.candidate]);
    parseMappingOutput(f.outputR1, f.bundle);
    parseMappingDecision(
      f.decision,
      f.candidate,
      f.bundle,
      f.outputR1,
      f.outputR2,
    );
    parseMappingAudit(f.audit, f.decision);
  });
});
void test('semantic fingerprint has a closed input: derived VI is not an unnoticed dependency', () => {
  const fingerprint = semanticInputFingerprint(snapshotFixture);
  assert.equal(
    fingerprint,
    semanticInputFingerprint(structuredClone(snapshotFixture)),
  );
  assert.throws(() =>
    semanticInputFingerprint({ ...snapshotFixture, glossVi: 'mèo' }),
  );
  for (const field of [
    'senseInputHash',
    'conceptInputHash',
    'rawAttributesHash',
    'identityHash',
  ] as const)
    assert.notEqual(
      fingerprint,
      semanticInputFingerprint({
        ...snapshotFixture,
        [field]: hashJson('changed'),
      }),
    );
  assert.notEqual(
    fingerprint,
    semanticInputFingerprint({ ...snapshotFixture, normalizerVersion: 'v2' }),
  );
  const baseline = {
    schemaVersion: 1,
    targetIdentityHash: hashJson('id'),
    existingLinksHash: hashJson('links'),
    candidateDecisionsHash: hashJson('decisions'),
    conceptPolicyHash: hashJson('policy'),
    migrationsHash: hashJson('migrations'),
    servingDefinitionHash: hashJson('view'),
  };
  assert.notEqual(
    promotionBaselineFingerprint(baseline),
    promotionBaselineFingerprint({
      ...baseline,
      existingLinksHash: hashJson('new links'),
    }),
  );
});
void test('candidate hash binds full gloss groups, evidence and provenance; rank is a sidecar', () => {
  const original = candidateInputFixture();
  const before = createMappingCandidate(original);
  const changed = structuredClone(original);
  changed.senseContext.enGlosses[1].text = 'a different secondary branch';
  changed.evidence.find(
    (e) => e.key === changed.senseContext.enGlosses[1].evidenceKey,
  )!.payloadHash = textRowHash(changed.senseContext.enGlosses[1]);
  const after = createMappingCandidate(changed);
  assert.equal(before.pairKey, after.pairKey);
  assert.notEqual(before.inputHash, after.inputHash);
  assert.notEqual(before.candidateKey, after.candidateKey);
  const ranked = structuredClone(original);
  ranked.retrieval.rankScore = 0.99;
  assert.equal(
    createMappingCandidate(ranked).candidateKey,
    before.candidateKey,
  );
  assert.throws(() =>
    parseMappingCandidates([{ ...before, inputHash: hashJson('forged') }]),
  );
});
void test('strict schema rejects wrong families, unknown fields, false calibration and unquantized scores', () => {
  const original = candidateInputFixture();
  for (const value of [
    { ...original, extra: true },
    { ...original, candidateType: 'translation_target' },
    { ...original, retrieval: { ...original.retrieval, calibratedScore: 0.9 } },
    { ...original, retrieval: { ...original.retrieval, rankScore: 0.1234567 } },
  ])
    assert.throws(() => createMappingCandidate(value));
});
void test('ready cannot bypass source audit, stable identity or concept definitions', () => {
  const blocked = candidateInputFixture();
  blocked.sources[0].audit = {
    status: 'blocked',
    evidence: [],
    reasons: ['License unverified'],
  };
  assert.throws(() => createMappingCandidate(blocked));
  blocked.classification = 'blocked_source';
  blocked.reasons = [{ code: 'blocked_source', detail: 'License unverified' }];
  const candidate = createMappingCandidate(blocked);
  assert.throws(() => createMappingBundle([candidate], 'v1'));
  const missing = candidateInputFixture();
  missing.sense.identity = null;
  assert.throws(() => createMappingCandidate(missing));
  const noDefinitions = candidateInputFixture();
  noDefinitions.conceptContext.definitions = [];
  assert.throws(() => createMappingCandidate(noDefinitions));
  const unverified = candidateInputFixture();
  unverified.sources[0].license = 'CẦN XÁC MINH';
  assert.throws(() => createMappingCandidate(unverified));
});
void test('evidence must bind row contents, correct owner, audited source hash and batch', () => {
  const mutations = [
    (c: ReturnType<typeof candidateInputFixture>) => {
      c.senseContext.enGlosses[0].text = 'forged';
    },
    (c: ReturnType<typeof candidateInputFixture>) => {
      c.evidence[0].owner.semanticKey = 'another-sense';
    },
    (c: ReturnType<typeof candidateInputFixture>) => {
      c.evidence[0].sourceHash = hashJson('other snapshot');
    },
    (c: ReturnType<typeof candidateInputFixture>) => {
      c.evidence[0].batchId = '00000000-0000-4000-8000-000000000001';
    },
    (c: ReturnType<typeof candidateInputFixture>) => {
      c.senseContext.metadata.appliesToKana = ['ねこ'];
    },
  ];
  for (const mutate of mutations) {
    const c = candidateInputFixture();
    mutate(c);
    assert.throws(() => createMappingCandidate(c));
  }
});
void test('ID ordering uses bigint, and one pair cannot appear twice under another hypothesis', () => {
  const input = candidateInputFixture();
  input.senseContext.enGlosses.forEach((r) => {
    r.rank = 0;
  });
  for (const r of input.senseContext.enGlosses)
    input.evidence.find((e) => e.key === r.evidenceKey)!.payloadHash =
      textRowHash(r);
  createMappingCandidate(input);
  input.senseContext.enGlosses.reverse();
  assert.throws(() => createMappingCandidate(input));
  const first = createMappingCandidate(candidateInputFixture());
  const other = { ...first, hypothesisRelation: 'broader' };
  assert.throws(
    () => parseMappingCandidates([first, other]),
    /Duplicate canonical pair/,
  );
});
void test('bundle excludes retrieval score, hypothesis and legacy results; R2 rendering is phase scoped', () => {
  const f = fixtureCase();
  const serialized = canonicalJson(f.bundle);
  for (const key of [
    'rankScore',
    'hypothesisRelation',
    'legacyDecision',
    'outputR1',
  ])
    assert.equal(serialized.includes(key), false);
  const r1 = renderMappingBundle(f.bundle, 'r1', 'seed', 'r1-v1');
  const r2 = renderMappingBundle(f.bundle, 'r2', 'seed', 'r2-v1');
  assert.equal(r1.contextHash, r2.contextHash);
  assert.notEqual(r1.renderedContextHash, r2.renderedContextHash);
  assert.deepEqual(r2, renderMappingBundle(f.bundle, 'r2', 'seed', 'r2-v1'));
  const forged = structuredClone(f.bundle);
  forged.senseContext.enGlosses[0].text = 'poisoned';
  assert.throws(() => parseMappingBundle(forged, [f.candidate]));
});
void test('output echoes identity and exact shortlist; extra/missing/duplicate verdicts fail', () => {
  const f = fixtureCase();
  const bad = [
    { ...f.outputR1, senseId: '999' },
    { ...f.outputR1, contextHash: hashJson('other context') },
    { ...f.outputR1, reviews: [] },
    { ...f.outputR1, reviews: [f.outputR1.reviews[0], f.outputR1.reviews[0]] },
    {
      ...f.outputR1,
      reviews: [{ ...f.outputR1.reviews[0], conceptId: '999' }],
    },
    {
      ...f.outputR1,
      reviews: [{ ...f.outputR1.reviews[0], candidateKey: hashJson('extra') }],
    },
  ];
  bad.forEach((o) => assert.throws(() => parseMappingOutput(o, f.bundle)));
});
void test('exact requires all source branches, with no invented coverage/conflict refs', () => {
  const f = fixtureCase(6);
  const partial = structuredClone(f.outputR1);
  partial.reviews[0].relation = 'exact';
  partial.reviews[0].coveredBranches = [f.bundle.sourceBranches[0]];
  partial.reviews[0].missingBranches = [f.bundle.sourceBranches[1]];
  assert.throws(() => parseMappingOutput(partial, f.bundle), /full coverage/);
  const foreign = structuredClone(f.outputR1);
  foreign.reviews[0].coveredBranches[0] = 'invented';
  assert.throws(() => parseMappingOutput(foreign, f.bundle));
  const conflict = structuredClone(f.outputR1);
  conflict.reviews[0].conflicts = [
    {
      code: 'pos_conflict',
      sourceEvidenceKeys: ['invented'],
      conceptEvidenceKeys: [],
      detail: 'Wrong POS',
    },
  ];
  assert.throws(() => parseMappingOutput(conflict, f.bundle), /Invented/);
});
void test('uncertain is a valid result, not a retry signal; noSuitableCandidate is coherent', () => {
  const f = fixtureCase(5);
  parseMappingOutput(f.outputR1, f.bundle);
  assert.throws(() =>
    parseMappingOutput({ ...f.outputR1, unresolvedReason: null }, f.bundle),
  );
  const none = fixtureCase(4);
  parseMappingOutput(none.outputR1, none.bundle);
  assert.throws(() =>
    parseMappingOutput(
      { ...none.outputR1, noSuitableCandidate: false },
      none.bundle,
    ),
  );
});
void test('disagreement cannot be accepted and decision/audit hashes cannot be swapped', () => {
  const f = fixtureCase();
  const r2 = structuredClone(f.outputR2);
  r2.reviews[0].relation = 'broader';
  assert.throws(() =>
    parseMappingDecision(
      { ...f.decision, outputHashR2: hashJson(r2) },
      f.candidate,
      f.bundle,
      f.outputR1,
      r2,
    ),
  );
  assert.throws(() =>
    parseMappingAudit(
      { ...f.audit, decisionHash: hashJson('foreign decision') },
      f.decision,
    ),
  );
  assert.throws(() =>
    parseMappingAudit({ ...f.audit, severity: 'severe' }, f.decision),
  );
});

function dispatchedJob() {
  const job = jobFixture();
  const entry = job.entries[0];
  const attempt = MappingAttemptSchema.parse({
    index: 1,
    phase: 'r1',
    kind: 'review',
    cacheOrigin: null,
    targetKey: entry.targetKey,
    renderedContextHash: entry.renderedR1,
    cacheKey: mappingCacheKey(job.providers.r1, 'r1', entry.renderedR1),
    startedAt: '2026-10-06T00:00:00Z',
    finishedAt: null,
    outcome: 'in_flight',
    retryReason: null,
    reservation: {
      inputTokens: 1000,
      outputTokens: 4096,
      reasoningTokens: 0,
      tokens: 5096,
      costMicrousd: 200,
    },
    actualUsage: null,
    rawResponse: null,
    validatedOutput: null,
  });
  return transitionMappingTarget(job, entry.targetKey, 'r1_running', {
    attempts: [attempt],
    status: 'running',
  });
}
void test('checkpoint transitions reserve before dispatch and distinguish received from validated', () => {
  const job = dispatchedJob();
  const key = job.entries[0].targetKey;
  assert.deepEqual(jobBudgetUsage(job), {
    requests: 1,
    tokens: 5096,
    costMicrousd: 200,
    unknownRequests: 0,
  });
  assert.throws(() => transitionMappingTarget(job, key, 'r1_validated'));
  const attempts = structuredClone(job.attempts);
  attempts[0].outcome = 'response';
  attempts[0].finishedAt = '2026-10-06T00:00:01Z';
  attempts[0].rawResponse = {
    path: 'responses/raw.json',
    sha256: hashJson('raw'),
  };
  const received = transitionMappingTarget(job, key, 'r1_received', {
    attempts,
  });
  assert.throws(() => transitionMappingTarget(received, key, 'r1_validated'));
  attempts[0].validatedOutput = {
    path: 'responses/validated.json',
    sha256: hashJson('normalized'),
  };
  const validated = transitionMappingTarget(received, key, 'r1_validated', {
    attempts,
  });
  assert.equal(validated.entries[0].state, 'r1_validated');
});
void test('unknown dispatch retains reservation and blocks automatic retries', () => {
  const job = dispatchedJob();
  job.entries[0].state = 'error';
  job.entries[0].reason = 'Timeout after dispatch';
  job.attempts[0].outcome = 'unknown';
  job.attempts[0].finishedAt = '2026-10-06T00:01:00Z';
  parseMappingJob(job);
  assert.equal(jobBudgetUsage(job).costMicrousd, 200);
  assert.equal(jobBudgetUsage(job).unknownRequests, 1);
  const retry = structuredClone(job.attempts[0]);
  retry.index = 2;
  retry.retryReason = 'retry timeout';
  job.attempts.push(retry);
  assert.throws(() => parseMappingJob(job), /unresolved dispatch/);
});
void test('R2 before R1 validation, phase cache reuse and frozen job overrides are rejected', () => {
  const job = dispatchedJob();
  const a = job.attempts[0];
  a.phase = 'r2';
  a.renderedContextHash = job.entries[0].renderedR2;
  a.cacheKey = mappingCacheKey(job.providers.r2, 'r2', a.renderedContextHash);
  job.entries[0].state = 'r2_running';
  assert.throws(() => parseMappingJob(job), /R2 before/);
  const clean = jobFixture();
  assert.notEqual(
    mappingCacheKey(clean.providers.r1, 'r1', clean.entries[0].renderedR1),
    mappingCacheKey(clean.providers.r1, 'r2', clean.entries[0].renderedR1),
  );
  clean.caps.maxRequests = 221;
  assert.throws(() => parseMappingJob(clean), /configuration/);
});
void test('budget/concurrency and false completion are rejected', () => {
  const job = dispatchedJob();
  job.attempts[0].reservation.costMicrousd = job.caps.maxCostMicrousd + 1;
  assert.throws(() => parseMappingJob(job), /budget/);
  const concurrent = dispatchedJob();
  const copy = structuredClone(concurrent.attempts[0]);
  copy.index = 2;
  concurrent.attempts.push(copy);
  assert.throws(() => parseMappingJob(concurrent), /concurrency/);
  const incomplete = jobFixture();
  incomplete.status = 'completed';
  assert.throws(() => parseMappingJob(incomplete), /Incomplete/);
  assert.throws(() => assertTargetTransition('queued', 'eligible'));
  assert.throws(() => assertTargetTransition('promoted', 'queued'));
  assert.equal(
    MappingRunStatusSchema.safeParse('awaiting_audit').success,
    false,
  );
});
void test('small or synthetic pilot cannot become an eligible production gate', () => {
  const manifest = pilotFixture();
  const key = manifest.targetKeys[0];
  const ref = { path: 'reviews/synthetic.json', sha256: hashJson('synthetic') };
  const gate = {
    schemaVersion: 1,
    pilotManifestHash: hashJson(manifest),
    policyVersion: manifest.policyVersion,
    report: ref,
    budgetReport: ref,
    targetAudits: [
      {
        targetKey: key,
        verdict: 'pass',
        severity: 'none',
        audit: ref,
        twoPassValidated: true,
        noCandidatesAudited: false,
        proposalAudited: true,
      },
    ],
    budgetWithinCaps: true,
    unknownRequests: 0,
  };
  const result = evaluateMappingGate(manifest, gate);
  assert.equal(result.eligible, false);
  assert.equal(result.targets, 1);
  assert.ok(result.reasons.includes('fixture_only'));
  assert.ok(result.reasons.includes('pilot_a_sample_or_accuracy'));
  assert.throws(
    () => evaluateMappingGate(manifest, { ...gate, targetAudits: [] }),
    /denominator/,
  );
  assert.throws(() => evaluateMappingGate(manifest, { ...gate, passed: true }));
});
void test('display priority is separate from mapping confidence; measured frequency needs evidence', () => {
  const priority = {
    schemaVersion: 1,
    senseKey: 'sense:1',
    displayPriority: 1,
    priorityBasis: 'source_order',
    measuredFrequency: null,
    evidenceRefs: [],
    policyVersion: 'priority-v1',
  };
  DisplayPrioritySchema.parse(priority);
  assert.equal(
    DisplayPrioritySchema.safeParse({ ...priority, measuredFrequency: 0 })
      .success,
    false,
  );
  assert.equal(
    DisplayPrioritySchema.safeParse({
      ...priority,
      priorityBasis: 'corpus_frequency',
    }).success,
    false,
  );
});
void test('CLI has strict command-specific flags, explicit effects and immutable resume config', () => {
  assert.equal(
    parseMappingCli('mapping-generate', ['--export', 'exports/input.json'])
      .effect,
    'read_only',
  );
  assert.equal(
    parseMappingCli('mapping-review', [
      '--job',
      'jobs/j.json',
      '--resume',
      '--generate',
    ]).effect,
    'provider',
  );
  for (const args of [
    ['--job', 'jobs/j.json'],
    ['--job', 'jobs/j.json', '--resume', '--generate', '--provider', 'stub'],
    [
      '--job',
      'jobs/j.json',
      '--generate',
      '--bundles',
      'b/m.json',
      '--provider',
      'unknown',
    ],
    ['--job', 'jobs/j.json', '--resume', '--generate', '--limit', '1'],
  ])
    assert.throws(() => parseMappingCli('mapping-review', args));
  for (const args of [
    ['--export', '../input.json'],
    ['--export', '/tmp/input.json'],
    ['--export', 'x', '--export', 'y'],
    ['--export=x'],
    ['--export', 'x', 'stray'],
    ['--export', 'x', '--generate'],
  ])
    assert.throws(() => parseMappingCli('mapping-generate', args));
});
void test('CLI database actions require target guard and local test opt-in', () => {
  assert.throws(() => parseMappingCli('mapping-import', ['--plan', 'p.json']));
  assert.throws(() =>
    parseMappingCli('mapping-import', [
      '--plan',
      'p.json',
      '--apply',
      '--dry-run',
      '--allow-db',
      'langoo',
    ]),
  );
  const cli = parseMappingCli('mapping-import', [
    '--plan',
    'p.json',
    '--apply',
    '--allow-db',
    'langoo_test',
    '--allow-test',
  ]);
  assertMappingDatabaseTarget(cli, {
    database: 'langoo_test',
    host: '127.0.0.1',
  });
  assert.throws(() =>
    assertMappingDatabaseTarget(cli, { database: 'langoo', host: '127.0.0.1' }),
  );
  assert.throws(() =>
    assertMappingDatabaseTarget(cli, {
      database: 'langoo_test',
      host: 'vps.example',
    }),
  );
  assert.throws(() =>
    parseMappingCli('mapping-promote', [
      '--plan',
      'p.json',
      '--rollback',
      'j.json',
      '--dry-run',
    ]),
  );
});
