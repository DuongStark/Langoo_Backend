import { Client } from 'pg';

/**
 * Verify the actual session, rather than only trusting the URL text. This
 * runs before each e2e file creates fixtures, so a role/database timezone
 * drift fails before any product data is written.
 */
beforeAll(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const literal = '2026-09-27T00:00:00.000Z';
    const result = await client.query<{
      database: string;
      timezone: string;
      bound: Date;
      expected: Date;
    }>(
      `SELECT current_database() AS database,
              current_setting('TimeZone') AS timezone,
              $1::timestamptz AS bound,
              TIMESTAMPTZ '2026-09-27 00:00:00+00' AS expected`,
      [literal],
    );
    const row = result.rows[0];
    if (
      row === undefined ||
      !row.database.endsWith('_test') ||
      row.timezone.toUpperCase() !== 'UTC' ||
      row.bound.getTime() !== row.expected.getTime()
    ) {
      throw new Error(
        `E2E DB phải có session TimeZone=UTC và bind instant nhất quán (database=${row?.database ?? 'unknown'}, timezone=${row?.timezone ?? 'unknown'})`,
      );
    }
  } finally {
    await client.end();
  }
});
