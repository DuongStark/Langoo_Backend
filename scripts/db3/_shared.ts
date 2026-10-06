import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { Client } from 'pg';

/**
 * Tiện ích chung cho các script DB3 (phiên song song DeepSeek).
 * Nguyên tắc: dry-run mặc định; --apply phải kèm --allow-db khớp tên DB hiện tại
 * (DB *_test cần thêm --allow-test). Mọi run ghi manifest JSON vào manifest-dir.
 */

export interface Cli {
  task: string;
  apply: boolean;
  allowDb?: string;
  allowTest: boolean;
  sources: string;
  manifestDir: string;
  limit?: number;
  flags: Map<string, string | boolean>;
}

export function parseCli(
  task: string,
  argv: string[],
  defaults?: { sources?: string },
): Cli {
  const flags = new Map<string, string | boolean>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(key, next);
      index += 1;
    } else {
      flags.set(key, true);
    }
  }
  const str = (key: string): string | undefined => {
    const value = flags.get(key);
    return typeof value === 'string' ? value : undefined;
  };
  const limitRaw = str('limit');
  const limit = limitRaw === undefined ? undefined : Number(limitRaw);
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) {
    throw new Error('--limit phải là số nguyên dương');
  }
  if (flags.has('dry-run') && flags.has('apply')) {
    throw new Error('Không dùng đồng thời --dry-run và --apply');
  }
  for (const key of [
    'apply',
    'allow-test',
    'fixture',
    'recover',
    'dry-run',
    'allow-partial',
  ]) {
    if (flags.has(key) && flags.get(key) !== true) {
      throw new Error(`--${key} không nhận giá trị`);
    }
  }
  if (flags.has('rollback') && typeof flags.get('rollback') !== 'string') {
    throw new Error('--rollback cần đường dẫn manifest');
  }
  return {
    task,
    apply: flags.get('apply') === true,
    allowDb: str('allow-db'),
    allowTest: flags.get('allow-test') === true,
    sources: str('sources') ?? defaults?.sources ?? defaultSources(),
    manifestDir: str('manifest-dir') ?? 'uploads/db3',
    limit,
    flags,
  };
}

function defaultSources(): string {
  const candidates = [
    path.resolve(__dirname, '../../../data-Langoo/downloads/extras'),
    path.resolve(__dirname, '../../../../data-Langoo/downloads/extras'),
  ];
  return candidates.find((directory) => existsSync(directory)) ?? candidates[0];
}

export function assertFixtureTarget(url: string, cli: Cli): void {
  if (!cli.flags.has('fixture') && cli.limit === undefined) return;
  const parsed = new URL(url);
  if (
    !dbNameOf(url).endsWith('_test') ||
    !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) ||
    !cli.allowTest
  ) {
    throw new Error(
      '--fixture/--limit chỉ dùng với DB local *_test và --allow-test',
    );
  }
}

export function loadEnv(): void {
  loadDotenv();
}

export function requireUrl(): string {
  loadEnv();
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url || url.trim() === '') {
    throw new Error('Thiếu DIRECT_URL/DATABASE_URL (xem .env)');
  }
  return url;
}

export function dbNameOf(url: string): string {
  const parsed = new URL(url);
  return decodeURIComponent(parsed.pathname.replace(/^\//, ''));
}

/** Chặn ghi nhầm đích: chỉ cho --apply khi tên DB khớp --allow-db. */
export function assertWritableTarget(url: string, cli: Cli): void {
  if (!cli.apply) return;
  const name = dbNameOf(url);
  if (cli.allowDb !== name) {
    throw new Error(
      `${cli.task}: --apply yêu cầu --allow-db ${name} (đang có: ${cli.allowDb ?? '∅'})`,
    );
  }
  if (name.endsWith('_test') && !cli.allowTest) {
    throw new Error(
      `${cli.task}: DB *_test cần thêm --allow-test (đích: ${name})`,
    );
  }
}

export async function connect(url: string): Promise<Client> {
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query("SET TIME ZONE 'UTC'");
  return client;
}

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function sha256File(file: string): string {
  return sha256(readFileSync(file));
}

export function readText(file: string): string {
  return readFileSync(file, 'utf8');
}

export interface RunManifest {
  task: string;
  startedAt: string;
  applied: boolean;
  db?: string;
  inputs?: Record<string, string>;
  summary: Record<string, unknown>;
  warnings?: string[];
  rollback?: { kind: string; items: unknown[]; before?: unknown[] };
}

export function writeManifest(
  directory: string,
  manifest: RunManifest,
): string {
  mkdirSync(directory, { recursive: true });
  const stamp = manifest.startedAt.replace(/[:.]/g, '-');
  const file = path.join(directory, `${stamp}-${manifest.task}.json`);
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return file;
}

export function readManifest(file: string): RunManifest {
  return JSON.parse(readFileSync(file, 'utf8')) as RunManifest;
}

export function log(...args: unknown[]): void {
  console.log(...args);
}

/** Chia mảng thành lô nhỏ để chèn theo batch. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

export interface SourceRow {
  code: string;
  name: string;
  license: string;
  attribution: string;
  url: string;
  version: string;
  sha256: string;
}

/**
 * Upsert một dòng public.source theo `code`.
 * Bảng source KHÔNG có default cho `id` → tự cấp MAX(id)+1 khi chèn mới.
 */
export async function upsertSourceRow(
  client: import('pg').Client,
  source: SourceRow,
): Promise<number> {
  const result = await client.query<{ id: number }>(
    `INSERT INTO public.source (id, code, name, license, attribution, url, version, sha256)
     SELECT COALESCE((SELECT MAX(id) FROM public.source), 0) + 1, $1, $2, $3, $4, $5, $6, $7
     ON CONFLICT (code) DO UPDATE SET
       name = EXCLUDED.name,
       license = EXCLUDED.license,
       attribution = EXCLUDED.attribution,
       url = EXCLUDED.url,
       version = EXCLUDED.version,
       sha256 = EXCLUDED.sha256
     RETURNING id`,
    [
      source.code,
      source.name,
      source.license,
      source.attribution,
      source.url,
      source.version,
      source.sha256,
    ],
  );
  return result.rows[0].id;
}
