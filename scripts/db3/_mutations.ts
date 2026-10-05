import { randomUUID } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { z } from 'zod';
import {
  assertWritableTarget,
  Cli,
  connect,
  dbNameOf,
  log,
  RunManifest,
} from './_shared';

// All SQL identifiers come from this allowlist, never from manifest text.
const tables = {
  'public.source': {
    columns: [
      'id',
      'code',
      'name',
      'license',
      'attribution',
      'url',
      'version',
      'sha256',
      'imported_at',
    ],
    keys: ['id'],
    scope: 'code',
  },
  'public.radical': {
    columns: [
      'number',
      'character',
      'name_en',
      'name_vi',
      'meaning_vi',
      'stroke_count',
      'variants',
    ],
    keys: ['number'],
    scope: 'number',
  },
  'core.media_asset': {
    columns: [
      'id',
      'kind',
      'object_key',
      'mime',
      'bytes',
      'sha256',
      'provider',
      'source_id',
      'created_at',
    ],
    keys: ['id'],
    scope: 'object_key',
  },
  'core.kanji_media': {
    columns: ['kanji_literal', 'asset_id', 'kind', 'frame_count'],
    keys: ['kanji_literal', 'kind'],
    scope: 'kanji_literal',
  },
  'core.deck': {
    columns: [
      'id',
      'slug',
      'title',
      'description',
      'language_id',
      'level_label',
      'is_published',
      'item_count',
      'created_at',
    ],
    keys: ['id'],
    scope: 'slug',
  },
  'core.deck_item': {
    columns: ['deck_id', 'anchor_sense_id', 'concept_id', 'position'],
    keys: ['deck_id', 'anchor_sense_id'],
    scope: 'deck_id',
  },
  'staging.import_batch': {
    columns: [
      'id',
      'source_code',
      'file_name',
      'sha256',
      'row_count',
      'started_at',
      'finished_at',
      'status',
      'error',
    ],
    keys: ['id'],
    scope: 'id',
  },
  'core.mapping_run': {
    columns: [
      'id',
      'run_key',
      'task',
      'algorithm',
      'model',
      'prompt_version',
      'source_snapshot',
      'parameters',
      'status',
      'started_at',
      'finished_at',
      'rows_seen',
      'rows_accepted',
      'rows_rejected',
      'rows_unresolved',
      'error',
    ],
    keys: ['id'],
    scope: 'run_key',
  },
  'core.sense_gloss': {
    columns: [
      'id',
      'sense_id',
      'language_id',
      'text',
      'detail',
      'is_machine',
      'reviewed_by',
      'reviewed_at',
      'quality',
      'rank',
      'source_id',
      'batch_id',
    ],
    keys: ['id'],
    scope: 'batch_id',
  },
  'core.concept_gloss': {
    columns: [
      'concept_id',
      'language_id',
      'rank',
      'text',
      'is_machine',
      'quality',
      'reviewed_by',
      'reviewed_at',
      'source_id',
      'batch_id',
    ],
    keys: ['concept_id', 'language_id', 'rank'],
    scope: 'batch_id',
  },
  'core.concept_label': {
    columns: [
      'id',
      'concept_id',
      'language_id',
      'rank',
      'text',
      'label_kind',
      'is_machine',
      'quality',
      'source_id',
      'batch_id',
    ],
    keys: ['id'],
    scope: 'batch_id',
  },
} as const;

export type Table = keyof typeof tables;
export type Row = Record<string, unknown>;
export interface Snapshot {
  table: Table;
  values: (string | number)[];
  rows: Row[];
}
interface Change {
  table: Table;
  values: (string | number)[];
  before: Row[];
  after: Row[];
}

const taskTables: Record<string, Table[]> = {
  radicals: ['public.source', 'public.radical'],
  kanjivg: ['public.source', 'core.media_asset', 'core.kanji_media'],
  decks: ['core.deck', 'core.deck_item'],
  gloss: [
    'public.source',
    'staging.import_batch',
    'core.mapping_run',
    'core.sense_gloss',
    'core.concept_gloss',
    'core.concept_label',
  ],
};
const targetSchema = z
  .object({
    host: z.string(),
    port: z.string(),
    database: z.string(),
  })
  .strict();
const changeSchema = z
  .object({
    table: z.enum(Object.keys(tables) as [Table, ...Table[]]),
    values: z.array(z.union([z.string().min(1), z.number().finite()])),
    before: z.array(z.record(z.unknown())),
    after: z.array(z.record(z.unknown())),
  })
  .strict();
const journalSchema = z
  .object({
    format: z.literal(2),
    runId: z.string().uuid(),
    task: z.enum(['radicals', 'kanjivg', 'decks', 'gloss']),
    startedAt: z.string().datetime(),
    applied: z.boolean(),
    status: z.enum([
      'planning',
      'prepared',
      'applied',
      'rollback-prepared',
      'rolled-back',
      'aborted',
    ]),
    target: targetSchema,
    db: z.string(),
    inputs: z.record(z.string()).optional(),
    summary: z.record(z.unknown()),
    warnings: z.array(z.string()).optional(),
    changes: z.array(changeSchema),
  })
  .strict();
export type Journal = z.infer<typeof journalSchema>;

export function targetOf(url: string): Journal['target'] {
  const parsed = new URL(url);
  return {
    host: parsed.hostname.toLowerCase(),
    port: parsed.port || '5432',
    database: dbNameOf(url),
  };
}

/** Durable atomic replacement; never truncate the previous recovery journal. */
export function saveJournal(file: string, data: unknown): void {
  const directory = path.dirname(file);
  mkdirSync(directory, { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(data, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(temporary, file);
    const directoryFd = openSync(directory, 'r');
    try {
      fsyncSync(directoryFd);
    } finally {
      closeSync(directoryFd);
    }
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      /* renamed or already removed */
    }
  }
}

function normalize(rows: Row[]): Row[] {
  // pg returns bigint as strings; JSON roundtrip only normalizes Date to UTC ISO.
  return JSON.parse(JSON.stringify(rows)) as Row[];
}
function keyOf(table: Table, row: Row): string {
  return JSON.stringify(tables[table].keys.map((key) => row[key]));
}
function canonical(table: Table, rows: Row[]): string {
  return JSON.stringify(
    rows
      .map((row) => tables[table].columns.map((column) => row[column]))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  );
}

export async function snapshot(
  client: Client,
  table: Table,
  values: (string | number)[],
): Promise<Snapshot> {
  const spec = tables[table];
  if (values.length === 0) return { table, values, rows: [] };
  const result = await client.query<Row>(
    `SELECT ${spec.columns.map((column) => (column.endsWith('_at') ? `${column}::text AS ${column}` : column)).join(', ')} FROM ${table}
     WHERE ${spec.scope} = ANY($1) ORDER BY ${spec.keys.join(', ')} FOR UPDATE`,
    [values],
  );
  return { table, values, rows: normalize(result.rows) };
}

export function changesOf(before: Snapshot[], after: Snapshot[]): Change[] {
  if (before.length !== after.length) throw new Error('Snapshot không khớp');
  return before.map((old, i) => {
    const current = after[i];
    if (old.table !== current.table)
      throw new Error('Snapshot không khớp bảng');
    return {
      table: old.table,
      values: current.values,
      before: old.rows,
      after: current.rows,
    };
  });
}

async function lockTables(client: Client, task: string): Promise<void> {
  await client.query("SET LOCAL lock_timeout = '10s'");
  await client.query(
    `LOCK TABLE ${taskTables[task].join(', ')} IN SHARE ROW EXCLUSIVE MODE`,
  );
}

export async function applyWithJournal(
  cli: Cli,
  url: string,
  base: RunManifest,
  action: (client: Client) => Promise<Change[]>,
  persist: typeof saveJournal = saveJournal,
  journalFile?: string,
): Promise<string> {
  if (!cli.apply || !taskTables[cli.task])
    throw new Error('Apply không hợp lệ');
  assertWritableTarget(url, cli);
  const journal: Journal = {
    ...base,
    task: cli.task as Journal['task'],
    format: 2,
    runId: randomUUID(),
    applied: false,
    status: 'planning',
    target: targetOf(url),
    db: dbNameOf(url),
    changes: [],
  };
  const file =
    journalFile ??
    path.resolve(
      cli.manifestDir,
      `${base.startedAt.replace(/[:.]/g, '-')}-${cli.task}-${journal.runId}.json`,
    );
  // Permission/path/fsync failure must happen before connecting or mutating DB.
  persist(file, journal);
  log(`manifest: ${file}`);
  const client = await connect(url);
  let commitAttempted = false;
  try {
    await client.query('BEGIN');
    await lockTables(client, cli.task);
    journal.changes = await action(client);
    journal.status = 'prepared';
    persist(file, journal);
    commitAttempted = true;
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (!commitAttempted) {
      journal.status = 'aborted';
      try {
        persist(file, journal);
      } catch {
        /* keep the durable earlier state */
      }
    }
    throw error;
  } finally {
    await client.end();
  }
  journal.applied = true;
  journal.status = 'applied';
  try {
    persist(file, journal);
  } catch {
    throw new Error(
      `DB đã commit; manifest prepared còn tại ${file}. Dùng --rollback <file> --recover cùng guard để phục hồi.`,
    );
  }
  return file;
}

function validateJournal(input: unknown, cli: Cli, url: string): Journal {
  const journal = journalSchema.parse(input);
  if (
    journal.task !== cli.task ||
    journal.db !== journal.target.database ||
    JSON.stringify(journal.target) !== JSON.stringify(targetOf(url))
  ) {
    throw new Error('Manifest không khớp task/host/port/database đích');
  }
  if (
    !(journal.status === 'applied' && journal.applied) &&
    !(
      journal.status === 'prepared' &&
      !journal.applied &&
      cli.flags.get('recover') === true
    ) &&
    !(
      journal.status === 'rollback-prepared' &&
      journal.applied &&
      cli.flags.get('recover') === true
    )
  ) {
    throw new Error(
      'Chỉ rollback manifest applied; prepared cần --recover. Từ chối dry-run/legacy/aborted.',
    );
  }
  const expected = taskTables[cli.task];
  if (
    journal.changes.length !== expected.length ||
    journal.changes.some((change, i) => change.table !== expected[i])
  ) {
    throw new Error('Manifest thiếu snapshot hoặc chứa bảng ngoài task');
  }
  for (const change of journal.changes) {
    const spec = tables[change.table];
    for (const rows of [change.before, change.after]) {
      const keys = new Set<string>();
      for (const row of rows) {
        if (
          Object.keys(row).length !== spec.columns.length ||
          !spec.columns.every((column) => Object.hasOwn(row, column)) ||
          !change.values.some(
            (value) => String(value) === String(row[spec.scope]),
          ) ||
          !spec.keys.every(
            (key) =>
              typeof row[key] === 'string' || typeof row[key] === 'number',
          )
        ) {
          throw new Error(`Snapshot không hợp lệ: ${change.table}`);
        }
        const key = keyOf(change.table, row);
        if (keys.has(key)) throw new Error('Snapshot trùng khoá');
        keys.add(key);
      }
    }
  }
  return journal;
}

const retainedGlossMetadata: Table[] = [
  'public.source',
  'staging.import_batch',
  'core.mapping_run',
];
function restoredRows(journal: Journal, change: Change): Row[] {
  if (journal.task !== 'gloss' || !retainedGlossMetadata.includes(change.table))
    return change.before;
  return change.after.map((row) =>
    change.table === 'core.mapping_run'
      ? { ...row, status: 'rolled_back' }
      : row,
  );
}

async function restore(
  client: Client,
  changes: Change[],
  task: Journal['task'],
): Promise<void> {
  // Remove only rows inserted by this run, children first. Existing rows keep
  // their IDs so ON DELETE SET NULL never touches clones of an existing deck.
  for (const change of [...changes].reverse()) {
    if (task === 'gloss' && retainedGlossMetadata.includes(change.table))
      continue;
    const spec = tables[change.table];
    const beforeKeys = new Set(
      change.before.map((row) => keyOf(change.table, row)),
    );
    for (const row of change.after) {
      if (beforeKeys.has(keyOf(change.table, row))) continue;
      if (
        task === 'gloss' &&
        ['core.sense_gloss', 'core.concept_gloss'].includes(change.table)
      ) {
        const referenced = await client.query(
          "SELECT 1 FROM core.mapping_run WHERE task='db3b-gloss' AND status='completed' AND parameters->'reused' @> $1::jsonb LIMIT 1",
          [JSON.stringify([{ table: change.table, batchId: row.batch_id }])],
        );
        if (referenced.rowCount)
          throw new Error(
            'Gloss is reused by another completed job; roll that job back first',
          );
      }
      if (change.table === 'core.deck') {
        const referenced = await client.query(
          `SELECT 1 FROM app.collection WHERE cloned_from_deck_id = $1
           UNION ALL SELECT 1 FROM app.collection_item WHERE added_from_deck_id = $1 LIMIT 1`,
          [row.id],
        );
        if (referenced.rowCount)
          throw new Error('Deck đã được clone/tham chiếu; dừng rollback');
      }
      await client.query(
        `DELETE FROM ${change.table} WHERE ${spec.keys.map((key, i) => `${key} = $${i + 1}`).join(' AND ')}`,
        spec.keys.map((key) => row[key]),
      );
    }
  }
  // Parents first, then restore removed/updated children. IDs are preserved.
  for (const change of changes) {
    if (task === 'gloss' && retainedGlossMetadata.includes(change.table))
      continue;
    const spec = tables[change.table];
    const afterByKey = new Map(
      change.after.map((row) => [keyOf(change.table, row), row]),
    );
    for (const row of change.before) {
      const current = afterByKey.get(keyOf(change.table, row));
      if (
        current &&
        canonical(change.table, [row]) === canonical(change.table, [current])
      )
        continue;
      await client.query(
        `INSERT INTO ${change.table} (${spec.columns.join(', ')})
         VALUES (${spec.columns.map((_, i) => `$${i + 1}`).join(', ')})
         ON CONFLICT (${spec.keys.join(', ')}) DO UPDATE SET
         ${spec.columns
           .filter(
             (column) => !(spec.keys as readonly string[]).includes(column),
           )
           .map((column) => `${column} = EXCLUDED.${column}`)
           .join(', ')}`,
        spec.columns.map((column) => row[column]),
      );
    }
  }
  if (task === 'gloss') {
    const mapping = changes.find((c) => c.table === 'core.mapping_run')!;
    await client.query(
      "UPDATE core.mapping_run SET status = 'rolled_back' WHERE run_key = ANY($1)",
      [mapping.values],
    );
  }
}

export async function rollbackWithJournal(
  cli: Cli,
  url: string,
  file: string,
  persist: typeof saveJournal = saveJournal,
): Promise<void> {
  if (!cli.apply)
    throw new Error('Rollback yêu cầu --apply cùng --allow-db/--allow-test');
  assertWritableTarget(url, cli);
  const input: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const journal = validateJournal(input, cli, url);
  const previousStatus = journal.status;
  const previousApplied = journal.applied;
  persist(file, journal);
  const client = await connect(url);
  let commitAttempted = false;
  try {
    await client.query('BEGIN');
    await lockTables(client, cli.task);
    let matchesAfter = true;
    let matchesBefore = true;
    for (const change of journal.changes) {
      const current = await snapshot(client, change.table, change.values);
      matchesAfter &&=
        canonical(change.table, current.rows) ===
        canonical(change.table, change.after);
      matchesBefore &&=
        canonical(change.table, current.rows) ===
        canonical(change.table, restoredRows(journal, change));
    }
    if (previousStatus === 'rollback-prepared' && matchesBefore) {
      // Previous rollback committed; only its final status write was lost.
    } else {
      if (!matchesAfter)
        throw new Error(
          'Dữ liệu đã đổi sau run hoặc run chưa commit; dừng rollback',
        );
      journal.status = 'rollback-prepared';
      journal.applied = true;
      persist(file, journal);
      await restore(client, journal.changes, journal.task);
    }
    commitAttempted = true;
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (!commitAttempted) {
      journal.status = previousStatus;
      journal.applied = previousApplied;
      try {
        persist(file, journal);
      } catch {
        /* durable rollback-prepared can be recovered */
      }
    }
    throw error;
  } finally {
    await client.end();
  }
  journal.applied = false;
  journal.status = 'rolled-back';
  try {
    persist(file, journal);
  } catch {
    throw new Error(
      `Rollback đã commit; dùng --recover với manifest rollback-prepared tại ${file} để xác nhận.`,
    );
  }
  log(`rollback ${cli.task}: đã khôi phục dữ liệu trước run`);
}

/** Confirm a committed child, including the COMMIT/checkpoint failure window. */
export async function confirmJournalApplied(
  cli: Cli,
  url: string,
  file: string,
  persist: typeof saveJournal = saveJournal,
): Promise<boolean> {
  const checkedCli = { ...cli, flags: new Map(cli.flags).set('recover', true) };
  assertWritableTarget(url, checkedCli);
  const journal = validateJournal(
    JSON.parse(readFileSync(file, 'utf8')),
    checkedCli,
    url,
  );
  if (journal.status !== 'applied' && journal.status !== 'prepared')
    throw new Error('Child journal is not an apply journal');
  const client = await connect(url);
  try {
    await client.query('BEGIN');
    await lockTables(client, cli.task);
    let after = true;
    let before = true;
    for (const change of journal.changes) {
      const current = await snapshot(client, change.table, change.values);
      after &&=
        canonical(change.table, current.rows) ===
        canonical(change.table, change.after);
      before &&=
        canonical(change.table, current.rows) ===
        canonical(change.table, change.before);
    }
    if (!after && !(before && journal.status === 'prepared'))
      throw new Error(
        'Child data differs from journal; stop instead of guessing ranks',
      );
    if (after) await validateGlossJournalDependencies(client, journal);
    await client.query('COMMIT');
    journal.status = after ? 'applied' : 'aborted';
    journal.applied = after;
    persist(file, journal);
    return after;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

/** Reused rows belong to earlier jobs, so they have explicit audit references. */
export async function validateGlossJournalDependencies(
  client: Client,
  journal: Journal,
): Promise<void> {
  if (journal.task !== 'gloss') return;
  const refs = z.array(
    z
      .object({
        table: z.enum(['core.sense_gloss', 'core.concept_gloss']),
        batchId: z.string().uuid(),
        targetId: z.string().regex(/^[1-9][0-9]*$/),
        text: z.string().min(1),
        candidateKey: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
  );
  for (const run of journal.changes.find((c) => c.table === 'core.mapping_run')
    ?.after ?? []) {
    const parameters = z
      .object({ reused: refs })
      .passthrough()
      .parse(run.parameters);
    for (const ref of parameters.reused) {
      const column =
        ref.table === 'core.sense_gloss' ? 'sense_id' : 'concept_id';
      const found = await client.query(
        `SELECT 1 FROM ${ref.table} g JOIN public.language lang ON lang.id=g.language_id WHERE g.batch_id=$1 AND g.${column}=$2 AND g.text=$3 AND lang.code='vi'`,
        [ref.batchId, ref.targetId, ref.text],
      );
      if (!found.rowCount)
        throw new Error(
          'Reused gloss lineage no longer matches the committed job',
        );
    }
  }
}
