/** M10.4: explicitly opted-in live fixture calls; never reads personal chats. */
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';

if (!process.argv.includes('--allow-live'))
  throw new Error('Requires --allow-live');
const keyFile = process.env.MUSE_API_KEY_FILE;
const output = process.env.MUSE_SMOKE_OUTPUT;
if (!keyFile || !output)
  throw new Error('Set private key file and output path');
const key = readFileSync(keyFile, 'utf8').trim();
const base = process.env.MUSE_SMOKE_BASE ?? 'http://127.0.0.1:8787';
const image = JSON.parse(
  readFileSync(new URL('./vision-fixture.json', import.meta.url), 'utf8'),
).image;
const headers = {
  authorization: `Bearer ${key}`,
  'content-type': 'application/json',
  'x-muse-timeout-ms': '60000',
};
const result = {
  task: 'M10.4',
  date: new Date().toISOString(),
  cases: [],
  liveRequests: 0,
  nativeTokenUsageAvailable: false,
};
const health = () =>
  fetch(base + '/health', { headers, signal: AbortSignal.timeout(15000) }).then(
    (r) => r.json(),
  );
const user = (content) => ({ role: 'user', content });
const withImage = () =>
  user([
    { type: 'text', text: 'Đọc chữ tiếng Anh trong ảnh. Chỉ trả lời chữ đó.' },
    { type: 'image_url', image_url: { url: image } },
  ]);

async function run(name, messages, validate, stream = false) {
  const started = performance.now();
  result.liveRequests++;
  let reply = '',
    firstDeltaMs = null,
    done = false,
    status;
  try {
    const res = await fetch(base + '/v1/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: 'muse-browser', messages, stream }),
      signal: AbortSignal.timeout(90000),
    });
    status = res.status;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!stream) {
      const j = await res.json();
      if (j.usage !== undefined)
        throw new Error('Unexpected native usage claim');
      reply = j.choices?.[0]?.message?.content ?? '';
    } else {
      let pending = '';
      const decoder = new TextDecoder();
      for await (const chunk of res.body) {
        pending += decoder.decode(chunk, { stream: true });
        let newline;
        while ((newline = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, newline).trim();
          pending = pending.slice(newline + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') {
            done = true;
            continue;
          }
          const j = JSON.parse(data);
          const text = j.choices?.[0]?.delta?.content;
          if (typeof text === 'string' && text) {
            firstDeltaMs ??= Math.round(performance.now() - started);
            reply += text;
          }
        }
      }
      if (!done) throw new Error('Stream ended without DONE');
    }
    const state = await health();
    const pathname = new URL(state.url).pathname;
    const isolated = /^\/thread\/[0-9a-f-]{36}\/?$/i.test(pathname);
    const row = {
      name,
      status,
      pass: Boolean(validate(reply)) && isolated,
      elapsedMs: Math.round(performance.now() - started),
      firstDeltaMs,
      isolatedThread: isolated,
      threadHash: createHash('sha256').update(pathname).digest('hex'),
      reply: reply.slice(0, 1500),
    };
    result.cases.push(row);
    console.log(
      JSON.stringify({
        name,
        pass: row.pass,
        elapsedMs: row.elapsedMs,
        firstDeltaMs,
        isolatedThread: isolated,
        reply: row.reply,
      }),
    );
  } catch (error) {
    const row = {
      name,
      status,
      pass: false,
      elapsedMs: Math.round(performance.now() - started),
      error: error.message,
    };
    result.cases.push(row);
    console.log(JSON.stringify(row));
  }
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n', {
    mode: 0o600,
  });
}

try {
  const state = await health();
  result.loggedIn = state.loggedIn === true;
  result.composerReady = state.composerReady === true;
  if (!result.loggedIn || !result.composerReady)
    throw new Error('Muse login/composer gate not ready');
  await run(
    'text',
    [user('Chỉ trả lời đúng chuỗi: MUSE_OK')],
    (text) => text.trim() === 'MUSE_OK',
  );
  await run(
    'japanese-vietnamese',
    [
      user(
        '食べる（たべる）có nghĩa là gì? Trả lời tiếng Việt trong một câu ngắn.',
      ),
    ],
    (text) => /ăn/i.test(text) && !/uống/i.test(text),
  );
  await run(
    'sense-json-bank',
    [
      user(
        'Chọn nghĩa phổ biến nhất của bank cho người mới học tiếng Anh: bank-finance = tổ chức nhận tiền gửi và cho vay; bank-river = bờ sông. Chỉ trả object JSON {"sense_id":"ID đã chọn"}, không giải thích.',
      ),
    ],
    (text) => {
      try {
        return (
          JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')).sense_id ===
          'bank-finance'
        );
      } catch {
        return false;
      }
    },
  );
  await run(
    'caller-history',
    [
      user('Tên gọi của tôi trong bài tập này là FENNEC.'),
      { role: 'assistant', content: 'Tôi sẽ gọi bạn là FENNEC.' },
      user('Theo ngữ cảnh được cung cấp, tên gọi của tôi là gì? Chỉ trả tên.'),
    ],
    (text) => text.includes('FENNEC'),
  );
  await run('vision-normal', [withImage()], (text) => /\bcat\b/i.test(text));
  await run(
    'vision-stream',
    [withImage()],
    (text) => /\bcat\b/i.test(text),
    true,
  );
  const code = `ISOLATION_${randomUUID().replaceAll('-', '')}`;
  await run(
    'isolation-seed',
    [user(`Trong bài tập này hãy nhớ mã ${code}. Chỉ trả đúng mã đó.`)],
    (text) => text.includes(code),
  );
  await run(
    'isolation-next',
    [
      user(
        'Có mã ISOLATION nào từ cuộc trò chuyện trước không? Nếu không được cung cấp mã trong ngữ cảnh hiện tại, chỉ trả KHONG_CO.',
      ),
    ],
    (text) => !text.includes(code) && text.includes('KHONG_CO'),
  );
  const hashes = result.cases.map((x) => x.threadHash).filter(Boolean);
  result.uniqueThreads = new Set(hashes).size;
  result.allPassed =
    result.cases.every((x) => x.pass) &&
    result.uniqueThreads === result.cases.length;
} catch (error) {
  result.preflightError = error.message;
  result.allPassed = false;
} finally {
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n', {
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      task: result.task,
      allPassed: result.allPassed,
      liveRequests: result.liveRequests,
      uniqueThreads: result.uniqueThreads,
      preflightError: result.preflightError,
    }),
  );
  if (!result.allPassed) process.exitCode = 2;
}
