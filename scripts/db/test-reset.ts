import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  assertTestDatabase,
  connect,
  databaseUrlWithName,
  loadScriptEnv,
  logError,
  logStep,
  resolveTestDirectUrl,
} from './_shared';
import { applyPendingMigrations } from './migrations';

const SCRIPT = 'db:test:reset';

const DUMP_FILE = path.join(
  'db',
  'exports',
  'langoo-min-full-inserts.sql',
);

/**
 * Drop/tạo lại DB test local rồi nạp db/exports/langoo-min-full-inserts.sql.
 * An toàn: chỉ chạy với DB tên kết thúc `_test`, từ chối khi NODE_ENV=production.
 */
async function main(): Promise<void> {
  loadScriptEnv();
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Không chạy db:test:reset khi NODE_ENV=production');
  }

  const parsed = resolveTestDirectUrl();
  assertTestDatabase(parsed);

  const dumpPath = path.resolve(process.cwd(), DUMP_FILE);
  await access(dumpPath);

  const maintenanceUrl = databaseUrlWithName(parsed, 'postgres');
  logStep(SCRIPT, `Drop + tạo lại database "${parsed.database}" ...`);
  const admin = await connect(maintenanceUrl, 'langoo-test-reset');
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${parsed.database}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${parsed.database}"`);
  } finally {
    await admin.end();
  }

  const sql = await readFile(dumpPath, 'utf8');
  logStep(
    SCRIPT,
    `Nạp dump ${dumpPath} (${Math.round(sql.length / 1024)} KB) ...`,
  );
  const db = await connect(parsed.raw, 'langoo-test-reset');
  try {
    // Migration 040_kanji_component.sql GRANTs to the app role `langoo`, which
    // exists on local/VPS clusters but not in CI (postgres-only kernel).
    await db.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'langoo') THEN
          CREATE ROLE langoo NOLOGIN;
        END IF;
      END $$;
    `);
    await db.query(sql);
  } finally {
    await db.end();
  }

  // Dump là "schema nền"; áp thêm các migration mới hơn (ví dụ 026/027) để DB test
  // luôn khớp schema hiện tại — giống bước CI (reset → migrate).
  await applyPendingMigrations(parsed.raw, SCRIPT);

  logStep(SCRIPT, `Xong: DB test "${parsed.database}" đã sẵn sàng.`);
}

main().catch((error: unknown) => {
  logError(SCRIPT, error);
  process.exitCode = 1;
});
