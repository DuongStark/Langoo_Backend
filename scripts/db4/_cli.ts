import { resolve } from 'node:path';
import { ArtifactPath, Positive } from './_primitives';

export type MappingCommand = keyof typeof commandFlags;
const commandFlags = {
  'mapping-inventory': [],
  'mapping-export': ['inventory', 'limit'],
  'mapping-generate': ['export', 'limit'],
  'mapping-score': ['candidates', 'limit'],
  'mapping-review': ['bundles', 'provider', 'job', 'generate', 'resume'],
  'mapping-audit': ['job'],
  'mapping-bind-target': ['job', 'gate'],
  'mapping-import': [
    'plan',
    'dry-run',
    'apply',
    'allow-db',
    'allow-test',
    'recover',
  ],
  'mapping-promote': [
    'plan',
    'rollback',
    'dry-run',
    'apply',
    'allow-db',
    'allow-test',
    'recover',
  ],
  'mapping-verify': ['root'],
  'mapping-refresh': ['root', 'dry-run', 'apply', 'allow-db', 'allow-test'],
} satisfies Record<string, string[]>;
const booleanFlags = new Set([
  'generate',
  'resume',
  'dry-run',
  'apply',
  'allow-test',
  'recover',
]);
const referenceFlags = new Set([
  'inventory',
  'export',
  'candidates',
  'bundles',
  'job',
  'gate',
  'plan',
  'rollback',
  'root',
]);
export interface MappingCli {
  command: MappingCommand;
  artifactDir: string;
  flags: Record<string, string | boolean | number>;
  effect: 'read_only' | 'provider' | 'database';
}
export function parseMappingCli(
  command: MappingCommand,
  argv: readonly string[],
): MappingCli {
  if (!Object.hasOwn(commandFlags, command))
    throw new Error('Unknown mapping command');
  const allowed = new Set<string>(['artifact-dir', ...commandFlags[command]]);
  const flags: MappingCli['flags'] = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--') || token.includes('='))
      throw new Error(`Expected --flag value: ${token}`);
    const key = token.slice(2);
    if (!allowed.has(key) || Object.hasOwn(flags, key))
      throw new Error(`Unknown/duplicate flag: ${key}`);
    if (booleanFlags.has(key)) flags[key] = true;
    else {
      const value = argv[++i];
      if (!value || value.startsWith('--') || !value.trim())
        throw new Error(`Missing value: ${key}`);
      if (referenceFlags.has(key)) ArtifactPath.parse(value);
      if (key === 'limit') {
        if (!/^[1-9][0-9]*$/.test(value)) throw new Error('Invalid limit');
        flags[key] = Positive.parse(Number(value));
      } else flags[key] = value;
    }
  }
  const required: Partial<Record<MappingCommand, string[]>> = {
    'mapping-export': ['inventory'],
    'mapping-generate': ['export'],
    'mapping-score': ['candidates'],
    'mapping-review': ['job', 'generate'],
    'mapping-audit': ['job'],
    'mapping-bind-target': ['job', 'gate'],
    'mapping-import': ['plan'],
    'mapping-verify': ['root'],
    'mapping-refresh': ['root'],
  };
  for (const key of required[command] ?? [])
    if (!flags[key]) throw new Error(`Required flag: ${key}`);
  if (command === 'mapping-review') {
    if (flags.resume) {
      if (flags.bundles || flags.provider)
        throw new Error('Resume uses frozen job config, no overrides');
    } else if (!flags.bundles || !flags.provider)
      throw new Error('New review requires bundles and provider');
    if (
      flags.provider &&
      !['stub', 'openai-compatible'].includes(String(flags.provider))
    )
      throw new Error('Unknown provider');
  }
  const mutation = [
    'mapping-import',
    'mapping-promote',
    'mapping-refresh',
  ].includes(command);
  if (command === 'mapping-promote' && !!flags.plan === !!flags.rollback)
    throw new Error('Exactly one of plan/rollback required');
  if (mutation) {
    if (!!flags.apply === !!flags['dry-run'])
      throw new Error('Exactly one of --apply/--dry-run required');
    if (flags.apply && !flags['allow-db'])
      throw new Error('Apply requires --allow-db');
    if (
      !flags.apply &&
      (flags['allow-db'] || flags['allow-test'] || flags.recover)
    )
      throw new Error('Write guards/recover require apply');
    if (flags.recover && flags.rollback)
      throw new Error('Recover and rollback are separate operations');
  }
  const artifactDir = resolve(
    typeof flags['artifact-dir'] === 'string'
      ? flags['artifact-dir']
      : 'uploads/db4',
  );
  return {
    command,
    artifactDir,
    flags,
    effect:
      mutation && flags.apply
        ? 'database'
        : command === 'mapping-review'
          ? 'provider'
          : 'read_only',
  };
}
/** D6 must call this with the database/host queried from the actual connection, before any write. */
export function assertMappingDatabaseTarget(
  cli: MappingCli,
  actual: { database: string; host: string },
): void {
  if (cli.effect !== 'database' || cli.flags['allow-db'] !== actual.database)
    throw new Error('Database target not authorized by CLI');
  const local = ['127.0.0.1', 'localhost', '::1'].includes(actual.host);
  if (/_test$/.test(actual.database) && (!cli.flags['allow-test'] || !local))
    throw new Error('Test target requires local host and --allow-test');
  if (cli.flags['allow-test'] && (!local || !/_test$/.test(actual.database)))
    throw new Error('--allow-test only permits a local test database');
}
