import { connect, loadScriptEnv, parseDbUrl, requireEnv } from '../db/_shared';
import { inventoryDuplicates } from './duplicate-inventory';
import { writeImmutableJson, safeProjectionError } from './source-projection';

async function main(): Promise<void> {
  loadScriptEnv();
  const flags = new Map<string, string>(),
    args = process.argv.slice(2);
  while (args.length) {
    const key = args.shift()!,
      value = args.shift();
    if (
      !['--target', '--out', '--limit', '--after', '--after-peer'].includes(
        key,
      ) ||
      !value ||
      value.startsWith('--') ||
      flags.has(key)
    )
      throw new Error('Invalid arguments');
    flags.set(key, value);
  }
  const parsed = parseDbUrl(requireEnv('DIRECT_URL'));
  const target = `${parsed.url.hostname}:${parsed.url.port || '5432'}/${parsed.database}`;
  if (flags.get('--target') !== target || !flags.has('--out'))
    throw new Error('Exact --target and --out required');
  const c = await connect(parsed.raw, 'langoo-dictionary-duplicate-inventory');
  try {
    const report = await inventoryDuplicates(
      c,
      target,
      Number(flags.get('--limit') ?? '500'),
      flags.get('--after') ?? '0',
      flags.get('--after-peer') ?? '0',
    );
    writeImmutableJson(flags.get('--out')!, report);
    console.log(
      JSON.stringify({
        target,
        ...report.counts,
        truncated: report.truncated,
        nextAfterSenseId: report.nextAfterSenseId,
        nextAfterPeerSenseId: report.nextAfterPeerSenseId,
      }),
    );
  } finally {
    await c.end();
  }
}
void main().catch((error: unknown) => {
  console.error('Duplicate inventory failed: ' + safeProjectionError(error));
  process.exitCode = 1;
});
