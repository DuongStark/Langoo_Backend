import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  BigintIdSchema,
  GlossCandidateSchema,
  GlossJobSchema,
  createGlossCandidate,
  parseGlossCandidate,
  parseGlossJob,
  parseGlossOutput,
  computeGlossCacheKey,
  hashGlossText,
  validateGlossJobCandidates,
  createGlossJob,
  validateGlossReview,
  hashGlossOutput,
  type GlossReview,
  type GlossCandidate,
  type GlossJob,
} from './_gloss-types';

const dir = path.join(__dirname, 'fixtures', 'gloss');
function jsonl(file: string): unknown[] {
  return readFileSync(path.join(dir, file), 'utf8')
    .trim()
    .split('\n')
    .map((s): unknown => JSON.parse(s));
}
const candidates = jsonl('candidates-v1.jsonl').map(parseGlossCandidate);
const ready = candidates[0];
if (ready.classification !== 'needs_translation')
  throw new Error('Bad fixture');
const readyTarget = ready.target;
const jobFixture: unknown = JSON.parse(
  readFileSync(path.join(dir, 'job-v1.json'), 'utf8'),
);
function job(): GlossJob {
  return parseGlossJob(structuredClone(jobFixture));
}
function cloned(): GlossCandidate {
  return structuredClone(ready);
}

void test('v1 fixtures cover every classification; malformed rows are rejected', () => {
  assert.equal(candidates.length, 6);
  assert.deepEqual(
    new Set(candidates.map((c) => c.classification)),
    new Set([
      'needs_translation',
      'eligible_source',
      'ambiguous',
      'missing_context',
      'blocked_source',
    ]),
  );
  for (const invalid of jsonl('invalid-candidates-v1.jsonl'))
    assert.equal(GlossCandidateSchema.safeParse(invalid).success, false);
  assert.equal(candidates[2].target, null);
  validateGlossJobCandidates(job(), candidates);
});

void test('IDs preserve values above JS safe integer; reject numbers, overflow and malformed strings', () => {
  assert.equal(BigintIdSchema.parse('9007199254740993'), '9007199254740993');
  assert.equal(
    BigintIdSchema.parse('9223372036854775807'),
    '9223372036854775807',
  );
  for (const id of [
    9007199254740992,
    '9223372036854775808',
    '01',
    '0',
    '-1',
    '1e3',
    'abc',
  ])
    assert.equal(BigintIdSchema.safeParse(id).success, false);
});

void test('lexical-only pivot and unaudited source cannot become ready candidates', () => {
  assert.throws(() =>
    createGlossCandidate({
      ...ready,
      alignment: { method: 'lexical_only', evidenceKeys: ['pivot'] },
    }),
  );
  assert.throws(() =>
    createGlossCandidate({ ...ready, sources: candidates[3].sources }),
  );
  const source = structuredClone(ready.sources[0]);
  source.audit.evidence = [];
  assert.throws(() => createGlossCandidate({ ...ready, sources: [source] }));
  source.audit.evidence = ready.sources[0].audit.evidence;
  source.license = 'CẦN XÁC MINH';
  assert.throws(() => createGlossCandidate({ ...ready, sources: [source] }));
  assert.throws(() =>
    createGlossCandidate({
      ...ready,
      classification: 'eligible_source',
      sourceGlossVi: 'mèo',
    }),
  );
});

void test('context requires same target, source/batch lineage and accurate content hash', () => {
  for (const change of ['target', 'source', 'batch', 'hash']) {
    const c = cloned();
    assert.ok(c.context);
    const row = c.context.rows[0];
    assert.equal(row.kind, 'sense_gloss');
    if (row.kind !== 'sense_gloss') throw new Error('Bad fixture');
    if (change === 'target') row.senseId = '42';
    if (change === 'source') row.sourceCode = 'absent-source';
    if (change === 'batch')
      row.batchId = 'f07fc477-00b2-4635-ae7b-728f54c74871';
    if (change === 'hash') row.text += ' changed';
    assert.throws(() => createGlossCandidate(c));
  }
});

void test('context kind/language, duplicate rows and rank order are validated', () => {
  const c = structuredClone(candidates[1]);
  assert.ok(c.context);
  c.context.rows.reverse();
  assert.throws(() => createGlossCandidate(c));
  c.context.rows.reverse();
  c.context.rows.push(structuredClone(c.context.rows[0]));
  assert.throws(() => createGlossCandidate(c));
  const a = cloned();
  assert.ok(a.context);
  a.context.context_language = 'ja';
  assert.throws(() => createGlossCandidate(a));
  a.context.context_language = 'en';
  a.context.context_kind = 'sense_definition';
  assert.throws(() => createGlossCandidate(a));
});

void test('canonical hashes ignore object key order, detect tampering and change with semantics', () => {
  const reversed: unknown = JSON.parse(
    JSON.stringify(ready, (key, value: unknown): unknown => {
      if (value && !Array.isArray(value) && typeof value === 'object')
        return Object.fromEntries(Object.entries(value).reverse());
      return value;
    }),
  );
  assert.deepEqual(parseGlossCandidate(reversed), ready);
  const c = cloned();
  assert.ok(c.target && c.target.targetType === 'sense');
  c.target.pos = 'different-POS';
  assert.throws(() => parseGlossCandidate(c));
  const rebuilt = createGlossCandidate(c);
  assert.notEqual(rebuilt.inputHash, ready.inputHash);
  assert.notEqual(rebuilt.candidateKey, ready.candidateKey);
  const otherSnapshot = createGlossCandidate({
    ...ready,
    datasetFingerprint: hashGlossText('other dataset'),
  });
  assert.notEqual(otherSnapshot.candidateKey, ready.candidateKey);
});

void test('provider, protocol, model and prompt changes invalidate cache keys', () => {
  const p = job().provider;
  const original = computeGlossCacheKey(ready, p);
  for (const changed of [
    { ...p, model: 'other' },
    { ...p, protocol: 'chat_completions' as const },
    { ...p, promptVersion: 'v2' },
    { ...p, name: 'opencode-go' as const },
  ])
    assert.notEqual(computeGlossCacheKey(ready, changed), original);
});

void test('checkpoint cannot silently change provider, prompt, session or budget', () => {
  for (const field of ['model', 'prompt', 'session', 'budget']) {
    const j = job();
    if (field === 'model') j.provider.model = 'other-model';
    if (field === 'prompt') j.provider.promptVersion = 'v2';
    if (field === 'session')
      j.sessionId = 'f07fc477-00b2-4635-ae7b-728f54c74871';
    if (field === 'budget') j.caps.maxRequests++;
    assert.throws(() => parseGlossJob(j), /configuration hash/);
  }
});

void test('LLM output is strict, bound to the target, and limited in Unicode characters', () => {
  const output = {
    target_type: 'sense',
    target_id: readyTarget.targetId,
    gloss_vi: 'mèo',
    reason: null,
  };
  assert.equal(parseGlossOutput(output, readyTarget).gloss_vi, 'mèo');
  for (const bad of [
    { ...output, target_id: '42' },
    { ...output, target_type: 'concept' },
    { ...output, confidence: 1 },
    { ...output, gloss_vi: ' ' },
    { ...output, gloss_vi: null },
    { ...output, gloss_vi: '猫'.repeat(501) },
  ])
    assert.throws(() => parseGlossOutput(bad, readyTarget));
  assert.equal(
    parseGlossOutput({ ...output, gloss_vi: '🐈'.repeat(500) }, readyTarget)
      .gloss_vi?.length,
    1000,
  );
  assert.equal(
    parseGlossOutput(
      { ...output, gloss_vi: null, reason: 'insufficient context' },
      readyTarget,
    ).gloss_vi,
    null,
  );
});

void test('strict schemas reject secret fields and credential-bearing URLs/paths', () => {
  const j = job();
  assert.equal(
    GlossJobSchema.safeParse({ ...j, apiKey: 'forbidden-fixture-field' })
      .success,
    false,
  );
  for (const baseUrl of [
    'https://user:pass@example.org',
    'https://example.org?api_key=fixture',
    'https://example.org#fixture',
    'file:///tmp/key',
  ])
    assert.equal(
      GlossJobSchema.safeParse({ ...j, provider: { ...j.provider, baseUrl } })
        .success,
      false,
    );
  for (const invalidPath of [
    '/etc/fixture',
    '../fixture',
    'cache/../fixture',
    'cache\\fixture',
  ])
    assert.equal(
      GlossJobSchema.safeParse({
        ...j,
        snapshot: {
          ...j.snapshot,
          inventory: { ...j.snapshot.inventory, path: invalidPath },
        },
      }).success,
      false,
    );
});

void test('checkpoint counts every attempt including unknown outcomes and enforces cap', () => {
  const j = job();
  j.entries[0].state = 'failed';
  j.entries[0].error = 'timeout';
  j.entries[0].attemptCount = 1;
  j.entries[0].attempts = [
    {
      attempt: 1,
      startedAt: '2026-10-05T09:00:00Z',
      outcome: 'unknown',
      response: null,
    },
  ];
  j.usage.attemptCount = 1;
  assert.equal(parseGlossJob(j).usage.attemptCount, 1);
  j.usage.attemptCount = 0;
  assert.throws(() => parseGlossJob(j));
  j.usage.attemptCount = 1;
  j.entries[0].attempts[0].attempt = 2;
  assert.throws(() => parseGlossJob(j));
  j.entries[0].attempts[0].attempt = 1;
  j.entries[0].attempts.push({ ...j.entries[0].attempts[0], attempt: 2 });
  j.entries[0].attemptCount = 2;
  j.usage.attemptCount = 2;
  j.caps.maxRequests = 1;
  assert.throws(() => parseGlossJob(j));
});

void test('running requires a final in-flight attempt and a stable session UUID', () => {
  const j = job();
  j.entries[0].state = 'running';
  assert.throws(() => parseGlossJob(j));
  j.entries[0].attemptCount = 1;
  j.usage.attemptCount = 1;
  j.entries[0].attempts = [
    {
      attempt: 1,
      startedAt: '2026-10-05T09:00:00Z',
      outcome: 'in_flight',
      response: null,
    },
  ];
  assert.equal(parseGlossJob(j).sessionId, j.sessionId);
  j.entries[0].state = 'failed';
  j.entries[0].error = 'interrupted';
  assert.throws(() => parseGlossJob(j));
});

void test('apply checkpoint needs validated output and a pre-registered applied journal', () => {
  const j = job();
  const e = j.entries[0];
  e.state = 'applied';
  assert.throws(() => parseGlossJob(j));
  e.output = {
    target_type: 'sense',
    target_id: readyTarget.targetId,
    gloss_vi: 'mèo',
    reason: null,
  };
  e.validation = 'passed';
  e.childRunKey = 'fixture-child';
  assert.throws(() => parseGlossJob(j));
  j.children = [
    {
      runKey: e.childRunKey,
      journalPath: 'journals/child.json',
      inputHash: ready.inputHash,
      state: 'registered',
    },
  ];
  assert.throws(() => parseGlossJob(j));
  j.children[0].state = 'applied';
  validateGlossJobCandidates(j, candidates);
  e.output.target_id = '42';
  assert.throws(() => validateGlossJobCandidates(j, candidates));
});

void test('job binding rejects mismatched dataset, input hash, missing/duplicate and blocked candidates', () => {
  const j = job();
  j.snapshot.datasetFingerprint = hashGlossText('other dataset');
  assert.throws(() => validateGlossJobCandidates(j, candidates));
  assert.throws(() => validateGlossJobCandidates(job(), []));
  assert.throws(() => validateGlossJobCandidates(job(), [ready, ready]));
  const wrongHash = job();
  wrongHash.entries[0].inputHash = hashGlossText('other input');
  assert.throws(() => validateGlossJobCandidates(wrongHash, candidates));
  const blocked = candidates[3];
  const b = job();
  b.entries[0].candidateKey = blocked.candidateKey;
  b.entries[0].inputHash = blocked.inputHash;
  assert.throws(() => validateGlossJobCandidates(b, candidates));
  const duplicates = job();
  duplicates.entries.push(structuredClone(duplicates.entries[0]));
  assert.throws(() => parseGlossJob(duplicates));
});

void test('DB3-B2.1 partial review stays bound after rejected rows; never accepts unreviewed or changed outputs', () => {
  const second = createGlossCandidate({
    ...ready,
    target: { ...readyTarget, targetId: '9007199254740994' },
    context: {
      ...ready.context,
      rows: ready.context.rows.map((row) => ({
        ...row,
        senseId: '9007199254740994',
      })),
    },
  });
  const selected = [ready, second];
  const j = createGlossJob({
    ...job(),
    entries: selected.map((c) => ({
      ...job().entries[0],
      candidateKey: c.candidateKey,
      inputHash: c.inputHash,
      state: 'validated',
      validation: 'passed',
      output: {
        target_type: 'sense',
        target_id: c.target!.targetId,
        gloss_vi: 'mèo',
        reason: null,
      },
    })),
  });
  const review: GlossReview = {
    schemaVersion: 1,
    jobKey: j.jobKey,
    entries: j.entries.map((e, i) => ({
      candidateKey: e.candidateKey,
      inputHash: e.inputHash,
      outputHash: hashGlossOutput(e.output!),
      verdict: i === 0 ? 'pass' : 'fail',
      severity: i === 0 ? 'none' : 'severe',
      reason: i === 0 ? null : 'Sai nghĩa',
      reviewer: 'GPT semantic review',
      reviewedAt: '2026-10-06T14:00:00Z',
    })),
  };
  assert.throws(() => validateGlossReview(j, selected, review));
  validateGlossReview(j, selected, review, { allowPartial: true });
  j.entries[1].state = 'rejected';
  validateGlossReview(j, selected, review, { allowPartial: true });
  const rejectedPass = structuredClone(review);
  rejectedPass.entries[1].verdict = 'pass';
  rejectedPass.entries[1].severity = 'none';
  assert.throws(() =>
    validateGlossReview(j, selected, rejectedPass, { allowPartial: true }),
  );
  const unreviewed = structuredClone(review);
  unreviewed.entries[0].reviewer = 'UNREVIEWED';
  assert.throws(
    () => validateGlossReview(j, selected, unreviewed, { allowPartial: true }),
    /completed semantic review/,
  );
  const tampered = structuredClone(review);
  tampered.entries[0].outputHash = hashGlossText('changed');
  assert.throws(() =>
    validateGlossReview(j, selected, tampered, { allowPartial: true }),
  );
  const omitted = structuredClone(review);
  omitted.entries.pop();
  assert.throws(() =>
    validateGlossReview(j, selected, omitted, { allowPartial: true }),
  );
  j.children.push({
    runKey: 'test-child',
    journalPath: 'journals/test.json',
    inputHash: hashGlossText('child'),
    state: 'registered',
  });
  j.entries[0].childRunKey = 'test-child';
  const reclassified = structuredClone(review);
  reclassified.entries[0].verdict = 'fail';
  reclassified.entries[0].reason = 'Changed after registration';
  assert.throws(() =>
    validateGlossReview(j, selected, reclassified, { allowPartial: true }),
  );
});

void test('DB3-B2.1 default pilot still requires 98/100 and zero severe', () => {
  const selected = Array.from({ length: 100 }, (_, i) => {
    const id = (9007199254742000n + BigInt(i)).toString();
    return createGlossCandidate({
      ...ready,
      target: { ...readyTarget, targetId: id },
      context: {
        ...ready.context,
        rows: ready.context.rows.map((row) => ({ ...row, senseId: id })),
      },
    });
  });
  const j = createGlossJob({
    ...job(),
    entries: selected.map((c) => ({
      ...job().entries[0],
      candidateKey: c.candidateKey,
      inputHash: c.inputHash,
      state: 'validated',
      validation: 'passed',
      output: {
        target_type: 'sense',
        target_id: c.target!.targetId,
        gloss_vi: 'mèo',
        reason: null,
      },
    })),
  });
  const review: GlossReview = {
    schemaVersion: 1,
    jobKey: j.jobKey,
    entries: j.entries.map((e, i) => ({
      candidateKey: e.candidateKey,
      inputHash: e.inputHash,
      outputHash: hashGlossOutput(e.output!),
      verdict: i < 98 ? 'pass' : 'fail',
      severity: i < 98 ? 'none' : 'minor',
      reason: i < 98 ? null : 'Thiếu nghĩa',
      reviewer: 'GPT review',
      reviewedAt: '2026-10-06T14:00:00Z',
    })),
  };
  validateGlossReview(j, selected, review);
  review.entries[97] = {
    ...review.entries[97],
    verdict: 'fail',
    severity: 'minor',
    reason: 'Thiếu nghĩa',
  };
  assert.throws(() => validateGlossReview(j, selected, review), /gate failed/);
  review.entries[97] = {
    ...review.entries[97],
    verdict: 'pass',
    severity: 'none',
    reason: null,
  };
  review.entries[99].severity = 'severe';
  assert.throws(() => validateGlossReview(j, selected, review), /gate failed/);
});
