import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accessStatus,
  guardedHandler,
  requireFreshThreads,
} from './muse-access.mjs';

const key = 'fixture-only-muse-key-with-more-than-32-characters';
function request(method = 'GET', url = '/health', headers = {}) {
  return {
    method,
    url,
    headers: { authorization: `Bearer ${key}`, ...headers },
  };
}

test('requires exact bearer key even for status and models', () => {
  assert.equal(accessStatus(request(), key), 200);
  for (const url of ['/health', '/v1/models', '/v1/chat/completions'])
    for (const authorization of ['', 'Bearer wrong', `${key}`, `bearer ${key}`])
      assert.equal(
        accessStatus(request('GET', url, { authorization }), key),
        401,
      );
});

test('does not expose account chat reading, media download, or arbitrary routes', () => {
  for (const url of [
    '/v1/muse/chats',
    '/v1/muse/chat?target=0',
    '/v1/muse/media?download=1',
    '/',
  ])
    assert.equal(accessStatus(request('GET', url), key), 404);
  assert.equal(accessStatus(request('POST', '/health'), key), 404);
});

test('rejects browser-origin calls even with a valid key', () => {
  assert.equal(
    accessStatus(
      request('GET', '/health', { origin: 'https://example.test' }),
      key,
    ),
    403,
  );
});

test('forces fresh thread and never dispatches unauthorized requests', async () => {
  let calls = 0;
  const handler = guardedHandler((req) => {
    calls++;
    assert.equal(req.headers['x-muse-thread'], 'new');
  }, key);
  await handler(
    request('POST', '/v1/chat/completions', { 'x-muse-thread': 'current' }),
    {},
  );
  let status;
  const res = {
    writeHead: (s) => {
      status = s;
    },
    end: () => {},
  };
  handler(request('POST', '/v1/chat/completions', { authorization: '' }), res);
  assert.equal(calls, 1);
  assert.equal(status, 401);
});

test('rejects concurrent generation until the browser action completes', async () => {
  let finish;
  const handler = guardedHandler(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    key,
  );
  const pending = handler(request('POST', '/v1/chat/completions'), {});
  await Promise.resolve();
  let status;
  handler(request('POST', '/v1/chat/completions'), {
    writeHead: (s) => {
      status = s;
    },
    end: () => {},
  });
  assert.equal(status, 429);
  finish();
  await pending;
});

test('never sends to the main chat or a previous thread when new chat fails', async () => {
  const prior = 'https://muse.ai/thread/11111111-1111-1111-1111-111111111111';
  for (const next of [
    prior,
    'https://muse.ai/',
    'https://example.test/thread/22222222-2222-2222-2222-222222222222',
  ]) {
    let url = prior;
    const driver = {
      page: { url: () => url, locator: () => ({ count: async () => 0 }) },
      _newChat: async () => {
        url = next;
      },
    };
    requireFreshThreads(driver);
    await assert.rejects(driver._newChat(), /isolated thread/);
  }
  let url = prior;
  const driver = {
    page: { url: () => url, locator: () => ({ count: async () => 0 }) },
    _newChat: async () => {
      url = 'https://muse.ai/thread/22222222-2222-2222-2222-222222222222';
      return { ok: true };
    },
  };
  requireFreshThreads(driver);
  assert.deepEqual(await driver._newChat(), { ok: true });
});

test('allows an empty new draft but refuses a draft with any previous message', async () => {
  for (const count of [0, 1]) {
    const driver = {
      page: {
        url: () => 'https://muse.ai/thread/new',
        locator: () => ({ count: async () => count }),
      },
      _newChat: async () => ({ ok: true }),
    };
    requireFreshThreads(driver);
    if (count === 0) assert.deepEqual(await driver._newChat(), { ok: true });
    else await assert.rejects(driver._newChat(), /isolated thread/);
  }
});

test('refuses empty or short credentials', () => {
  for (const value of ['', 'short', 'a'.repeat(32) + '\n'])
    assert.throws(() => guardedHandler(() => {}, value));
});
