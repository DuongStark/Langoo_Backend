/** M14.1 owner-approved single migration, deliberately not the all-pending migrator. */
import { readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const [file, expectedHash, flag] = process.argv.slice(2);
if (
  flag !== '--apply' ||
  !file ||
  !['045_concept_images.sql', '046_concept_image_default_accept.sql'].includes(
    basename(file),
  ) ||
  !/^[0-9a-f]{64}$/.test(expectedHash || '')
)
  throw Error('EXPLICIT_APPROVED_MIGRATION_REQUIRED');
const sql = readFileSync(file, 'utf8');
if (createHash('sha256').update(sql).digest('hex') !== expectedHash)
  throw Error('MIGRATION_HASH_MISMATCH');
const root = process.env.M141_APP_ROOT || process.cwd(),
  requireApp = createRequire(resolve(root, 'package.json'));
const env = requireApp('dotenv').parse(readFileSync(resolve(root, '.env'))),
  { Client } = requireApp('pg');
const db = new Client({
  connectionString: env.DIRECT_URL || env.DATABASE_URL,
  application_name: 'langoo-m141-image-schema',
});
try {
  await db.connect();
  await db.query('BEGIN');
  await db.query(`SET LOCAL lock_timeout='5s'`);
  await db.query(`SET LOCAL statement_timeout='30s'`);
  await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
    'm14.1:image-schema',
  ]);
  const existing = await db.query(
    `SELECT name FROM public.schema_migration WHERE name=$1`,
    [basename(file)],
  );
  if (
    basename(file).startsWith('046_') &&
    !(
      await db.query(
        "SELECT name FROM public.schema_migration WHERE name='045_concept_images.sql'",
      )
    ).rows.length
  )
    throw Error('MIGRATION_045_REQUIRED');
  if (!existing.rows.length) {
    await db.query(sql);
    await db.query(`INSERT INTO public.schema_migration(name) VALUES($1)`, [
      basename(file),
    ]);
  }
  await db.query('COMMIT');
  console.log(
    JSON.stringify({
      migration: basename(file),
      sha256: expectedHash,
      applied: !existing.rows.length,
    }),
  );
} catch (error) {
  await db.query('ROLLBACK').catch(() => {});
  console.error(
    JSON.stringify({
      error_code: 'MIGRATION_FAILED',
      sqlstate:
        error.code && /^[A-Z0-9]{5}$/.test(error.code) ? error.code : undefined,
    }),
  );
  process.exitCode = 1;
} finally {
  await db.end();
}
