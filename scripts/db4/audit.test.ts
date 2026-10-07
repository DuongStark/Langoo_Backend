import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { resolveArtifact } from './_artifacts';
import {
  parseMappingJob,
  renderMappingBundle,
  type MappingJob,
} from './_mapping-types';
import {
  aggregateTargetVerdict,
  buildAuditPrompt,
  parseAuditResponse,
  main as auditMain,
  type AuditPacket,
} from './mapping-audit';
import { createStubAdapter, runJob } from './_runner';
import { fixtureCase, semanticCases } from './fixtures/build';

const FIXTURES = path.resolve(__dirname, 'fixtures');

function makeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'db4-audit-'));
  cpSync(FIXTURES, path.join(root, 'fixtures'), { recursive: true });
  return root;
}

function pristineJob(root: string, jobRel: string): MappingJob {
  const source = readFileSync(path.join(FIXTURES, 'job.json')).toString('utf8');
  const abs = resolveArtifact(root, jobRel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, source);
  return parseMappingJob(JSON.parse(source));
}

function outputsFor(job: MappingJob): Map<string, unknown> {
  const outputs = new Map<string, unknown>();
  semanticCases.forEach((_, index) => {
    const fixture = fixtureCase(index);
    for (const phase of ['r1', 'r2'] as const) {
      const rendered = renderMappingBundle(
        fixture.bundle,
        phase,
        job.seed,
        job.providers[phase].promptVersion,
      );
      outputs.set(
        rendered.renderedContextHash,
        phase === 'r1' ? fixture.outputR1 : fixture.outputR2,
      );
    }
  });
  return outputs;
}

function clock(): () => string {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 9, 7, 0, 0, tick++)).toISOString();
}

void test('parseAuditResponse: đúng/sai số entry, index trùng/ngoài phạm vi', () => {
  const valid = {
    audits: [
      {
        index: 2,
        verdict: 'fail',
        severity: 'severe',
        reason: 'x',
        suggested: 'reject_pair',
      },
      {
        index: 1,
        verdict: 'pass',
        severity: 'none',
        reason: 'y',
        suggested: null,
      },
    ],
  };
  const parsed = parseAuditResponse(valid, 2);
  assert.deepEqual(
    parsed.map((item) => item.index),
    [1, 2],
  );
  assert.throws(() => parseAuditResponse({ audits: [] }, 1), /1\/1|trả/);
  assert.throws(
    () =>
      parseAuditResponse(
        {
          audits: [
            {
              index: 1,
              verdict: 'pass',
              severity: 'none',
              reason: 'a',
              suggested: null,
            },
            {
              index: 1,
              verdict: 'pass',
              severity: 'none',
              reason: 'b',
              suggested: null,
            },
          ],
        },
        2,
      ),
    /trùng/,
  );
  assert.throws(
    () =>
      parseAuditResponse(
        {
          audits: [
            {
              index: 3,
              verdict: 'pass',
              severity: 'none',
              reason: 'a',
              suggested: null,
            },
          ],
        },
        1,
      ),
    /ngoài phạm vi/,
  );
});

void test('aggregateTargetVerdict: fail thắng, deferred, severity max', () => {
  assert.deepEqual(
    aggregateTargetVerdict([
      { verdict: 'pass', severity: 'minor' },
      { verdict: 'fail', severity: 'severe' },
    ]),
    { verdict: 'fail', severity: 'severe' },
  );
  assert.deepEqual(
    aggregateTargetVerdict([
      { verdict: 'pass', severity: 'none' },
      { verdict: 'deferred', severity: 'minor' },
    ]),
    { verdict: 'deferred', severity: 'minor' },
  );
  assert.deepEqual(
    aggregateTargetVerdict([{ verdict: 'pass', severity: 'none' }]),
    { verdict: 'pass', severity: 'none' },
  );
});

void test('buildAuditPrompt: rubric + packet đủ candidate', () => {
  const packet: AuditPacket = {
    lemma: '猫',
    reading: 'ねこ',
    jlptLevel: 5,
    isPrimary: true,
    normalizedPos: ['noun'],
    glosses: [{ key: 'g:1', text: 'cat' }],
    definitions: [],
    sourceBranches: ['g:1'],
    candidates: [
      { index: 1, conceptId: '1', definitions: ['domestic cat'], labels: [] },
    ],
    passR1: [{ index: 1, relation: 'exact', reason: 'ok' }],
    passR2: [{ index: 1, relation: 'exact', reason: 'ok' }],
    proposal: [{ index: 1, proposal: 'accept_exact', relation: 'exact' }],
  };
  const prompt = buildAuditPrompt(packet);
  assert.match(prompt.system, /severe/);
  const user = JSON.parse(prompt.user) as AuditPacket;
  assert.equal(user.candidates.length, 1);
  assert.equal(user.proposal[0].proposal, 'accept_exact');
});

void test('audit e2e trên fixture: reviewer mock pass → report + gate', async () => {
  const root = makeRoot();
  const jobRel = 'jobs/audit-e2e.json';
  const job0 = pristineJob(root, jobRel);
  await runJob({
    root,
    jobRel,
    adapter: createStubAdapter({ outputs: outputsFor(job0) }),
    now: clock(),
    log: () => {},
  });

  process.env.DB4_AUDIT_ENDPOINT =
    'https://example.invalid/v1/chat/completions';
  process.env.DB4_AUDIT_MODEL = 'test-reviewer';
  process.env.DB4_AUDIT_API_KEY = 'test-key';
  delete process.env.DB4_AUDIT_LIMIT;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: JSON.stringify({
                  audits: [
                    {
                      index: 1,
                      verdict: 'pass',
                      severity: 'none',
                      reason: 'Đúng.',
                      suggested: null,
                    },
                  ],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
  const originalLog = console.log;
  console.log = () => undefined;
  try {
    await auditMain(['--job', jobRel, '--artifact-dir', root]);
  } finally {
    console.log = originalLog;
    globalThis.fetch = originalFetch;
    delete process.env.DB4_AUDIT_ENDPOINT;
    delete process.env.DB4_AUDIT_MODEL;
    delete process.env.DB4_AUDIT_API_KEY;
  }

  const prefix = job0.jobKey.slice(0, 12);
  const report = JSON.parse(
    readFileSync(
      resolveArtifact(root, `reports/pilot-a-audit-${prefix}.json`),
      'utf8',
    ),
  ) as { counts: { pass: number; fail: number }; failures: unknown[] };
  assert.equal(report.counts.pass, 1);
  assert.equal(report.counts.fail, 0);
  assert.equal(report.failures.length, 0);
  assert.ok(existsSync(resolveArtifact(root, `gates/${job0.jobKey}.json`)));
  const auditFile = JSON.parse(
    readFileSync(
      resolveArtifact(
        root,
        `audits/${job0.jobKey}/${job0.entries[0].targetKey}.json`,
      ),
      'utf8',
    ),
  ) as { audits: { verdict: string; reviewerKind: string }[] };
  assert.equal(auditFile.audits[0].verdict, 'pass');
  assert.equal(auditFile.audits[0].reviewerKind, 'llm');
});
