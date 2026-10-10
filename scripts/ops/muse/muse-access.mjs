/** M10.4: limit the upstream shim to authenticated, internal pilot requests. */
import { timingSafeEqual } from 'node:crypto';

export function accessStatus(req, key) {
  const supplied = Buffer.from(req.headers.authorization ?? '');
  const expected = Buffer.from(`Bearer ${key}`);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    return 401;
  // This service is for server-to-server calls, not browser JS.
  if (req.headers.origin) return 403;
  const routes = new Set([
    'GET /health',
    'GET /v1/models',
    'POST /v1/chat/completions',
  ]);
  if (!routes.has(`${req.method} ${req.url}`)) return 404;
  return 200;
}

export function guardedHandler(upstream, key) {
  if (key.length < 32 || /\s/.test(key))
    throw new Error(
      'M10.4 requires a private API key of at least 32 characters',
    );
  let active = false;
  return (req, res) => {
    const status = accessStatus(req, key);
    if (status !== 200) {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'Muse pilot access denied' } }),
      );
      return;
    }
    if (req.method === 'POST' && active) {
      res.writeHead(429, {
        'content-type': 'application/json',
        'retry-after': '3',
      });
      res.end(JSON.stringify({ error: { message: 'Muse browser is busy' } }));
      return;
    }
    // Trial requests must not implicitly continue the shared main chat.
    // Fresh-thread reliability and full-history support remain release gates.
    if (req.method !== 'POST') return upstream(req, res);
    req.headers['x-muse-thread'] = 'new';
    active = true;
    return Promise.resolve()
      .then(() => upstream(req, res))
      .finally(() => {
        active = false;
      });
  };
}

export function requireFreshThreads(driver) {
  const original = driver._newChat.bind(driver);
  driver._newChat = async () => {
    const before = driver.page.url();
    const result = await original();
    const after = new URL(driver.page.url());
    // Muse allocates the UUID only after sending the first message.
    const draft = after.pathname === '/thread/new';
    const empty =
      (await driver.page.locator('[data-message-item]').count()) === 0;
    if (
      after.origin !== 'https://muse.ai' ||
      (!draft && !/^\/thread\/[0-9a-f-]{36}\/?$/i.test(after.pathname)) ||
      (!draft && after.href === before) ||
      !empty
    )
      throw new Error('Muse did not create an isolated thread');
    return result;
  };
}
