/** Run against the pinned upstream checkout after applying upstream-context.patch. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { once } from 'node:events';
import { guardedHandler } from './muse-access.mjs';

if (!process.env.MUSE_UPSTREAM_DIR)
  throw new Error('Set MUSE_UPSTREAM_DIR to patched upstream');
process.env.MUSE_SHIM_MODELS = 'muse-browser';
const root = process.env.MUSE_UPSTREAM_DIR;
const { buildPrompt, startShim } = await import(
  pathToFileURL(path.join(root, 'muse-openai-shim.mjs')).href
);
const { driver } = await import(
  pathToFileURL(path.join(root, 'muse-driver.mjs')).href
);
const key = 'fixture-only-muse-key-with-more-than-32-characters';

test('preserves system and full text history while keeping current question last', () => {
  const prompt = buildPrompt({
    messages: [
      { role: 'system', content: 'Explain in Vietnamese.' },
      { role: 'user', content: 'My nickname is FENNEC.' },
      { role: 'assistant', content: 'I will remember FENNEC.' },
      { role: 'user', content: 'What is my nickname?' },
    ],
  });
  assert.ok(prompt.startsWith('Explain in Vietnamese.'));
  assert.ok(prompt.includes('My nickname is FENNEC.'));
  assert.ok(prompt.includes('I will remember FENNEC.'));
  assert.ok(prompt.endsWith('What is my nickname?'));
  assert.ok(!prompt.includes('### USER'));
});

test('patched HTTP transport enforces images, fails incomplete replies, and omits fake usage', async (t) => {
  const originalChat = driver.chat;
  const originalStream = driver.chatStream;
  const server = startShim({ port: 0, host: '127.0.0.1' });
  const [upstream] = server.listeners('request');
  server.removeListener('request', upstream);
  server.on('request', guardedHandler(upstream, key));
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (body) =>
    fetch(base + '/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'muse-browser',
        messages: [{ role: 'user', content: 'hello' }],
        ...body,
      }),
      signal: AbortSignal.timeout(3000),
    });
  try {
    await t.test(
      'rejects filesystem/remote attachments without dispatching browser',
      async () => {
        let calls = 0;
        driver.chat = async () => {
          calls++;
          return { reply: 'ok' };
        };
        for (const files of [['/etc/passwd'], ['http://127.0.0.1/private']]) {
          assert.equal((await call({ files })).status, 400);
        }
        for (const url of [
          'file:///etc/passwd',
          'https://example.test/image.png',
          'data:image/svg+xml;base64,PHN2Zy8+',
        ]) {
          const r = await call({
            messages: [
              {
                role: 'user',
                content: [{ type: 'image_url', image_url: { url } }],
              },
            ],
          });
          assert.equal(r.status, 400);
        }
        assert.equal(calls, 0);
      },
    );
    await t.test(
      'only uploads current-turn images and forwards complete text context',
      async () => {
        driver.chat = async (prompt, options) => {
          assert.deepEqual(options.files, [
            { url: 'data:image/png;base64,Yg==' },
          ]);
          assert.equal(options.newThread, true);
          assert.ok(prompt.includes('previous image'));
          return { reply: 'complete' };
        };
        const image = (text, url) => [
          { type: 'text', text },
          { type: 'image_url', image_url: { url } },
        ];
        const r = await call({
          messages: [
            {
              role: 'user',
              content: image('previous image', 'data:image/png;base64,YQ=='),
            },
            { role: 'assistant', content: 'a' },
            {
              role: 'user',
              content: image('current image', 'data:image/png;base64,Yg=='),
            },
          ],
        });
        assert.equal(r.status, 200);
        const j = await r.json();
        assert.equal(j.choices[0].message.content, 'complete');
        assert.equal(j.usage, undefined);
      },
    );
    await t.test(
      'partial timeout, approval, upstream error, and empty replies fail',
      async () => {
        for (const result of [
          { reply: 'partial', timedOut: true },
          { reply: 'partial', needsApproval: true },
          { reply: 'partial', error: 'fixture error' },
          { reply: ' ' },
        ]) {
          driver.chat = async () => result;
          const r = await call({});
          assert.equal(r.status, 502);
          assert.ok(!(await r.text()).includes('partial'));
        }
      },
    );
    await t.test(
      'successful SSE includes DONE and has no fabricated usage',
      async () => {
        driver.chatStream = async (_, options) => {
          options.onDelta('complete');
          return { reply: 'complete' };
        };
        const r = await call({
          stream: true,
          stream_options: { include_usage: true },
        });
        const text = await r.text();
        assert.ok(text.includes('complete'));
        assert.ok(text.includes('[DONE]'));
        assert.ok(!text.includes('"usage"'));
      },
    );
    await t.test(
      'failed SSE breaks the stream instead of finishing a partial success',
      async () => {
        driver.chatStream = async (_, options) => {
          options.onDelta('partial');
          return { reply: 'partial', timedOut: true };
        };
        await assert.rejects(async () => {
          const r = await call({ stream: true });
          await r.text();
        });
      },
    );
  } finally {
    driver.chat = originalChat;
    driver.chatStream = originalStream;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
