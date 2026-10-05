import { Client } from 'pg';
import {
  assertFixtureTarget,
  assertWritableTarget,
  chunk,
  connect,
  log,
  parseCli,
  requireUrl,
  RunManifest,
  writeManifest,
} from './_shared';
import {
  applyWithJournal,
  changesOf,
  rollbackWithJournal,
  snapshot,
} from './_mutations';

interface DeckItemRow {
  level: number;
  lexeme_id: string;
  sense_id: string | null;
  frequency_rank: number | null;
}
const levels = [1, 2, 3, 4, 5];
const slugOf = (level: number): string => `jlpt-n${level}`;

async function loadItems(
  client: Client,
  limit?: number,
): Promise<DeckItemRow[]> {
  const result = await client.query<DeckItemRow>(
    `WITH lowest AS (
       SELECT lexeme_id, MAX(source_level) AS level
       FROM core.jlpt_link WHERE status = 'accepted' AND lexeme_id IS NOT NULL
       GROUP BY lexeme_id
     )
     SELECT l.level, l.lexeme_id, s.id AS sense_id, lx.frequency_rank
     FROM lowest l JOIN core.lexeme lx ON lx.id = l.lexeme_id
     LEFT JOIN core.sense s ON s.lexeme_id = l.lexeme_id AND s.is_primary
     ORDER BY l.level, lx.frequency_rank NULLS LAST, l.lexeme_id`,
  );
  if (
    result.rows.some(
      (row) => row.sense_id === null || !levels.includes(row.level),
    )
  ) {
    throw new Error(
      'JLPT accepted thiếu primary sense hoặc cấp không hợp lệ; dừng seed',
    );
  }
  if (limit === undefined) return result.rows;
  const counts = new Map<number, number>();
  return result.rows.filter((row) => {
    const count = counts.get(row.level) ?? 0;
    counts.set(row.level, count + 1);
    return count < limit;
  });
}

async function applyDecks(client: Client, items: DeckItemRow[]): Promise<void> {
  const language = await client.query<{ id: number }>(
    "SELECT id FROM public.language WHERE code = 'ja'",
  );
  const languageId = language.rows[0]?.id;
  if (!languageId) throw new Error("Thiếu ngôn ngữ 'ja'");
  for (const level of levels) {
    const deck = await client.query<{ id: string }>(
      `INSERT INTO core.deck (slug, title, description, language_id, level_label, is_published, item_count)
       VALUES ($1, $2, $3, $4, $5, false, 0)
       ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title,
         description = EXCLUDED.description, language_id = EXCLUDED.language_id,
         level_label = EXCLUDED.level_label
       RETURNING id`,
      [
        slugOf(level),
        `Từ vựng JLPT N${level}`,
        'JLPT accepted; ưu tiên N5 → N1; anchor sense is_primary',
        languageId,
        `N${level}`,
      ],
    );
    const id = deck.rows[0].id;
    const desired = items.filter((row) => row.level === level);
    await client.query(
      'DELETE FROM core.deck_item WHERE deck_id = $1 AND NOT (anchor_sense_id = ANY($2::bigint[]))',
      [id, desired.map((row) => row.sense_id)],
    );
    let position = 0;
    for (const batch of chunk(desired, 200)) {
      const values: unknown[] = [];
      const tuples = batch.map((row) => {
        const base = values.length;
        values.push(id, row.sense_id, ++position);
        return `($${base + 1}, $${base + 2}, NULL, $${base + 3})`;
      });
      await client.query(
        `INSERT INTO core.deck_item (deck_id, anchor_sense_id, concept_id, position)
         VALUES ${tuples.join(', ')}
         ON CONFLICT (deck_id, anchor_sense_id) DO UPDATE SET position = EXCLUDED.position`,
        values,
      );
    }
    await client.query('UPDATE core.deck SET item_count = $2 WHERE id = $1', [
      id,
      desired.length,
    ]);
    log(`  ${slugOf(level)}: ${desired.length} item`);
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const cli = parseCli('decks', argv);
  const url = requireUrl();
  const rollback = cli.flags.get('rollback');
  if (typeof rollback === 'string')
    return rollbackWithJournal(cli, url, rollback);
  assertWritableTarget(url, cli);
  assertFixtureTarget(url, cli);
  const manifest: RunManifest = {
    task: 'decks',
    startedAt: new Date().toISOString(),
    applied: false,
    summary: {},
    warnings: [],
  };
  const summarize = (items: DeckItemRow[]): void => {
    manifest.summary.totalItems = items.length;
    manifest.summary.decks = Object.fromEntries(
      levels.map((level) => [
        slugOf(level),
        items.filter((item) => item.level === level).length,
      ]),
    );
  };
  log(`== DB3 decks (${cli.apply ? 'APPLY' : 'DRY-RUN'}) ==`);
  if (cli.apply) {
    await applyWithJournal(cli, url, manifest, async (client) => {
      const beforeDecks = await snapshot(
        client,
        'core.deck',
        levels.map(slugOf),
      );
      if (cli.limit !== undefined && beforeDecks.rows.length > 0) {
        throw new Error(
          '--limit chỉ seed fixture mới; không thay tập item của deck có sẵn',
        );
      }
      const beforeItems = await snapshot(
        client,
        'core.deck_item',
        beforeDecks.rows.map((row) => String(row.id)),
      );
      await client.query(
        'LOCK TABLE core.jlpt_link, core.lexeme, core.sense IN SHARE MODE',
      );
      const items = await loadItems(client, cli.limit);
      summarize(items);
      await applyDecks(client, items);
      const afterDecks = await snapshot(
        client,
        'core.deck',
        levels.map(slugOf),
      );
      const afterItems = await snapshot(
        client,
        'core.deck_item',
        afterDecks.rows.map((row) => String(row.id)),
      );
      return changesOf([beforeDecks, beforeItems], [afterDecks, afterItems]);
    });
  } else {
    const client = await connect(url);
    try {
      summarize(await loadItems(client, cli.limit));
    } finally {
      await client.end();
    }
    log(`manifest: ${writeManifest(cli.manifestDir, manifest)}`);
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
