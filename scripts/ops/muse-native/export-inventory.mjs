/** M10.5: READ ONLY snapshot export; bounded chunks for persistent bulk jobs. */
import { createRequire } from 'node:module';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  openSync,
  fsyncSync,
  closeSync,
  renameSync,
} from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

function save(path, value) {
  const temp = path + '.tmp';
  const fd = openSync(temp, 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, path);
  const parent = openSync(dirname(path), 'r');
  try {
    fsyncSync(parent);
  } finally {
    closeSync(parent);
  }
}

async function main() {
  process.umask(0o077);
  const flags = new Map();
  const args = process.argv.slice(2);
  while (args.length) {
    const flag = args.shift(),
      value = args.shift();
    if (
      ![
        '--out',
        '--bulk-dir',
        '--cohort',
        '--limit',
        '--max-rank',
        '--shard-words',
      ].includes(flag) ||
      !value ||
      flags.has(flag)
    )
      throw new Error('Invalid flags');
    flags.set(flag, value);
  }
  if (flags.has('--out') === flags.has('--bulk-dir'))
    throw new Error('Choose one output mode');
  const output = resolve(flags.get('--out') || flags.get('--bulk-dir'));
  if (existsSync(output)) throw new Error('Snapshot exists');
  const limit = Number(flags.get('--limit') || 100),
    rank = Number(flags.get('--max-rank') || 5000);
  const shardWords = Number(flags.get('--shard-words') || 50);
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 5000 ||
    !Number.isInteger(rank) ||
    rank < 1 ||
    rank > 20000 ||
    !Number.isInteger(shardWords) ||
    shardWords < 5 ||
    shardWords > 100
  )
    throw new Error('Invalid selection bounds');
  const require = createRequire('/opt/langoo/app/package.json');
  const env = require('dotenv').parse(readFileSync('/opt/langoo/app/.env'));
  const { Client } = require('pg');
  const db = new Client({
    connectionString: env.DIRECT_URL || env.DATABASE_URL,
    application_name: 'langoo-m105-native-readonly',
    connectionTimeoutMillis: 15000,
  });
  await db.connect();
  let wordCount = 0,
    senseCount = 0;
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await db.query("SET LOCAL statement_timeout='60s'");
    await db.query("SET LOCAL work_mem='16MB'");
    await db.query('SET LOCAL max_parallel_workers_per_gather=0');
    const meta = (
      await db.query(
        "SELECT pg_current_snapshot()::text AS snapshot,current_setting('transaction_read_only') AS ro",
      )
    ).rows[0];
    if (meta.ro !== 'on') throw new Error('Read-only required');
    const words = flags.has('--cohort')
      ? JSON.parse(readFileSync(flags.get('--cohort'), 'utf8')).words
      : (
          await db.query(
            `SELECT lemma,min(frequency_rank) AS rank FROM core.lexeme
        WHERE language_id=1 AND frequency_rank <= $1 AND lemma ~ '^[a-z]+$'
        GROUP BY lemma ORDER BY min(frequency_rank),lemma LIMIT $2`,
            [rank, limit],
          )
        ).rows.map((r) => r.lemma);
    if (
      !Array.isArray(words) ||
      !words.length ||
      words.length > 5000 ||
      new Set(words).size !== words.length ||
      words.some((w) => typeof w !== 'string' || !/^[a-z]+$/.test(w))
    )
      throw new Error('Invalid cohort');
    const base = {
      task: 'M10.5',
      exported_at: new Date().toISOString(),
      target: 'langoo-vps',
      read_only: true,
      snapshot: meta.snapshot,
      selection: {
        max_rank: rank,
        limit,
        explicit_cohort: flags.has('--cohort'),
      },
    };
    const shards = [],
      recordsAll = [],
      ids = new Set();
    if (flags.has('--bulk-dir')) mkdirSync(output, { mode: 0o700 });
    for (let offset = 0; offset < words.length; offset += shardWords) {
      const cohort = words.slice(offset, offset + shardWords);
      const rows = (
        await db.query(
          `SELECT sc.sense_id::text AS "senseId",sc.lexeme_id::text AS "lexemeId",
        sc.lemma,sc.pos,src.code AS source,src.version AS "sourceVersion",sc.sense_no AS "senseNo",
        coalesce(sc.definition,sc.gloss_en,'') AS definition,se.definition AS "rawDefinition",
        coalesce(sc.gloss_en_context,ARRAY[]::text[]) AS "glossEnContext",sc.register,sc.domain,
        se.attributes,sc.frequency_rank AS "frequencyRank"
        FROM core.lexeme le JOIN core.sense se ON se.lexeme_id=le.id
        JOIN serve.sense_card sc ON sc.sense_id=se.id JOIN public.source src ON src.id=se.source_id
        WHERE le.language_id=1 AND le.lemma=ANY($1::text[])
        ORDER BY le.lemma,src.code,sc.lexeme_id,sc.sense_no,sc.sense_id`,
          [cohort],
        )
      ).rows;
      const grouped = new Map(cohort.map((lemma) => [lemma, []]));
      for (const row of rows) {
        if (ids.has(row.senseId)) throw new Error('Duplicate source ID');
        ids.add(row.senseId);
        const { attributes, ...sense } = row;
        grouped.get(row.lemma).push({
          ...sense,
          tags: Array.isArray(attributes?.tags)
            ? attributes.tags.filter((t) => typeof t === 'string')
            : [],
          topics: Array.isArray(attributes?.topics)
            ? attributes.topics.filter((t) => typeof t === 'string')
            : [],
        });
      }
      const records = cohort.map((lemma) => ({
        lemma,
        senses: grouped.get(lemma),
      }));
      wordCount += records.length;
      senseCount += rows.length;
      if (flags.has('--bulk-dir')) {
        const file = `snapshot-${String(shards.length + 1).padStart(4, '0')}.json`;
        save(join(output, file), { ...base, records });
        shards.push({
          file,
          words: records.length,
          senses: rows.length,
          file_sha256: createHash('sha256')
            .update(readFileSync(join(output, file)))
            .digest('hex'),
        });
      } else {
        if (records.some((r) => !r.senses.length))
          throw new Error('Missing senses');
        recordsAll.push(...records);
      }
    }
    await db.query('COMMIT');
    // Only a committed, completely exported snapshot has an index.
    if (flags.has('--bulk-dir'))
      save(join(output, 'inventory.json'), {
        ...base,
        shard_words: shardWords,
        words: wordCount,
        senses: senseCount,
        shards,
      });
    else save(output, { ...base, records: recordsAll });
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    await db.end();
  }
  console.log(
    JSON.stringify({
      words: wordCount,
      senses: senseCount,
      read_only: true,
      bulk: flags.has('--bulk-dir'),
    }),
  );
}
main().catch((error) => {
  console.error(JSON.stringify({ error_type: error.name }));
  process.exitCode = 1;
});
