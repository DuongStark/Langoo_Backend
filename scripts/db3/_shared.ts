import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  return {
    task,
    apply: flags.get('apply') === true,
    allowDb: str('allow-db'),
    allowTest: flags.get('allow-test') === true,
    sources:
      str('sources') ??
      defaults?.sources ??
      path.resolve(__dirname, '../../../data-Langoo/downloads/extras'),
    manifestDir: str('manifest-dir') ?? 'uploads/db3',
    limit: limitRaw === undefined ? undefined : Number(limitRaw),
    flags,
  };
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
