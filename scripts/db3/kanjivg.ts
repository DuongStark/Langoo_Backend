import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import {
  assertFixtureTarget,
  assertWritableTarget,
  chunk,
  connect,
  log,
  parseCli,
  requireUrl,
  RunManifest,
  sha256,
  sha256File,
  upsertSourceRow,
  writeManifest,
} from './_shared';
import {
  applyWithJournal,
  changesOf,
  rollbackWithJournal,
  snapshot,
} from './_mutations';

/**
 * DB3-A1 — seed KanjiVG (SVG thứ tự nét) vào core.media_asset + core.kanji_media.
 * File nằm ngoài DB theo `object_key`; script chỉ ghi metadata (không blob).
 * Chỉ seed cho kanji có trong core.kanji; chữ thiếu file/không có kanji → báo cáo.
 *
 * Dry-run mặc định. Apply: `--apply --allow-db <db> [--allow-test]`.
 * Rollback: `--rollback <manifest.json>`.
 */

interface MediaRow {
  literal: string;
  filename: string;
  codepointHex: string;
  objectKey: string;
  mime: string;
  bytes: number;
  sha256: string;
}

const SOURCE = {
  code: 'kanjivg',
  name: 'KanjiVG — stroke order diagrams',
  license: 'CC BY-SA 3.0',
  attribution: 'KanjiVG by Ulrich Apel (https://kanjivg.tagaini.net/)',
  url: 'https://github.com/KanjiVG/kanjivg',
};

function collectSvgRows(svgDir: string, limit?: number): MediaRow[] {
  const entries = readdirSync(svgDir)
    .filter((name) => /^[0-9A-Fa-f]{4,6}\.svg$/.test(name))
    .sort();
  const rows: MediaRow[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const codepointHex = entry.replace(/\.svg$/i, '').toLowerCase();
    const literal = String.fromCodePoint(Number.parseInt(codepointHex, 16));
    const file = path.join(svgDir, entry);
    const stats = statSync(file);
    if (!stats.isFile()) continue;
    if (seen.has(literal)) throw new Error(`SVG trùng codepoint: ${entry}`);
    seen.add(literal);
    rows.push({
      literal,
      filename: entry,
      codepointHex,
      objectKey: `kanjivg/${codepointHex}.svg`,
      mime: 'image/svg+xml',
      bytes: stats.size,
      sha256: sha256File(file),
    });
    if (limit !== undefined && rows.length >= limit) break;
  }
  return rows;
}

async function applyRows(
  client: import('pg').Client,
  rows: MediaRow[],
  sourceId: number,
  provider: string,
): Promise<void> {
  for (const batch of chunk(rows, 100)) {
    for (const row of batch) {
      const asset = await client.query<{ id: string }>(
        `INSERT INTO core.media_asset (kind, object_key, mime, bytes, sha256, provider, source_id)
         VALUES ('stroke_svg', $1, $2, $3, $4, $5, $6)
         ON CONFLICT (object_key) DO UPDATE SET
           kind = EXCLUDED.kind,
           mime = EXCLUDED.mime,
           bytes = EXCLUDED.bytes,
           sha256 = EXCLUDED.sha256,
           provider = EXCLUDED.provider,
           source_id = EXCLUDED.source_id
         RETURNING id`,
        [row.objectKey, row.mime, row.bytes, row.sha256, provider, sourceId],
      );
      await client.query(
        `INSERT INTO core.kanji_media (kanji_literal, asset_id, kind, frame_count)
         VALUES ($1, $2, 'stroke_svg', 1)
         ON CONFLICT (kanji_literal, kind) DO UPDATE SET
           asset_id = EXCLUDED.asset_id, frame_count = EXCLUDED.frame_count`,
        [row.literal, asset.rows[0].id],
      );
    }
    log(`  lô ${batch.length} asset xong`);
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const cli = parseCli('kanjivg', argv);
  const url = requireUrl();
  const rollback = cli.flags.get('rollback');
  if (typeof rollback === 'string')
    return rollbackWithJournal(cli, url, rollback);
  assertWritableTarget(url, cli);
  assertFixtureTarget(url, cli);
  const flag = (key: string): string | undefined => {
    const value = cli.flags.get(key);
    return typeof value === 'string' ? value : undefined;
  };
  const svgDir = flag('svg-dir') ?? path.join(cli.sources, 'kanjivg');
  const version = flag('version') ?? 'unknown';
  if (cli.apply && (version.trim() === '' || version === 'unknown')) {
    throw new Error('Apply KanjiVG cần --version <release/tag/commit nguồn>');
  }
  const provider = flag('provider') ?? 'local';
  const copyTo = flag('copy-to');
  const all = collectSvgRows(svgDir, cli.limit);
  const manifest: RunManifest = {
    task: 'kanjivg',
    startedAt: new Date().toISOString(),
    applied: false,
    inputs: { svgDir, version, url: SOURCE.url, license: SOURCE.license },
    summary: { scanned: all.length, provider },
    warnings: [],
  };
  log(`== DB3 kanjivg (${cli.apply ? 'APPLY' : 'DRY-RUN'}) ==`);
  const selectRows = async (
    client: import('pg').Client,
  ): Promise<MediaRow[]> => {
    const known = await client.query<{ literal: string }>(
      'SELECT literal FROM core.kanji ORDER BY literal',
    );
    const knownSet = new Set(known.rows.map((row) => row.literal));
    const allSet = new Set(all.map((row) => row.literal));
    const rows = all.filter((row) => knownSet.has(row.literal));
    manifest.summary.seeded = rows.length;
    manifest.summary.filesWithoutKanji = all
      .filter((row) => !knownSet.has(row.literal))
      .map((row) => row.objectKey);
    manifest.summary.kanjiWithoutSvg = known.rows
      .filter((row) => !allSet.has(row.literal))
      .map((row) => row.literal);
    manifest.inputs!.sha256 = sha256(
      all.map((row) => `${row.objectKey}:${row.sha256}`).join('\n'),
    );
    log(
      `khớp core.kanji: ${rows.length}; thiếu SVG: ${(manifest.summary.kanjiWithoutSvg as string[]).length}`,
    );
    return rows;
  };
  if (cli.apply) {
    await applyWithJournal(cli, url, manifest, async (client) => {
      await client.query('LOCK TABLE core.kanji IN SHARE MODE');
      const rows = await selectRows(client);
      if (rows.length === 0)
        throw new Error('Không có SVG khớp core.kanji; dừng apply');
      const before = [
        await snapshot(client, 'public.source', [SOURCE.code]),
        await snapshot(
          client,
          'core.media_asset',
          rows.map((row) => row.objectKey),
        ),
        await snapshot(
          client,
          'core.kanji_media',
          rows.map((row) => row.literal),
        ),
      ];
      for (const row of rows) {
        const src = path.join(svgDir, row.filename);
        if (sha256File(src) !== row.sha256)
          throw new Error(`Nguồn SVG đã đổi: ${row.filename}`);
        if (copyTo !== undefined) {
          // Cache files are immutable: never overwrite media belonging to an older run.
          mkdirSync(copyTo, { recursive: true });
          const dest = path.join(copyTo, `${row.codepointHex}.svg`);
          if (existsSync(dest)) {
            if (sha256File(dest) !== row.sha256)
              throw new Error(`File đích khác hash: ${row.filename}`);
          } else {
            copyFileSync(src, dest, constants.COPYFILE_EXCL);
          }
        }
      }
      const sourceId = await upsertSourceRow(client, {
        ...SOURCE,
        version,
        sha256: manifest.inputs!.sha256,
      });
      await applyRows(client, rows, sourceId, provider);
      const after = [
        await snapshot(client, 'public.source', [SOURCE.code]),
        await snapshot(
          client,
          'core.media_asset',
          rows.map((row) => row.objectKey),
        ),
        await snapshot(
          client,
          'core.kanji_media',
          rows.map((row) => row.literal),
        ),
      ];
      return changesOf(before, after);
    });
  } else {
    const client = await connect(url);
    try {
      await selectRows(client);
    } finally {
      await client.end();
    }
    log(`manifest: ${writeManifest(cli.manifestDir, manifest)}`);
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(
      `kanjivg: LỖI — ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
