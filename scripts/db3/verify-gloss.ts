import { Client } from 'pg';
import { canonicalJson, parseGlossJob, type GlossJob } from './_gloss-types';
import { readArtifactJson } from './_gloss-artifacts';
import {
  type Journal,
  targetOf,
  validateGlossJournalDependencies,
} from './_mutations';
import { connect, parseCli, requireUrl } from './_shared';

/** Read-only coverage/provenance audit; never changes reviewed state or cache. */
export async function verifyGloss(
  client: Client,
  job?: GlossJob,
  artifactDir?: string,
): Promise<Record<string, unknown>> {
  const coverage = await client.query<Record<string, unknown>>(
    `SELECT lang.code AS language,count(*)::text AS rows,count(DISTINCT g.sense_id)::text AS senses,count(*) FILTER (WHERE g.is_machine AND g.reviewed_by IS NULL)::text AS machine_unreviewed,count(*) FILTER (WHERE g.reviewed_by IS NOT NULL)::text AS reviewed FROM core.sense_gloss g JOIN public.language lang ON lang.id=g.language_id WHERE lang.code IN ('en','vi') GROUP BY lang.code ORDER BY lang.code`,
  );
  const anomalies = await client.query<Record<string, unknown>>(
    `SELECT count(*) FILTER (WHERE rank <= 0 OR btrim(text)='')::text AS invalid_text_rank,count(*) FILTER (WHERE (reviewed_by IS NULL) <> (reviewed_at IS NULL))::text AS invalid_review,count(*) FILTER (WHERE g.is_machine AND (g.source_id IS NULL OR g.batch_id IS NULL))::text AS machine_missing_lineage FROM core.sense_gloss g JOIN public.language lang ON lang.id=g.language_id WHERE lang.code='vi'`,
  );
  const concepts = await client.query<Record<string, unknown>>(
    `SELECT (SELECT count(*)::text FROM core.concept_gloss g JOIN public.language lang ON lang.id=g.language_id WHERE lang.code='vi') AS gloss_rows,(SELECT count(*)::text FROM core.concept_label g JOIN public.language lang ON lang.id=g.language_id WHERE lang.code='vi') AS label_rows`,
  );
  const children: Record<string, unknown>[] = [];
  let serving: Record<string, unknown> | null = null;
  if (job) {
    parseGlossJob(job);
    if (!artifactDir) throw new Error('Job verification requires artifact-dir');
    const senseIds = [
      ...new Set(
        job.entries
          .filter(
            (e) => e.state === 'applied' && e.output?.target_type === 'sense',
          )
          .map((e) => e.output!.target_id),
      ),
    ];
    const served = await client.query<Record<string, unknown>>(
      `SELECT count(*)::int AS requested,count(*) FILTER(WHERE sc.sense_id IS NULL)::int AS missing,count(*) FILTER(WHERE sc.gloss_vi IS DISTINCT FROM chosen.text OR sc.gloss_vi_machine IS DISTINCT FROM chosen.is_machine OR sc.gloss_vi_reviewed IS DISTINCT FROM (chosen.reviewed_by IS NOT NULL))::int AS incorrect_flags,count(*) FILTER(WHERE sc.gloss_vi_machine AND NOT sc.gloss_vi_reviewed)::int AS machine_unreviewed FROM unnest($1::bigint[]) requested(sense_id) LEFT JOIN serve.sense_card sc USING(sense_id) LEFT JOIN LATERAL(SELECT g.text,g.is_machine,g.reviewed_by FROM core.sense_gloss g JOIN public.language lang ON lang.id=g.language_id WHERE g.sense_id=requested.sense_id AND lang.code='vi' ORDER BY(g.reviewed_by IS NOT NULL) DESC,g.is_machine,g.rank LIMIT 1) chosen ON true`,
      [senseIds],
    );
    serving = served.rows[0];
    for (const child of job.children) {
      const run = await client.query<{
        status: string;
        parameters: { inputHash: string; jobKey: string };
      }>('SELECT status,parameters FROM core.mapping_run WHERE run_key=$1', [
        child.runKey,
      ]);
      const row = run.rows[0];
      const journal = readArtifactJson(
        artifactDir,
        child.journalPath,
      ) as Journal;
      if (
        journal.inputs?.runKey !== child.runKey ||
        journal.inputs?.inputHash !== child.inputHash ||
        journal.summary.jobKey !== job.jobKey
      )
        throw new Error('Journal child identity mismatch');
      let valid = true;
      if (child.state === 'applied')
        await validateGlossJournalDependencies(client, journal);
      if (journal.summary.neverCommitted === true) {
        children.push({
          runKey: child.runKey,
          checkpointState: child.state,
          databaseStatus: row?.status ?? null,
          valid:
            child.state === 'rolled_back' &&
            journal.status === 'rolled-back' &&
            !row,
        });
        continue;
      }
      const expectedStatus =
        child.state === 'rolled_back' ? 'rolled_back' : 'completed';
      valid &&=
        row?.status === expectedStatus &&
        row?.parameters?.inputHash === child.inputHash &&
        row?.parameters?.jobKey === job.jobKey;
      for (const change of journal.changes.filter((c) =>
        [
          'core.sense_gloss',
          'core.concept_gloss',
          'core.concept_label',
        ].includes(c.table),
      )) {
        // SQL identifiers are selected explicitly, not copied from journal columns.
        const columns =
          change.table === 'core.sense_gloss'
            ? [
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
              ]
            : change.table === 'core.concept_gloss'
              ? [
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
                ]
              : [
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
                ];
        const current = await client.query<Record<string, unknown>>(
          `SELECT ${columns.map((c) => (c.endsWith('_at') ? `${c}::text AS ${c}` : c)).join(',')} FROM ${change.table} WHERE batch_id=ANY($1::uuid[])`,
          [change.values],
        );
        const expected =
          child.state === 'rolled_back' ? change.before : change.after;
        const sort = (rows: Record<string, unknown>[]) =>
          rows.map((r) => canonicalJson(r)).sort();
        valid &&=
          canonicalJson(sort(current.rows)) === canonicalJson(sort(expected));
      }
      children.push({
        runKey: child.runKey,
        checkpointState: child.state,
        databaseStatus: row?.status ?? null,
        valid,
      });
    }
  }
  return {
    coverage: coverage.rows,
    anomalies: anomalies.rows[0],
    concepts: concepts.rows[0],
    children,
    serving,
    valid:
      children.every((c) => c.valid === true) &&
      Object.values(anomalies.rows[0]).every((count) => Number(count) === 0) &&
      (!serving || (serving.missing === 0 && serving.incorrect_flags === 0)),
  };
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const cli = parseCli('verify-gloss', args);
  if (cli.apply || cli.flags.has('rollback'))
    throw new Error('verify-gloss is read-only');
  const url = requireUrl();
  const root = String(cli.flags.get('artifact-dir') ?? 'uploads/db3b');
  const jobFlag = cli.flags.get('job');
  const job =
    typeof jobFlag === 'string'
      ? parseGlossJob(readArtifactJson(root, jobFlag))
      : undefined;
  if (job) {
    const target = targetOf(url);
    if (
      target.host !== job.snapshot.host.toLowerCase() ||
      Number(target.port) !== job.snapshot.port ||
      target.database !== job.snapshot.database
    )
      throw new Error('Verification target does not match job snapshot');
  }
  const client = await connect(url);
  try {
    await client.query<Record<string, unknown>>('BEGIN READ ONLY');
    const result = await verifyGloss(client, job, root);
    await client.query<Record<string, unknown>>('ROLLBACK');
    console.log(JSON.stringify(result, null, 2));
    if (!result.valid) process.exitCode = 1;
  } finally {
    await client.end();
  }
}
if (require.main === module)
  main().catch(() => {
    console.error(
      'Gloss verification failed; check artifact lineage and DB target.',
    );
    process.exitCode = 1;
  });
