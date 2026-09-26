import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  connect,
  loadScriptEnv,
  logError,
  logStep,
  requireEnv,
} from './_shared';

const SCRIPT = 'db:migrate';

/**
 * Chạy các file db/migrations/*.sql còn thiếu so với public.schema_migration,
 * theo thứ tự tên. Mỗi file + bản ghi schema_migration nằm trong 1 transaction.
 * Kết nối bằng DIRECT_URL. Không bao giờ sửa file migration đã chạy.
 */
async function main(): Promise<void> {
  loadScriptEnv();
  const directUrl = requireEnv('DIRECT_URL');

  const migrationsDir = path.resolve(process.cwd(), 'db', 'migrations');
  const files = (await readdir(migrationsDir))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  if (files.length === 0) {
    throw new Error(`Không tìm thấy file migration nào trong ${migrationsDir}`);
  }

  const client = await connect(directUrl, 'langoo-db-migrate');
  try {
    // Bảng nhật ký migration (định dạng y hệt hệ thống cũ; dump DB mẫu cũng có sẵn).
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migration (
        name text NOT NULL,
        applied_at timestamp with time zone DEFAULT now()
      )
    `);

    const result = await client.query<{ name: string }>(
      'SELECT name FROM public.schema_migration ORDER BY name',
    );
    const applied = new Set(result.rows.map((row) => row.name));
    const known = new Set(files);
    const pending = files.filter((file) => !applied.has(file));
    const unknown = result.rows
      .map((row) => row.name)
      .filter((name) => !known.has(name));

    if (unknown.length > 0) {
      logStep(
        SCRIPT,
        `CẢNH BÁO: DB có ${unknown.length} migration không tồn tại trong db/migrations (schema trôi?): ${unknown.join(', ')}`,
      );
    }

    if (pending.length === 0) {
      logStep(
        SCRIPT,
        `Đã cập nhật đủ ${files.length} file migration (${files[0]} → ${files[files.length - 1]}), không cần chạy thêm.`,
      );
      return;
    }

    logStep(SCRIPT, `Sẽ chạy ${pending.length} file: ${pending.join(', ')}`);
    for (const file of pending) {
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO public.schema_migration (name) VALUES ($1)',
          [file],
        );
        await client.query('COMMIT');
        logStep(SCRIPT, `Đã chạy ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Migration ${file} thất bại và đã rollback. Chi tiết: ${detail}`,
        );
      }
    }
    logStep(SCRIPT, `Hoàn tất: đã chạy ${pending.length} file migration.`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  logError(SCRIPT, error);
  process.exitCode = 1;
});
