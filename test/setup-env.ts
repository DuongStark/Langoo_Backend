import { config as loadDotenv } from 'dotenv';

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
  try {
    database = decodeURIComponent(new URL(rawUrl).pathname.replace(/^\//, ''));
  } catch {
    throw new Error(`${label} không phải URL hợp lệ`);
  }
  if (!/_test$/.test(database)) {
    throw new Error(
      `An toàn: e2e chỉ chạy trên DB có tên kết thúc "_test" — ${label} đang trỏ "${database}". ` +
        'Chạy "npm run db:test:reset" và đặt TEST_DATABASE_URL trong .env.',
    );
  }
  return rawUrl;
}

process.env.DATABASE_URL = assertTestDb(
  testUrl,
  'TEST_DATABASE_URL/DATABASE_URL',
);
process.env.DIRECT_URL = assertTestDb(
  process.env.TEST_DIRECT_URL ?? process.env.DIRECT_URL ?? testUrl,
  'TEST_DIRECT_URL/DIRECT_URL',
);
process.env.NODE_ENV = 'test';
if (process.env.LOG_LEVEL === undefined) {
  process.env.LOG_LEVEL = 'error';
}
