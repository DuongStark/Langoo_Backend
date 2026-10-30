/** M14.2 immutable, read-only snapshot of the 76 missing restaurant images. */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { inflectionBase } from './batch-policy.mjs';
const root = process.env.M141_APP_ROOT || '/opt/langoo/app',
  req = createRequire(resolve(root, 'package.json'));
const env = req('dotenv').parse(readFileSync(resolve(root, '.env'))),
  { Client } = req('pg');
const dir = process.argv[2];
if (!dir) throw Error('RUN_DIR_REQUIRED');
mkdirSync(dir, { recursive: true, mode: 0o700 });
const path = resolve(dir, 'cohort.json');
if (existsSync(path)) throw Error('COHORT_ALREADY_EXISTS');
const db = new Client({
  connectionString: env.DIRECT_URL || env.DATABASE_URL,
  application_name: 'langoo-m142-export',
});
try {
  await db.connect();
  await db.query('BEGIN READ ONLY');
  const rows = (
    await db.query(
      `SELECT di.position,s.id::text sense_id,s.definition,l.lemma,l.pos,l.language_id FROM core.deck d JOIN core.deck_item di ON di.deck_id=d.id JOIN core.sense s ON s.id=di.anchor_sense_id JOIN core.lexeme l ON l.id=s.lexeme_id WHERE d.slug='en-restaurant-dining' AND NOT EXISTS(SELECT 1 FROM core.concept_media cm JOIN core.media_asset ma ON ma.id=cm.asset_id JOIN serve.concept_image ci ON ci.concept_id=cm.concept_id WHERE cm.status='approved' AND ma.kind='concept_image' AND (cm.concept_id=di.concept_id OR cm.anchor_sense_id=di.anchor_sense_id OR ma.metadata->>'source_sense_id'=di.anchor_sense_id::text)) ORDER BY di.position`,
    )
  ).rows;
  if (rows.length !== 76) throw Error('EXPECTED_76_MISSING');
  for (const row of rows) {
    if (!row.definition?.trim()) throw Error('SOURCE_DEFINITION_REQUIRED');
    row.definition_sha256 = createHash('sha256')
      .update(row.definition)
      .digest('hex');
    row.base_lemma = inflectionBase(row.definition);
    row.candidates = (
      await db.query(
        `SELECT DISTINCT ON(c.id) c.id::text concept_id,s.id::text anchor_sense_id,s.definition,c.gloss_en,c.status,l.pos FROM core.lexeme l JOIN core.sense s ON s.lexeme_id=l.id JOIN core.sense_concept sc ON sc.sense_id=s.id JOIN core.concept c ON c.id=sc.concept_id WHERE l.lemma=$1 AND l.language_id=$2 AND l.pos=$3 AND sc.relation='exact' AND sc.verified AND sc.confidence>=0.7 AND c.status IN('draft','curated') ORDER BY c.id,s.id`,
        [row.base_lemma || row.lemma, row.language_id, row.pos],
      )
    ).rows;
  }
  await db.query('ROLLBACK');
  writeFileSync(
    path,
    JSON.stringify(
      {
        task: 'M14.2',
        deck: 'en-restaurant-dining',
        created_at: new Date().toISOString(),
        items: rows,
      },
      null,
      2,
    ),
    { flag: 'wx', mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      count: rows.length,
      without_candidates: rows
        .filter((x) => !x.candidates.length)
        .map((x) => ({
          sense_id: x.sense_id,
          lemma: x.lemma,
          pos: x.pos,
          definition: x.definition,
        })),
      total_candidates: rows.reduce((n, x) => n + x.candidates.length, 0),
    }),
  );
} catch (e) {
  console.error(
    JSON.stringify({
      error_code: /^[A-Z0-9_]+$/.test(e.message) ? e.message : 'EXPORT_FAILED',
      sqlstate: e.code,
    }),
  );
  process.exitCode = 1;
} finally {
  await db.end();
}
