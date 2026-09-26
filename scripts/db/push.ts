import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  connect,
  loadScriptEnv,
  logError,
  logStep,
  parseDbUrl,
  requireEnv,
} from './_shared';

const SCRIPT = 'db:push';

const DUMP_FILE = path.join('db', 'exports', 'langoo-min-full-inserts.sql');
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * (Tùy chọn) Đẩy dump DB mẫu lên DIRECT_URL của cloud.
 *
 * LƯU Ý:
 * - Dump tạo bảng trực tiếp (không IF NOT EXISTS) → chỉ dùng cho DB ĐÍCH TRỐNG.
 * - Đây là thao tác ghi lên cloud, luôn cần cờ --yes (và chủ dự án đồng ý).
 * - Không chạy nhầm vào DB local.
 */
async function main(): Promise<void> {
  loadScriptEnv();
  const directUrl = requireEnv('DIRECT_URL');
  const parsed = parseDbUrl(directUrl);

  if (LOCAL_HOSTS.has(parsed.url.hostname)) {
    throw new Error(
      'db:push chỉ dùng để đẩy lên DB cloud, không chạy với URL local. Dùng db:test:reset cho DB test.',
    );
  }
  if (!process.argv.includes('--yes')) {
    throw new Error(
      `Đây là thao tác GHI dump lên ${parsed.url.hostname}/${parsed.database}. Thêm cờ --yes để xác nhận.`,
    );
  }

  const dumpPath = path.resolve(process.cwd(), DUMP_FILE);
  const sql = await readFile(dumpPath, 'utf8');
  logStep(
    SCRIPT,
    `Đang đẩy dump (${Math.round(sql.length / 1024)} KB) lên ${parsed.url.hostname}/${parsed.database} ...`,
  );

  const client = await connect(directUrl, 'langoo-db-push');
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
  logStep(SCRIPT, 'Xong — dump đã được nạp lên cloud.');
}

main().catch((error: unknown) => {
  logError(SCRIPT, error);
  process.exitCode = 1;
});
