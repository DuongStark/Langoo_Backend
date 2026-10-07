/** DB4-D0.2: bounded source backfill, immutable before-images and drift guards. */
import { createHash } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Client } from 'pg';
import { z } from 'zod';

export const PROJECTION_POLICY = 'wiktextract-en-leaf-v1';
const migration = readFileSync(
  resolve('db/migrations/038_dictionary_source_projection.sql'),
  'utf8',
);
const functionBody = migration.split('$function$')[1];
if (!functionBody) throw new Error('Missing trusted source projection SQL');
export const PROJECTION_SQL_HASH = hash(functionBody);
const inlineProjection = functionBody
  .trim()
  .replace(/;$/, '')
  .replaceAll('target_sense', 'target.id');

const contextSchema = z.object({
  sense: z
    .object({
      id: z.string(),
      lexeme_id: z.string(),
      definition: z.string().nullable(),
      definition_language_id: z.number().int().nullable(),
    })
    .passthrough(),
  lexeme: z.record(z.unknown()),
  source: z.record(z.unknown()),
  glosses: z.array(z.record(z.unknown())),
  tags: z.array(z.string()),
});
type Context = z.infer<typeof contextSchema>;
const sourceRowSchema = z.object({
  context: contextSchema,
  first_gloss: z.string(),
  leaf_gloss: z.string(),
  glosses: z.array(z.string()),
  eligible: z.boolean(),
  en_id: z.number().int(),
});
type SourceRow = z.infer<typeof sourceRowSchema>;
const recordSchema = z
  .object({
    senseId: z.string().regex(/^[1-9]\d*$/),
    decision: z.enum(['eligible', 'unchanged', 'blocked']),
    reason: z.string(),
    context: contextSchema,
    contextHash: z.string().regex(/^[a-f0-9]{64}$/),
    after: z.object({ definition: z.string(), languageId: z.number().int() }),
  })
  .strict();
export type ProjectionRecord = z.infer<typeof recordSchema>;
const manifestSchema = z
  .object({
    schema: z.literal('dictionary-source-projection-v1'),
    policy: z.literal(PROJECTION_POLICY),
    sqlHash: z.string(),
    target: z.string(),
    exportedAt: z.string(),
    snapshot: z.string(),
    afterSenseId: z.string(),
    truncated: z.boolean(),
    nextAfterSenseId: z.string(),
    records: z.array(recordSchema).max(5000),
    digest: z.string(),
  })
  .strict();
export type ProjectionManifest = z.infer<typeof manifestSchema>;

// The SQL function body in migration 038 is the same policy used on old DBs
// for read-only exports. No function installation is needed to inspect a VPS.
const sourceQuery = `
 SELECT jsonb_build_object(
   'sense', to_jsonb(target) || jsonb_build_object('id',target.id::text,'lexeme_id',target.lexeme_id::text),
   'lexeme', to_jsonb(l) || jsonb_build_object('id',l.id::text),
   'source', to_jsonb(src),
   'glosses', coalesce((SELECT jsonb_agg(to_jsonb(g) || jsonb_build_object('id',g.id::text,'sense_id',g.sense_id::text) ORDER BY g.rank,g.id)
      FROM core.sense_gloss g JOIN public.language lg ON lg.id=g.language_id
      WHERE g.sense_id=target.id AND lg.code='en'),'[]'::jsonb),
   'tags', coalesce((SELECT jsonb_agg(tag_code ORDER BY tag_code) FROM core.sense_tag WHERE sense_id=target.id),'[]'::jsonb)
 ) AS context, p.*
 FROM core.sense target JOIN core.lexeme l ON l.id=target.lexeme_id
 JOIN public.source src ON src.id=target.source_id
 CROSS JOIN LATERAL (${inlineProjection}) p(first_gloss,leaf_gloss,glosses,eligible,en_id)
 WHERE src.code='wiktextract'
`;

export function hash(value: unknown): string {
  function stable(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(stable);
    if (v !== null && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, x]) => [k, stable(x)]),
      );
    }
    return v;
  }
  return createHash('sha256')
    .update(JSON.stringify(stable(value)))
    .digest('hex');
}

function classify(row: SourceRow): ProjectionRecord {
  const before = row.context.sense;
  const owned =
    row.eligible &&
    (before.definition_language_id === null ||
      before.definition_language_id === row.en_id) &&
    (before.definition === null ||
      before.definition === row.first_gloss ||
      before.definition === row.leaf_gloss);
  const unchanged =
    before.definition === row.leaf_gloss &&
    before.definition_language_id === row.en_id;
  return {
    senseId: before.id,
    context: row.context,
    contextHash: hash(row.context),
    after: { definition: row.leaf_gloss, languageId: row.en_id },
    decision: !owned ? 'blocked' : unchanged ? 'unchanged' : 'eligible',
    reason: !row.eligible
      ? 'source_batch_rank_or_review_conflict'
      : !owned
        ? 'custom_definition_or_language'
        : unchanged
          ? 'already_projected'
          : 'source_parent_to_leaf',
  };
}

export async function exportProjection(
  client: Client,
  target: string,
  limit = 500,
  afterSenseId = '0',
): Promise<ProjectionManifest> {
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 5000 ||
    !/^\d+$/.test(afterSenseId)
  )
    throw new Error('Invalid export bounds');
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await client.query("SET LOCAL statement_timeout='60s'");
    await client.query("SET LOCAL work_mem='16MB'");
    await client.query('SET LOCAL max_parallel_workers_per_gather=0');
    const snapshot = await client.query<{ snapshot: string }>(
      'SELECT pg_current_snapshot()::text AS snapshot',
    );
    const rows = await client.query<SourceRow>(
      sourceQuery +
        `
      AND target.id > $1::bigint
      AND EXISTS (SELECT 1 FROM core.sense_gloss g JOIN public.language lg ON lg.id=g.language_id
                  WHERE g.sense_id=target.id AND lg.code='en' AND g.rank>1)
      AND p.first_gloss IS DISTINCT FROM p.leaf_gloss
      ORDER BY target.id LIMIT $2`,
      [afterSenseId, limit + 1],
    );
    const records = rows.rows
      .slice(0, limit)
      .map((r) => classify(sourceRowSchema.parse(r)));
    const body = {
      schema: 'dictionary-source-projection-v1' as const,
      policy: PROJECTION_POLICY as typeof PROJECTION_POLICY,
      sqlHash: PROJECTION_SQL_HASH,
      target,
      exportedAt: new Date().toISOString(),
      snapshot: snapshot.rows[0].snapshot,
      afterSenseId,
      truncated: rows.rows.length > limit,
      nextAfterSenseId: records.at(-1)?.senseId ?? afterSenseId,
      records,
    };
    await client.query('COMMIT');
    return { ...body, digest: hash(body) };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

export function validateManifest(value: unknown): ProjectionManifest {
  const m = manifestSchema.parse(value);
  const { digest, ...body } = m;
  if (m.sqlHash !== PROJECTION_SQL_HASH || digest !== hash(body))
    throw new Error('Manifest integrity/policy mismatch');
  const ids = new Set<string>();
  for (const r of m.records) {
    if (
      r.senseId !== r.context.sense.id ||
      r.contextHash !== hash(r.context) ||
      ids.has(r.senseId)
    )
      throw new Error('Record identity/hash mismatch');
    ids.add(r.senseId);
  }
  return m;
}

export function writeImmutableJson(file: string, value: unknown): void {
  const fd = openSync(file, 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value, null, 2) + '\n');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const dir = openSync(dirname(resolve(file)), 'r');
  try {
    fsyncSync(dir);
  } finally {
    closeSync(dir);
  }
}

function afterContext(r: ProjectionRecord): Context {
  return {
    ...r.context,
    sense: {
      ...r.context.sense,
      definition: r.after.definition,
      definition_language_id: r.after.languageId,
    },
  };
}

/** One bounded manifest is one transaction; a prepared journal is sufficient
 * for conditional rollback even if the process crashes after COMMIT. */
export async function mutateProjection(
  client: Client,
  input: unknown,
  target: string,
  journalFile: string,
  mode: 'apply' | 'rollback',
): Promise<{ changed: number; unchanged: number }> {
  const m = validateManifest(input);
  if (target !== m.target) throw new Error('Manifest database target mismatch');
  writeImmutableJson(journalFile, {
    schema: 'dictionary-projection-journal-v1',
    mode,
    preparedAt: new Date().toISOString(),
    manifest: m,
  });
  let changed = 0,
    unchanged = 0;
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  try {
    await client.query("SET LOCAL statement_timeout='30s'");
    await client.query("SET LOCAL lock_timeout='2s'");
    const installed = await client.query<{ body: string }>(
      "SELECT prosrc AS body FROM pg_proc WHERE oid=to_regprocedure('core.wiktextract_en_projection(bigint)')",
    );
    if (
      installed.rows.length !== 1 ||
      hash(installed.rows[0].body) !== PROJECTION_SQL_HASH
    )
      throw new Error('Projection migration 038 missing or policy differs');
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('langoo-dictionary-source-projection'))",
    );
    for (const r of [...m.records]
      .filter((r) => r.decision === 'eligible')
      .sort((a, b) => (BigInt(a.senseId) < BigInt(b.senseId) ? -1 : 1))) {
      await client.query(
        'SELECT id FROM core.sense WHERE id=$1::bigint FOR UPDATE',
        [r.senseId],
      );
      const rows = await client.query<SourceRow>(
        sourceQuery + ' AND target.id=$1::bigint',
        [r.senseId],
      );
      if (rows.rows.length !== 1)
        throw new Error('Missing source row: ' + r.senseId);
      const current = sourceRowSchema.parse(rows.rows[0]);
      const currentHash = hash(current.context),
        afterHash = hash(afterContext(r));
      const expected = mode === 'apply' ? r.contextHash : afterHash;
      const finished = mode === 'apply' ? afterHash : r.contextHash;
      if (currentHash === finished) {
        unchanged++;
        continue;
      }
      if (currentHash !== expected)
        throw new Error('Source drift at sense ' + r.senseId);
      // Recompute eligibility and output rather than trusting the manifest's label.
      const candidate = classify(
        mode === 'apply' ? current : { ...current, context: r.context },
      );
      if (
        candidate.decision !== 'eligible' ||
        candidate.after.definition !== r.after.definition ||
        candidate.after.languageId !== r.after.languageId
      )
        throw new Error('Projection decision mismatch: ' + r.senseId);
      const next =
        mode === 'apply'
          ? r.after
          : {
              definition: r.context.sense.definition,
              languageId: r.context.sense.definition_language_id,
            };
      await client.query(
        'UPDATE core.sense SET definition=$2,definition_language_id=$3 WHERE id=$1::bigint',
        [r.senseId, next.definition, next.languageId],
      );
      const verify = await client.query<SourceRow>(
        sourceQuery + ' AND target.id=$1::bigint',
        [r.senseId],
      );
      if (
        verify.rows.length !== 1 ||
        hash(sourceRowSchema.parse(verify.rows[0]).context) !== finished
      )
        throw new Error('Write verification mismatch');
      changed++;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
  // Never edit the prepared before-image; report file is supplementary.
  writeImmutableJson(journalFile + '.result.json', {
    mode,
    changed,
    unchanged,
    committedAt: new Date().toISOString(),
  });
  return { changed, unchanged };
}

/** CLI diagnostics retain our drift/target reasons without logging DB URLs. */
export function safeProjectionError(error: unknown): string {
  if (!(error instanceof Error)) return 'Unknown failure';
  const code = 'code' in error ? error.code : undefined;
  if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code))
    return 'Database error ' + code;
  return error.message
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[redacted database URL]')
    .slice(0, 240);
}
