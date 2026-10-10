import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { MappingAudit, MappingDecision, hashJson } from './_mapping-types';
import {
  evaluateExactProposalAudits,
  storeAuditArtifact,
} from './mapping-audit';

// Synthetic contract identities, never semantic gold labels.
function fixture() {
  const decision: MappingDecision = {
    schemaVersion: 1,
    candidateKey: hashJson('candidate'),
    inputHash: hashJson('input'),
    outputHashR1: hashJson('r1'),
    outputHashR2: hashJson('r2'),
    policyVersion: 'fixture-policy',
    proposal: 'accept_exact',
    relation: 'exact',
    reasons: [],
  };
  const row = {
    bundleKey: hashJson('bundle'),
    senseId: '123',
    decision,
    decisionHash: hashJson(decision),
  };
  const proposal = {
    bundleKey: row.bundleKey,
    senseId: row.senseId,
    senseKey: 'fixture-sense',
    candidateKey: decision.candidateKey,
    conceptId: '456',
    decisionHash: row.decisionHash,
    policyVersion: decision.policyVersion,
    verified: false as const,
    calibratedScore: null,
  };
  const audit: MappingAudit = {
    schemaVersion: 1,
    candidateKey: decision.candidateKey,
    inputHash: decision.inputHash,
    outputHashR1: decision.outputHashR1,
    outputHashR2: decision.outputHashR2,
    decisionHash: row.decisionHash,
    reviewerKind: 'llm',
    reviewerId: 'fixture-reviewer',
    reviewerSession: 'fixture-session',
    reviewedAt: '2026-10-10T00:00:00Z',
    verdict: 'pass',
    severity: 'none',
    reason: 'Synthetic validator test.',
    suggestedDecision: 'accept_exact',
  };
  return { row, proposal, audit };
}
void test('positive audit preserves target denominator and never grants promotion', () => {
  const f = fixture();
  const result = evaluateExactProposalAudits(
    [f.proposal],
    [f.row],
    [f.audit],
    100,
  );
  assert.deepEqual(result.report.counts, {
    retrievalTargets: 100,
    exactProposals: 1,
    audited: 1,
    pass: 1,
    fail: 0,
    deferred: 0,
    severe: 0,
    unauditedTargets: 99,
  });
  assert.equal(result.passedProposals[0].verified, false);
  assert.equal(result.passedProposals[0].calibratedScore, null);
  assert.equal(result.passedProposals[0].auditHash, hashJson(f.audit));
  assert.equal(result.report.apply, false);
  assert.equal(result.report.promotionReady, false);
  assert.equal(result.report.fullPilotGatePassed, false);
  assert.equal(result.report.fullTargetGateEvaluated, false);
  assert.equal(result.report.needsHumanApprovalPerMapping, false);
  assert.ok(
    result.report.remainingGates.includes('insufficient_positive_sample'),
  );
  assert.ok(result.report.observedLabelWilson95!.lower < 0.5);
});
void test('fail and deferred proposals are excluded with their original lineage retained', () => {
  const f = fixture();
  const failed = {
    ...f.audit,
    verdict: 'fail',
    severity: 'severe',
    suggestedDecision: 'accept_nonexact',
  };
  const result = evaluateExactProposalAudits(
    [f.proposal],
    [f.row],
    [failed],
    100,
  );
  assert.equal(result.passedProposals.length, 0);
  assert.equal(result.report.counts.severe, 1);
  assert.ok(result.report.remainingGates.includes('severe_error'));
  assert.equal(result.audits[0].decisionHash, f.row.decisionHash);
  const deferred = {
    ...f.audit,
    verdict: 'deferred',
    suggestedDecision: 'defer',
  };
  const other = evaluateExactProposalAudits(
    [f.proposal],
    [f.row],
    [deferred],
    100,
  );
  assert.equal(other.report.counts.deferred, 1);
  assert.equal(other.report.observedAiAuditPassRate, 0);
  assert.ok(other.report.remainingGates.includes('unresolved_positive_audit'));
});
void test('rejects missing, foreign and duplicate audit rows', () => {
  const f = fixture();
  for (const audits of [
    [],
    [{ ...f.audit, candidateKey: hashJson('foreign') }],
    [f.audit, f.audit],
  ])
    assert.throws(() =>
      evaluateExactProposalAudits([f.proposal], [f.row], audits, 100),
    );
});
void test('rejects stale input/output/decision lineage on every hash', () => {
  const f = fixture();
  for (const key of [
    'inputHash',
    'outputHashR1',
    'outputHashR2',
    'decisionHash',
  ])
    assert.throws(
      () =>
        evaluateExactProposalAudits(
          [f.proposal],
          [f.row],
          [{ ...f.audit, [key]: hashJson('drift') }],
          100,
        ),
      /lineage mismatch/,
    );
});
void test('rejects missing, foreign, nonexact or hash-drifted decisions', () => {
  const f = fixture();
  const variants = [
    [],
    [{ ...f.row, senseId: '999' }],
    [{ ...f.row, bundleKey: hashJson('other') }],
    [{ ...f.row, decisionHash: hashJson('other') }],
    [{ ...f.row, decision: { ...f.row.decision, proposal: 'defer' } }],
    [{ ...f.row, decision: { ...f.row.decision, relation: 'broader' } }],
  ];
  for (const rows of variants)
    assert.throws(() =>
      evaluateExactProposalAudits([f.proposal], rows, [f.audit], 100),
    );
});
void test('cannot repeat targets or omit an exact proposal to cherry-pick precision', () => {
  const f = fixture();
  assert.throws(() =>
    evaluateExactProposalAudits(
      [f.proposal, f.proposal],
      [f.row],
      [f.audit],
      100,
    ),
  );
  assert.throws(() => evaluateExactProposalAudits([], [f.row], [], 100));
  assert.throws(() =>
    evaluateExactProposalAudits([f.proposal], [f.row], [f.audit], 0),
  );
});
void test('semantic pass cannot be replaced by a structural rule audit', () => {
  const f = fixture();
  assert.throws(
    () =>
      evaluateExactProposalAudits(
        [f.proposal],
        [f.row],
        [{ ...f.audit, reviewerKind: 'rule' }],
        100,
      ),
    /Structural rule/,
  );
});
void test('rejects contradictory verdicts and fabricated curator/confidence fields', () => {
  const f = fixture();
  for (const overrides of [
    { severity: 'severe' },
    { suggestedDecision: 'reject_pair' },
    { verdict: 'fail' },
    { verdict: 'deferred', severity: 'severe', suggestedDecision: 'defer' },
    { verified: true },
  ])
    assert.throws(() =>
      evaluateExactProposalAudits(
        [f.proposal],
        [f.row],
        [{ ...f.audit, ...overrides }],
        100,
      ),
    );
  assert.throws(() =>
    evaluateExactProposalAudits(
      [{ ...f.proposal, verified: true }],
      [f.row],
      [f.audit],
      100,
    ),
  );
  assert.throws(() =>
    evaluateExactProposalAudits(
      [{ ...f.proposal, calibratedScore: 0.99 }],
      [f.row],
      [f.audit],
      100,
    ),
  );
});
void test('zero proposals do not produce 100% precision or an apply gate', () => {
  const result = evaluateExactProposalAudits([], [], [], 100);
  assert.equal(result.report.observedAiAuditPassRate, null);
  assert.equal(result.report.observedLabelWilson95, null);
  assert.equal(result.report.counts.unauditedTargets, 100);
  assert.equal(result.report.promotionReady, false);
});
void test('immutable publication reuses identical bytes and refuses changed output', () => {
  const root = mkdtempSync(join(tmpdir(), 'db4-d5-audit-'));
  try {
    const ref = storeAuditArtifact(
      root,
      'run/result.json',
      '{"apply":false}\n',
    );
    assert.deepEqual(
      storeAuditArtifact(root, ref.path, '{"apply":false}\n'),
      ref,
    );
    assert.throws(
      () => storeAuditArtifact(root, ref.path, '{"apply":true}\n'),
      /hash mismatch/,
    );
    assert.equal(
      readFileSync(join(root, ref.path), 'utf8'),
      '{"apply":false}\n',
    );
    writeFileSync(join(root, ref.path), 'tampered');
    assert.throws(
      () => storeAuditArtifact(root, ref.path, '{"apply":false}\n'),
      /hash mismatch/,
    );
    assert.throws(() => storeAuditArtifact(root, '../escape.json', 'bad'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
