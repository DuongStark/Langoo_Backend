import {
  assertWritableTarget,
  chunk,
  connect,
  dbNameOf,
  log,
  parseCli,
  readManifest,
  requireUrl,
  writeManifest,
} from './_shared';

/**
 * DB3-A3 — seed deck hệ thống JLPT N1–N5 từ core.jlpt_link (status=accepted).
 * Quy tắc đã chốt tạm (05/10):
 *  - 1 lexeme chỉ vào cấp THẤP NHẤT (N5 < N4 < ... < N1) → tránh trùng giữa deck.
 *  - anchor_sense_id = sense `is_primary` của lexeme (đã đo: 100% accepted có primary).
 *  - `is_published = false` (review trước khi bật); `concept_id` để NULL (DB4 nối sau).
 *  - position theo `frequency_rank` (NULL cuối) rồi lexeme_id; item_count cập nhật sau khi chèn.
 *
 * Dry-run mặc định (chỉ SELECT). Apply: `--apply --allow-db <db> [--allow-test]`.
 * Rollback: `--rollback <manifest.json>`.
 */

interface DeckItemRow {
  level: number;
  lexemeId: string;
  senseId: string;
  frequencyRank: number | null;
}

function deckSlug(level: number): string {
  return `jlpt-n${level}`;
}

function deckTitle(level: number): string {
  return `Từ vựng JLPT N${level}`;
}

async function loadItems(
  client: import('pg').Client,
  limit?: number,
): Promise<DeckItemRow[]> {
  const result = await client.query<{
    level: number;
    lexeme_id: string;
    sense_id: string;
    frequency_rank: number | null;
  }>(
    `WITH lowest AS (
       SELECT DISTINCT ON (jl.lexeme_id)
         jl.lexeme_id, jl.source_level AS level
       FROM core.jlpt_link jl
       WHERE jl.status = 'accepted' AND jl.lexeme_id IS NOT NULL
       ORDER BY jl.lexeme_id, jl.source_level ASC
     )
     SELECT l.level, l.lexeme_id, s.id AS sense_id, lx.frequency_rank
     FROM lowest l
     JOIN core.lexeme lx ON lx.id = l.lexeme_id
     JOIN core.sense s ON s.lexeme_id = l.lexeme_id AND s.is_primary
     ORDER BY l.level, lx.frequency_rank NULLS LAST, l.lexeme_id`,
  );
  if (limit === undefined) {
    return result.rows.map((row) => ({
      level: row.level,
      lexemeId: row.lexeme_id,
      senseId: row.sense_id,
      frequencyRank: row.frequency_rank,
    }));
  }
  const perLevel = new Map<number, number>();
  const out: DeckItemRow[] = [];
  for (const row of result.rows) {
    const count = perLevel.get(row.level) ?? 0;
    if (count >= limit) continue;
    perLevel.set(row.level, count + 1);
    out.push({
      level: row.level,
      lexemeId: row.lexeme_id,
      senseId: row.sense_id,
      frequencyRank: row.frequency_rank,
    });
  }
  return out;
}

async function applyDecks(
  client: import('pg').Client,
  items: DeckItemRow[],
): Promise<Map<string, { deckId: string; count: number }>> {
  const language = await client.query<{ id: number }>(
    "SELECT id FROM public.language WHERE code = 'ja'",
  );
  const languageId = language.rows[0]?.id;
  if (!languageId)
    throw new Error("Không tìm thấy ngôn ngữ 'ja' trong public.language");

  const levels = [...new Set(items.map((item) => item.level))].sort();
  const result = new Map<string, { deckId: string; count: number }>();

  for (const level of levels) {
    const slug = deckSlug(level);
    const deck = await client.query<{ id: string }>(
      `INSERT INTO core.deck (slug, title, description, language_id, level_label, is_published, item_count)
       VALUES ($1, $2, $3, $4, $5, false, 0)
       ON CONFLICT (slug) DO UPDATE SET
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         language_id = EXCLUDED.language_id,
         level_label = EXCLUDED.level_label
       RETURNING id`,
      [
        slug,
        deckTitle(level),
        `Bộ từ vựng JLPT N${level} (nguồn: core.jlpt_link accepted, cấp thấp nhất; anchor sense is_primary)`,
        languageId,
        `N${level}`,
      ],
    );
    const deckId = deck.rows[0].id;
    const levelItems = items.filter((item) => item.level === level);
    let position = 0;
    for (const batch of chunk(levelItems, 200)) {
      const values: unknown[] = [];
      const tuples = batch.map((item) => {
        position += 1;
        const base = values.length;
        values.push(deckId, item.senseId, position);
        return `($${base + 1},$${base + 2},NULL,$${base + 3})`;
      });
      await client.query(
        `INSERT INTO core.deck_item (deck_id, anchor_sense_id, concept_id, position)
         VALUES ${tuples.join(',')}
         ON CONFLICT (deck_id, anchor_sense_id) DO UPDATE SET position = EXCLUDED.position`,
        values,
      );
    }
    await client.query(
      `UPDATE core.deck SET item_count = (
         SELECT count(*)::int FROM core.deck_item WHERE deck_id = $1
       ) WHERE id = $1`,
      [deckId],
    );
    result.set(slug, { deckId, count: levelItems.length });
    log(`  ${slug}: ${levelItems.length} item`);
  }
  return result;
}

async function rollback(manifestFile: string): Promise<void> {
  const manifest = readManifest(manifestFile);
  if (!manifest.rollback || manifest.rollback.kind !== 'decks') {
    throw new Error('Manifest không phải của task decks');
  }
  const slugs = manifest.rollback.items.map((item) => String(item));
  const url = requireUrl();
  const client = await connect(url);
  try {
    await client.query('BEGIN');
    const decks = await client.query<{ id: string }>(
      'SELECT id FROM core.deck WHERE slug = ANY($1::text[])',
      [slugs],
    );
    const ids = decks.rows.map((row) => row.id);
    const items = await client.query(
      'DELETE FROM core.deck_item WHERE deck_id = ANY($1::bigint[])',
      [ids],
    );
    const removed = await client.query(
      'DELETE FROM core.deck WHERE id = ANY($1::bigint[])',
      [ids],
    );
    await client.query('COMMIT');
    log(
      `rollback decks: xoá ${removed.rowCount} deck, ${items.rowCount} deck_item`,
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const cli = parseCli('decks', process.argv.slice(2));
  if (typeof cli.flags.get('rollback') === 'string') {
    await rollback(cli.flags.get('rollback') as string);
    return;
  }

  const url = requireUrl();
  assertWritableTarget(url, cli);
  const client = await connect(url);
  let items: DeckItemRow[] = [];
  try {
    items = await loadItems(client, cli.limit);
  } finally {
    await client.end();
  }

  log(`== DB3 decks (${cli.apply ? 'APPLY' : 'DRY-RUN'}) ==`);
  const byLevel = new Map<number, number>();
  for (const item of items) {
    byLevel.set(item.level, (byLevel.get(item.level) ?? 0) + 1);
  }
  for (const level of [...byLevel.keys()].sort()) {
    log(`  N${level}: ${byLevel.get(level)} lexeme (anchor = primary sense)`);
  }
  if (items.length === 0) {
    log(
      '  ⚠ không có jlpt_link accepted trong DB này (dry-run hợp lệ, không ghi gì)',
    );
  }

  if (cli.apply && items.length > 0) {
    const client2 = await connect(url);
    try {
      await client2.query('BEGIN');
      await applyDecks(client2, items);
      await client2.query('COMMIT');
    } catch (error) {
      await client2.query('ROLLBACK');
      throw error;
    } finally {
      await client2.end();
    }
  }

  const slugs = [...new Set(items.map((item) => deckSlug(item.level)))].sort();
  const manifestFile = writeManifest(cli.manifestDir, {
    task: 'decks',
    startedAt: new Date().toISOString(),
    applied: cli.apply && items.length > 0,
    db: cli.apply ? dbNameOf(url) : undefined,
    summary: {
      totalItems: items.length,
      decks: Object.fromEntries(
        [...byLevel.entries()].map(([level, count]) => [
          `jlpt-n${level}`,
          count,
        ]),
      ),
    },
    warnings: items.length === 0 ? ['không có dữ liệu jlpt_link accepted'] : [],
    rollback: { kind: 'decks', items: slugs },
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
      `decks: LỖI — ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
