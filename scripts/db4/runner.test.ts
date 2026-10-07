import assert from 'node:assert/strict';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  readBytes,
  resolveArtifact,
  stablePretty,
  writeTextAtomic,
} from './_artifacts';
import {
  createMappingJob,
  createMappingReservation,
  hashJson,
  jobBudgetUsage,
  mappingCacheKey,
  parseMappingJob,
  renderMappingBundle,
  transitionMappingTarget,
  verifyArtifactBytes,
  type MappingJob,
} from './_mapping-types';
import { createStubAdapter, runJob, type ProviderAdapter } from './_runner';
import { fixtureCase, jobFixture, semanticCases } from './fixtures/build';

const FIXTURES = path.resolve(__dirname, 'fixtures');

function makeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'db4-runner-'));
  cpSync(FIXTURES, path.join(root, 'fixtures'), { recursive: true });
  return root;
}

function writeJobFile(
  root: string,
  jobRel: string,
  value: string | MappingJob,
): void {
  const abs = resolveArtifact(root, jobRel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, typeof value === 'string' ? value : stablePretty(value));
}

function pristineJob(root: string, jobRel: string): MappingJob {
  const source = readFileSync(path.join(FIXTURES, 'job.json')).toString('utf8');
  writeJobFile(root, jobRel, source);
  return parseMappingJob(JSON.parse(source));
}

function withCaps(
  job: MappingJob,
  caps: Partial<MappingJob['caps']>,
): MappingJob {
  const {
    jobKey: _jobKey,
    entries,
    attempts: _attempts,
    children: _children,
    status: _status,
    ...config
  } = job;
  void _jobKey;
  void _attempts;
  void _children;
  void _status;
  return createMappingJob(
    { ...config, caps: { ...config.caps, ...caps } },
    entries,
  );
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

void test('jobFixture vẫn là golden fixture của contract (không bị test này sửa)', () => {
  const job = jobFixture();
  assert.equal(job.entries.length, 1);
  assert.equal(job.mode, 'fixture');
  assert.equal(job.entries[0].state, 'queued');
});

void test('happy path: R1/R2 review → decision accept_exact → awaiting_audit', async () => {
  const root = makeRoot();
  const jobRel = 'jobs/run-happy.json';
  const job0 = pristineJob(root, jobRel);
  const adapter = createStubAdapter({ outputs: outputsFor(job0) });
  const job = await runJob({
    root,
    jobRel,
    adapter,
    now: clock(),
    log: () => {},
  });

  assert.equal(job.entries[0].state, 'decision_ready');
  assert.equal(job.status, 'awaiting_audit');
  const decisionRef = job.entries[0].decision;
  assert.ok(decisionRef);
  const bytes = readBytes(root, decisionRef.path);
  verifyArtifactBytes(decisionRef, bytes);
  const artifact = JSON.parse(bytes.toString('utf8')) as {
    decisions: { proposal: string; outputHashR1: string }[];
  };
  assert.equal(artifact.decisions.length, 1);
  assert.equal(artifact.decisions[0].proposal, 'accept_exact');
  assert.equal(
    artifact.decisions[0].outputHashR1,
    hashJson(fixtureCase(0).outputR1),
  );
  assert.deepEqual(
    job.attempts.map((a) => `${a.phase}:${a.kind}:${a.outcome}`),
    ['r1:review:response', 'r2:review:response'],
  );
  for (const attempt of job.attempts) {
    assert.ok(
      attempt.rawResponse && attempt.validatedOutput && attempt.actualUsage,
    );
    const validated = readBytes(root, attempt.validatedOutput.path);
    verifyArtifactBytes(attempt.validatedOutput, validated);
  }
});

void test('cache: job thứ hai cùng root không gọi adapter, usage = 0', async () => {
  const root = makeRoot();
  const job0 = pristineJob(root, 'jobs/cache-a.json');
  await runJob({
    root,
    jobRel: 'jobs/cache-a.json',
    adapter: createStubAdapter({ outputs: outputsFor(job0) }),
    now: clock(),
  });
  pristineJob(root, 'jobs/cache-b.json');
  let calls = 0;
  const frozen: ProviderAdapter = {
    id: 'never',
    review: () => {
      calls += 1;
      throw new Error('adapter không được gọi khi cache hit');
    },
  };
  const job = await runJob({
    root,
    jobRel: 'jobs/cache-b.json',
    adapter: frozen,
    now: clock(),
  });
  assert.equal(calls, 0);
  assert.equal(job.entries[0].state, 'decision_ready');
  assert.deepEqual(
    job.attempts.map((a) => a.kind),
    ['cache', 'cache'],
  );
  assert.deepEqual(jobBudgetUsage(job), {
    requests: 0,
    tokens: 0,
    costMicrousd: 0,
    unknownRequests: 0,
  });
});

void test('stub mặc định all-none → decision reject_pair', async () => {
  const root = makeRoot();
  pristineJob(root, 'jobs/stub-none.json');
  const job = await runJob({
    root,
    jobRel: 'jobs/stub-none.json',
    adapter: createStubAdapter(),
    now: clock(),
    log: () => {},
  });
  assert.equal(job.entries[0].state, 'decision_ready');
  const artifact = JSON.parse(
    readBytes(root, job.entries[0].decision!.path).toString('utf8'),
  ) as { decisions: { proposal: string }[] };
  assert.equal(artifact.decisions[0].proposal, 'reject_pair');
  assert.equal(job.status, 'awaiting_audit');
});

void test('budget: maxRequests=1 → dừng ở budget_exhausted, giữ nguyên R1 validated', async () => {
  const root = makeRoot();
  const rebuilt = withCaps(pristineJob(root, 'jobs/budget.json'), {
    maxRequests: 1,
  });
  writeJobFile(root, 'jobs/budget.json', rebuilt);
  const job = await runJob({
    root,
    jobRel: 'jobs/budget.json',
    adapter: createStubAdapter({ outputs: outputsFor(rebuilt) }),
    now: clock(),
    log: () => {},
  });
  assert.equal(job.status, 'budget_exhausted');
  assert.equal(job.entries[0].state, 'r1_validated');
  assert.equal(job.attempts.filter((a) => a.kind === 'review').length, 1);
});

void test('adapter lỗi: retry tối đa rồi target error, không ném ra ngoài', async () => {
  const root = makeRoot();
  const rebuilt = withCaps(pristineJob(root, 'jobs/err.json'), {
    maxRetries: 1,
  });
  writeJobFile(root, 'jobs/err.json', rebuilt);
  let calls = 0;
  const adapter: ProviderAdapter = {
    id: 'boom',
    review: () => {
      calls += 1;
      throw new Error('boom');
    },
  };
  const job = await runJob({
    root,
    jobRel: 'jobs/err.json',
    adapter,
    now: clock(),
    log: () => {},
  });
  assert.equal(calls, 2);
  assert.equal(job.entries[0].state, 'error');
  assert.match(job.entries[0].reason ?? '', /adapter lỗi/);
  assert.deepEqual(
    job.attempts.map((a) => a.outcome),
    ['failed', 'failed'],
  );
  assert.equal(job.attempts[0].retryReason, null);
  assert.equal(job.attempts[1].retryReason, 'adapter: boom');
});

void test('output sai schema: retry rồi error với reason schema', async () => {
  const root = makeRoot();
  const rebuilt = withCaps(pristineJob(root, 'jobs/schema.json'), {
    maxRetries: 0,
  });
  writeJobFile(root, 'jobs/schema.json', rebuilt);
  let calls = 0;
  const adapter: ProviderAdapter = {
    id: 'bad-schema',
    review: () => {
      calls += 1;
      return Promise.resolve({ raw: { bogus: true } });
    },
  };
  const job = await runJob({
    root,
    jobRel: 'jobs/schema.json',
    adapter,
    now: clock(),
    log: () => {},
  });
  assert.equal(calls, 1);
  assert.equal(job.entries[0].state, 'error');
  assert.match(job.entries[0].reason ?? '', /schema lỗi/);
  assert.equal(job.attempts[0].outcome, 'failed');
});

void test('resume sau crash: R1 durable được validate lại, chỉ dispatch R2', async () => {
  const root = makeRoot();
  const jobRel = 'jobs/recover.json';
  const base = pristineJob(root, jobRel);
  const fixture = fixtureCase(0);
  const entry = base.entries[0];
  const rendered = renderMappingBundle(
    fixture.bundle,
    'r1',
    base.seed,
    base.providers.r1.promptVersion,
  );
  const attempt = {
    index: 1,
    phase: 'r1' as const,
    kind: 'review' as const,
    cacheOrigin: null,
    targetKey: entry.targetKey,
    renderedContextHash: rendered.renderedContextHash,
    cacheKey: mappingCacheKey(
      base.providers.r1,
      'r1',
      rendered.renderedContextHash,
    ),
    startedAt: clock()(),
    finishedAt: null,
    outcome: 'in_flight' as const,
    retryReason: null,
    reservation: createMappingReservation(base.providers.r1, {
      inputTokens: 500,
      outputTokens: 4096,
      reasoningTokens: 0,
    }),
    actualUsage: null,
    rawResponse: null,
    validatedOutput: null,
  };
  const crashed = transitionMappingTarget(base, entry.targetKey, 'r1_running', {
    attempts: [attempt],
  });
  writeJobFile(root, jobRel, crashed);
  writeTextAtomic(
    root,
    `responses/${base.jobKey}/r1/${entry.bundleKey}/1.raw.json`,
    stablePretty(fixture.outputR1),
  );

  const calls: string[] = [];
  const adapter: ProviderAdapter = {
    id: 'scripted',
    review: (request) => {
      calls.push(request.phase);
      const output =
        request.phase === 'r1' ? fixture.outputR1 : fixture.outputR2;
      return Promise.resolve({ raw: output });
    },
  };
  const job = await runJob({
    root,
    jobRel,
    adapter,
    now: clock(),
    log: () => {},
  });
  assert.deepEqual(calls, ['r2']);
  assert.equal(job.entries[0].state, 'decision_ready');
  const r1Attempt = job.attempts.find((a) => a.phase === 'r1')!;
  assert.equal(r1Attempt.outcome, 'response');
  assert.ok(r1Attempt.rawResponse);
  assert.ok(r1Attempt.validatedOutput);
});

void test('lock: chặn chạy trùng job đang giữ lock sống', async () => {
  const root = makeRoot();
  const jobRel = 'jobs/locked.json';
  const base = pristineJob(root, jobRel);
  const lockAbs = resolveArtifact(root, `jobs/${base.jobKey}/lock`);
  mkdirSync(path.dirname(lockAbs), { recursive: true });
  writeFileSync(lockAbs, JSON.stringify({ pid: process.pid }));
  await assert.rejects(
    runJob({
      root,
      jobRel,
      adapter: createStubAdapter(),
      now: clock(),
      log: () => {},
    }),
    /đang chạy/,
  );
});
