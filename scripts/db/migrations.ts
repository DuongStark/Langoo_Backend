import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { connect, logStep } from './_shared';

/**
 * Áp các file db/migrations/*.sql còn thiếu so với public.schema_migration,
 * theo thứ tự tên; mỗi file + bản ghi migration nằm trong 1 transaction.
 * Dùng chung cho CLI `db:migrate` và `db:test:reset` (dump + migration).
 */
export interface MigrationOptions {
  /** Chỉ áp file có số thứ tự <= giá trị này (vd "027") — dùng cho rollout từng phần. */
  upto?: string;
}

export async function applyPendingMigrations(
  directUrl: string,
  script: string,
  options: MigrationOptions = {},
): Promise<void> {
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
    const allPending = files.filter((file) => !applied.has(file));
    const upto = options.upto === undefined ? null : Number(options.upto);
    const pending =
      upto === null
        ? allPending
        : allPending.filter((file) => migrationOrdinal(file) <= upto);
    const skipped = allPending.length - pending.length;
    const unknown = result.rows
      .map((row) => row.name)
      .filter((name) => !known.has(name));

    if (unknown.length > 0) {
      logStep(
        script,
        `CẢNH BÁO: DB có ${unknown.length} migration không tồn tại trong db/migrations (schema trôi?): ${unknown.join(', ')}`,
      );
    }

    if (pending.length === 0) {
      logStep(
        script,
        `Đã cập nhật đủ ${files.length} file migration (${files[0]} → ${files[files.length - 1]}), không cần chạy thêm.`,
      );
      logSkipped(script, skipped, options.upto);
      return;
    }

    logStep(script, `Sẽ chạy ${pending.length} file: ${pending.join(', ')}`);
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
        logStep(script, `Đã chạy ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Migration ${file} thất bại và đã rollback. Chi tiết: ${detail}`,
        );
      }
    }
    logStep(script, `Hoàn tất: đã chạy ${pending.length} file migration.`);
    logSkipped(script, skipped, options.upto);
  } finally {
    await client.end();
  }
}

function migrationOrdinal(file: string): number {
  const match = /^(\d+)_/.exec(file);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function logSkipped(
  script: string,
  skipped: number,
  upto: string | undefined,
): void {
  if (skipped > 0) {
    logStep(
      script,
      `Bỏ qua ${skipped} file sau --upto ${upto ?? ''} (chờ rollout).`,
    );
  }
}
