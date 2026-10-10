/** M10.5: export only Muse-origin cookies to a private VPS file. Never log values. */
import { createRequire } from 'node:module';
import { writeFileSync, renameSync, chmodSync } from 'node:fs';
const require = createRequire(
  '/opt/langoo/services/muse-bridge/upstream/package.json',
);
const { chromium } = require('playwright-core');
const path = '/opt/langoo/storage/muse-native/cookies.json';
let browser;
try {
  browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const contexts = browser.contexts();
  if (contexts.length !== 1) throw new Error('Unexpected context count');
  const cookies = await contexts[0].cookies('https://muse.ai/');
  if (!cookies.some((cookie) => cookie.name === 'hatch_sess' && cookie.value))
    throw new Error('Muse login missing');
  if (new Set(cookies.map((cookie) => cookie.name)).size !== cookies.length)
    throw new Error('Ambiguous cookie scope');
  const values = Object.fromEntries(
    cookies.map((cookie) => [cookie.name, cookie.value]),
  );
  writeFileSync(path + '.tmp', JSON.stringify({ cookies: values }), {
    mode: 0o600,
  });
  chmodSync(path + '.tmp', 0o600);
  renameSync(path + '.tmp', path);
  console.log(
    JSON.stringify({ exported: true, scope: 'https://muse.ai/', mode: '0600' }),
  );
} catch {
  console.error('Muse session export failed; no credentials logged');
  process.exitCode = 1;
} finally {
  await browser?.close();
}
