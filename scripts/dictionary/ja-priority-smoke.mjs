// M4.5 — bounded read-only HTTP smoke; no external AI calls or account tokens.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2),
  arg = (name) => args[args.indexOf(name) + 1];
const base = args.includes('--base')
  ? arg('--base')
  : 'http://127.0.0.1:3000/v1';
const requests = [];
async function get(path, status = 200) {
  const start = performance.now();
  const res = await fetch(base + path, { signal: AbortSignal.timeout(45000) });
  assert.equal(res.status, status, path);
  const data = await res.json();
  requests.push({
    path,
    ms: Math.round(performance.now() - start),
    status: res.status,
  });
  return data;
}
// PM2 reports online before Nest listens. Readiness is a separate bounded gate.
let ready = false;
for (let attempt = 0; attempt < 40; attempt++) {
  try {
    const response = await fetch(base + '/health', {
      signal: AbortSignal.timeout(1000),
    });
    if (response.status === 200) {
      ready = true;
      break;
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 250));
}
assert.ok(ready, 'API did not become ready after restart');
const en = [];
for (const q of ['run', 'book']) {
  const response = await get(
    '/dictionary/search?' + new URLSearchParams({ q, lang: 'en', limit: '5' }),
  );
  en.push({
    q,
    data: response.data.map(({ lexeme_id, surface, pos, frequency_rank }) => ({
      lexeme_id,
      surface,
      pos,
      frequency_rank,
    })),
  });
}
if (args.includes('--capture-en')) {
  writeFileSync(arg('--capture-en'), JSON.stringify(en));
  console.log(JSON.stringify({ status: 'baseline_saved', requests }));
  process.exit(0);
}
if (args.includes('--compare-en'))
  assert.deepEqual(en, JSON.parse(readFileSync(arg('--compare-en'))));
const expected = {
  来る: '137747',
  できる: '79879',
  する: '152799',
  ある: '135748',
  いる: '110473',
  入る: '75572',
};
const firsts = [];
for (const [q, id] of Object.entries(expected)) {
  const response = await get(
    '/dictionary/search?' + new URLSearchParams({ q, lang: 'ja', limit: '5' }),
  );
  assert.equal(response.data[0].lexeme_id, id, q);
  assert.equal(response.data[0].frequency_source, 'bccwj-suw');
  assert.ok(response.data[0].preview?.sense_id);
  firsts.push({
    q,
    lexeme_id: id,
    surface: response.data[0].surface,
    reading: response.data[0].reading,
    rank: response.data[0].frequency_rank,
    preview_gloss: response.data[0].preview.gloss_en,
  });
}
const suggestions = await get(
  '/dictionary/suggestions?' + new URLSearchParams({ q: 'する', lang: 'ja' }),
);
assert.ok(suggestions.data.length <= 5);
assert.equal(suggestions.data[0].lexeme_id, '152799');
const cat = await get('/lexemes/156837/senses');
assert.equal(cat.recommended_sense_ids.length, 1);
assert.match(cat.data[0].gloss_en, /cat/i);
const mixed = await get('/lexemes/68759/senses'),
  flat = await get('/lexemes/68759/senses?view=flat');
assert.equal(mixed.recommended_sense_ids.length, 3);
assert.deepEqual(
  mixed.data.slice(0, 3).map((c) => c.sense_no),
  [1, 3, 13],
);
assert.deepEqual(
  [...mixed.data.map((c) => c.sense_id)].sort(),
  [...flat.data.map((c) => c.sense_id)].sort(),
);
assert.deepEqual(
  flat.data.map((c) => c.sense_no),
  [...flat.data.map((c) => c.sense_no)].sort((a, b) => a - b),
);
const detail = await get('/senses/' + mixed.recommended_sense_ids[2]);
assert.equal(detail.card.sense_no, 13);
let cursor,
  seen = new Set();
for (let i = 0; i < 3; i++) {
  const params = new URLSearchParams({ q: '来', lang: 'ja', limit: '2' });
  if (cursor) params.set('cursor', cursor);
  const response = await get('/dictionary/search?' + params);
  for (const hit of response.data) {
    assert.ok(!seen.has(hit.lexeme_id));
    seen.add(hit.lexeme_id);
  }
  cursor = response.next_cursor;
  if (!cursor) break;
  assert.equal(JSON.parse(Buffer.from(cursor, 'base64url')).v, 5);
}
const old = Buffer.from(
  JSON.stringify({
    v: 4,
    q: '来',
    l: 'ja',
    e: 0,
    p: 0,
    n: 1,
    f: 2147483647,
    z: 1,
    i: '1',
    k: 'lemma',
    s: '来',
  }),
).toString('base64url');
await get(
  '/dictionary/search?' +
    new URLSearchParams({ q: '来', lang: 'ja', cursor: old }),
  400,
);
const kanji = await get('/kanji/' + encodeURIComponent('猫'));
assert.ok(Array.isArray(kanji.parts));
const stroke = await fetch(
  base + '/kanji/' + encodeURIComponent('猫') + '/stroke.svg',
);
assert.equal(stroke.status, 200);
const reverse = await get(
  '/dictionary/reverse?' + new URLSearchParams({ q: 'cát' }),
);
assert.equal(reverse.matched, true);
const sources = await get('/sources');
const rows = Array.isArray(sources) ? sources : sources.data;
assert.ok(rows.some((source) => source.code === 'bccwj-suw'));
console.log(
  JSON.stringify({
    status: 'pass',
    firsts,
    checks: [
      'six_queries',
      'previews',
      'suggestion_cap',
      'cat_main_sense',
      'curated_three',
      'all_senses_preserved',
      'flat_source_order',
      'sense_detail',
      'cursor_v5',
      'old_cursor_rejected',
      'english_unchanged',
      'kanji_parts',
      'stroke',
      'reverse',
      'source_attribution',
    ],
    requests,
  }),
);
