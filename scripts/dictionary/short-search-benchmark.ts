/** M4.2: read-only SQL benchmark. DIRECT_URL must be supplied explicitly. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Client } from 'pg';
import { Prisma } from '../../src/generated/prisma/client';
import { PrismaService } from '../../src/db/prisma.service';
import {
  escapeLike,
  getSearchQueryVariants,
} from '../../src/dictionary/dictionary.service';
import { DictionarySearchRepository } from '../../src/dictionary/repositories/dictionary-search.repository';

async function main() {
  const url = process.env.DIRECT_URL;
  const output = process.argv[2];
  if (!url || !output)
    throw new Error(
      'Supply DIRECT_URL and an output JSON path; no .env fallback.',
    );
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 5000,
  });
  await client.connect();
  const results: unknown[] = [];
  const artifact = {
    code: 'M4.2',
    measured_at: new Date().toISOString(),
    repository_sha256: createHash('sha256')
      .update(
        readFileSync(
          'src/dictionary/repositories/dictionary-search.repository.ts',
        ),
      )
      .digest('hex'),
    scope:
      'SQL only, read-only, limit specified per case; wall includes EXPLAIN and SELECT per phase, sum Execution Time for comparison; not FE/API latency',
    results,
  };
  mkdirSync(dirname(output), { recursive: true });
  try {
    const fixtures: [string, string | null, boolean?, number?][] = [
      ['a', 'en'],
      ['猫', 'ja'],
      ['run', 'en'],
      ['る', 'ja'],
      ['走る', 'ja'],
      ['日', 'ja'],
      ['生', 'ja'],
      ['人', 'ja'],
      ['a', null],
      ['𠮷', 'ja'],
      ['a', 'en', false, 21],
      ['a', 'en', true, 5],
      ['猫', 'ja', true, 5],
    ];
    for (const [q, lang, deduplicateSurface = false, limit = 6] of fixtures) {
      const plans: unknown[] = [];
      // Execute the actual repository SQL through pg, keeping transaction options.
      const tx = {
        $executeRawUnsafe: (sql: string) => client.query(sql),
        $queryRaw: async (sql: Prisma.Sql) => {
          const result = await client.query(
            'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + sql.text,
            sql.values,
          );
          plans.push((result.rows[0] as Record<string, unknown>)['QUERY PLAN']);
          return (
            await client.query<Record<string, unknown>>(sql.text, sql.values)
          ).rows;
        },
      };
      const repo = new DictionarySearchRepository({
        ...tx,
        $transaction: async (work: (session: typeof tx) => Promise<unknown>) =>
          work(tx),
      } as unknown as PrismaService);
      await client.query('BEGIN READ ONLY');
      await client.query("SET LOCAL statement_timeout = '20000'");
      const start = performance.now();
      try {
        const variants = getSearchQueryVariants(q, lang);
        await repo.search({
          queries: variants,
          patterns: variants.map(escapeLike),
          lang,
          limit,
          deduplicateSurface,
          cursor: null,
        });
        results.push({
          q,
          lang,
          limit,
          deduplicateSurface,
          wall_ms: performance.now() - start,
          plans,
        });
        console.log(
          JSON.stringify({
            q,
            lang,
            limit,
            deduplicateSurface,
            wall_ms: performance.now() - start,
          }),
        );
      } catch (error) {
        // Do not print connection details or the raw driver error.
        results.push({
          q,
          lang,
          limit,
          deduplicateSurface,
          wall_ms: performance.now() - start,
          error: error instanceof Error ? error.name : 'UnknownError',
        });
        console.log(
          JSON.stringify({ q, lang, error: 'query failed; see server logs' }),
        );
      } finally {
        await client.query('ROLLBACK');
        writeFileSync(output, JSON.stringify(artifact, null, 2) + '\n');
      }
    }
  } finally {
    await client.end();
  }
}

void main().catch(() => {
  console.error(
    'Benchmark failed; verify explicit DIRECT_URL and output path.',
  );
  process.exitCode = 1;
});
