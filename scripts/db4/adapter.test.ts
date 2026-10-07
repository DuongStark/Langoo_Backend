import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderMappingBundle } from './_mapping-types';
import {
  buildReviewPrompt,
  createChatCompletionsAdapter,
  extractJsonObject,
} from './_adapter_openai';
import { fixtureCase, providerFixture } from './fixtures/build';
import type { ProviderAdapterRequest } from './_runner';

function request(phase: 'r1' | 'r2' = 'r1'): ProviderAdapterRequest {
  const fixture = fixtureCase();
  const provider = providerFixture(phase);
  return {
    phase,
    bundle: fixture.bundle,
    rendered: renderMappingBundle(
      fixture.bundle,
      phase,
      'fixture-seed-v1',
      provider.promptVersion,
    ),
    provider,
    attemptIndex: 1,
  };
}

void test('prompt: JSON payload deterministic + guidance theo phase', () => {
  const r1 = buildReviewPrompt(request('r1'));
  const r1b = buildReviewPrompt(request('r1'));
  const r2 = buildReviewPrompt(request('r2'));
  assert.deepEqual(r1, r1b);
  assert.notEqual(r1.system, r2.system);
  assert.match(r1.system, /pass R1/);
  assert.match(r2.system, /adversarially/);
  const payload = JSON.parse(r1.user) as {
    phase: string;
    bundleKey: string;
    candidates: unknown[];
    sourceBranches: string[];
  };
  assert.equal(payload.phase, 'r1');
  assert.equal(payload.bundleKey, fixtureCase().bundle.bundleKey);
  assert.equal(
    payload.candidates.length,
    fixtureCase().bundle.candidates.length,
  );
  assert.deepEqual(payload.sourceBranches, fixtureCase().bundle.sourceBranches);
});

void test('extractJsonObject: bỏ code fence + cắt quanh object', () => {
  assert.deepEqual(extractJsonObject('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJsonObject('prefix {"a":{"b":2}} suffix'), {
    a: { b: 2 },
  });
  assert.throws(() => extractJsonObject('không có json'));
});

void test('adapter: gọi đúng endpoint/headers/body, parse output + usage', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fakeFetch: typeof fetch = (url, init) => {
    calls.push({
      url:
        url instanceof URL ? url.href : typeof url === 'string' ? url : url.url,
      init: init as RequestInit,
    });
    return Promise.resolve(
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content:
                  '```json\n{"schemaVersion":1,"task":"sense_concept_review"}\n```',
              },
            },
          ],
          usage: {
            prompt_tokens: 120,
            completion_tokens: 45,
            total_tokens: 165,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
  };
  const adapter = createChatCompletionsAdapter({
    endpoint: 'https://example.invalid/v1/chat/completions',
    apiKey: 'test-key',
    model: 'test-model',
    sessionId: 'config-session',
    maxTokens: 2048,
    fetchImpl: fakeFetch,
  });
  const result = await adapter.review(request('r2'));
  assert.deepEqual(result.raw, {
    schemaVersion: 1,
    task: 'sense_concept_review',
  });
  assert.deepEqual(result.usage, { tokens: 165, costMicrousd: 0 });
  assert.equal(calls.length, 1);
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer test-key');
  assert.equal(headers['x-opencode-session'], 'fixture-session-r2');
  const body = JSON.parse(calls[0].init.body as string) as {
    model: string;
    max_tokens: number;
    temperature: number;
    messages: { role: string }[];
  };
  assert.equal(body.model, 'test-model');
  assert.equal(body.max_tokens, 2048);
  assert.equal(body.temperature, 0);
  assert.deepEqual(
    body.messages.map((m) => m.role),
    ['system', 'user'],
  );
});

void test('adapter: HTTP lỗi / JSON rác / finish length đều throw', async () => {
  const make = (response: Response) =>
    createChatCompletionsAdapter({
      endpoint: 'https://example.invalid/v1/chat/completions',
      apiKey: 'k',
      model: 'm',
      sessionId: 's',
      maxTokens: 100,
      fetchImpl: () => Promise.resolve(response),
    });
  await assert.rejects(
    make(new Response('rate limited', { status: 429 })).review(request('r1')),
    /HTTP 429/,
  );
  await assert.rejects(
    make(
      new Response(
        JSON.stringify({
          choices: [
            { finish_reason: 'stop', message: { content: 'xin chào' } },
          ],
        }),
        { status: 200 },
      ),
    ).review(request('r1')),
    /JSON/,
  );
  await assert.rejects(
    make(
      new Response(
        JSON.stringify({
          choices: [
            { finish_reason: 'length', message: { content: '{"a":1}' } },
          ],
        }),
        { status: 200 },
      ),
    ).review(request('r1')),
    /bị cắt/,
  );
});
