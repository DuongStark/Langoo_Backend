/** M4.5: VPS read-only source export. Requires adjacent pure ranking helper. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { rankWord } from './learner-priority.ts';
import { hash, splitContexts, packTasks } from './learner-priority-muse.mjs';
const directory = resolve(process.argv[2]);
if (existsSync(`${directory}/input.json`))
  throw new Error('Frozen input already exists');
const require = createRequire('/opt/langoo/app/package.json');
const { Client } = require('pg');
const env = require('dotenv').parse(readFileSync('/opt/langoo/app/.env'));
const cohort = JSON.parse(readFileSync(`${directory}/cohort.json`, 'utf8'));
if (
  cohort.words.length !== 50 ||
  new Set(cohort.words).size !== 50 ||
  cohort.words.some((w) => !/^[a-z]+$/.test(w))
)
  throw new Error('Invalid cohort');
const evidence = JSON.parse(
  readFileSync(`${directory}/wordnet-evidence.json`, 'utf8'),
);
const client = new Client({
  connectionString: env.DIRECT_URL || env.DATABASE_URL,
  application_name: 'langoo-m45-muse-readonly',
  connectionTimeoutMillis: 15000,
});
await client.connect();
let rows, snapshot;
try {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL statement_timeout='30s'");
  await client.query("SET LOCAL work_mem='16MB'");
  await client.query('SET LOCAL max_parallel_workers_per_gather=0');
  const meta = (
    await client.query(
      "SELECT pg_current_snapshot()::text AS snapshot,current_setting('transaction_read_only') AS ro",
    )
  ).rows[0];
  if (meta.ro !== 'on') throw new Error('Read-only required');
  snapshot = meta.snapshot;
  rows = (
    await client.query(
      `SELECT sc.sense_id::text AS "senseId",sc.lexeme_id::text AS "lexemeId",
    sc.lemma,sc.pos,src.code AS source,src.version AS "sourceVersion",sc.sense_no AS "senseNo",
    coalesce(sc.definition,sc.gloss_en,'') AS definition,se.definition AS "rawDefinition",
    coalesce(sc.gloss_en_context,ARRAY[]::text[]) AS "glossEnContext",sc.gloss_vi AS "glossVi",
    sc.gloss_vi_machine AS "glossViMachine",sc.gloss_vi_reviewed AS "glossViReviewed",sc.register,sc.domain,
    se.attributes,sc.frequency_rank AS "frequencyRank"
    FROM core.lexeme le JOIN core.sense se ON se.lexeme_id=le.id
    JOIN serve.sense_card sc ON sc.sense_id=se.id JOIN public.source src ON src.id=se.source_id
    WHERE le.language_id=1 AND le.lemma=ANY($1::text[])
    ORDER BY le.lemma,src.code,sc.lexeme_id,sc.sense_no,sc.sense_id`,
      [cohort.words],
    )
  ).rows;
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
if (new Set(rows.map((row) => row.senseId)).size !== rows.length)
  throw new Error('Duplicate source IDs');
const records = cohort.words.map((lemma) => {
  const senses = rankWord(
    rows.filter((row) => row.lemma === lemma),
    evidence.evidence,
  );
  if (!senses.length) throw new Error('Missing word: ' + lemma);
  return { lemma, senses, baseline: senses[0].senseId };
});
const input = {
  task: 'M4.5',
  exported_at: new Date().toISOString(),
  target: 'langoo-vps',
  snapshot,
  read_only: true,
  cohort,
  evidence_sha256: hash(evidence),
  evidence_origin_sha256: evidence.source_artifact_sha256,
  wordnet_corpus: 'unverified',
  records,
};
writeFileSync(`${directory}/input.json`, JSON.stringify(input, null, 2), {
  mode: 0o600,
});
const tasks = records.flatMap((record) => {
  const parts = splitContexts(record);
  return parts.map((context, index) => ({
    id: `${record.lemma}:${parts.length > 1 ? 'part' : 'final'}:${index}`,
    context,
    stage: parts.length > 1 ? 'part' : 'final',
  }));
});
console.log(
  JSON.stringify({
    words: records.length,
    senses: rows.length,
    source_hash: hash(input),
    initial_tasks: tasks.length,
    initial_batches: packTasks(tasks).map((batch) => batch.map((t) => t.id)),
  }),
);
