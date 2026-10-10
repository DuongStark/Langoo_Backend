// DB4-D4/D5: freeze the complete selected cohort and native Muse request inputs.
// This module only reads D2 artifacts and writes immutable shadow-run artifacts.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  BatchManifest,
  BatchManifestSchema,
  BatchSchedule,
  BatchScheduleSchema,
  BatchTarget,
  BatchTargetResultSchema,
  createBatchJob,
} from './_batch-types';
import {
  AuditManifestSchema,
  ExportManifestSchema,
  RetrievalSense,
  RetrievalSenseSchema,
  SearchManifestSchema,
  SearchResultSchema,
  artifactPath,
  readArtifact,
  writeAtomicArtifact,
  writeAtomicJson,
} from './_retrieval';
import {
  ArtifactRefSchema,
  MappingBundle,
  MappingBundleSchema,
  SemanticSnapshotSchema,
  Sha256Schema,
  Text,
  canonicalJson,
  hashBytes,
  hashJson,
  parseMappingBundle,
  parseMappingCandidate,
  parseMappingBundleIntegrity,
  renderMappingBundle,
  semanticInputFingerprint,
} from './_mapping-types';
import { AUDIT_POLICY_VERSION } from './mapping-audit';
import { DECISION_POLICY_VERSION } from './_decisions';
import { CONDITIONAL_R2_POLICY_VERSION } from './muse-batch-decide';
import {
  PromptRevision,
  parsePromptRevision,
  promptFilename,
  promptVersion,
} from './muse-prompt-version';

const Count = z.number().int().nonnegative();
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
// Frozen D2 JSONL files predate the per-output-file cap. Read them by line, with
// a bounded total input size, then emit only capped per-shard run artifacts.
const MAX_FROZEN_INPUT_BYTES = 128 * 1024 * 1024;
const MAX_JSONL_ROW_BYTES = 16 * 1024 * 1024;
const Slug = z
  .string()
  .min(1)
  .max(96)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);

export const CohortTargetSchema = z
  .object({
    schemaVersion: z.literal(1),
    task: z.literal('db4_cohort_target'),
    targetKey: Sha256Schema,
    senseKey: Text,
    senseId: z.string().regex(/^[1-9][0-9]*$/),
    lexemeId: z.string().regex(/^[1-9][0-9]*$/),
    lexemeKey: Text,
    sourceRef: z
      .object({
        file: ArtifactRefSchema,
        line: z.number().int().positive(),
        rowSha256: Sha256Schema,
      })
      .strict(),
    split: z.enum(['development', 'holdout']),
    shardId: Slug,
    strata: z
      .object({
        level: z.number().int().min(1).max(5).nullable(),
        posFamily: z.enum([
          'noun',
          'verb',
          'adjective_adverb',
          'expression',
          'other',
        ]),
        glossCount: z.enum(['one', 'multiple']),
        fieldInfo: z.enum(['present', 'absent']),
        originalStatus: z.enum([
          'unlinked',
          'existing_nonexact',
          'existing_exact',
        ]),
      })
      .strict(),
    enGlossCount: Count,
    hasFieldInfo: z.boolean(),
    hasExistingExact: z.boolean(),
    originalStatus: z.enum(['unlinked', 'existing_nonexact', 'existing_exact']),
    level: z.number().int().min(1).max(5).nullable(),
    pos: z.array(Text),
  })
  .strict();
export const SamplingSchema = z.object({
  schemaVersion: z.literal(1),
  task: z.literal('db4_cohort_sampling'),
  selectorVersion: Text,
  seed: Text,
  input: z.object({
    exportManifest: ArtifactRefSchema,
    sourceSenseFile: ArtifactRefSchema,
  }),
  config: z.object({ shardTarget: Count, maxShards: Count }),
  counts: z.object({
    eligible: Count,
    selected: Count,
    development: Count,
    holdout: Count,
    shards: Count,
    shardCounts: z.record(Text, Count),
  }),
  files: z.object({
    population: ArtifactRefSchema,
    selected: ArtifactRefSchema,
  }),
  constraints: z.object({
    lexemeDisjoint: z.boolean(),
    pilotLexemesInDevelopment: z.boolean(),
    duplicateSenseKeys: z.boolean(),
    withinPlanTarget: z.boolean(),
    developmentQuotaMet: z.boolean(),
    holdoutQuotaMet: z.boolean(),
  }),
});
export const PopulationSchema = z.object({
  schemaVersion: z.literal(1),
  task: z.literal('db4_cohort_population'),
  export: z.object({ manifest: ArtifactRefSchema, senses: ArtifactRefSchema }),
  counts: z.object({ eligible: Count, selected: Count }),
});
export const GenerationStatusSchema = z
  .object({
    senseKey: Text,
    senseId: z.string().regex(/^[1-9][0-9]*$/),
    status: z.enum(['ready', 'no_candidates']),
    bundleKey: Sha256Schema.nullable(),
    reason: Text.nullable().optional(),
    candidateCount: Count.optional(),
  })
  .passthrough();
export const GenerationManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    task: z.literal('db4_retrieval_generation'),
    version: Text,
    createdAt: z.string().datetime(),
    snapshot: SemanticSnapshotSchema,
    semanticInputFingerprint: Sha256Schema,
    inputs: z
      .object({
        export: ArtifactRefSchema,
        audit: ArtifactRefSchema,
        search: ArtifactRefSchema,
      })
      .strict(),
    files: z
      .object({
        candidates: ArtifactRefSchema,
        bundles: ArtifactRefSchema,
        sourceIdentity: ArtifactRefSchema,
        status: ArtifactRefSchema,
      })
      .strict(),
    counts: z
      .object({
        senses: Count,
        candidates: Count,
        bundles: Count,
        statuses: z.record(Text, Count),
      })
      .strict(),
    apply: z.literal(false),
    semanticQualityValidated: z.literal(false),
  })
  .strict();
type CohortTarget = z.infer<typeof CohortTargetSchema>;

export type BatchPrepareOptions = {
  runId: string;
  samplingPath: string;
  generationPath: string;
  exportPath: string;
  outputPrefix: string;
  promptRevision: PromptRevision;
  promptDirectory: string;
  gitRevision: string;
  dirtySourceSha256: string | null;
  workers?: number;
  mappingDispatches?: number;
  auditDispatches?: number;
  requestTimeoutSeconds?: number;
  now?: () => string;
};

type RawLineVisitor = (line: Buffer, lineNumber: number) => void;

async function forEachRawJsonl(
  root: string,
  refValue: unknown,
  visit: RawLineVisitor,
  maxFileBytes = MAX_FROZEN_INPUT_BYTES,
): Promise<number> {
  const ref = ArtifactRefSchema.parse(refValue);
  const path = artifactPath(root, ref.path);
  const size = statSync(path).size;
  if (size > maxFileBytes)
    throw new Error(`Frozen input exceeds bounded reader: ${ref.path}`);

  const hash = createHash('sha256');
  const input = createReadStream(path, { highWaterMark: 256 * 1024 });
  let pending: Uint8Array = new Uint8Array(0);
  let lineNumber = 0;
  for await (const chunk of input) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    hash.update(bytes);
    pending = pending.length
      ? Buffer.concat([Buffer.from(pending), bytes])
      : bytes;
    let start = 0;
    for (;;) {
      const end = pending.indexOf(0x0a, start);
      if (end < 0) break;
      const line = pending.subarray(start, end);
      if (!line.length || line.length > MAX_JSONL_ROW_BYTES)
        throw new Error(`Invalid/oversized row in ${ref.path}`);
      if (line.at(-1) === 0x0d)
        throw new Error(`CRLF JSONL is not accepted: ${ref.path}`);
      visit(Buffer.from(line), ++lineNumber);
      start = end + 1;
    }
    pending = pending.subarray(start);
    if (pending.length > MAX_JSONL_ROW_BYTES)
      throw new Error(`Oversized JSONL row in ${ref.path}`);
  }
  if (pending.length)
    throw new Error(`JSONL must end with a newline: ${ref.path}`);
  if (hash.digest('hex') !== ref.sha256)
    throw new Error(`Artifact hash mismatch: ${ref.path}`);
  return lineNumber;
}

function jsonLines<T>(bytes: Buffer, schema: z.ZodType<T>, label: string): T[] {
  const text = bytes.toString('utf8');
  if (!text.endsWith('\n')) throw new Error(`${label} must end with a newline`);
  const lines = text.slice(0, -1).split('\n');
  if (lines.some((line) => !line)) throw new Error(`${label} has a blank row`);
  return lines.map((line) => schema.parse(JSON.parse(line) as unknown));
}

function writeCappedJsonl(root: string, path: string, rows: unknown[]) {
  const bytes = rows.map((row) => JSON.stringify(row) + '\n').join('');
  if (Buffer.byteLength(bytes) > MAX_ARTIFACT_BYTES)
    throw new Error(`Batch output exceeds 64 MiB: ${path}`);
  return writeAtomicArtifact(root, path, bytes);
}

function writeCappedJsonlText(root: string, path: string, bytes: string) {
  if (Buffer.byteLength(bytes) > MAX_ARTIFACT_BYTES)
    throw new Error(`Batch output exceeds 64 MiB: ${path}`);
  return writeAtomicArtifact(root, path, bytes);
}

function readJson(
  root: string,
  path: string,
): { bytes: Buffer; value: unknown } {
  const bytes = readFileSync(artifactPath(root, path));
  return { bytes, value: JSON.parse(bytes.toString('utf8')) as unknown };
}

function ensureImmutableIntent(
  root: string,
  path: string,
  identity: Record<string, unknown>,
  now: () => string,
) {
  const fullPath = artifactPath(root, path);
  if (existsSync(fullPath)) {
    const existing = JSON.parse(readFileSync(fullPath, 'utf8')) as {
      createdAt?: unknown;
      identity?: unknown;
    };
    if (canonicalJson(existing.identity) !== canonicalJson(identity))
      throw new Error('Existing prepare intent has different input identity');
    const createdAt = z.string().datetime().parse(existing.createdAt);
    return {
      createdAt,
      ref: { path, sha256: hashBytes(readFileSync(fullPath)) },
    };
  }
  const createdAt = z.string().datetime().parse(now());
  const value = {
    schemaVersion: 1,
    task: 'db4_batch_prepare_intent',
    runId: identity.runId,
    createdAt,
    identity,
  };
  return {
    createdAt,
    ref: writeAtomicJson(root, path, value),
  };
}

export function verifySourceSenseRows(
  root: string,
  sourceRef: z.infer<typeof ArtifactRefSchema>,
  targets: CohortTarget[],
): Promise<Map<string, RetrievalSense>> {
  const byLine = new Map<number, CohortTarget>();
  for (const target of targets) {
    if (
      target.sourceRef.file.path !== sourceRef.path ||
      target.sourceRef.file.sha256 !== sourceRef.sha256
    )
      throw new Error('Selected target references another source sense file');
    if (byLine.has(target.sourceRef.line))
      throw new Error('Selected source sense line is duplicated');
    byLine.set(target.sourceRef.line, target);
  }
  const senses = new Map<string, RetrievalSense>();
  return forEachRawJsonl(root, sourceRef, (line, lineNumber) => {
    const target = byLine.get(lineNumber);
    if (!target) return;
    const withNewline = Buffer.concat([line, Buffer.from('\n')]);
    if (hashBytes(withNewline) !== target.sourceRef.rowSha256)
      throw new Error(`Cohort source row hash mismatch at line ${lineNumber}`);
    const sense = RetrievalSenseSchema.parse(
      JSON.parse(line.toString('utf8')) as unknown,
    );
    if (
      sense.sense.id !== target.senseId ||
      sense.sense.lexemeId !== target.lexemeId ||
      sense.sense.identity?.senseKey !== target.senseKey ||
      sense.sense.identity?.externalId !== target.lexemeKey
    )
      throw new Error(
        `Selected source identity mismatch at line ${lineNumber}`,
      );
    if (senses.has(target.targetKey))
      throw new Error('Duplicate selected target key');
    senses.set(target.targetKey, sense);
  }).then((rows) => {
    if (rows < Math.max(...byLine.keys()))
      throw new Error('Selected source line is outside the frozen sense file');
    return senses;
  });
}

function sourceRevision(repoRoot: string) {
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  const files = [
    'scripts/db4/_batch-types.ts',
    'scripts/db4/_decisions.ts',
    'scripts/db4/_mapping-types.ts',
    'scripts/db4/_retrieval.ts',
    'scripts/db4/batch-preflight.ts',
    'scripts/db4/batch-prepare.ts',
    'scripts/db4/batch-report.ts',
    'scripts/db4/batch-validate.ts',
    'scripts/db4/cohort-select.ts',
    'scripts/db4/mapping-audit.ts',
    'scripts/db4/muse-batch-runner.py',
    'scripts/db4/muse-batch-decide.ts',
    'scripts/db4/muse-prompt-version.ts',
    'scripts/db4/muse-review-decide.ts',
    'scripts/ops/db4-batch/run-shadow.py',
    'docs/prompts/db4-d4-semantic-match-v2.1.r1.txt',
    'docs/prompts/db4-d4-semantic-match-v2.1.r2.txt',
    'docs/prompts/db4-d4-semantic-match-v2.1.system.txt',
  ];
  const dirty = files.flatMap((path) => {
    const current = readFileSync(resolve(repoRoot, path));
    let committed: Buffer | null = null;
    try {
      committed = execFileSync('git', ['show', `HEAD:${path}`], {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      // A new, uncommitted file is part of the dirty source fingerprint.
    }
    const currentHash = hashBytes(current);
    return committed && hashBytes(committed) === currentHash
      ? []
      : [{ path, sha256: currentHash }];
  });
  return {
    revision,
    dirtySourceSha256: dirty.length ? hashJson(dirty) : null,
  };
}

export function requireSourceAudit(
  bundle: MappingBundle,
  audit: z.infer<typeof AuditManifestSchema>,
) {
  const auditedByKey = new Map(
    audit.sources.map((source) => [source.key, source]),
  );
  for (const candidate of bundle.candidates) {
    for (const source of candidate.sources) {
      const audited = auditedByKey.get(source.key);
      if (!audited || audited.audit.status !== 'verified')
        throw new Error(
          `Bundle uses a source not verified for this run: ${source.key}`,
        );
      if (
        canonicalJson([
          source.code,
          source.version,
          source.sha256,
          source.license,
          source.attribution,
          source.url,
        ]) !==
        canonicalJson([
          audited.code,
          audited.version,
          audited.sha256,
          audited.license,
          audited.attribution,
          audited.url,
        ])
      )
        throw new Error(
          `Bundle source identity differs from audit: ${source.key}`,
        );
    }
  }
}

export async function prepareAutomatedBatch(
  root: string,
  options: BatchPrepareOptions,
) {
  const runId = Slug.parse(options.runId);
  const prefix = options.outputPrefix;
  artifactPath(root, `${prefix}/run-manifest.json`);
  const workers = options.workers ?? 8;
  const mappingDispatches = options.mappingDispatches ?? 5000;
  const auditDispatches = options.auditDispatches ?? 250;
  const requestTimeoutSeconds = options.requestTimeoutSeconds ?? 240;
  z.number().int().min(1).max(8).parse(workers);
  z.number().int().min(1).max(5000).parse(mappingDispatches);
  z.number().int().min(0).max(250).parse(auditDispatches);
  z.number().int().min(30).max(240).parse(requestTimeoutSeconds);
  z.string()
    .regex(/^[0-9a-f]{7,40}$/)
    .parse(options.gitRevision);
  if (options.dirtySourceSha256 !== null)
    Sha256Schema.parse(options.dirtySourceSha256);
  const sourceRevisionHash = {
    revision: options.gitRevision,
    dirtySourceSha256: options.dirtySourceSha256,
  };

  const samplingFile = readJson(root, options.samplingPath);
  const samplingBytes = samplingFile.bytes;
  const samplingRef = {
    path: options.samplingPath,
    sha256: hashBytes(samplingBytes),
  };
  const sampling = SamplingSchema.parse(samplingFile.value);
  const populationRef = sampling.files.population;
  const selectedRef = sampling.files.selected;
  const populationBytes = readArtifact(root, populationRef);
  const population = PopulationSchema.parse(
    JSON.parse(populationBytes.toString('utf8')) as unknown,
  );
  const selectedBytes = readArtifact(root, selectedRef);
  const selectedRows = jsonLines(
    selectedBytes,
    CohortTargetSchema,
    'Selected cohort',
  );
  if (
    !sampling.constraints.lexemeDisjoint ||
    !sampling.constraints.pilotLexemesInDevelopment ||
    sampling.constraints.duplicateSenseKeys ||
    !sampling.constraints.withinPlanTarget ||
    !sampling.constraints.developmentQuotaMet ||
    !sampling.constraints.holdoutQuotaMet ||
    sampling.counts.eligible <= 0 ||
    selectedRows.length !== sampling.counts.selected
  )
    throw new Error('Frozen sampling manifest failed a cohort constraint');

  const exportFile = readJson(root, options.exportPath);
  const exportRef = {
    path: options.exportPath,
    sha256: hashBytes(exportFile.bytes),
  };
  const sourceExport = ExportManifestSchema.parse(exportFile.value);
  const sourceSenseRef = sourceExport.files.senses;
  if (
    sampling.input.exportManifest.path !== exportRef.path ||
    sampling.input.exportManifest.sha256 !== exportRef.sha256 ||
    sampling.input.sourceSenseFile.path !== sourceSenseRef.path ||
    sampling.input.sourceSenseFile.sha256 !== sourceSenseRef.sha256 ||
    population.export.manifest.path !== exportRef.path ||
    population.export.manifest.sha256 !== exportRef.sha256 ||
    population.export.senses.path !== sourceSenseRef.path ||
    population.export.senses.sha256 !== sourceSenseRef.sha256 ||
    population.counts.eligible !== sampling.counts.eligible ||
    population.counts.selected !== sampling.counts.selected ||
    sampling.counts.eligible !== sourceExport.counts.senses
  )
    throw new Error(
      'Sampling artifacts do not bind the complete source export',
    );

  const sourceSenseMap = await verifySourceSenseRows(
    root,
    sourceSenseRef,
    selectedRows,
  );
  for (const selected of selectedRows) {
    const sense = sourceSenseMap.get(selected.targetKey);
    if (!sense)
      throw new Error('Selected sense was not resolved from source file');
    const expectedTargetKey = hashJson({
      schemaVersion: 1,
      task: 'db4_cohort_target',
      snapshotFingerprint: sourceExport.semanticInputFingerprint,
      semanticKey: sense.sense.semanticKey,
    });
    if (selected.targetKey !== expectedTargetKey)
      throw new Error(
        'Selected target key does not bind to export fingerprint',
      );
  }

  const splitCounts = selectedRows.reduce(
    (counts, row) => {
      counts[row.split]++;
      return counts;
    },
    { development: 0, holdout: 0 },
  );
  const shardCounts: Record<string, number> = {};
  for (const row of selectedRows)
    shardCounts[row.shardId] = (shardCounts[row.shardId] ?? 0) + 1;
  if (
    splitCounts.development !== sampling.counts.development ||
    splitCounts.holdout !== sampling.counts.holdout ||
    canonicalJson(Object.entries(shardCounts).sort()) !==
      canonicalJson(Object.entries(sampling.counts.shardCounts).sort()) ||
    Object.values(shardCounts).some(
      (count) => count > Math.min(100, sampling.config.shardTarget),
    ) ||
    Object.keys(shardCounts).length !== sampling.counts.shards ||
    sampling.counts.selected > 1000 ||
    sampling.counts.shards > 10
  )
    throw new Error('Selected cohort denominator/split/shard counts drifted');

  const generationFile = readJson(root, options.generationPath);
  const generationBytes = generationFile.bytes;
  const generationRef = {
    path: options.generationPath,
    sha256: hashBytes(generationBytes),
  };
  const generation = GenerationManifestSchema.parse(generationFile.value);
  if (generation.apply || generation.semanticQualityValidated)
    throw new Error('Expected an unapplied D2 retrieval generation');
  const d2ExportFile = readJson(root, generation.inputs.export.path);
  if (hashBytes(d2ExportFile.bytes) !== generation.inputs.export.sha256)
    throw new Error('Generation export manifest hash mismatch');
  const d2Export = ExportManifestSchema.parse(d2ExportFile.value);
  const auditBytes = readArtifact(root, generation.inputs.audit);
  const audit = AuditManifestSchema.parse(
    JSON.parse(auditBytes.toString('utf8')) as unknown,
  );
  if (audit.exportSha256 !== generation.inputs.export.sha256)
    throw new Error('Generation source audit belongs to another export');
  for (const source of audit.sources)
    if (source.audit.status === 'verified')
      source.audit.evidence.forEach((ref) => readArtifact(root, ref));
  const auditHash = hashBytes(auditBytes);
  const expectedSnapshot = {
    ...d2Export.snapshot,
    sourcePolicyVersion: `db4-d2-source-audit-v1:${auditHash}`,
  };
  if (
    canonicalJson(expectedSnapshot) !== canonicalJson(generation.snapshot) ||
    semanticInputFingerprint(expectedSnapshot) !==
      generation.semanticInputFingerprint
  )
    throw new Error('Generation semantic fingerprint/snapshot mismatch');

  const searchFile = readJson(root, generation.inputs.search.path);
  const searchRef = {
    path: generation.inputs.search.path,
    sha256: hashBytes(searchFile.bytes),
  };
  if (searchRef.sha256 !== generation.inputs.search.sha256)
    throw new Error('Generation search manifest hash mismatch');
  const search = SearchManifestSchema.parse(searchFile.value);
  if (
    search.exportSha256 !== generation.inputs.export.sha256 ||
    search.auditSha256 !== generation.inputs.audit.sha256
  )
    throw new Error('Search manifest is not bound to generation inputs');
  const searchResults = jsonLines(
    readArtifact(root, search.results),
    SearchResultSchema,
    'Search results',
  );
  const selectedSenseKeys = new Map(
    [...sourceSenseMap.values()].map((sense) => [
      sense.sense.semanticKey,
      sense.sense.id,
    ]),
  );
  const searchBySense = new Map(
    searchResults.map((result) => [result.senseKey, result]),
  );
  if (searchBySense.size !== searchResults.length)
    throw new Error('Search results contain duplicate sense keys');
  if (searchResults.length !== sampling.counts.selected)
    throw new Error('Search result denominator differs from selected cohort');
  for (const [senseKey, senseId] of selectedSenseKeys) {
    const result = searchBySense.get(senseKey);
    if (!result || result.senseId !== senseId)
      throw new Error('Search results do not cover selected source senses');
  }

  const generationStatusRows = jsonLines(
    readArtifact(root, generation.files.status),
    GenerationStatusSchema,
    'Generation statuses',
  );
  const statusBySense = new Map(
    generationStatusRows.map((status) => [status.senseKey, status]),
  );
  if (
    statusBySense.size !== generationStatusRows.length ||
    generationStatusRows.length !== sampling.counts.selected ||
    generation.counts.senses !== sampling.counts.selected
  )
    throw new Error('Generation status denominator/identity mismatch');
  const selectedBySemanticKey = new Map<string, CohortTarget>();
  const targetRows: BatchTarget[] = selectedRows.map((selected) => {
    const source = sourceSenseMap.get(selected.targetKey)!;
    if (selectedBySemanticKey.has(source.sense.semanticKey))
      throw new Error('Duplicate selected semantic sense');
    selectedBySemanticKey.set(source.sense.semanticKey, selected);
    return {
      targetKey: selected.targetKey,
      senseKey: selected.senseKey,
      senseId: selected.senseId,
      lexemeId: selected.lexemeId,
      lexemeKey: selected.lexemeKey,
      level: selected.level,
      pos: selected.pos,
      enGlossCount: selected.enGlossCount,
      hasFieldInfo: selected.hasFieldInfo,
      hasExistingExact: selected.hasExistingExact,
      originalStatus: selected.originalStatus,
      strata: selected.strata,
      sourceRef: selected.sourceRef,
      split: selected.split,
      shardId: selected.shardId,
    };
  });

  const statusCounts = { ready: 0, no_candidates: 0 };
  for (const selected of selectedRows) {
    const source = sourceSenseMap.get(selected.targetKey)!;
    const status = statusBySense.get(source.sense.semanticKey);
    if (!status || status.senseId !== source.sense.id)
      throw new Error('Generation status is missing/mismatched for a target');
    statusCounts[status.status]++;
    const searchResult = searchBySense.get(source.sense.semanticKey)!;
    if (
      (status.status === 'ready' &&
        (!status.bundleKey ||
          !status.candidateCount ||
          !searchResult.hits.length)) ||
      (status.status === 'no_candidates' &&
        (status.bundleKey !== null ||
          status.candidateCount !== 0 ||
          searchResult.hits.length))
    )
      throw new Error('Retrieval status conflicts with its search result');
  }

  const bundlesBySense = new Map<string, MappingBundle>();
  const bundleRef = generation.files.bundles;
  let bundleCount = 0;
  await forEachRawJsonl(root, bundleRef, (line) => {
    const bundle = parseMappingBundleIntegrity(
      MappingBundleSchema.parse(JSON.parse(line.toString('utf8')) as unknown),
    );
    if (
      bundle.semanticInputFingerprint !== generation.semanticInputFingerprint ||
      bundle.builderVersion !== generation.version ||
      bundle.mode !== generation.snapshot.mode
    )
      throw new Error('Bundle differs from retrieval generation identity');
    const sourceSelected = selectedBySemanticKey.get(bundle.sense.semanticKey);
    const targetStatus = statusBySense.get(bundle.sense.semanticKey);
    if (
      !sourceSelected ||
      !targetStatus ||
      targetStatus.status !== 'ready' ||
      targetStatus.bundleKey !== bundle.bundleKey ||
      targetStatus.senseId !== bundle.sense.id ||
      bundle.sense.identity?.senseKey !== sourceSelected.senseKey ||
      bundle.sense.identity?.externalId !== sourceSelected.lexemeKey
    )
      throw new Error('Bundle is not bound to its selected target/status');
    requireSourceAudit(bundle, audit);
    if (bundlesBySense.has(bundle.sense.semanticKey))
      throw new Error('Duplicate retrieval bundle for sense');
    bundlesBySense.set(bundle.sense.semanticKey, bundle);
    bundleCount++;
  });
  if (
    bundleCount !== generation.counts.bundles ||
    bundleCount !== statusCounts.ready ||
    bundlesBySense.size !== statusCounts.ready
  )
    throw new Error('Generation bundle denominator mismatch');
  for (const [semanticKey, status] of statusBySense) {
    if (status.status === 'ready' && !bundlesBySense.has(semanticKey))
      throw new Error('Ready generation status has no bound D1 bundle');
    if (status.status === 'no_candidates' && bundlesBySense.has(semanticKey))
      throw new Error('No-candidate status has a D1 bundle');
  }

  const candidatesByShard = new Map<string, string[]>();
  const seenCandidateKeysBySense = new Map<string, Set<string>>();
  const closedCandidateGroups = new Set<string>();
  let currentSenseKey: string | null = null;
  let currentCandidates: ReturnType<typeof parseMappingCandidate>[] = [];
  let candidateCount = 0;
  let previousTargetLine = 0;
  const flushCandidateGroup = () => {
    if (!currentSenseKey) return;
    const bundle = bundlesBySense.get(currentSenseKey);
    const selected = selectedBySemanticKey.get(currentSenseKey);
    const status = statusBySense.get(currentSenseKey);
    if (!bundle || !selected || status?.status !== 'ready')
      throw new Error('Candidate group has no ready target/bundle');
    parseMappingBundle(bundle, currentCandidates);
    if (
      currentCandidates.length !== bundle.candidates.length ||
      currentCandidates.length !== status.candidateCount
    )
      throw new Error('Candidate count does not match bundle/status');
    const rows = candidatesByShard.get(selected.shardId) ?? [];
    rows.push(
      ...currentCandidates.map((candidate) => JSON.stringify(candidate) + '\n'),
    );
    candidatesByShard.set(selected.shardId, rows);
    closedCandidateGroups.add(currentSenseKey);
  };
  await forEachRawJsonl(root, generation.files.candidates, (line) => {
    const candidate = parseMappingCandidate(
      JSON.parse(line.toString('utf8')) as unknown,
    );
    if (
      candidate.semanticInputFingerprint !== generation.semanticInputFingerprint
    )
      throw new Error('Full candidate differs from generation fingerprint');
    const semanticKey = candidate.sense.semanticKey;
    const selected = selectedBySemanticKey.get(semanticKey);
    const status = statusBySense.get(semanticKey);
    if (!selected || status?.status !== 'ready')
      throw new Error('Candidate file contains a non-selected/non-ready sense');
    if (currentSenseKey !== semanticKey) {
      flushCandidateGroup();
      if (closedCandidateGroups.has(semanticKey))
        throw new Error('Candidate file splits a sense across disjoint groups');
      const sourceLine = selected.sourceRef.line;
      if (sourceLine <= previousTargetLine)
        throw new Error('Candidate groups are not in frozen source order');
      previousTargetLine = sourceLine;
      currentSenseKey = semanticKey;
      currentCandidates = [];
      seenCandidateKeysBySense.set(semanticKey, new Set());
    }
    const keys = seenCandidateKeysBySense.get(semanticKey)!;
    if (keys.has(candidate.candidateKey))
      throw new Error('Duplicate full candidate in generation');
    keys.add(candidate.candidateKey);
    currentCandidates.push(candidate);
    candidateCount++;
  });
  flushCandidateGroup();
  if (candidateCount !== generation.counts.candidates)
    throw new Error('Full candidate denominator differs from generation');
  for (const [semanticKey, status] of statusBySense) {
    if (status.status === 'ready' && !seenCandidateKeysBySense.has(semanticKey))
      throw new Error('Ready target has no full D1 candidates');
    if (
      status.status === 'no_candidates' &&
      seenCandidateKeysBySense.has(semanticKey)
    )
      throw new Error('No-candidate target has full D1 candidates');
  }

  const revision = parsePromptRevision(options.promptRevision);
  const system = readFileSync(
    resolve(options.promptDirectory, promptFilename(revision, 'system')),
    'utf8',
  ).trim();
  const phaseText = {
    r1: readFileSync(
      resolve(options.promptDirectory, promptFilename(revision, 'r1')),
      'utf8',
    ).trim(),
    r2: readFileSync(
      resolve(options.promptDirectory, promptFilename(revision, 'r2')),
      'utf8',
    ).trim(),
  };
  const promptHashes = {
    system: hashBytes(system),
    r1: hashBytes(phaseText.r1),
    r2: hashBytes(phaseText.r2),
  };
  const promptVersions = {
    r1: promptVersion(revision, 'r1'),
    r2: promptVersion(revision, 'r2'),
  };

  const intentIdentity = {
    runId,
    sampling: samplingRef,
    population: populationRef,
    selected: selectedRef,
    sourceExport: exportRef,
    sourceSenseFile: sourceSenseRef,
    generation: generationRef,
    search: searchRef,
    audit: generation.inputs.audit,
    bundles: generation.files.bundles,
    statuses: generation.files.status,
    semanticInputFingerprint: generation.semanticInputFingerprint,
    promptRevision: revision,
    promptHashes,
    git: sourceRevisionHash,
    caps: {
      selectedTargets: selectedRows.length,
      workers,
      mappingDispatches,
      auditDispatches,
      requestTimeoutSeconds,
    },
  };
  const intent = ensureImmutableIntent(
    root,
    `${prefix}/preparation-intent.json`,
    intentIdentity,
    options.now ?? (() => new Date().toISOString()),
  );

  const promptRefs = {
    system: writeAtomicArtifact(root, `${prefix}/prompts/system.txt`, system),
    r1: writeAtomicArtifact(root, `${prefix}/prompts/r1.txt`, phaseText.r1),
    r2: writeAtomicArtifact(root, `${prefix}/prompts/r2.txt`, phaseText.r2),
  };
  const targetRef = writeCappedJsonl(
    root,
    `${prefix}/targets.jsonl`,
    targetRows,
  );
  const jobs: BatchSchedule['jobs'] = [];
  const requestRows = new Map<string, { r1: unknown[]; r2: unknown[] }>();
  const shardTargetRows = new Map<string, BatchTarget[]>();
  const initialResults: unknown[] = [];
  for (const target of targetRows) {
    const source = sourceSenseMap.get(target.targetKey)!;
    const status = statusBySense.get(source.sense.semanticKey)!;
    const list = shardTargetRows.get(target.shardId) ?? [];
    list.push(target);
    shardTargetRows.set(target.shardId, list);
    const resultStatus =
      status.status === 'ready' ? 'r1_pending' : 'no_candidates';
    initialResults.push(
      BatchTargetResultSchema.parse({
        runId,
        targetKey: target.targetKey,
        senseKey: target.senseKey,
        status: resultStatus,
        finalGeneration: 1,
        d1Decision: null,
        auditResult: null,
        reason:
          status.status === 'no_candidates'
            ? (status.reason ?? 'No shortlist after retrieval.')
            : null,
      }),
    );
    if (status.status === 'no_candidates') continue;
    const bundle = bundlesBySense.get(source.sense.semanticKey);
    if (!bundle) throw new Error('Ready target has no D1 bundle');
    const perShard = requestRows.get(target.shardId) ?? { r1: [], r2: [] };
    requestRows.set(target.shardId, perShard);
    let r1JobKey: string | null = null;
    for (const phase of ['r1', 'r2'] as const) {
      const rendered = renderMappingBundle(
        bundle,
        phase,
        `${runId}:${target.targetKey}:${phase}`,
        promptVersions[phase],
      );
      const requestBytes =
        Buffer.byteLength(canonicalJson(rendered.payload)) +
        Buffer.byteLength(system) +
        Buffer.byteLength(phaseText[phase]);
      if (requestBytes > MAX_ARTIFACT_BYTES)
        throw new Error(
          `Rendered request exceeds 64 MiB: ${target.senseKey}/${phase}`,
        );
      const promptHash = hashJson({
        revision,
        version: promptVersions[phase],
        systemSha256: promptHashes.system,
        phaseSha256: promptHashes[phase],
      });
      const job = createBatchJob(runId, {
        targetKey: target.targetKey,
        senseKey: target.senseKey,
        shardId: target.shardId,
        generation: 1,
        kind: 'review',
        phase,
        attempt: 1,
        bundleKey: bundle.bundleKey,
        inputHash: hashJson({
          bundleKey: bundle.bundleKey,
          contextHash: bundle.contextHash,
        }),
        promptHash,
        renderedHash: rendered.renderedContextHash,
        dependsOn: phase === 'r2' ? r1JobKey : null,
      });
      jobs.push(job);
      const row = {
        jobKey: job.jobKey,
        targetKey: target.targetKey,
        senseKey: target.senseKey,
        phase,
        generation: 1,
        bundleKey: bundle.bundleKey,
        promptVersion: promptVersions[phase],
        promptHash,
        renderedContextHash: rendered.renderedContextHash,
        dependencyJobKey: job.dependsOn,
        payload: rendered.payload,
      };
      perShard[phase].push(row);
      if (phase === 'r1') r1JobKey = job.jobKey;
    }
  }
  const createdAt = intent.createdAt;
  const schedule: BatchSchedule = BatchScheduleSchema.parse({
    schemaVersion: 1,
    task: 'db4_batch_schedule',
    runId,
    waveId: 'initial',
    createdAt,
    jobs,
  });
  const scheduleBytes = schedule.jobs
    .map((job) => JSON.stringify(job) + '\n')
    .join('');
  if (Buffer.byteLength(scheduleBytes) > MAX_ARTIFACT_BYTES)
    throw new Error('Batch schedule exceeds 64 MiB');
  const scheduleRef = writeAtomicArtifact(
    root,
    `${prefix}/schedule.jsonl`,
    scheduleBytes,
  );
  const initialResultsRef = writeCappedJsonl(
    root,
    `${prefix}/initial-target-results.jsonl`,
    initialResults,
  );
  const shardManifestRows: BatchManifest['shards'] = [];
  const perShardSummary: Record<string, unknown> = {};
  for (const shardId of Object.keys(shardCounts).sort()) {
    const targets = shardTargetRows.get(shardId) ?? [];
    const requests = requestRows.get(shardId) ?? { r1: [], r2: [] };
    const candidates = candidatesByShard.get(shardId) ?? [];
    const shardTargetRef = writeCappedJsonl(
      root,
      `${prefix}/shards/${shardId}/targets.jsonl`,
      targets,
    );
    const shardCandidateRef = writeCappedJsonlText(
      root,
      `${prefix}/shards/${shardId}/candidates.jsonl`,
      candidates.join(''),
    );
    const r1Ref = writeCappedJsonl(
      root,
      `${prefix}/shards/${shardId}/requests-r1.jsonl`,
      requests.r1,
    );
    const r2Ref = writeCappedJsonl(
      root,
      `${prefix}/shards/${shardId}/requests-r2-planned.jsonl`,
      requests.r2,
    );
    const readyCount = requests.r1.length;
    const noCandidateCount = targets.length - readyCount;
    shardManifestRows.push({
      shardId,
      targets: shardTargetRef,
      candidates: shardCandidateRef,
      requests: { r1: r1Ref, r2: r2Ref },
      readyCount,
      noCandidateCount,
      count: targets.length,
    });
    perShardSummary[shardId] = {
      selected: targets.length,
      r1Planned: readyCount,
      r2ConditionalPlanned: requests.r2.length,
      noCandidates: noCandidateCount,
      fullCandidates: candidates.length,
    };
  }

  const snapshotRef = writeAtomicJson(
    root,
    `${prefix}/sources/snapshot.json`,
    generation.snapshot,
  );
  const report = {
    schemaVersion: 1,
    task: 'db4_batch_preparation_report',
    runId,
    createdAt,
    mode: 'shadow',
    apply: false,
    dispatched: false,
    selectedDenominator: targetRows.length,
    splitCounts,
    retrievalStatusCounts: statusCounts,
    r1Planned: statusCounts.ready,
    r1ReadyAtPrepare: statusCounts.ready,
    r2ConditionalPlanned: statusCounts.ready,
    r2DispatchableAtPrepare: 0,
    mappingDispatchCap: mappingDispatches,
    auditDispatchCap: auditDispatches,
    workers,
    requestTimeoutSeconds,
    promptRevision: revision,
    promptHashes,
    semanticInputFingerprint: generation.semanticInputFingerprint,
    sourceInputRefs: intentIdentity,
    perShard: perShardSummary,
    gates: {
      cohortValidated: true,
      sourceAuditValidated: true,
      generationValidated: true,
      requestsRendered: true,
      museCalled: false,
      databaseWritten: false,
    },
  };
  const reportRef = writeAtomicJson(
    root,
    `${prefix}/preparation-report.json`,
    report,
  );
  const manifest: BatchManifest = BatchManifestSchema.parse({
    schemaVersion: 1,
    task: 'db4_automated_mapping_batch',
    runId,
    createdAt,
    mode: 'shadow',
    apply: false,
    promotionReady: false,
    git: sourceRevisionHash,
    snapshot: snapshotRef,
    cohort: {
      selectorVersion: sampling.selectorVersion,
      seed: sampling.seed,
      population: populationRef,
      selected: selectedRef,
      sampling: samplingRef,
      counts: {
        population: sampling.counts.eligible,
        selected: sampling.counts.selected,
        development: sampling.counts.development,
        holdout: sampling.counts.holdout,
        shards: sampling.counts.shards,
      },
    },
    sources: {
      cohortExport: exportRef,
      export: generation.inputs.export,
      audit: generation.inputs.audit,
    },
    retrieval: {
      generationManifest: generationRef,
      searchManifest: searchRef,
      candidates: generation.files.candidates,
      bundles: generation.files.bundles,
      statuses: generation.files.status,
      readyCount: statusCounts.ready,
      noCandidateCount: statusCounts.no_candidates,
    },
    prompt: {
      revision,
      system: promptRefs.system,
      r1: promptRefs.r1,
      r2: promptRefs.r2,
    },
    artifacts: {
      preparationIntent: intent.ref,
      targets: targetRef,
      schedule: scheduleRef,
      initialTargetResults: initialResultsRef,
      preparationReport: reportRef,
    },
    versions: {
      retrieval: generation.version,
      prompt: revision,
      adapter: 'db4-d4-native-request-renderer-v1',
      decision: `${DECISION_POLICY_VERSION}+${CONDITIONAL_R2_POLICY_VERSION}`,
      audit: AUDIT_POLICY_VERSION,
    },
    caps: {
      selectedTargets: targetRows.length,
      shardTargets: Math.min(100, sampling.config.shardTarget),
      generationTargets: 500,
      artifactBytes: MAX_ARTIFACT_BYTES,
      workers,
      semanticGenerations: 2,
      formatRepairsPerTarget: 1,
      expansionsPerTarget: 1,
      mappingDispatches,
      auditDispatches,
      requestTimeoutSeconds,
    },
    shards: shardManifestRows,
  });
  const manifestPath = `${prefix}/run-manifest.json`;
  const priorManifestPath = artifactPath(root, manifestPath);
  if (existsSync(priorManifestPath)) {
    const prior = JSON.parse(
      readFileSync(priorManifestPath, 'utf8'),
    ) as unknown;
    if (canonicalJson(prior) !== canonicalJson(manifest))
      throw new Error(
        'Existing run manifest differs from immutable preparation',
      );
  } else {
    writeAtomicJson(root, manifestPath, manifest);
  }
  const manifestBytes = readFileSync(artifactPath(root, manifestPath));
  return {
    manifest: { path: manifestPath, sha256: hashBytes(manifestBytes) },
    report: reportRef,
    counts: {
      selected: targetRows.length,
      development: splitCounts.development,
      holdout: splitCounts.holdout,
      r1Planned: statusCounts.ready,
      r2ConditionalPlanned: statusCounts.ready,
      noCandidates: statusCounts.no_candidates,
      jobs: jobs.length,
      shards: shardManifestRows.length,
    },
    dispatched: false,
    apply: false,
  };
}

export function currentBatchSourceRevision(repoRoot = process.cwd()) {
  return sourceRevision(repoRoot);
}

if (require.main === module) {
  const flags: Record<string, string> = {};
  const allowed = new Set([
    'artifact-dir',
    'run-id',
    'sampling',
    'generation',
    'export',
    'output-prefix',
    'prompt-revision',
  ]);
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (
      !key?.startsWith('--') ||
      !allowed.has(key.slice(2)) ||
      !value ||
      value.startsWith('--') ||
      flags[key.slice(2)]
    )
      throw new Error(`Unknown/duplicate/missing flag: ${key}`);
    flags[key.slice(2)] = value;
  }
  const runId = flags['run-id'];
  const root = resolve(flags['artifact-dir'] ?? 'uploads/db4');
  const samplingPath = flags.sampling;
  const generationPath = flags.generation;
  const exportPath = flags.export;
  if (!runId || !samplingPath || !generationPath || !exportPath)
    throw new Error(
      'Usage: tsx scripts/db4/batch-prepare.ts --artifact-dir ROOT --run-id ID --sampling PATH --generation PATH --export PATH [--output-prefix PATH] [--prompt-revision v1|v2|v2.1]',
    );
  const promptRevision = parsePromptRevision(
    flags['prompt-revision'] ?? 'v2.1',
  );
  const source = currentBatchSourceRevision(process.cwd());
  const outputPrefix = flags['output-prefix'] ?? `batch-runs/${runId}`;
  void prepareAutomatedBatch(root, {
    runId,
    samplingPath,
    generationPath,
    exportPath,
    outputPrefix,
    promptRevision,
    promptDirectory: resolve('docs/prompts'),
    gitRevision: source.revision,
    dirtySourceSha256: source.dirtySourceSha256,
  })
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
