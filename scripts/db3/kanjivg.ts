import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
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
} from './_shared';

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
  const entries = readdirSync(svgDir).filter((name) =>
    /^[0-9A-Fa-f]{4,6}\.svg$/.test(name),
  );
  const rows: MediaRow[] = [];
  for (const entry of entries) {
    const codepointHex = entry.replace(/\.svg$/i, '').toLowerCase();
    const literal = String.fromCodePoint(Number.parseInt(codepointHex, 16));
    const file = path.join(svgDir, entry);
    const stats = statSync(file);
    if (!stats.isFile()) continue;
    rows.push({
      literal,
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
           asset_id = EXCLUDED.asset_id`,
        [row.literal, asset.rows[0].id],
      );
    }
    log(`  lô ${batch.length} asset xong`);
  }
}

async function rollback(manifestFile: string): Promise<void> {
  const manifest = readManifest(manifestFile);
  if (!manifest.rollback || manifest.rollback.kind !== 'kanjivg') {
    throw new Error('Manifest không phải của task kanjivg');
  }
  const keys = manifest.rollback.items.map((item) => String(item));
  const literals = keys.map((key) => {
    const hex = path.basename(key).replace(/\.svg$/i, '');
    return String.fromCodePoint(Number.parseInt(hex, 16));
  });
  const url = requireUrl();
  const client = await connect(url);
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM core.kanji_media
       WHERE kind = 'stroke_svg' AND kanji_literal = ANY($1::text[])`,
      [literals],
    );
    const removed = await client.query(
      `DELETE FROM core.media_asset
       WHERE object_key = ANY($1::text[])
         AND NOT EXISTS (
           SELECT 1 FROM core.kanji_media km WHERE km.asset_id = core.media_asset.id
         )`,
      [keys],
    );
    await client.query('COMMIT');
    log(
      `rollback kanjivg: xoá ${removed.rowCount} media_asset (và kanji_media tương ứng)`,
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const cli = parseCli('kanjivg', process.argv.slice(2));
  if (typeof cli.flags.get('rollback') === 'string') {
    await rollback(cli.flags.get('rollback') as string);
    return;
  }

  const url = requireUrl();
  assertWritableTarget(url, cli);
  const svgDir =
    (typeof cli.flags.get('svg-dir') === 'string'
      ? (cli.flags.get('svg-dir') as string)
      : undefined) ?? path.join(cli.sources, 'kanjivg');
  const version =
    (typeof cli.flags.get('version') === 'string'
      ? (cli.flags.get('version') as string)
      : undefined) ?? 'unknown';
  const provider =
    (typeof cli.flags.get('provider') === 'string'
      ? (cli.flags.get('provider') as string)
      : undefined) ?? 'local';
  const copyTo =
    typeof cli.flags.get('copy-to') === 'string'
      ? (cli.flags.get('copy-to') as string)
      : undefined;

  const all = collectSvgRows(svgDir, cli.limit);
  log(`== DB3 kanjivg (${cli.apply ? 'APPLY' : 'DRY-RUN'}) ==`);
  log(
    `svg-dir: ${svgDir} (${all.length} file quét được${cli.limit ? `, limit ${cli.limit}` : ''})`,
  );

  const client = await connect(url);
  let rows: MediaRow[] = [];
  let skipped: string[] = [];
  try {
    const literals = all.map((row) => row.literal);
    const known = await client.query<{ literal: string }>(
      'SELECT literal FROM core.kanji WHERE literal = ANY($1::text[])',
      [literals],
    );
    const knownSet = new Set(known.rows.map((row) => row.literal));
    rows = all.filter((row) => knownSet.has(row.literal));
    skipped = all
      .filter((row) => !knownSet.has(row.literal))
      .map((row) => row.objectKey);
  } finally {
    await client.end();
  }

  log(
    `khớp core.kanji: ${rows.length} | bỏ qua (không có kanji): ${skipped.length}`,
  );
  for (const row of rows.slice(0, 5)) {
    log(
      `  ${row.literal} ← ${row.objectKey} (${row.bytes} bytes, ${row.sha256.slice(0, 10)}…)`,
    );
  }
  if (skipped.length > 0) {
    log(
      `  ⚠ bỏ qua: ${skipped.slice(0, 8).join(', ')}${skipped.length > 8 ? '…' : ''}`,
    );
  }

  if (cli.apply) {
    if (copyTo !== undefined) {
      mkdirSync(copyTo, { recursive: true });
      for (const row of rows) {
        const src = path.join(svgDir, `${row.codepointHex}.svg`);
        const dest = path.join(copyTo, `${row.codepointHex}.svg`);
        copyFileSync(src, dest);
      }
      log(`  đã copy ${rows.length} file → ${copyTo}`);
    }
    const client2 = await connect(url);
    try {
      await client2.query('BEGIN');
      const inputsHash = await import('node:crypto').then((crypto) =>
        crypto
          .createHash('sha256')
          .update(
            rows.map((row) => `${row.objectKey}:${row.sha256}`).join('\n'),
          )
          .digest('hex'),
      );
      const sourceId = await upsertSourceRow(client2, {
        ...SOURCE,
        version,
        sha256: inputsHash,
      });
      await applyRows(client2, rows, sourceId, provider);
      await client2.query('COMMIT');
      log(`  nguồn: ${SOURCE.code} (id ${sourceId})`);
    } catch (error) {
      await client2.query('ROLLBACK');
      throw error;
    } finally {
      await client2.end();
    }
  }

  const manifestFile = writeManifest(cli.manifestDir, {
    task: 'kanjivg',
    startedAt: new Date().toISOString(),
    applied: cli.apply,
    db: cli.apply ? dbNameOf(url) : undefined,
    inputs: { svgDir, version },
    summary: {
      scanned: all.length,
      seeded: rows.length,
      skippedMissingKanji: skipped.length,
      provider,
    },
    warnings:
      skipped.length > 0
        ? [`bỏ qua ${skipped.length} file không có kanji`]
        : [],
    rollback: { kind: 'kanjivg', items: rows.map((row) => row.objectKey) },
  });
  log(`manifest: ${manifestFile}`);
  if (!cli.apply) {
    log(
      '(dry-run) chưa ghi DB. Thêm --apply --allow-db <db> [--allow-test] để ghi.',
    );
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
