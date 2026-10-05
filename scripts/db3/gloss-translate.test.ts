import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  createGlossReviewTemplate,
  main as exportReview,
} from './gloss-review';
import {
  createGlossCandidate,
  createGlossJob,
  parseGlossCandidate,
  parseGlossJob,
  hashGlossText,
  hashGlossOutput,
  validateGlossReview,
  computeGlossCacheKey,
  type GlossCandidate,
  type GlossJob,
} from './_gloss-types';
import {
  artifactHash,
  readArtifactJson,
  readArtifactText,
  resolveArtifactPath,
  writeArtifactJson,
} from './_gloss-artifacts';
import {
  createGoGlossProvider,
  createStubGlossProvider,
  GlossProviderError,
  GLOSS_PROMPT_VERSION,
  parseProviderResult,
  type GlossProvider,
} from './_gloss-provider';
import {
  translateGlossJob,
  selectGlossPilotCandidates,
} from './gloss-translate';

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'gloss-translate-'));
  const template = parseGlossCandidate(
    JSON.parse(
      readFileSync(
        path.join(__dirname, 'fixtures/gloss/candidates-v1.jsonl'),
        'utf8',
      ).split('\n')[0],
    ) as unknown,
  );
  const audit = writeArtifactJson(root, 'source-audit.json', { fixture: true });
  const source = {
    ...template.sources[0],
    audit: { ...template.sources[0].audit, evidence: [audit] },
  };
  const candidate = createGlossCandidate({ ...template, sources: [source] });
  const inventory = writeArtifactJson(root, 'inventory.json', {
    summary: {
      fingerprint: {
        dataset_digest: candidate.datasetFingerprint,
        host: '127.0.0.1',
        port: '55433',
        db: 'langoo_fixture_test',
      },
    },
  });
  const job = createGlossJob({
    schemaVersion: 1,
    snapshot: {
      datasetFingerprint: candidate.datasetFingerprint,
      inventory,
      host: '127.0.0.1',
      port: 55433,
      database: 'langoo_fixture_test',
    },
    provider: {
      name: 'stub',
      baseUrl: 'https://example.org/stub',
      protocol: 'responses',
      model: 'fixture',
      promptVersion: GLOSS_PROMPT_VERSION,
    },
    sessionId: '3bc9d174-886d-4a83-9c12-f49f1901c5fe',
    caps: { maxRequests: 3, maxTokens: null, maxCostUsd: 0, concurrency: 1 },
    usage: { attemptCount: 0, tokens: 0, costUsd: 0 },
    entries: [
      {
        candidateKey: candidate.candidateKey,
        inputHash: candidate.inputHash,
        state: 'pending',
        attemptCount: 0,
        attempts: [],
        output: null,
        validation: 'pending',
        error: null,
        childRunKey: null,
      },
    ],
    children: [],
  });
  if (!candidate.target) throw new Error('Bad fixture');
  const adapter = createStubGlossProvider({
    [candidate.target.semanticKey]: 'mèo',
  });
  return {
    root,
    candidate,
    job,
    adapter,
    options: {
      artifactDir: root,
      job,
      candidates: [candidate],
      adapter,
      generate: true,
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
function counted(adapter: GlossProvider) {
  let calls = 0;
  return {
    adapter: {
      ...adapter,
      call(...args: Parameters<GlossProvider['call']>) {
        calls++;
        return adapter.call(...args);
      },
    },
    calls: () => calls,
  };
}

void test('dry-run does no writes/calls; source hashes/symlink path enforced', async (t) => {
  const f = fixture();
  t.after(f.cleanup);
  const count = counted(f.adapter);
  const result = await translateGlossJob({
    ...f.options,
    adapter: count.adapter,
    generate: false,
  });
  assert.equal(result.usage.attemptCount, 0);
  assert.equal(count.calls(), 0);
  assert.throws(() => statSync(path.join(f.root, 'job.json')));
  assert.throws(() =>
    readArtifactText(f.root, 'inventory.json', hashGlossText('bad')),
  );
  assert.throws(() => resolveArtifactPath(f.root, '../escape'));
  symlinkSync(
    path.join(f.root, 'source-audit.json'),
    path.join(f.root, 'link.json'),
  );
  assert.throws(() => readArtifactJson(f.root, 'link.json'));
  writeArtifactJson(f.root, 'source-audit.json', { changed: true });
  await assert.rejects(translateGlossJob(f.options), /hash mismatch/);
});
void test('stub generation validates output; resume/cache do not consume another attempt', async (t) => {
  const f = fixture();
  t.after(f.cleanup);
  const count = counted(f.adapter);
  const first = await translateGlossJob({
    ...f.options,
    adapter: count.adapter,
  });
  assert.equal(first.entries[0].state, 'validated');
  assert.equal(first.usage.attemptCount, 1);
  assert.equal(statSync(path.join(f.root, 'job.json')).mode & 0o777, 0o600);
  const second = await translateGlossJob({
    ...f.options,
    adapter: count.adapter,
    job: first,
  });
  assert.equal(count.calls(), 1);
  assert.deepEqual(second, first);
  const other = createGlossJob({
    ...f.job,
    sessionId: 'f07fc477-00b2-4635-ae7b-728f54c74871',
  });
  const cached = await translateGlossJob({
    ...f.options,
    adapter: count.adapter,
    job: other,
    jobFile: 'other-job.json',
  });
  assert.equal(cached.entries[0].state, 'validated');
  assert.equal(cached.usage.attemptCount, 0);
  assert.equal(count.calls(), 1);
  const cache = `cache/${computeGlossCacheKey(f.candidate, f.job.provider)}.json`;
  writeArtifactJson(f.root, cache, { corrupted: true });
  await assert.rejects(
    translateGlossJob({ ...f.options, job: other, jobFile: 'third-job.json' }),
  );
});
void test('checkpoint failure after response is recovered without recalling provider', async (t) => {
  const f = fixture();
  t.after(f.cleanup);
  const count = counted(f.adapter);
  let failed = false;
  const persist: typeof writeArtifactJson = (root, file, data) => {
    const pending = file === 'job.json' ? parseGlossJob(data) : null;
    if (!failed && pending?.entries[0].state === 'validated') {
      failed = true;
      throw new Error('simulated fsync failure');
    }
    return writeArtifactJson(root, file, data);
  };
  await assert.rejects(
    translateGlossJob({ ...f.options, adapter: count.adapter, persist }),
    /fsync/,
  );
  const pending = parseGlossJob(readArtifactJson(f.root, 'job.json'));
  assert.equal(pending.entries[0].state, 'running');
  const resumed = await translateGlossJob({
    ...f.options,
    adapter: count.adapter,
    job: pending,
  });
  assert.equal(resumed.entries[0].state, 'validated');
  assert.equal(resumed.usage.attemptCount, 1);
  assert.equal(count.calls(), 1);
});

void test('responses/attempts are namespaced by job when model changes', async (t) => {
  const f = fixture();
  t.after(f.cleanup);
  const count = counted(f.adapter);
  const first = await translateGlossJob({
    ...f.options,
    adapter: count.adapter,
  });
  const response = first.entries[0].attempts[0].response!;
  const previous = readArtifactText(f.root, response.path, response.sha256);
  const other = createGlossJob({
    ...f.job,
    provider: { ...f.job.provider, model: 'other-stub-model' },
  });
  const second = await translateGlossJob({
    ...f.options,
    job: other,
    adapter: count.adapter,
    jobFile: 'model2.json',
  });
  assert.notEqual(second.entries[0].attempts[0].response!.path, response.path);
  assert.equal(
    readArtifactText(f.root, response.path, response.sha256),
    previous,
  );
  await translateGlossJob({ ...f.options, job: first, adapter: count.adapter });
  assert.equal(count.calls(), 2);
});

void test('pilot selection rejects duplicate targets and cannot claim 100 from a small sample', () => {
  const f = fixture();
  try {
    assert.equal(selectGlossPilotCandidates([f.candidate], 1).length, 1);
    assert.throws(
      () => selectGlossPilotCandidates([f.candidate, f.candidate], 1),
      /multiple candidates/,
    );
    assert.throws(
      () => selectGlossPilotCandidates([f.candidate], 100),
      /100 unique/,
    );
  } finally {
    f.cleanup();
  }
});
void test('429/5xx retries are capped, honor Retry-After and count all attempts', async (t) => {
  const f = fixture();
  t.after(f.cleanup);
  let calls = 0;
  const waits: number[] = [];
  const adapter: GlossProvider = {
    ...f.adapter,
    call(...args) {
      calls++;
      if (calls < 3)
        return Promise.reject(
          new GlossProviderError('Go HTTP 429', true, 'failed', 2000),
        );
      return f.adapter.call(...args);
    },
  };
  const result = await translateGlossJob({
    ...f.options,
    adapter,
    sleep: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
  });
  assert.equal(result.usage.attemptCount, 3);
  assert.equal(result.entries[0].state, 'validated');
  assert.deepEqual(waits, [2000, 2000]);
  const g = fixture();
  t.after(g.cleanup);
  const cap = createGlossJob({
    ...g.job,
    caps: { ...g.job.caps, maxRequests: 1 },
  });
  const r = await translateGlossJob({
    ...g.options,
    job: cap,
    adapter: {
      ...g.adapter,
      call: () =>
        Promise.reject(new GlossProviderError('Go HTTP 503', true, 'failed')),
    },
    sleep: () => Promise.resolve(),
  });
  assert.equal(r.usage.attemptCount, 1);
  assert.equal(r.entries[0].state, 'failed');
});
void test('unknown attempts retain budget and require explicit retry; fatal errors do not retry', async (t) => {
  const f = fixture();
  t.after(f.cleanup);
  let calls = 0;
  const adapter: GlossProvider = {
    ...f.adapter,
    call(...args) {
      calls++;
      return calls === 1
        ? Promise.reject(new GlossProviderError('timeout', true, 'unknown'))
        : f.adapter.call(...args);
    },
  };
  await assert.rejects(translateGlossJob({ ...f.options, adapter }), /timeout/);
  const pending = parseGlossJob(readArtifactJson(f.root, 'job.json'));
  assert.equal(pending.entries[0].attempts[0].outcome, 'unknown');
  assert.ok(pending.usage.tokens > 0);
  await assert.rejects(
    translateGlossJob({ ...f.options, adapter, job: pending }),
    /explicit/,
  );
  assert.equal(calls, 1);
  const resumed = await translateGlossJob({
    ...f.options,
    adapter,
    job: pending,
    retryUnknown: true,
  });
  assert.equal(resumed.usage.attemptCount, 2);
  assert.equal(calls, 2);
  const g = fixture();
  t.after(g.cleanup);
  let denied = 0;
  await assert.rejects(
    translateGlossJob({
      ...g.options,
      adapter: {
        ...g.adapter,
        call: () => {
          denied++;
          return Promise.reject(
            new GlossProviderError('Go HTTP 403', false, 'failed'),
          );
        },
      },
    }),
    /403/,
  );
  assert.equal(denied, 1);
});
void test('token/cost reservation stops before calls and preserves untouched candidates', async (t) => {
  const f = fixture();
  t.after(f.cleanup);
  const count = counted(f.adapter);
  const cap = createGlossJob({
    ...f.job,
    caps: { ...f.job.caps, maxTokens: 1 },
  });
  const result = await translateGlossJob({
    ...f.options,
    job: cap,
    adapter: count.adapter,
  });
  assert.equal(result.entries[0].state, 'pending');
  assert.equal(count.calls(), 0);
  const g = fixture();
  t.after(g.cleanup);
  const expensive = counted({ ...g.adapter, inputRatePerMillion: 1 });
  const zero = await translateGlossJob({
    ...g.options,
    adapter: expensive.adapter,
  });
  assert.equal(zero.usage.attemptCount, 0);
  assert.equal(expensive.calls(), 0);
});
void test('wrong ID/invalid JSON/null/truncated output is rejected, never cached', async (t) => {
  for (const kind of ['id', 'json', 'null', 'truncated']) {
    const f = fixture();
    t.after(f.cleanup);
    const adapter: GlossProvider = {
      ...f.adapter,
      async call(...args) {
        const result = await f.adapter.call(...args);
        if (kind === 'id')
          result.output = {
            target_type: 'sense',
            target_id: '42',
            gloss_vi: 'mèo',
            reason: null,
          };
        if (kind === 'json') result.output = 'not JSON';
        if (kind === 'null')
          result.output = {
            target_type: 'sense',
            target_id: f.candidate.target!.targetId,
            gloss_vi: null,
            reason: 'Insufficient context',
          };
        if (kind === 'truncated')
          result.validationError = 'Response not completed';
        return result;
      },
    };
    const result = await translateGlossJob({ ...f.options, adapter });
    assert.equal(result.entries[0].state, 'rejected');
    assert.equal(result.usage.attemptCount, 1);
    assert.throws(() =>
      statSync(
        path.join(
          f.root,
          `cache/${computeGlossCacheKey(f.candidate, f.job.provider)}.json`,
        ),
      ),
    );
  }
});
void test('concurrent generation cannot consume quota from the same stale checkpoint', async (t) => {
  const f = fixture();
  t.after(f.cleanup);
  const count = counted(f.adapter);
  const results = await Promise.allSettled([
    translateGlossJob({ ...f.options, adapter: count.adapter }),
    translateGlossJob({ ...f.options, adapter: count.adapter }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(count.calls(), 1);
});
void test('protocol parser extracts only completed assistant text, handles usage and reasoning', () => {
  const output = {
    target_type: 'sense',
    target_id: '1',
    gloss_vi: 'mèo',
    reason: null,
  };
  const responses = {
    status: 'completed',
    output: [
      { type: 'reasoning', summary: [] },
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: JSON.stringify(output) }],
      },
    ],
    usage: { input_tokens: 5, output_tokens: 3 },
  };
  assert.deepEqual(parseProviderResult(responses, 'responses').output, output);
  assert.ok(
    parseProviderResult({ ...responses, status: 'incomplete' }, 'responses')
      .validationError,
  );
  assert.deepEqual(
    parseProviderResult(
      {
        choices: [
          {
            finish_reason: 'stop',
            message: { content: JSON.stringify(output) },
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 3 },
      },
      'chat_completions',
    ).output,
    output,
  );
});
void test('Go HTTP mock verifies endpoint, headers, timeout, retry status and key redaction', async (t) => {
  const f = fixture();
  t.after(f.cleanup);
  const seen: { url?: string; headers?: typeof requestHeaders } = {};
  const requestHeaders = {
    authorization: 'Bearer fixture-secret',
    'x-opencode-session': f.job.sessionId,
  };
  let mode: 'responses' | 'chat' | 'deny' | 'slow' = 'responses';
  const server = createServer((req, res) => {
    seen.url = req.url;
    seen.headers = {
      authorization: String(req.headers.authorization),
      'x-opencode-session': String(req.headers['x-opencode-session']),
    };
    if (mode === 'slow') return;
    if (mode === 'deny') {
      res.writeHead(401);
      res.end('fixture-secret');
      return;
    }
    const output = JSON.stringify({
      target_type: 'sense',
      target_id: f.candidate.target!.targetId,
      gloss_vi: 'mèo',
      reason: null,
    });
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify(
        mode === 'chat'
          ? {
              choices: [
                { finish_reason: 'stop', message: { content: output } },
              ],
              note: 'fixture-secret',
            }
          : {
              status: 'completed',
              output: [
                {
                  type: 'message',
                  role: 'assistant',
                  content: [{ type: 'output_text', text: output }],
                },
              ],
              note: 'fixture-secret',
            },
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => close(server));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('No mock address');
  const adapter = createGoGlossProvider({
    apiKey: 'fixture-secret',
    timeoutMs: 200,
    maxOutputTokens: 1200,
    reasoningEffort: 'minimal',
    inputRatePerMillion: 0.1,
    outputRatePerMillion: 0.2,
    allowLocalMock: true,
  });
  const provider: GlossJob['provider'] = {
    ...f.job.provider,
    name: 'opencode-go',
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
  };
  const result = await adapter.call(f.candidate, provider, f.job.sessionId);
  assert.equal(seen.url, '/v1/responses');
  assert.deepEqual(seen.headers, requestHeaders);
  assert.ok(!JSON.stringify(result.raw).includes('fixture-secret'));
  mode = 'chat';
  await adapter.call(
    f.candidate,
    { ...provider, protocol: 'chat_completions' },
    f.job.sessionId,
  );
  assert.equal(seen.url, '/v1/chat/completions');
  mode = 'deny';
  await assert.rejects(
    adapter.call(f.candidate, provider, f.job.sessionId),
    /401/,
  );
  mode = 'slow';
  await assert.rejects(
    adapter.call(f.candidate, provider, f.job.sessionId),
    /timed out/,
  );
});
function close(server: Server): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

void test('human gate binds 100 outputs and rejects output swaps, low pass count, severe errors', async () => {
  const f = fixture();
  try {
    const candidates: GlossCandidate[] = Array.from({ length: 100 }, (_, i) => {
      if (
        f.candidate.classification !== 'needs_translation' ||
        f.candidate.target.targetType !== 'sense'
      )
        throw new Error('Bad fixture');
      const id = String(9007199254740993n + BigInt(i));
      return createGlossCandidate({
        ...f.candidate,
        target: {
          ...f.candidate.target,
          targetId: id,
          semanticKey: `fixture:sense:${i}`,
        },
        context: {
          ...f.candidate.context,
          rows: f.candidate.context.rows.map((r) =>
            r.kind === 'concept_definition' ? r : { ...r, senseId: id },
          ),
        },
      });
    });
    const entries = candidates.map((c) => ({
      ...f.job.entries[0],
      candidateKey: c.candidateKey,
      inputHash: c.inputHash,
      state: 'validated' as const,
      validation: 'passed' as const,
      output: {
        target_type: 'sense' as const,
        target_id: c.target!.targetId,
        gloss_vi: 'mèo',
        reason: null,
      },
    }));
    const job = createGlossJob({ ...f.job, entries });
    const template = createGlossReviewTemplate(job, candidates);
    assert.ok(template.entries.every((e) => e.verdict === 'fail'));
    assert.throws(() => validateGlossReview(job, candidates, template));
    writeArtifactJson(f.root, 'job.json', job);
    writeFileSync(
      path.join(f.root, 'review-candidates.jsonl'),
      candidates.map((c) => JSON.stringify(c)).join('\n'),
      { mode: 0o600 },
    );
    const exportArgs = [
      '--artifact-dir',
      f.root,
      '--candidates',
      'review-candidates.jsonl',
    ];
    await exportReview(exportArgs);
    const reviewPath = `reviews/${job.jobKey}-template.json`;
    writeArtifactJson(f.root, reviewPath, {
      reviewer: 'Human edits preserved',
    });
    const editedReview = readArtifactText(f.root, reviewPath);
    await assert.rejects(exportReview(exportArgs), /already exists/);
    assert.equal(readArtifactText(f.root, reviewPath), editedReview);
    const review = {
      schemaVersion: 1,
      jobKey: job.jobKey,
      entries: entries.map((e) => ({
        candidateKey: e.candidateKey,
        inputHash: e.inputHash,
        outputHash: hashGlossOutput(e.output),
        verdict: 'pass',
        severity: 'none',
        reviewer: 'Fixture bilingual reviewer',
        reviewedAt: '2026-10-05T09:00:00Z',
        reason: null as string | null,
      })),
    };
    validateGlossReview(job, candidates, review);
    review.entries[0].reviewer = 'UNREVIEWED';
    assert.throws(() => validateGlossReview(job, candidates, review));
    review.entries[0].reviewer = 'Fixture bilingual reviewer';
    review.entries[0].outputHash = artifactHash('changed');
    assert.throws(() => validateGlossReview(job, candidates, review));
    review.entries[0].outputHash = hashGlossOutput(entries[0].output);
    for (const row of review.entries.slice(0, 3)) {
      row.verdict = 'fail';
      row.reason = 'Wrong gloss';
      row.severity = 'minor';
    }
    assert.throws(() => validateGlossReview(job, candidates, review));
    review.entries[2].verdict = 'pass';
    review.entries[0].severity = 'severe';
    assert.throws(() => validateGlossReview(job, candidates, review));
  } finally {
    f.cleanup();
  }
});
