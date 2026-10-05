import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Client, type QueryResult } from 'pg';
import {
  canonicalJson,
  hashGlossText,
  parseGlossCandidate,
  parseGlossJob,
  validateGlossJobCandidates,
  validateGlossReview,
  hashGlossOutput,
  computeGlossCacheKey,
  parseGlossResponseArtifact,
  type GlossCandidate,
  type GlossJob,
  type GlossReview,
} from './_gloss-types';
import {
  resolveArtifactPath,
  readArtifactJson,
  readArtifactText,
  writeArtifactJson,
  withArtifactLock,
} from './_gloss-artifacts';
import {
  applyWithJournal,
  changesOf,
  confirmJournalApplied,
  rollbackWithJournal,
  saveJournal,
  snapshot,
  targetOf,
  type Journal,
  type Table,
} from './_mutations';
import {
  assertFixtureTarget,
  assertWritableTarget,
  connect,
  parseCli,
  requireUrl,
  type Cli,
} from './_shared';

export interface GlossApplyOptions {
  url: string;
  cli: Cli;
  artifactDir: string;
  job: GlossJob;
  candidates: GlossCandidate[];
  review?: GlossReview;
  jobPath?: string;
  persistJob?: (job: GlossJob) => void;
  persistJournal?: typeof saveJournal;
}
const glossTables: Table[] = [
  'public.source',
  'staging.import_batch',
  'core.mapping_run',
  'core.sense_gloss',
  'core.concept_gloss',
  'core.concept_label',
];
const BATCH_SIZE = 50;

function guard(options: GlossApplyOptions, rollback = false): GlossJob {
  const { url, cli } = options;
  if (cli.task !== 'gloss' || !cli.apply)
    throw new Error('Gloss writes require --apply and gloss task');
  assertWritableTarget(url, cli);
  assertFixtureTarget(url, cli);
  const job = parseGlossJob(structuredClone(options.job));
  validateGlossJobCandidates(job, options.candidates);
  const target = targetOf(url);
  if (
    target.host !== job.snapshot.host.toLowerCase() ||
    Number(target.port) !== job.snapshot.port ||
    target.database !== job.snapshot.database
  )
    throw new Error(
      'Job snapshot host/port/database does not match target; IDs cannot be remapped by lemma',
    );
  if (
    !rollback &&
    (job.usage.attemptCount > job.caps.maxRequests ||
      job.usage.costUsd > job.caps.maxCostUsd ||
      (job.caps.maxTokens !== null && job.usage.tokens > job.caps.maxTokens))
  )
    throw new Error('Job exceeded its approved budget');
  return job;
}
function saveJob(options: GlossApplyOptions, job: GlossJob): void {
  parseGlossJob(job);
  if (options.persistJob) options.persistJob(job);
  else
    writeArtifactJson(options.artifactDir, options.jobPath ?? 'job.json', job);
}
function loadEvidence(options: GlossApplyOptions, job: GlossJob): void {
  // Fixture evidence is synthetic; bypass requires the strict local *_test guard.
  if (options.cli.flags.get('fixture') === true) return;
  const inventory = readArtifactJson(
    options.artifactDir,
    job.snapshot.inventory.path,
    job.snapshot.inventory.sha256,
  ) as { summary?: { fingerprint?: { dataset_digest?: string } } };
  if (
    inventory.summary?.fingerprint?.dataset_digest !==
    job.snapshot.datasetFingerprint
  )
    throw new Error('Inventory artifact is not the job dataset');
  for (const candidate of options.candidates.filter((c) =>
    job.entries.some((e) => e.candidateKey === c.candidateKey),
  )) {
    for (const source of candidate.sources) {
      if (source.audit.status !== 'verified')
        throw new Error('Source audit is blocked');
      for (const evidence of source.audit.evidence)
        readArtifactJson(options.artifactDir, evidence.path, evidence.sha256);
    }
  }
  for (const entry of job.entries) {
    if (!['validated', 'applied'].includes(entry.state)) continue;
    const response = [...entry.attempts]
      .reverse()
      .find((a) => a.outcome === 'response')?.response;
    const candidate = options.candidates.find(
      (c) => c.candidateKey === entry.candidateKey,
    )!;
    const cacheKey = computeGlossCacheKey(candidate, job.provider);
    if (!response && entry.attemptCount !== 0)
      throw new Error('Validated machine output needs a response artifact');
    const artifact = parseGlossResponseArtifact(
      response
        ? readArtifactJson(options.artifactDir, response.path, response.sha256)
        : readArtifactJson(options.artifactDir, `cache/${cacheKey}.json`),
    );
    if (
      (response && artifact.jobKey !== job.jobKey) ||
      artifact.candidateKey !== entry.candidateKey ||
      artifact.inputHash !== entry.inputHash ||
      artifact.cacheKey !== cacheKey ||
      !artifact.output ||
      artifact.validationError !== null ||
      hashGlossOutput(artifact.output) !== hashGlossOutput(entry.output!)
    )
      throw new Error('Machine response does not bind to job input/output');
  }
}

/** Check source identity and every original context row again inside the write transaction. */
export async function assertGlossCandidateTarget(
  client: Client,
  candidate: GlossCandidate,
): Promise<void> {
  if (
    candidate.classification !== 'needs_translation' &&
    candidate.classification !== 'eligible_source'
  )
    throw new Error('Candidate is not apply eligible');
  const target = candidate.target;
  if (target.targetType === 'sense') {
    const result = await client.query<Record<string, unknown>>(
      `SELECT s.lexeme_id::text, s.sense_no, s.external_id, s.register, s.domain, s.is_primary, l.lemma, l.reading, l.pos, l.attributes, lang.code AS language,(SELECT MAX(source_level)::int FROM core.jlpt_link WHERE lexeme_id=l.id AND status='accepted') AS jlpt_level FROM core.sense s JOIN core.lexeme l ON l.id=s.lexeme_id JOIN public.language lang ON lang.id=l.language_id WHERE s.id=$1 FOR UPDATE OF s,l`,
      [target.targetId],
    );
    const row = result.rows[0];
    if (
      !row ||
      row.lexeme_id !== target.lexemeId ||
      row.sense_no !== target.senseNo ||
      row.external_id !== target.semanticKey ||
      row.lemma !== target.lemma ||
      row.reading !== target.reading ||
      row.pos !== target.pos ||
      row.language !== target.language ||
      row.register !== target.register ||
      row.domain !== target.domain ||
      row.is_primary !== target.isPrimary
    )
      throw new Error('Sense source identity or target metadata has changed');
    const forms = new Set<string>();
    const push = (value: unknown) => {
      if (typeof value === 'string' && value.trim()) forms.add(value.trim());
    };
    push(row.lemma);
    push(row.reading);
    if (
      typeof row.attributes === 'object' &&
      row.attributes !== null &&
      !Array.isArray(row.attributes)
    ) {
      const attributes = row.attributes as Record<string, unknown>;
      for (const key of ['kanji', 'kana']) {
        const items = attributes[key];
        if (Array.isArray(items))
          for (const item of items as unknown[]) {
            if (typeof item === 'object' && item !== null)
              push((item as Record<string, unknown>).text);
          }
      }
    }
    if (
      canonicalJson([...forms].sort()) !==
      canonicalJson([...new Set(target.forms)].sort())
    )
      throw new Error('Target forms changed since harvest');
    if (target.jlptLevel !== null && row.jlpt_level !== target.jlptLevel)
      throw new Error('Canonical accepted JLPT level changed since harvest');
  } else {
    const result = await client.query<Record<string, unknown>>(
      'SELECT ili FROM core.concept WHERE id=$1 FOR UPDATE',
      [target.targetId],
    );
    if (!result.rows.length || result.rows[0].ili !== target.ili)
      throw new Error('Concept target identity has changed');
    if (!target.ili && !target.synsetKeys.length)
      throw new Error('Concept needs ILI or known synset identity');
    if (target.synsetKeys.length) {
      const synsets = await client.query<{ key: string }>(
        "SELECT lexicon || ':' || synset_id AS key FROM core.wordnet_synset WHERE concept_id=$1",
        [target.targetId],
      );
      const known = new Set(synsets.rows.map((r) => r.key));
      if (target.synsetKeys.some((key) => !known.has(key)))
        throw new Error('Concept synset identity does not match target');
    }
  }
  for (const source of candidate.sources) {
    const result = await client.query<Record<string, unknown>>(
      'SELECT id,version,sha256,license,attribution,url FROM public.source WHERE code=$1',
      [source.code],
    );
    const row = result.rows[0];
    if (
      !row ||
      row.id !== source.sourceId ||
      row.version !== source.version ||
      row.sha256 !== source.sha256 ||
      row.license !== source.license ||
      row.attribution !== source.attribution ||
      row.url !== source.url
    )
      throw new Error('Original source metadata has changed');
    if (source.batchIds.length) {
      const batches = await client.query<Record<string, unknown>>(
        'SELECT id FROM staging.import_batch WHERE id=ANY($1::uuid[]) AND source_code=$2',
        [source.batchIds, source.code],
      );
      if (batches.rows.length !== source.batchIds.length)
        throw new Error('Original source batch lineage does not match');
    }
  }
  for (const context of candidate.context?.rows ?? []) {
    let result: QueryResult<Record<string, unknown>>;
    if (context.kind === 'sense_gloss') {
      result = await client.query<Record<string, unknown>>(
        `SELECT g.text,g.sense_id::text,g.rank,g.batch_id::text,src.code AS source_code,lang.code AS language FROM core.sense_gloss g JOIN public.language lang ON lang.id=g.language_id LEFT JOIN public.source src ON src.id=g.source_id WHERE g.id=$1`,
        [context.glossId],
      );
      const row = result.rows[0];
      if (
        !row ||
        row.sense_id !== context.senseId ||
        row.rank !== context.rank ||
        row.language !== context.language
      )
        throw new Error('Context gloss identity has changed');
    } else if (context.kind === 'sense_definition') {
      result = await client.query<Record<string, unknown>>(
        `SELECT s.definition AS text,s.batch_id::text,src.code AS source_code,lang.code AS language FROM core.sense s LEFT JOIN public.source src ON src.id=s.source_id LEFT JOIN public.language lang ON lang.id=s.definition_language_id WHERE s.id=$1`,
        [context.senseId],
      );
    } else {
      // concept context definitions are explicitly the English concept cache.
      if (context.language !== 'en')
        throw new Error(
          'Only grounded English concept definitions are supported',
        );
      result = await client.query<Record<string, unknown>>(
        `SELECT c.gloss_en AS text,c.batch_id::text,src.code AS source_code,'en'::text AS language FROM core.concept c LEFT JOIN public.source src ON src.id=c.source_id WHERE c.id=$1`,
        [context.conceptId],
      );
    }
    const row = result.rows[0];
    if (
      !row ||
      row.text !== context.text ||
      row.language !== context.language ||
      row.source_code !== context.sourceCode ||
      row.batch_id !== context.batchId
    )
      throw new Error('Context content/source has changed since harvest');
  }
  if (
    target.targetType === 'sense' &&
    candidate.context?.context_kind === 'sense_gloss_en'
  ) {
    const all = await client.query<Record<string, unknown>>(
      `SELECT g.id::text FROM core.sense_gloss g JOIN public.language lang ON lang.id=g.language_id WHERE g.sense_id=$1 AND lang.code='en' ORDER BY g.rank,g.id`,
      [target.targetId],
    );
    const expected = candidate.context.rows.map((r) =>
      r.kind === 'sense_gloss' ? r.glossId : 'invalid',
    );
    if (canonicalJson(all.rows.map((r) => r.id)) !== canonicalJson(expected))
      throw new Error('Ordered EN context is incomplete or has changed');
  }
}

async function appendChild(
  client: Client,
  options: GlossApplyOptions,
  job: GlossJob,
  child: GlossJob['children'][number],
  entries: GlossJob['entries'],
  batchId: string,
) {
  const sourceCode = `db3b-ai-${job.jobKey}`;
  const scopes: (string | number)[][] = [
    [sourceCode],
    [batchId],
    [child.runKey],
    [batchId],
    [batchId],
    [batchId],
  ];
  const before = [];
  for (let i = 0; i < glossTables.length; i++)
    before.push(await snapshot(client, glossTables[i], scopes[i]));
  if (before[2].rows.length)
    throw new Error(
      'Run already exists but no confirmed matching journal; stop',
    );
  let sourceId: number;
  const source = before[0].rows[0];
  const licenses = [
    ...new Set(
      options.candidates
        .filter((c) =>
          job.entries.some((e) => e.candidateKey === c.candidateKey),
        )
        .flatMap((c) => c.sources.map((s) => s.license)),
    ),
  ].join('; ');
  if (source) {
    if (
      source.sha256 !== job.jobKey ||
      source.version !== job.provider.promptVersion
    )
      throw new Error('Derived source identity conflicts with job');
    sourceId = Number(source.id);
  } else {
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO public.source(id,code,name,license,attribution,url,version,sha256) SELECT COALESCE(MAX(id),0)+1,$1,'DB3-B Vietnamese machine gloss',$2,$3,$4,$5,$6 FROM public.source RETURNING id`,
      [
        sourceCode,
        licenses,
        `Machine translation; original sources and licenses are recorded in job ${job.jobKey}; ${job.provider.name}/${job.provider.model}`,
        job.provider.baseUrl,
        job.provider.promptVersion,
        job.jobKey,
      ],
    );
    sourceId = inserted.rows[0].id;
  }
  const payload = entries.map((entry) => ({
    candidate: options.candidates.find(
      (c) => c.candidateKey === entry.candidateKey,
    )!,
    output: entry.output!,
  }));
  await client.query<Record<string, unknown>>(
    `INSERT INTO staging.import_batch(id,source_code,file_name,sha256,row_count,finished_at,status) VALUES($1,$2,$3,$4,$5,now(),'completed')`,
    [batchId, sourceCode, child.journalPath, child.inputHash, entries.length],
  );
  const mapping = await client.query<Record<string, unknown>>(
    `INSERT INTO core.mapping_run(run_key,task,algorithm,model,prompt_version,source_snapshot,parameters,status,finished_at,rows_seen,rows_accepted) VALUES($1,'db3b-gloss','gloss-append-v1',$2,$3,$4,$5,'completed',now(),$6,$6) RETURNING id`,
    [
      child.runKey,
      job.provider.model,
      job.provider.promptVersion,
      JSON.stringify(job.snapshot),
      JSON.stringify({
        jobKey: job.jobKey,
        inputHash: child.inputHash,
        batchId,
        entries: payload,
      }),
      entries.length,
    ],
  );
  const vi = await client.query<Record<string, unknown>>(
    "SELECT id FROM public.language WHERE code='vi'",
  );
  if (vi.rowCount !== 1) throw new Error('Vietnamese language is missing');
  const reusedLineage: {
    table: string;
    batchId: string;
    targetId: string;
    text: string;
    candidateKey: string;
  }[] = [];
  for (const { candidate, output } of payload) {
    await assertGlossCandidateTarget(client, candidate);
    const target = candidate.target!;
    const normalized = output.gloss_vi!.normalize('NFC').trim();
    if (!normalized) throw new Error('Normalized gloss is empty');
    const table =
      target.targetType === 'sense' ? 'core.sense_gloss' : 'core.concept_gloss';
    const column = target.targetType === 'sense' ? 'sense_id' : 'concept_id';
    // Table and column are selected only from fixed variants, never from artifact SQL.
    const reused = await client.query<{ batch_id: string }>(
      `SELECT g.batch_id::text FROM core.mapping_run run CROSS JOIN LATERAL jsonb_array_elements(run.parameters->'entries') item JOIN ${table} g ON g.batch_id=(run.parameters->>'batchId')::uuid WHERE run.task='db3b-gloss' AND run.status='completed' AND item->'candidate'->>'candidateKey'=$1 AND item->'candidate'->>'inputHash'=$2 AND normalize(btrim(item->'output'->>'gloss_vi'),NFC)=$3 AND g.${column}=$4 AND g.language_id=$5 AND g.text=$3 LIMIT 1`,
      [
        candidate.candidateKey,
        candidate.inputHash,
        normalized,
        target.targetId,
        vi.rows[0].id,
      ],
    );
    if (reused.rowCount) {
      reusedLineage.push({
        table,
        batchId: reused.rows[0].batch_id,
        targetId: target.targetId,
        text: normalized,
        candidateKey: candidate.candidateKey,
      });
      continue;
    }
    const rank = await client.query<Record<string, unknown>>(
      `SELECT COALESCE(MAX(rank),0)+1 AS next FROM ${table} WHERE ${column}=$1 AND language_id=$2`,
      [target.targetId, vi.rows[0].id],
    );
    if (Number(rank.rows[0].next) > 32767)
      throw new Error('Gloss rank has exhausted smallint');
    await client.query<Record<string, unknown>>(
      `INSERT INTO ${table}(${column},language_id,text,is_machine,quality,reviewed_by,reviewed_at,rank,source_id,batch_id) VALUES($1,$2,$3,true,NULL,NULL,NULL,$4,$5,$6)`,
      [
        target.targetId,
        vi.rows[0].id,
        normalized,
        rank.rows[0].next,
        sourceId,
        batchId,
      ],
    );
  }
  await client.query(
    "UPDATE core.mapping_run SET parameters=parameters || jsonb_build_object('reused',$2::jsonb) WHERE run_key=$1",
    [child.runKey, JSON.stringify(reusedLineage)],
  );
  if (!mapping.rows.length) throw new Error('Missing run audit metadata');
  const after = [];
  for (let i = 0; i < glossTables.length; i++)
    after.push(await snapshot(client, glossTables[i], scopes[i]));
  return changesOf(before, after);
}

export async function applyGlossJob(
  options: GlossApplyOptions,
): Promise<GlossJob> {
  const job = guard(options);
  loadEvidence(options, job);
  const fixture = options.cli.flags.get('fixture') === true;
  if (!fixture && !options.review)
    throw new Error('Human pilot review gate is required before apply');
  if (options.review)
    validateGlossReview(job, options.candidates, options.review);
  const accepted = options.review
    ? new Set(
        options.review.entries
          .filter((e) => e.verdict === 'pass')
          .map((e) => e.candidateKey),
      )
    : new Set(job.entries.map((e) => e.candidateKey));
  const persist = options.persistJournal ?? saveJournal;
  // Never recalculate chunks from pending entries: the registration order is durable.
  for (const child of job.children) {
    const file = resolveArtifactPath(options.artifactDir, child.journalPath);
    const entries = job.entries.filter((e) => e.childRunKey === child.runKey);
    if (
      !entries.length ||
      hashGlossText(
        canonicalJson(
          entries.map((e) => ({
            key: e.candidateKey,
            inputHash: e.inputHash,
            output: e.output,
          })),
        ),
      ) !== child.inputHash
    )
      throw new Error('Registered child payload does not match job');
    if (child.state === 'rolled_back')
      throw new Error(
        'Rolled-back job must not be reapplied; create an explicitly new job',
      );
    if (existsSync(file)) {
      const raw = readArtifactJson(
        options.artifactDir,
        child.journalPath,
      ) as Journal;
      if (
        raw.inputs?.runKey !== child.runKey ||
        raw.inputs?.inputHash !== child.inputHash ||
        raw.summary.jobKey !== job.jobKey
      )
        throw new Error('Child journal identity mismatch');
      if (!['planning', 'aborted'].includes(raw.status)) {
        if (
          await confirmJournalApplied(options.cli, options.url, file, persist)
        ) {
          child.state = 'applied';
          for (const entry of entries) entry.state = 'applied';
          saveJob(options, job);
          continue;
        }
      }
    } else if (child.state === 'applied' || child.state === 'prepared') {
      throw new Error('Committed child journal is missing; stop');
    }
    const batchId = randomUUID();
    const cli = { ...options.cli, manifestDir: path.dirname(file) };
    await applyWithJournal(
      cli,
      options.url,
      {
        task: 'gloss',
        startedAt: new Date().toISOString(),
        applied: false,
        inputs: { inputHash: child.inputHash, runKey: child.runKey },
        summary: { jobKey: job.jobKey, batchId },
      },
      (client) => appendChild(client, options, job, child, entries, batchId),
      persist,
      file,
    );
    child.state = 'applied';
    for (const entry of entries) entry.state = 'applied';
    saveJob(options, job);
  }
  const pending = job.entries.filter(
    (e) =>
      e.childRunKey === null &&
      e.state === 'validated' &&
      accepted.has(e.candidateKey),
  );
  if (
    job.entries.some(
      (e) => !['validated', 'applied', 'rejected'].includes(e.state),
    )
  )
    throw new Error('Job translation is not complete');
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const entries = pending.slice(i, i + BATCH_SIZE);
    const inputHash = hashGlossText(
      canonicalJson(
        entries.map((e) => ({
          key: e.candidateKey,
          inputHash: e.inputHash,
          output: e.output,
        })),
      ),
    );
    const runKey = `db3b:${job.jobKey}:${job.children.length}`;
    const child: GlossJob['children'][number] = {
      runKey,
      journalPath: `journals/${job.jobKey}-${job.children.length}.json`,
      inputHash,
      state: 'registered',
    };
    job.children.push(child);
    for (const entry of entries) entry.childRunKey = runKey;
    saveJob(options, job); // Crucially before creating a journal or opening the transaction.
    // Registered children use the same recovery path on initial apply and resume.
    return applyGlossJob({ ...options, job });
  }
  return job;
}

export async function rollbackGlossJob(
  options: GlossApplyOptions,
): Promise<GlossJob> {
  const job = guard(options, true);
  const persist = options.persistJournal ?? saveJournal;
  for (const child of [...job.children].reverse()) {
    const file = resolveArtifactPath(options.artifactDir, child.journalPath);
    let raw = existsSync(file)
      ? (readArtifactJson(options.artifactDir, child.journalPath) as Journal)
      : undefined;
    if (!raw || ['planning', 'aborted'].includes(raw.status)) {
      const client = await connect(options.url);
      try {
        const run = await client.query<Record<string, unknown>>(
          'SELECT 1 FROM core.mapping_run WHERE run_key=$1',
          [child.runKey],
        );
        if (run.rowCount || child.state === 'applied')
          throw new Error('Committed child recovery journal is missing');
      } finally {
        await client.end();
      }
      if (!raw) {
        raw = {
          format: 2,
          runId: randomUUID(),
          task: 'gloss',
          startedAt: new Date().toISOString(),
          applied: false,
          status: 'rolled-back',
          target: targetOf(options.url),
          db: job.snapshot.database,
          inputs: { runKey: child.runKey, inputHash: child.inputHash },
          summary: { jobKey: job.jobKey, neverCommitted: true },
          changes: [],
        };
      }
      raw.status = 'rolled-back';
      raw.applied = false;
      raw.summary.neverCommitted = true;
      raw.changes = [];
      persist(file, raw);
    }
    if (
      raw.inputs?.runKey !== child.runKey ||
      raw.inputs?.inputHash !== child.inputHash
    )
      throw new Error('Rollback child identity mismatch');
    if (child.state === 'rolled_back') {
      if (raw.status !== 'rolled-back')
        throw new Error('Rollback checkpoint disagrees with journal');
      continue;
    }
    if (
      raw.status === 'prepared' &&
      !(await confirmJournalApplied(options.cli, options.url, file, persist))
    ) {
      raw.status = 'rolled-back';
      raw.applied = false;
      raw.summary.neverCommitted = true;
      raw.changes = [];
      persist(file, raw);
    }
    if (raw.status !== 'rolled-back') {
      const cli = {
        ...options.cli,
        flags: new Map(options.cli.flags).set('recover', true),
      };
      await rollbackWithJournal(cli, options.url, file, persist);
    }
    child.state = 'rolled_back';
    for (const entry of job.entries.filter(
      (e) => e.childRunKey === child.runKey,
    ))
      entry.state = 'validated';
    saveJob(options, job);
  }
  return job;
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const cli = parseCli('gloss', args);
  const root = path.resolve(
    String(cli.flags.get('artifact-dir') ?? 'uploads/db3b'),
  );
  const jobPath = String(cli.flags.get('job') ?? 'job.json');
  if (
    cli.flags.has('rollback') &&
    (!cli.apply || cli.flags.get('rollback') !== jobPath)
  )
    throw new Error(
      'Rollback requires --apply --rollback <same relative path as --job>',
    );
  const candidatesPath = String(
    cli.flags.get('candidates') ?? 'candidates.jsonl',
  );
  const candidates = readArtifactText(root, candidatesPath)
    .split('\n')
    .filter((s) => s.trim())
    .map((s) => parseGlossCandidate(JSON.parse(s)));
  const job = parseGlossJob(readArtifactJson(root, jobPath));
  validateGlossJobCandidates(job, candidates);
  if (!cli.apply) {
    console.log(
      JSON.stringify({
        dryRun: true,
        jobKey: job.jobKey,
        validated: job.entries.filter((e) => e.state === 'validated').length,
      }),
    );
    return;
  }
  await withArtifactLock(root, 'job', async () => {
    const currentJob = parseGlossJob(readArtifactJson(root, jobPath));
    const reviewPath = String(cli.flags.get('review') ?? 'review.json');
    const review =
      !cli.flags.has('rollback') && cli.flags.get('fixture') !== true
        ? (readArtifactJson(root, reviewPath) as GlossReview)
        : undefined;
    const options = {
      url: requireUrl(),
      cli,
      artifactDir: root,
      job: currentJob,
      candidates,
      review,
      jobPath,
    };
    const updated = cli.flags.has('rollback')
      ? await rollbackGlossJob(options)
      : await applyGlossJob(options);
    console.log(
      JSON.stringify({
        jobKey: updated.jobKey,
        children: updated.children.map((c) => ({
          runKey: c.runKey,
          state: c.state,
        })),
      }),
    );
  });
}
if (require.main === module)
  main().catch(() => {
    console.error(
      'Gloss apply failed; inspect durable job/journals. Credentials are not logged.',
    );
    process.exitCode = 1;
  });
