/** M4.5: exports a read-only 100-word pilot. No apply command or provider. */
import {
  createReadStream,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { connect, loadScriptEnv, parseDbUrl, requireEnv } from '../db/_shared';
import { safeProjectionError } from './source-projection';
import {
  digest,
  rankWord,
  strings,
  type SourceSense,
  type WordNetEvidence,
} from './learner-priority';
import { renderPilot, type PilotWord } from './learner-priority-report';

interface CoreRow extends SourceSense {
  attributes: Record<string, unknown>;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected object input');
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected source text');
  return value;
}

function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Invalid source integer');
  return value;
}

async function fileHash(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path))
    hash.update(chunk as Buffer);
  return hash.digest('hex');
}

function sqliteEvidence(db: DatabaseSync, words: string[]): WordNetEvidence[] {
  const query = db.prepare(`SELECT f.form AS lemma,e.pos,l.specifier AS lexicon,
    sy.id AS synset_id,se.id AS sense_id,se.entry_rank,
    (SELECT count(*) FROM counts k WHERE k.sense_rowid=se.rowid) AS count_rows,
    (SELECT max(k.count) FROM counts k WHERE k.sense_rowid=se.rowid) AS tag_count,
    (SELECT d.definition FROM definitions d WHERE d.synset_rowid=sy.rowid LIMIT 1) AS definition
    FROM forms f JOIN entries e ON e.rowid=f.entry_rowid
    JOIN senses se ON se.entry_rowid=e.rowid
    JOIN synsets sy ON sy.rowid=se.synset_rowid
    JOIN lexicons l ON l.rowid=se.lexicon_rowid
    WHERE f.rank=0 AND f.form=? AND l.language='en'`);
  const pos: Record<string, string> = {
    n: 'noun',
    v: 'verb',
    a: 'adjective',
    s: 'adjective',
    r: 'adverb',
  };
  return words.flatMap((word) =>
    query.all(word).map((row) => {
      const countRows = integer(row.count_rows);
      return {
        lemma: text(row.lemma),
        pos: pos[text(row.pos)] ?? text(row.pos),
        lexicon: text(row.lexicon),
        synsetId: text(row.synset_id),
        sourceSenseId: text(row.sense_id),
        entryRank: integer(row.entry_rank),
        // Do not combine independent count records with unknown provenance.
        count:
          countRows === 1 && row.tag_count !== null
            ? integer(row.tag_count)
            : null,
        countRows,
        definition: row.definition === null ? null : text(row.definition),
      };
    }),
  );
}

async function main(): Promise<void> {
  loadScriptEnv();
  const args = process.argv.slice(2),
    flags = new Map<string, string>();
  while (args.length) {
    const key = args.shift()!,
      value = args.shift();
    if (
      !['--target', '--wordnet', '--cohort', '--out'].includes(key) ||
      !value ||
      value.startsWith('--') ||
      flags.has(key)
    )
      throw new Error(
        'Use --target --wordnet --cohort --out; no mutations supported',
      );
    flags.set(key, value);
  }
  for (const flag of ['--target', '--wordnet', '--cohort', '--out'])
    if (!flags.has(flag)) throw new Error('All four flags are required');
  const parsed = parseDbUrl(requireEnv('DIRECT_URL'));
  const target = `${parsed.url.hostname}:${parsed.url.port || '5432'}/${parsed.database}`;
  if (target !== flags.get('--target'))
    throw new Error('Exact DB target mismatch');
  const cohort = object(
    JSON.parse(readFileSync(flags.get('--cohort')!, 'utf8')) as unknown,
  );
  const words = strings(cohort.words);
  if (
    words.length !== 100 ||
    new Set(words).size !== 100 ||
    words.some((word) => !/^[a-z]+$/.test(word))
  )
    throw new Error(
      'Cohort must have exactly 100 distinct lowercase headwords',
    );
  const sqlitePath = resolve(flags.get('--wordnet')!);
  const db = new DatabaseSync(sqlitePath, { readOnly: true });
  let evidence: WordNetEvidence[];
  try {
    evidence = sqliteEvidence(db, words);
  } finally {
    db.close();
  }
  const sqliteHash = await fileHash(sqlitePath);
  const client = await connect(parsed.raw, 'langoo-m45-readonly-pilot');
  const startedAt = new Date().toISOString();
  let snapshot: string, rows: CoreRow[];
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='30s'");
    await client.query("SET LOCAL work_mem='16MB'");
    await client.query('SET LOCAL max_parallel_workers_per_gather=0');
    const snap = await client.query<{ snapshot: string; ro: string }>(
      "SELECT pg_current_snapshot()::text AS snapshot,current_setting('transaction_read_only') AS ro",
    );
    if (snap.rows[0].ro !== 'on')
      throw new Error('Read-only transaction required');
    snapshot = snap.rows[0].snapshot;
    const result = await client.query<CoreRow>(
      `SELECT
      sc.sense_id::text AS "senseId", sc.lexeme_id::text AS "lexemeId",
      sc.lemma,sc.pos,src.code AS source,src.version AS "sourceVersion",
      sc.sense_no AS "senseNo",coalesce(sc.definition,sc.gloss_en,'') AS definition,
      se.definition AS "rawDefinition",coalesce(sc.gloss_en_context,ARRAY[]::text[]) AS "glossEnContext",
      sc.gloss_vi AS "glossVi",sc.gloss_vi_machine AS "glossViMachine",
      sc.gloss_vi_reviewed AS "glossViReviewed",sc.register,sc.domain,
      se.attributes,sc.frequency_rank AS "frequencyRank"
      FROM core.lexeme le JOIN core.sense se ON se.lexeme_id=le.id
      JOIN serve.sense_card sc ON sc.sense_id=se.id JOIN public.source src ON src.id=se.source_id
      WHERE le.language_id=1 AND le.lemma=ANY($1::text[])
      ORDER BY le.lemma,src.code,sc.lexeme_id,sc.sense_no,sc.sense_id`,
      [words],
    );
    rows = result.rows;
    await client.query('COMMIT');
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
  if (new Set(rows.map((row) => row.senseId)).size !== rows.length)
    throw new Error('Duplicate sense rows from read model');
  const records: PilotWord[] = words.map((lemma) => {
    const senses = rankWord(
      rows.filter((row) => row.lemma === lemma),
      evidence,
    );
    if (!senses.length) throw new Error('Missing cohort headword: ' + lemma);
    const recommended = senses[0];
    if (recommended.tier === 3)
      throw new Error('No defined sense for cohort headword: ' + lemma);
    const previous = senses
      .filter((sense) => sense.lexemeId === recommended.lexemeId)
      .sort((a, b) => a.senseNo - b.senseNo)[0];
    return {
      lemma,
      senses,
      recommended,
      previous,
      changed: recommended.senseId !== previous.senseId,
    };
  });
  const summary = {
    task: 'M4.5',
    policy: 'm4.5-rule-pilot-v1.1',
    startedAt,
    target,
    snapshot,
    selection: cohort.selection,
    sourceSqliteSha256: sqliteHash,
    corpusProvenance:
      'unverified; source counts are not modern population usage percentages',
    apiAiRequests: 0,
    dbWrites: 0,
    headwords: records.length,
    senses: rows.length,
    exactWordNetBindings: records
      .flatMap((record) => record.senses)
      .filter((sense) => sense.binding === 'exact').length,
    countBackedRecommendations: records.filter(
      (record) => (record.recommended.wordnet?.count ?? 0) > 0,
    ).length,
    recommendationsChangedWithinSelectedLexeme: records.filter(
      (record) => record.changed,
    ).length,
    recommendationsWithoutVi: records.filter(
      (record) => !record.recommended.glossVi,
    ).length,
    recommendationSources: Object.fromEntries(
      ['omw-en', 'oewn', 'wiktextract'].map((source) => [
        source,
        records.filter((record) => record.recommended.source === source).length,
      ]),
    ),
    semanticGate: 'not graded; user preview / source audit required',
    contentHash: digest(records),
  };
  const out = resolve(flags.get('--out')!);
  mkdirSync(out, { recursive: true });
  writeFileSync(
    resolve(out, 'pilot.json'),
    JSON.stringify({ summary, records }, null, 2) + '\n',
    { flag: 'wx' },
  );
  writeFileSync(resolve(out, 'pilot.html'), renderPilot(records, summary), {
    flag: 'wx',
  });
  writeFileSync(
    resolve(out, 'summary.json'),
    JSON.stringify(summary, null, 2) + '\n',
    { flag: 'wx' },
  );
  console.log(JSON.stringify(summary, null, 2));
}

void main().catch((error: unknown) => {
  console.error('M4.5 pilot failed: ' + safeProjectionError(error));
  process.exitCode = 1;
});
