import { config as loadDotenv } from 'dotenv';
import { Client } from 'pg';
import { withUtcTimezone } from '../../src/db/connection-url';

/** Nạp .env cho script CLI (process.env có sẵn luôn thắng dotenv). */
export function loadScriptEnv(): void {
  loadDotenv();
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Thiếu biến môi trường ${name} (xem .env.example)`);
  }
  return value;
}

export interface ParsedDbUrl {
  raw: string;
  url: URL;
  database: string;
}

export function parseDbUrl(raw: string): ParsedDbUrl {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Chuỗi kết nối không phải URL hợp lệ');
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (database === '') {
    throw new Error('Chuỗi kết nối thiếu tên database');
  }
  return { raw, url, database };
}

/**
 * Chỉ cho phép thao tác phá huỷ (DROP/CREATE) trên DB có tên kết thúc `_test`
 * và tên an toàn để nội suy vào identifier SQL.
 */
export function assertTestDatabase(parsed: ParsedDbUrl): void {
  if (!/_test$/.test(parsed.database)) {
    throw new Error(
      `An toàn: chỉ thao tác trên DB tên kết thúc bằng "_test" (đang nhận "${parsed.database}").`,
    );
  }
  if (!/^[a-z][a-z0-9_]*_test$/.test(parsed.database)) {
    throw new Error(
      `Tên DB "${parsed.database}" chứa ký tự không an toàn, từ chối thực hiện.`,
    );
  }
  if (!['localhost', '127.0.0.1', '::1'].includes(parsed.url.hostname)) {
    throw new Error(
      `An toàn: DB test phải là local (host nhận được "${parsed.url.hostname}").`,
    );
  }
}

export function databaseUrlWithName(
  parsed: ParsedDbUrl,
  database: string,
): string {
  const url = new URL(parsed.url.toString());
  url.pathname = `/${database}`;
  return url.toString();
}

/** URL direct dành cho DB test: TEST_DIRECT_URL → TEST_DATABASE_URL. */
export function resolveTestDirectUrl(): ParsedDbUrl {
  const raw =
    process.env.TEST_DIRECT_URL ??
    process.env.TEST_DATABASE_URL;
  if (raw === undefined || raw.trim() === '') {
    throw new Error(
      'Thiếu TEST_DIRECT_URL hoặc TEST_DATABASE_URL để thao tác DB test',
    );
  }
  return parseDbUrl(raw);
}

export async function connect(
  connectionString: string,
  applicationName: string,
): Promise<Client> {
  const client = new Client({
    connectionString: withUtcTimezone(connectionString),
    application_name: applicationName,
  });
  await client.connect();
  return client;
}

export function logStep(script: string, message: string): void {
  console.log(`[${script}] ${message}`);
}

export function logError(script: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[${script}] LỖI: ${message}`);
}
