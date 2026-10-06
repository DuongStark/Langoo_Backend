import { readFileSync } from 'node:fs';
import { loadScriptEnv, connect, requireEnv, parseDbUrl } from '../db/_shared';
import {
  exportProjection,
  mutateProjection,
  writeImmutableJson,
  safeProjectionError,
} from './source-projection';

async function main(): Promise<void> {
  loadScriptEnv();
  const args = process.argv.slice(2),
    command = args.shift();
  const allowed = new Set([
    '--target',
    '--out',
    '--limit',
    '--after',
    '--manifest',
    '--journal',
    '--allow-data-write',
  ]);
  const flags = new Map<string, string>();
  while (args.length) {
    const key = args.shift()!;
    if (!allowed.has(key) || flags.has(key))
      throw new Error('Unknown/duplicate argument');
    const value = key === '--allow-data-write' ? 'yes' : args.shift();
    if (!value || value.startsWith('--'))
      throw new Error('Missing argument value');
    flags.set(key, value);
  }
  if (!['export', 'apply', 'rollback'].includes(command ?? ''))
    throw new Error('Use export/apply/rollback');
  const parsed = parseDbUrl(requireEnv('DIRECT_URL'));
  const target = `${parsed.url.hostname}:${parsed.url.port || '5432'}/${parsed.database}`;
  if (flags.get('--target') !== target)
    throw new Error('--target must match actual host:port/database');
  if (command !== 'export' && !flags.has('--allow-data-write'))
    throw new Error(
      'Mutation requires --allow-data-write and a reviewed manifest',
    );
  const client = await connect(
    parsed.raw,
    'langoo-dictionary-source-projection',
  );
  try {
    if (command === 'export') {
      const out = flags.get('--out');
      if (!out) throw new Error('Missing --out');
      const manifest = await exportProjection(
        client,
        target,
        Number(flags.get('--limit') ?? '500'),
        flags.get('--after') ?? '0',
      );
      writeImmutableJson(out, manifest);
      console.log(
        JSON.stringify({
          target,
          records: manifest.records.length,
          truncated: manifest.truncated,
          nextAfterSenseId: manifest.nextAfterSenseId,
          counts: Object.fromEntries(
            ['eligible', 'unchanged', 'blocked'].map((d) => [
              d,
              manifest.records.filter((r) => r.decision === d).length,
            ]),
          ),
        }),
      );
    } else {
      const file = flags.get('--manifest'),
        journal = flags.get('--journal');
      if (!file || !journal) throw new Error('Missing --manifest/--journal');
      console.log(
        await mutateProjection(
          client,
          JSON.parse(readFileSync(file, 'utf8')) as unknown,
          target,
          journal,
          command as 'apply' | 'rollback',
        ),
      );
    }
  } finally {
    await client.end();
  }
}
void main().catch((error: unknown) => {
  console.error('Projection command failed: ' + safeProjectionError(error));
  process.exitCode = 1;
});
