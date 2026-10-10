/** M10.4: authenticated loopback pilot over a pinned upstream checkout. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { guardedHandler, requireFreshThreads } from './muse-access.mjs';

const root = process.env.MUSE_UPSTREAM_DIR;
const keyFile = process.env.MUSE_API_KEY_FILE;
if (!root || !keyFile)
  throw new Error('Missing private Muse deployment settings');
const key = readFileSync(keyFile, 'utf8').trim();
const { startShim } = await import(
  pathToFileURL(path.join(root, 'muse-openai-shim.mjs')).href
);
const { driver } = await import(
  pathToFileURL(path.join(root, 'muse-driver.mjs')).href
);
requireFreshThreads(driver);
const server = startShim({ host: '127.0.0.1', port: 8787 });
const [upstream] = server.listeners('request');
server.removeListener('request', upstream);
server.on('request', guardedHandler(upstream, key));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    server.close();
    await driver.close().catch(() => {});
    process.exit(0);
  });
}
await driver.launch();
console.log(
  'M10.4 pilot browser attached; authentication must be checked separately',
);
