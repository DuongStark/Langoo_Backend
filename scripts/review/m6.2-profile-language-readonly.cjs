/** M6.2: validate the local compiled SQL against VPS in one read-only transaction.
 * Run after npm run build: node scripts/review/m6.2-profile-language-readonly.cjs
 * Uses SSH langoo-vps; emits counts only. Does not deploy code or write DB/files remotely.
 */
require('reflect-metadata');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const { DictionarySearchRepository } = require(
  path.join(root, 'dist/dictionary/repositories/dictionary-search.repository'),
);
const { CollectionsService } = require(
  path.join(root, 'dist/collections/collections.service'),
);
const { QuizSourceRepository } = require(
  path.join(root, 'dist/ai/quiz/repositories/quiz-source.repository'),
);
const { DueRepository } = require(
  path.join(root, 'dist/srs/repositories/due.repository'),
);
const { Prisma } = require(path.join(root, 'dist/generated/prisma/client'));
const ownerMarker = '9223372036854775000';
const profileMarker = '00000000-0000-4000-8000-000000000001';
const collectionMarker = '00000000-0000-4000-8000-000000000002';
async function capture(label, languages, run) {
  let query;
  const prisma = {
    $queryRaw: async (input, ...values) => {
      const sql = Array.isArray(input) ? Prisma.sql(input, ...values) : input;
      query = {
        text: sql.text,
        values: sql.values.map((v) =>
          typeof v === 'bigint' ? v.toString() : v,
        ),
      };
      return [];
    },
  };
  await run(prisma);
  if (!query) throw new Error(`Missing captured query: ${label}`);
  return { label, languages, ...query };
}
async function main() {
  const queries = [];
  for (const ids of [[1], [2], [1, 2]]) {
    for (const suggestions of [false, true]) {
      queries.push(
        await capture(
          `dictionary-${ids.join('-')}-${suggestions ? 'suggestions' : 'search'}`,
          ids,
          (prisma) =>
            new DictionarySearchRepository(prisma).search({
              queries: ['run'],
              patterns: ['run'],
              lang: null,
              allowedLanguageIds: ids,
              limit: suggestions ? 5 : 21,
              cursor: null,
              deduplicateSurface: suggestions,
            }),
        ),
      );
    }
  }
  queries.push(
    await capture('collections-visible-count', null, (prisma) =>
      new CollectionsService(prisma, {}).list(BigInt(ownerMarker)),
    ),
  );
  queries.push(
    await capture('quiz-visible-face', null, (prisma) =>
      new QuizSourceRepository(prisma).findSourceItems({
        userId: BigInt(ownerMarker),
        profileId: profileMarker,
        collectionId: null,
      }),
    ),
  );
  for (const id of [1, 2]) {
    queries.push(
      await capture(`due-language-${id}`, [id], (prisma) =>
        new DueRepository(prisma).findCandidates({
          userId: BigInt(ownerMarker),
          profileId: profileMarker,
          primaryLanguageId: id,
          secondaryLanguageId: null,
          now: new Date(),
          learnAheadMinutes: 0,
          includeLearnAhead: false,
          limit: 20,
          collectionId: collectionMarker,
        }),
      ),
    );
  }
  const explain = process.argv.includes('--explain-quiz');
  if (explain) {
    const quiz = queries.find((query) => query.label === 'quiz-visible-face');
    const baseline = {
      ...quiz,
      label: 'quiz-anchor-baseline',
      text: quiz.text
        .replace(
          'visible_face.sense_id AS sense_id',
          'i.anchor_sense_id AS sense_id',
        )
        .replace(
          /      JOIN app.study_profile p[\s\S]*?\) sc ON true/,
          '      JOIN serve.sense_card sc ON sc.sense_id = i.anchor_sense_id',
        )
        .replace(
          'AND s.face_id = visible_face.id',
          'AND s.face_id IN (SELECT f.id FROM app.collection_item_face f WHERE f.item_id=i.id)',
        ),
    };
    queries.splice(0, queries.length, baseline, quiz);
  }
  const payload = `
require('dotenv').config({ quiet: true });
const { Client } = require('pg');
const assert = require('node:assert/strict');
const queries = ${JSON.stringify(queries)};
(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '30s'");
    const lang = (await client.query("SELECT id,code FROM public.language WHERE code IN ('en','ja') ORDER BY id")).rows;
    assert.deepEqual(lang, [{ id: 1, code: 'en' }, { id: 2, code: 'ja' }]);
    const context = (await client.query('SELECT c.owner_id,c.profile_id,c.id AS collection_id,p.primary_language_id,p.secondary_language_id FROM app.collection c JOIN app.study_profile p ON p.id=c.profile_id AND p.user_id=c.owner_id WHERE c.archived_at IS NULL ORDER BY (p.secondary_language_id IS NOT NULL) DESC,c.item_count DESC LIMIT 1')).rows[0];
    const results = [];
    for (const query of queries) {
      if (!context && !query.label.startsWith('dictionary-')) continue;
      const values = query.values.map(v => v === '${ownerMarker}' ? context.owner_id : v === '${profileMarker}' ? context.profile_id : v === '${collectionMarker}' ? context.collection_id : v);
      const start = Date.now();
      if (${explain}) {
        const plan = (await client.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + query.text, values)).rows[0]['QUERY PLAN'][0];
        const nodes = [];
        function walk(node) { nodes.push({ node: node['Node Type'], relation: node['Relation Name'], rows: node['Actual Rows'], loops: node['Actual Loops'], estimate: node['Plan Rows'], total_ms: node['Actual Total Time'] * node['Actual Loops'] }); (node.Plans || []).forEach(walk); }
        walk(plan.Plan);
        results.push({ label: query.label, execution_ms: plan['Execution Time'], nodes: nodes.sort((a,b) => b.total_ms-a.total_ms).slice(0,12) });
        continue;
      }
      const rows = (await client.query(query.text, values)).rows;
      const allowed = query.languages || [context.primary_language_id, context.secondary_language_id].filter(v => v !== null);
      if (query.label !== 'collections-visible-count') {
        assert(rows.every(row => allowed.includes(row.language_id)), query.label + ': excluded language leaked');
      } else {
        assert(rows.every(row => row.visible_item_count >= 0 && row.visible_item_count <= row.item_count), 'invalid visible count');
      }
      if (query.label.endsWith('suggestions')) assert(rows.length <= 5);
      results.push({ label: query.label, rows: rows.length, language_ids: [...new Set(rows.map(row => row.language_id).filter(v => v !== undefined))], elapsed_ms: Date.now() - start });
    }
    console.log(JSON.stringify({ read_only: true, results }, null, 2));
  } finally { await client.query('ROLLBACK'); await client.end(); }
})().catch(error => { console.error('M6.2 read-only smoke failed:', error.code || error.name, error.message); process.exitCode = 1; });
`;
  process.stdout.write(
    execFileSync(
      'ssh',
      [
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=10',
        'langoo-vps',
        'cd /opt/langoo/app && node',
      ],
      { input: payload, timeout: 120000, encoding: 'utf8' },
    ),
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
