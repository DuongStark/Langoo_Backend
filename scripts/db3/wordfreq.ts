import { readFileSync } from 'node:fs';
import {
  assertFixtureTarget,
  assertWritableTarget,
  chunk,
  connect,
  dbNameOf,
  log,
  parseCli,
  readManifest,
  requireUrl,
  sha256File,
  upsertSourceRow,
  writeManifest,
  type RunManifest,
} from './_shared';

/**
 * DB3 — import xếp hạng tần suất `wordfreq` vào `core.lexeme.frequency_rank`.
 *
 * Bảng xếp hạng sinh tất định bằng `scripts/db3/wordfreq-export.py` (không LLM):
 *   python scripts/db3/wordfreq-export.py --lang en --lemmas en.txt --out wordfreq-en.tsv
 *
 * Dry-run mặc định. Apply: `--apply --allow-db <db> [--allow-test]`.
 * Rollback: `--rollback <manifest.json>` (chỉ xoá rank do chính run này set).
 */

const SOURCE = {
  code: 'wordfreq',
  name: 'wordfreq',
  license: 'CC BY-SA 4.0',
  attribution: 'wordfreq (RSpeer)',
  url: 'https://github.com/rspeer/wordfreq',
};

interface MappingRow {
  rank: number;
  lemma: string;
}

interface Meta {
  lang?: string;
  wordfreqVersion?: string;
  matched?: number;
  outputSha256?: string;
}

function flagValue(
  cli: ReturnType<typeof parseCli>,
  key: string,
): string | undefined {
  const value = cli.flags.get(key);
  return typeof value === 'string' ? value : undefined;
}

function readMapping(file: string, limit?: number): MappingRow[] {
  const rows: MappingRow[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    const [rankRaw, lemma] = line.split('\t');
    const rank = Number(rankRaw);
    if (!Number.isSafeInteger(rank) || rank < 1 || !lemma)
      throw new Error(`Mapping sai định dạng ở dòng: ${line.slice(0, 80)}`);
    rows.push({ rank, lemma });
    if (limit !== undefined && rows.length >= limit) break;
  }
  if (rows.length === 0) throw new Error('Mapping rỗng');
  return rows;
}

function readMeta(file: string): Meta {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Meta;
  } catch {
    return {};
  }
}

async function updateRanks(
  client: import('pg').Client,
  languageId: number,
  rows: MappingRow[],
): Promise<number> {
  await client.query(
    'CREATE TEMP TABLE tmp_wordfreq (lemma text PRIMARY KEY, rank integer NOT NULL) ON COMMIT DROP',
  );
  for (const batch of chunk(rows, 50_000)) {
    await client.query(
      `INSERT INTO tmp_wordfreq (lemma, rank)
       SELECT * FROM unnest($1::text[], $2::int[])
       ON CONFLICT (lemma) DO NOTHING`,
      [batch.map((row) => row.lemma), batch.map((row) => row.rank)],
    );
  }
  const updated = await client.query(
    `UPDATE core.lexeme l
     SET frequency_rank = m.rank
     FROM tmp_wordfreq m
     WHERE l.language_id = $1
       AND lower(l.lemma) = m.lemma
       AND l.frequency_rank IS DISTINCT FROM m.rank`,
    [languageId],
  );
  return updated.rowCount ?? 0;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const cli = parseCli('wordfreq', argv);
  const url = requireUrl();
  const languageCode = flagValue(cli, 'lang') ?? 'en';
  const mappingFile =
    flagValue(cli, 'mapping') ?? `uploads/db3/wordfreq-${languageCode}.tsv`;
  const meta = readMeta(flagValue(cli, 'meta') ?? `${mappingFile}.meta.json`);

  const rollback = flagValue(cli, 'rollback');
  if (rollback !== undefined) {
    if (!cli.apply) throw new Error('Rollback cần --apply --allow-db <tên-db>');
    assertWritableTarget(url, cli);
    const manifest = readManifest(rollback);
    if (manifest.task !== 'wordfreq' || !manifest.applied)
      throw new Error('Manifest không phải run wordfreq đã apply');
    if (manifest.db !== dbNameOf(url))
      throw new Error(
        `Rollback sai đích: manifest ${manifest.db ?? '?'} vs ${dbNameOf(url)}`,
      );
    const client = await connect(url);
    try {
      const cleared = await client.query(
        `UPDATE core.lexeme l
         SET frequency_rank = NULL
         FROM public.language g
         WHERE g.id = l.language_id AND g.code = $1
           AND l.frequency_rank IS NOT NULL`,
        [languageCode],
      );
      log(
        `== wordfreq ROLLBACK — xoá rank: ${cleared.rowCount ?? 0} lexeme (${languageCode})`,
      );
    } finally {
      await client.end();
    }
    return;
  }

  assertWritableTarget(url, cli);
  assertFixtureTarget(url, cli);
  const rows = readMapping(mappingFile, cli.limit);

  const manifest: RunManifest = {
    task: 'wordfreq',
    startedAt: new Date().toISOString(),
    applied: false,
    db: dbNameOf(url),
    inputs: {
      mapping: mappingFile,
      mappingSha256: sha256File(mappingFile),
      wordfreqVersion: meta.wordfreqVersion ?? 'unknown',
      license: SOURCE.license,
      sourceUrl: SOURCE.url,
    },
    summary: {
      lang: languageCode,
      rows: rows.length,
      metaMatched: meta.matched ?? null,
    },
    warnings: [],
  };

  log(
    `== DB3 wordfreq (${cli.apply ? 'APPLY' : 'DRY-RUN'}) — ${rows.length} lemma (${languageCode}) ==`,
  );
  const client = await connect(url);
  try {
    const language = await client.query<{ id: number }>(
      'SELECT id FROM public.language WHERE code = $1',
      [languageCode],
    );
    if (language.rows.length === 0)
      throw new Error(`Không có language code=${languageCode}`);
    const languageId = language.rows[0].id;

    const before = await client.query<{ n: string }>(
      'SELECT count(*)::int AS n FROM core.lexeme WHERE language_id = $1 AND frequency_rank IS NOT NULL',
      [languageId],
    );
    manifest.summary.beforeNonNull = before.rows[0].n;

    if (!cli.apply) {
      const sample = await client.query<{ lemma: string; rank: number | null }>(
        `SELECT lemma, frequency_rank AS rank FROM core.lexeme
         WHERE language_id = $1 AND lemma IN ('run', 'cat', 'apple', 'runch', 'catex')
         ORDER BY lemma`,
        [languageId],
      );
      log('mẫu hiện tại:', JSON.stringify(sample.rows));
      log(`manifest: ${writeManifest(cli.manifestDir, manifest)}`);
      return;
    }

    if (before.rows[0].n !== 0)
      throw new Error(
        'Đã có frequency_rank trước khi chạy; rollback sẽ không an toàn — dừng',
      );

    await client.query('BEGIN');
    try {
      const updated = await updateRanks(client, languageId, rows);
      await upsertSourceRow(client, {
        ...SOURCE,
        version: meta.wordfreqVersion ?? 'unknown',
        sha256: manifest.inputs!.mappingSha256,
      });
      const after = await client.query<{ n: string }>(
        'SELECT count(*)::int AS n FROM core.lexeme WHERE language_id = $1 AND frequency_rank IS NOT NULL',
        [languageId],
      );
      await client.query('COMMIT');
      manifest.applied = true;
      manifest.summary.updated = updated;
      manifest.summary.afterNonNull = after.rows[0].n;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }

    const sample = await client.query<{ lemma: string; rank: number | null }>(
      `SELECT lemma, frequency_rank AS rank FROM core.lexeme
       WHERE language_id = $1 AND lemma IN ('run', 'cat', 'apple', 'runch', 'catex')
       ORDER BY lemma`,
      [languageId],
    );
    log('mẫu sau apply:', JSON.stringify(sample.rows));
    log(`updated: ${String(manifest.summary.updated)}`);
    log(`manifest: ${writeManifest(cli.manifestDir, manifest)}`);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(
      `wordfreq: LỖI — ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
