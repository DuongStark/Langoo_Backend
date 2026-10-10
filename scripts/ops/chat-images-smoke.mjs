/** M10.3: opt-in deployed API vision/privacy smoke; deletes only its own test user. */
import { readFileSync } from 'node:fs';
import { randomUUID, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import dotenv from 'dotenv';
import pg from 'pg';

if (!process.argv.includes('--allow-create-test-user'))
  throw new Error('Requires --allow-create-test-user');
const base =
  process.argv.find((x) => x.startsWith('--base='))?.slice(7) ??
  'http://127.0.0.1:3000/v1';
const env = dotenv.parse(readFileSync('.env'));
const db = new pg.Client({ connectionString: env.DATABASE_URL });
const email = `smoke-m10-3-${randomUUID()}@langoo.test`;
const image =
  'data:image/png;base64,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';
let token;
let connected = false;
let canCleanup = false;
async function call(route, method = 'GET', body) {
  const res = await fetch(base + route, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(90000),
  });
  const data = await res.json();
  if (!res.ok)
    throw new Error(`API ${route}: ${res.status} ${data.code ?? ''}`);
  return data;
}
try {
  await db.connect();
  connected = true;
  const existing = await db.query('SELECT id FROM app.users WHERE email=$1', [
    email,
  ]);
  if (existing.rowCount) throw new Error('Smoke email already exists');
  canCleanup = true;
  const auth = await call('/auth/register', 'POST', {
    email,
    password: randomBytes(24).toString('hex'),
  });
  token = auth.access_token;
  if (!token) throw new Error('No smoke token');
  const session = await call('/chat/sessions', 'POST', {
    language_id: 2,
    title: 'M10.3 vision smoke',
  });
  const body = {
    content: 'Đọc đúng từ tiếng Anh trong ảnh và dịch sang tiếng Việt.',
    images: [image],
  };
  const result = await call(
    `/chat/sessions/${session.id}/messages`,
    'POST',
    body,
  );
  if (!/cat/i.test(result.assistant_message?.content ?? ''))
    throw new Error('Vision reply did not identify CAT');
  const res = await fetch(
    base + `/chat/sessions/${session.id}/messages/stream`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90000),
    },
  );
  const sse = await res.text();
  if (!res.ok || !sse.includes('event: done') || sse.includes('event: error'))
    throw new Error('Vision stream failed');
  const bad = await fetch(base + `/chat/sessions/${session.id}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: 'hi',
      images: ['https://example.test/image.png'],
    }),
  });
  if (bad.status !== 400) throw new Error('External URL accepted');
  const history = await call(`/chat/sessions/${session.id}/messages`);
  const rows = await db.query(
    'SELECT content,content_json FROM app.chat_message WHERE session_id=$1',
    [session.id],
  );
  if (
    rows.rowCount !== 4 ||
    JSON.stringify(rows.rows).includes('base64') ||
    JSON.stringify(history).includes('base64')
  )
    throw new Error('Image leaked into persisted history');
  const pm = JSON.parse(
    execFileSync('sudo', ['-u', 'langoo', '-H', 'pm2', 'jlist'], {
      encoding: 'utf8',
    }),
  ).find((p) => p.name === 'langoo-api');
  for (const file of [pm.pm2_env.pm_out_log_path, pm.pm2_env.pm_err_log_path]) {
    const tail = readFileSync(file)
      .subarray(-512 * 1024)
      .toString();
    if (tail.includes(image.slice(0, 150)))
      throw new Error('Image found in runtime log');
  }
  console.log(
    JSON.stringify({
      task: 'M10.3',
      visionNormal: true,
      visionSse: true,
      externalUrlRejected: true,
      persistedMessages: rows.rowCount,
      historyHasImages: false,
      logsHaveImages: false,
    }),
  );
} finally {
  if (connected && canCleanup) {
    const deleted = await db.query(
      'DELETE FROM app.users WHERE email=$1 RETURNING id',
      [email],
    );
    console.log(JSON.stringify({ smokeUsersRemoved: deleted.rowCount }));
  }
  if (connected) await db.end();
}
