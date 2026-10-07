// M4.5 — isolated database regression. Refuses any database without _test suffix.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import pg from 'pg';
import dotenv from 'dotenv';
import { applyArtifact, sha256 } from './ja-priority-cli.mjs';
const args = process.argv.slice(2),
  arg = (name) => args[args.indexOf(name) + 1];
const name = arg('--test-db');
if (!args.includes('--test-db') || !name.endsWith('_test'))
  throw new Error('Isolated _test database required');
const env = dotenv.parse(readFileSync(arg('--env-file'))),
  url = new URL(env.DIRECT_URL || env.DATABASE_URL);
url.pathname = '/' + name;
const db = new pg.Client({ connectionString: url.toString() });
await db.connect();
try {
  const raw = readFileSync(arg('--artifact')),
    data = JSON.parse(raw),
    hash = sha256(raw);
  const version = (
    await db.query("select version from public.source where code='jmdict'")
  ).rows[0].version;
  const identity = `m45-test:${name}:jmdict-${version}`;
  const before = (
    await db.query(
      'select count(*)::int AS n from core.dictionary_priority_run',
    )
  ).rows[0].n;
  assert.equal(
    (await applyArtifact(db, data, hash, identity, false)).status,
    'dry_run_valid',
  );
  assert.equal(
    (
      await db.query(
        'select count(*)::int AS n from core.dictionary_priority_run',
      )
    ).rows[0].n,
    before,
  );
  await assert.rejects(
    applyArtifact(db, data, hash, 'wrong-target', true),
    /identity/,
  );
  const applied = await applyArtifact(db, data, hash, identity, true);
  assert.ok(['applied', 'already_active'].includes(applied.status));
  assert.equal(
    (await applyArtifact(db, data, hash, identity, true)).status,
    'already_active',
  );
  const invalid = structuredClone(data);
  invalid.lexemes[0].input_hash = '0'.repeat(32);
  await assert.rejects(
    applyArtifact(db, invalid, 'e'.repeat(64), identity, true),
    /drift/,
  );
  const wrongSense = structuredClone(data);
  wrongSense.senses[0].lexeme_id = data.lexemes.find(
    (x) => !data.senses.some((sense) => sense.lexeme_id === x.lexeme_id),
  ).lexeme_id;
  await assert.rejects(
    applyArtifact(db, wrongSense, 'f'.repeat(64), identity, true),
    /drift/,
  );
  const priority = data.lexemes[0];
  await db.query('BEGIN');
  await db.query('update core.lexeme set lemma=lemma||$2 where id=$1', [
    priority.lexeme_id,
    'drift',
  ]);
  assert.equal(
    (
      await db.query(
        'select count(*)::int AS n from serve.japanese_lexeme_priority where lexeme_id=$1',
        [priority.lexeme_id],
      )
    ).rows[0].n,
    0,
  );
  await db.query('ROLLBACK');
  const sense = data.senses[0];
  await db.query('BEGIN');
  await db.query(
    "update core.sense_gloss set text=text||' drift' where sense_id=$1 and language_id=1",
    [sense.sense_id],
  );
  assert.equal(
    (
      await db.query(
        'select count(*)::int AS n from serve.japanese_sense_priority where sense_id=$1',
        [sense.sense_id],
      )
    ).rows[0].n,
    0,
  );
  await db.query('ROLLBACK');
  await db.query('BEGIN');
  await db.query(
    "insert into core.sense_gloss(id,sense_id,language_id,text,is_machine,rank,source_id) values(90000000001,$1,3,'gloss máy đang chạy',true,1,1)",
    [sense.sense_id],
  );
  assert.equal(
    (
      await db.query(
        'select count(*)::int AS n from serve.japanese_sense_priority where sense_id=$1',
        [sense.sense_id],
      )
    ).rows[0].n,
    1,
  );
  await db.query('ROLLBACK');
  const require = createRequire(import.meta.url),
    build = resolve(arg('--build'));
  const { Prisma } = require(resolve(build, 'generated/prisma/client.js'));
  const prisma = {
    $queryRaw: async (sql, ...values) => {
      const query = Array.isArray(sql) ? Prisma.sql(sql, ...values) : sql;
      return (await db.query(query.text, query.values)).rows.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([k, v]) => [
            k,
            ['lexeme_id', 'sense_id', 'concept_id', 'id'].includes(k) &&
            v !== null
              ? BigInt(v)
              : v,
          ]),
        ),
      );
    },
  };
  const { DictionarySearchRepository } = require(
    resolve(build, 'dictionary/repositories/dictionary-search.repository.js'),
  );
  const { JapanesePriorityRepository } = require(
    resolve(build, 'dictionary/repositories/japanese-priority.repository.js'),
  );
  const { SenseCardRepository } = require(
    resolve(build, 'dictionary/repositories/sense-card.repository.js'),
  );
  const search = new DictionarySearchRepository(prisma),
    preferences = new JapanesePriorityRepository(prisma),
    cards = new SenseCardRepository(prisma);
  const expected = {
    来る: '137747',
    できる: '79879',
    する: '152799',
    ある: '135748',
    いる: '110473',
    入る: '75572',
  };
  for (const [query, id] of Object.entries(expected)) {
    const rows = await search.search({
      queries: [query],
      patterns: [query],
      lang: 'ja',
      limit: 5,
      cursor: null,
    });
    assert.equal(rows[0].lexeme_id.toString(), id, query);
    assert.equal(rows[0].frequency_source, 'bccwj-suw');
  }
  for (const [query, id] of Object.entries({
    刷る: '81826',
    出切る: '79714',
    居る: '110473',
  })) {
    const rows = await search.search({
      queries: [query],
      patterns: [query],
      lang: 'ja',
      limit: 5,
      cursor: null,
    });
    assert.equal(rows[0].lexeme_id.toString(), id, query);
  }
  const first = await search.search({
    queries: ['る'],
    patterns: ['る'],
    lang: 'ja',
    limit: 100,
    cursor: null,
  });
  let cursor = null,
    paged = [];
  for (let page = 0; page < 100; page++) {
    const rows = await search.search({
      queries: ['る'],
      patterns: ['る'],
      lang: 'ja',
      limit: 2,
      cursor,
    });
    if (!rows.length) break;
    paged.push(...rows);
    const row = rows.at(-1);
    cursor = {
      version: 5,
      query: 'る',
      lang: 'ja',
      exactRank: row.exact_rank,
      prefixRank: row.prefix_rank,
      jaSourceRank: row.ja_source_rank,
      viTranslationRank: row.vi_translation_rank,
      frequencyNullRank: row.frequency_null_rank,
      frequencyRank: row.frequency_sort,
      surfaceLength: row.surface_length,
      lexemeId: row.lexeme_id.toString(),
      surfaceKind: row.surface_kind,
      surface: row.surface,
    };
  }
  assert.deepEqual(
    paged.map((r) => r.lexeme_id),
    first.map((r) => r.lexeme_id),
  );
  assert.equal(
    new Set(paged.map((r) => r.lexeme_id.toString())).size,
    paged.length,
  );
  const suggest = await search.search({
    queries: ['る'],
    patterns: ['る'],
    lang: 'ja',
    limit: 5,
    cursor: null,
    deduplicateSurface: true,
  });
  assert.ok(suggest.length <= 5);
  const sameSurface = (
    await db.query(
      `select min(ds.surface) as surface,
              array_agg(distinct ds.lexeme_id order by ds.lexeme_id) as lexeme_ids
       from serve.dictionary_search ds
       join core.lexeme l on l.id=ds.lexeme_id
       join public.source src on src.id=l.source_id and src.code='jmdict'
       where ds.lang_code='ja'
       group by lower(ds.surface)
       having count(distinct ds.lexeme_id)>1
       order by min(ds.surface)
       limit 1`,
    )
  ).rows[0];
  assert.ok(
    sameSurface,
    'test fixture needs two JMdict lexemes with one surface',
  );
  const idsForSurface = sameSurface.lexeme_ids.map(BigInt);
  const beforeGloss = await search.search({
    queries: [sameSurface.surface],
    patterns: [sameSurface.surface],
    lang: 'ja',
    limit: 20,
    cursor: null,
  });
  const competingJmdict = beforeGloss.filter((row) =>
    idsForSurface.includes(row.lexeme_id),
  );
  assert.ok(competingJmdict.length > 1);
  const targetLexeme = competingJmdict.at(-1).lexeme_id;
  await db.query('BEGIN');
  await db.query(
    `delete from core.sense_gloss g using core.sense s,public.language lg
     where s.lexeme_id=any($1::bigint[]) and g.sense_id=s.id
       and lg.id=g.language_id and lg.code='vi'`,
    [idsForSurface.map(String)],
  );
  await db.query(
    `insert into core.sense_gloss(id,sense_id,language_id,text,is_machine,rank,source_id)
     values(90000000003,(select min(id) from core.sense where lexeme_id=$1),
       (select id from public.language where code='vi'),'bản dịch thử',true,1,1)`,
    [targetLexeme.toString()],
  );
  const withGloss = await search.search({
    queries: [sameSurface.surface],
    patterns: [sameSurface.surface],
    lang: 'ja',
    limit: 20,
    cursor: null,
  });
  assert.equal(withGloss[0].lexeme_id, targetLexeme);
  await db.query('ROLLBACK');
  const pref = await preferences.getByLexemes([68759n, 156837n, 174336n]);
  assert.deepEqual(
    pref
      .filter((p) => p.lexeme_id === 68759n && p.recommended)
      .map((p) => p.sense_id.toString()),
    data.senses.filter((p) => p.lexeme_id === '68759').map((p) => p.sense_id),
  );
  assert.equal(
    pref.filter((p) => p.lexeme_id === 156837n && p.recommended).length,
    1,
  );
  const sensesForTranslationTest = (
    await db.query(
      'select id,sense_no from core.sense where lexeme_id=$1 order by sense_no,id',
      [68759],
    )
  ).rows;
  assert.ok(sensesForTranslationTest.length > 1);
  const translatedSense = sensesForTranslationTest.at(-1);
  await db.query('BEGIN');
  await db.query(
    `delete from core.sense_gloss g using core.sense s,public.language lg
     where s.lexeme_id=$1 and g.sense_id=s.id and lg.id=g.language_id and lg.code='vi'`,
    [68759],
  );
  await db.query(
    `insert into core.sense_gloss(id,sense_id,language_id,text,is_machine,rank,source_id)
     values(90000000002,$1,(select id from public.language where code='vi'),'bản dịch thử',true,1,1)`,
    [translatedSense.id],
  );
  const translationPriorities = await preferences.getByLexemes([68759n]);
  assert.equal(
    translationPriorities[0].sense_id.toString(),
    String(translatedSense.id),
  );
  await db.query('ROLLBACK');
  const detail = await cards.getBySenseIds([BigInt(sense.sense_id)]);
  assert.equal(detail[0].senseId.toString(), sense.sense_id);
  const enBefore = await search.search({
    queries: ['run'],
    patterns: ['run'],
    lang: 'en',
    limit: 5,
    cursor: null,
  });
  await db.query('BEGIN');
  await db.query(
    "update core.dictionary_priority_run set active=false where policy='ja-bccwj-v1'",
  );
  assert.equal(
    (
      await db.query(
        'select count(*)::int as n from serve.japanese_lexeme_priority',
      )
    ).rows[0].n,
    0,
  );
  assert.deepEqual(
    await search.search({
      queries: ['run'],
      patterns: ['run'],
      lang: 'en',
      limit: 5,
      cursor: null,
    }),
    enBefore,
  );
  assert.deepEqual(await preferences.getByLexemes([68759n]), []);
  await db.query('ROLLBACK');
  console.log(
    JSON.stringify({
      status: 'pass',
      checks: [
        'dry_run',
        'target_guard',
        'idempotence',
        'lexeme_drift',
        'sense_identity_guard',
        'serve_drift_guard',
        'vi_write_compatible',
        'six_query_fixes',
        'specific_spelling',
        'cursor_pagination',
        'suggestion_cap',
        'selected_senses',
        'vi_translation_sense_order',
        'vi_translation_lexeme_order',
        'batch_cards',
        'rollback',
        'english_unchanged',
      ],
      run_id: applied.run_id,
    }),
  );
} finally {
  await db.end();
}
