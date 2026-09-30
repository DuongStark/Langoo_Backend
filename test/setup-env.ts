import { config as loadDotenv } from 'dotenv';
import { withUtcTimezone } from '../src/db/connection-url';

// Nạp .env sớm nhất có thể (trước khi AppModule khởi tạo ConfigModule).
loadDotenv();

const testUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (testUrl === undefined || testUrl.trim() === '') {
  throw new Error(
    'E2E cần TEST_DATABASE_URL (hoặc DATABASE_URL trỏ DB local) trong .env. Xem .env.example.',
  );
}

function assertTestDb(rawUrl: string, label: string): string {
  let database: string;
  let hostname: string;
  try {
    const url = new URL(rawUrl);
    database = decodeURIComponent(url.pathname.replace(/^\//, ''));
    hostname = url.hostname.toLowerCase();
  } catch {
    throw new Error(`${label} không phải URL hợp lệ`);
  }
  if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    throw new Error(
      `An toàn: e2e chỉ chạy trên PostgreSQL local — ${label} đang trỏ host "${hostname}".`,
    );
  }
  if (!/_test$/.test(database)) {
    throw new Error(
      `An toàn: e2e chỉ chạy trên DB có tên kết thúc "_test" — ${label} đang trỏ "${database}". ` +
        'Chạy "npm run db:test:reset" và đặt TEST_DATABASE_URL trong .env.',
    );
  }
  return rawUrl;
}

const testDatabaseUrl = withUtcTimezone(
  assertTestDb(testUrl, 'TEST_DATABASE_URL/DATABASE_URL'),
);
// Never fall back to the production DIRECT_URL for test setup. A separate
// test direct URL is allowed, but it must point at the same safe DB class.
const testDirectUrl = withUtcTimezone(
  assertTestDb(
    process.env.TEST_DIRECT_URL ?? testUrl,
    'TEST_DIRECT_URL/TEST_DATABASE_URL',
  ),
);
process.env.DATABASE_URL = testDatabaseUrl;
process.env.DIRECT_URL = testDirectUrl;
process.env.NODE_ENV = 'test';
if (process.env.LOG_LEVEL === undefined) {
  process.env.LOG_LEVEL = 'error';
}
// M12: e2e bắn rất nhiều request auth → tắt rate limit và scheduler cho ổn định.
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.SCHEDULER_ENABLED = 'false';
