import {
  connect,
  dbNameOf,
  log,
  parseCli,
  requireUrl,
  writeManifest,
} from './_shared';

/**
 * DB3-A4 — audit JLPT (READ-ONLY, không ghi DB nghiệp vụ).
 * Tái lập các số kiểm kê: theo cấp, lexeme nhiều cấp, accepted thiếu sense,
 * đối chiếu lexeme_level (chỉ tham chiếu) với jlpt_link (canonical).
 */

async function main(): Promise<void> {
  const cli = parseCli('verify-jlpt', process.argv.slice(2));
  const url = requireUrl();
  const client = await connect(url);
  try {
    const byLevel = await client.query<{
      level: number;
      rows: number;
      lexemes: number;
      accepted: number;
    }>(
      `SELECT source_level AS level, count(*)::int AS rows,
              count(DISTINCT lexeme_id)::int AS lexemes,
              count(DISTINCT lexeme_id) FILTER (WHERE status = 'accepted')::int AS accepted
       FROM core.jlpt_link GROUP BY 1 ORDER BY 1`,
    );
    const multiLevel = await client.query<{ lexemes: number }>(
      `SELECT count(*)::int AS lexemes
       FROM (
         SELECT lexeme_id FROM core.jlpt_link
         WHERE lexeme_id IS NOT NULL
         GROUP BY lexeme_id HAVING count(DISTINCT source_level) > 1
       ) t`,
    );
    const acceptedNoSense = await client.query<{ lexemes: number }>(
      `SELECT count(DISTINCT jl.lexeme_id)::int AS lexemes
       FROM core.jlpt_link jl
       WHERE jl.status = 'accepted' AND jl.lexeme_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM core.sense s WHERE s.lexeme_id = jl.lexeme_id)`,
    );
    const acceptedNoPrimary = await client.query<{ lexemes: number }>(
      `SELECT count(DISTINCT jl.lexeme_id)::int AS lexemes
       FROM core.jlpt_link jl
       WHERE jl.status = 'accepted' AND jl.lexeme_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM core.sense s WHERE s.lexeme_id = jl.lexeme_id AND s.is_primary
         )`,
    );
    const levels = await client.query<{
      source: string;
      rows: number;
      lexemes: number;
    }>(
      `SELECT 'lexeme_level' AS source, count(*)::int AS rows, count(DISTINCT lexeme_id)::int AS lexemes
       FROM core.lexeme_level
       UNION ALL
       SELECT 'jlpt_link (có lexeme_id)', count(*)::int, count(DISTINCT lexeme_id)::int
       FROM core.jlpt_link WHERE lexeme_id IS NOT NULL`,
    );
    const overlap = await client.query<{ both: number }>(
      `SELECT count(*)::int AS both
       FROM (SELECT DISTINCT lexeme_id FROM core.lexeme_level) a
       JOIN (SELECT DISTINCT lexeme_id FROM core.jlpt_link WHERE lexeme_id IS NOT NULL) b
         ON b.lexeme_id = a.lexeme_id`,
    );

    log(`== DB3 verify-jlpt (READ-ONLY) — db=${dbNameOf(url)} ==`);
    for (const row of byLevel.rows) {
      log(
        `  N${row.level}: rows=${row.rows} lexemes=${row.lexemes} accepted=${row.accepted}`,
      );
    }
    log(`  lexeme nhiều cấp: ${multiLevel.rows[0].lexemes}`);
    log(`  accepted thiếu sense: ${acceptedNoSense.rows[0].lexemes}`);
    log(
      `  accepted thiếu sense is_primary: ${acceptedNoPrimary.rows[0].lexemes}`,
    );
    for (const row of levels.rows) {
      log(`  ${row.source}: rows=${row.rows} lexemes=${row.lexemes}`);
    }
    log(`  giao lexeme_level ∩ jlpt_link: ${overlap.rows[0].both}`);

    const manifestFile = writeManifest(cli.manifestDir, {
      task: 'verify-jlpt',
      startedAt: new Date().toISOString(),
      applied: false,
      db: dbNameOf(url),
      summary: {
        byLevel: byLevel.rows,
        multiLevelLexemes: multiLevel.rows[0].lexemes,
        acceptedMissingSense: acceptedNoSense.rows[0].lexemes,
        acceptedMissingPrimary: acceptedNoPrimary.rows[0].lexemes,
        levelTables: levels.rows,
        overlap: overlap.rows[0].both,
      },
    });
    log(`manifest: ${manifestFile}`);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(
      `verify-jlpt: LỖI — ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
