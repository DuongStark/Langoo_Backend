// DB4-D4/D5: read-only integrity and denominator gate before native dispatch.
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  BatchManifestSchema,
  BatchScheduleSchema,
  BatchTargetResultSchema,
  BatchTargetSchema,
  createBatchJob,
} from './_batch-types';
import {
  ArtifactRef,
  ArtifactRefSchema,
  MappingBundle,
  SemanticSnapshotSchema,
  canonicalJson,
  createMappingBundle,
  hashBytes,
  hashJson,
  parseMappingBundleIntegrity,
  parseMappingCandidate,
  semanticInputFingerprint,
  MappingBundleSchema,
} from './_mapping-types';
import {
  AuditManifestSchema,
  ExportManifestSchema,
  RetrievalSenseSchema,
  SearchManifestSchema,
  SearchResultSchema,
  artifactPath,
  readArtifact,
} from './_retrieval';
import {
  CohortTargetSchema,
  GenerationManifestSchema,
  GenerationStatusSchema,
  PopulationSchema,
  SamplingSchema,
  requireSourceAudit,
  verifySourceSenseRows,
} from './batch-prepare';
import { posFamily } from './cohort-select';
import { promptVersion } from './muse-prompt-version';

const MAX_INPUT_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_JSON_BYTES = 16 * 1024 * 1024;
const MAX_ROW_BYTES = 16 * 1024 * 1024;
const MAX_REQUEST_BYTES = 64 * 1024 * 1024;

type BatchManifest = z.infer<typeof BatchManifestSchema>;
type Request = {
  jobKey: string;
  targetKey: string;
  senseKey: string;
  phase: 'r1' | 'r2';
  generation: number;
  bundleKey: string;
  promptVersion: string;
  promptHash: string;
  renderedContextHash: string;
  dependencyJobKey: string | null;
  payload: {
    schemaVersion: 1;
    phase: 'r1' | 'r2';
    seed: string;
    promptVersion: string;
    bundle: MappingBundle;
  };
};
const RequestSchema = z
  .object({
    jobKey: z.string().regex(/^[0-9a-f]{64}$/),
    targetKey: z.string().regex(/^[0-9a-f]{64}$/),
    senseKey: z.string().min(1),
    phase: z.enum(['r1', 'r2']),
    generation: z.number().int().min(1).max(2),
    bundleKey: z.string().regex(/^[0-9a-f]{64}$/),
    promptVersion: z.string().min(1),
    promptHash: z.string().regex(/^[0-9a-f]{64}$/),
    renderedContextHash: z.string().regex(/^[0-9a-f]{64}$/),
    dependencyJobKey: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable(),
    payload: z
      .object({
        schemaVersion: z.literal(1),
        phase: z.enum(['r1', 'r2']),
        seed: z.string().min(1),
        promptVersion: z.string().min(1),
        bundle: MappingBundleSchema,
      })
      .strict(),
  })
  .strict();

function sameRef(a: ArtifactRef, b: ArtifactRef): boolean {
  return a.path === b.path && a.sha256 === b.sha256;
}

function rememberRef(
  refs: Map<string, string>,
  refValue: unknown,
): ArtifactRef {
  const ref = ArtifactRefSchema.parse(refValue);
  const previous = refs.get(ref.path);
  if (previous && previous !== ref.sha256)
    throw new Error(`Conflicting hashes for artifact path ${ref.path}`);
  refs.set(ref.path, ref.sha256);
  return ref;
}

async function verifyArtifactRef(
  root: string,
  ref: ArtifactRef,
): Promise<void> {
  const path = artifactPath(root, ref.path);
  const size = statSync(path).size;
  if (size > MAX_INPUT_BYTES)
    throw new Error(`Artifact exceeds 4 GiB preflight cap: ${ref.path}`);
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path, {
    highWaterMark: 1024 * 1024,
  }) as AsyncIterable<Uint8Array>)
    digest.update(chunk);
  if (digest.digest('hex') !== ref.sha256)
    throw new Error(`Artifact hash mismatch: ${ref.path}`);
}

async function scanJsonl<T>(
  root: string,
  ref: ArtifactRef,
  label: string,
  schema: z.ZodType<T>,
  visit: (row: T, lineNumber: number) => void,
): Promise<number> {
  const path = artifactPath(root, ref.path);
  const size = statSync(path).size;
  if (size > MAX_INPUT_BYTES)
    throw new Error(`${label} exceeds 4 GiB preflight cap`);
  const digest = createHash('sha256');
  const input = createReadStream(path, {
    highWaterMark: 1024 * 1024,
  }) as AsyncIterable<Uint8Array>;
  let pending: Uint8Array = new Uint8Array(0);
  let lineNumber = 0;
  for await (const chunk of input) {
    digest.update(chunk);
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    let start = 0;
    while (true) {
      const end = pending.indexOf(0x0a, start);
      if (end < 0) break;
      const bytes = pending.subarray(start, end);
      if (!bytes.length || bytes.length > MAX_ROW_BYTES)
        throw new Error(`${label} contains an empty/oversized row`);
      if (bytes.at(-1) === 0x0d)
        throw new Error(`${label} must use LF line endings`);
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
      } catch {
        throw new Error(`${label} has invalid JSON at line ${lineNumber + 1}`);
      }
      visit(schema.parse(parsed), ++lineNumber);
      start = end + 1;
    }
    pending = pending.subarray(start);
    if (pending.length > MAX_ROW_BYTES)
      throw new Error(`${label} contains an oversized JSONL row`);
  }
  if (pending.length) throw new Error(`${label} must end with LF`);
  if (digest.digest('hex') !== ref.sha256)
    throw new Error(`${label} hash mismatch`);
  return lineNumber;
}

function readJsonRef<T>(
  root: string,
  ref: ArtifactRef,
  schema: z.ZodType<T>,
  label: string,
): T {
  const path = artifactPath(root, ref.path);
  if (statSync(path).size > MAX_JSON_BYTES)
    throw new Error(`${label} exceeds 16 MiB cap`);
  const bytes = readArtifact(root, ref);
  return schema.parse(JSON.parse(bytes.toString('utf8')) as unknown);
}

function readJsonlRef<T>(
  root: string,
  ref: ArtifactRef,
  schema: z.ZodType<T>,
  label: string,
): T[] {
  const path = artifactPath(root, ref.path);
  if (statSync(path).size > MAX_REQUEST_BYTES)
    throw new Error(`${label} exceeds 64 MiB cap`);
  const bytes = readArtifact(root, ref);
  if (!bytes.length) return [];
  const text = bytes.toString('utf8');
  if (!text.endsWith('\n')) throw new Error(`${label} must end with LF`);
  const lines = text.slice(0, -1).split('\n');
  if (lines.some((line) => !line)) throw new Error(`${label} has an empty row`);
  return lines.map((line) => schema.parse(JSON.parse(line) as unknown));
}

function targetProjection(target: z.infer<typeof BatchTargetSchema>) {
  return {
    targetKey: target.targetKey,
    senseKey: target.senseKey,
    senseId: target.senseId,
    lexemeId: target.lexemeId,
    lexemeKey: target.lexemeKey,
    level: target.level,
    pos: target.pos,
    enGlossCount: target.enGlossCount,
    hasFieldInfo: target.hasFieldInfo,
    hasExistingExact: target.hasExistingExact,
    originalStatus: target.originalStatus,
    strata: target.strata,
    sourceRef: target.sourceRef,
    split: target.split,
    shardId: target.shardId,
  };
}

function normalizeBundleCandidateOrder(value: unknown): MappingBundle {
  const bundle = MappingBundleSchema.parse(value);
  return parseMappingBundleIntegrity({
    ...bundle,
    candidates: [...bundle.candidates].sort((a, b) =>
      a.candidateKey < b.candidateKey
        ? -1
        : a.candidateKey > b.candidateKey
          ? 1
          : 0,
    ),
  });
}

export async function preflightBatchInputs(
  rootValue: string,
  manifestPath: string,
) {
  const root = resolve(rootValue);
  const manifestFile = artifactPath(root, manifestPath);
  if (statSync(manifestFile).size > MAX_JSON_BYTES)
    throw new Error('Run manifest exceeds 16 MiB cap');
  const manifestBytes = readFileSync(manifestFile);
  const manifest = BatchManifestSchema.parse(
    JSON.parse(manifestBytes.toString('utf8')) as unknown,
  );
  if (manifest.mode !== 'shadow' || manifest.apply || manifest.promotionReady)
    throw new Error('Preflight accepts only an unapplied shadow batch');

  const refHashes = new Map<string, string>();
  const verifiedPaths = new Set<string>();
  const markVerified = (refValue: unknown) => {
    verifiedPaths.add(ArtifactRefSchema.parse(refValue).path);
  };
  const readJsonRefChecked = <T>(
    ref: ArtifactRef,
    schema: z.ZodType<T>,
    label: string,
  ): T => {
    const value = readJsonRef(root, ref, schema, label);
    markVerified(ref);
    return value;
  };
  const readJsonlRefChecked = <T>(
    ref: ArtifactRef,
    schema: z.ZodType<T>,
    label: string,
  ): T[] => {
    const rows = readJsonlRef(root, ref, schema, label);
    markVerified(ref);
    return rows;
  };
  const readArtifactChecked = (ref: ArtifactRef): Buffer => {
    const bytes = readArtifact(root, ref);
    markVerified(ref);
    return bytes;
  };
  const scanJsonlChecked = async <T>(
    ref: ArtifactRef,
    label: string,
    schema: z.ZodType<T>,
    visit: (row: T, lineNumber: number) => void,
  ): Promise<number> => {
    const count = await scanJsonl(root, ref, label, schema, visit);
    markVerified(ref);
    return count;
  };
  const coreRefs: ArtifactRef[] = [
    manifest.snapshot,
    manifest.cohort.population,
    manifest.cohort.selected,
    manifest.cohort.sampling,
    manifest.sources.cohortExport,
    manifest.sources.export,
    manifest.sources.audit,
    manifest.retrieval.generationManifest,
    manifest.retrieval.searchManifest,
    manifest.retrieval.candidates,
    manifest.retrieval.bundles,
    manifest.retrieval.statuses,
    manifest.prompt.system,
    manifest.prompt.r1,
    manifest.prompt.r2,
    manifest.artifacts.preparationIntent,
    manifest.artifacts.targets,
    manifest.artifacts.schedule,
    manifest.artifacts.initialTargetResults,
    manifest.artifacts.preparationReport,
    ...manifest.shards.flatMap((shard) => [
      shard.targets,
      shard.candidates,
      shard.requests.r1,
      shard.requests.r2,
    ]),
  ];
  coreRefs.forEach((ref) => rememberRef(refHashes, ref));

  const cohortExport = readJsonRefChecked(
    manifest.sources.cohortExport,
    ExportManifestSchema,
    'Cohort source export',
  );
  const sampling = readJsonRefChecked(
    manifest.cohort.sampling,
    SamplingSchema,
    'Cohort sampling manifest',
  );
  const population = readJsonRefChecked(
    manifest.cohort.population,
    PopulationSchema,
    'Cohort population manifest',
  );
  if (
    !sameRef(sampling.files.population, manifest.cohort.population) ||
    !sameRef(sampling.files.selected, manifest.cohort.selected) ||
    !sameRef(sampling.input.exportManifest, manifest.sources.cohortExport) ||
    !sameRef(sampling.input.sourceSenseFile, cohortExport.files.senses) ||
    !sameRef(population.export.manifest, manifest.sources.cohortExport) ||
    !sameRef(population.export.senses, cohortExport.files.senses) ||
    population.counts.eligible !== sampling.counts.eligible ||
    population.counts.selected !== sampling.counts.selected ||
    sampling.counts.eligible !== cohortExport.counts.senses ||
    sampling.counts.selected !== manifest.cohort.counts.selected ||
    sampling.counts.development !== manifest.cohort.counts.development ||
    sampling.counts.holdout !== manifest.cohort.counts.holdout ||
    sampling.counts.shards !== manifest.cohort.counts.shards
  )
    throw new Error('Cohort manifests disagree on source refs or denominators');
  Object.values(cohortExport.files).forEach((ref) =>
    rememberRef(refHashes, ref),
  );
  rememberRef(refHashes, sampling.files.population);
  rememberRef(refHashes, sampling.files.selected);
  if (
    !sampling.constraints.lexemeDisjoint ||
    !sampling.constraints.pilotLexemesInDevelopment ||
    sampling.constraints.duplicateSenseKeys ||
    !sampling.constraints.withinPlanTarget ||
    !sampling.constraints.developmentQuotaMet ||
    !sampling.constraints.holdoutQuotaMet
  )
    throw new Error('Frozen cohort failed its sampling constraints');

  const selected = readJsonlRefChecked(
    manifest.cohort.selected,
    CohortTargetSchema,
    'Selected cohort',
  );
  if (selected.length !== manifest.cohort.counts.selected)
    throw new Error('Selected cohort denominator mismatch');
  const sourceSenses = await verifySourceSenseRows(
    root,
    cohortExport.files.senses,
    selected,
  );
  markVerified(cohortExport.files.senses);
  const byTarget = new Map(
    selected.map((target) => [target.targetKey, target]),
  );
  const bySenseKey = new Map(
    selected.map((target) => [target.senseKey, target]),
  );
  const bySemanticKey = new Map(
    [...sourceSenses.values()].map((sense) => [sense.sense.semanticKey, sense]),
  );
  if (
    byTarget.size !== selected.length ||
    bySenseKey.size !== selected.length ||
    bySemanticKey.size !== selected.length
  )
    throw new Error('Cohort contains duplicate target/sense identities');
  const splitCounts = { development: 0, holdout: 0 };
  const shardCounts = new Map<string, number>();
  const lexemeSplits = new Map<string, string>();
  for (const target of selected) {
    splitCounts[target.split]++;
    shardCounts.set(target.shardId, (shardCounts.get(target.shardId) ?? 0) + 1);
    const split = lexemeSplits.get(target.lexemeKey);
    if (split && split !== target.split)
      throw new Error('A lexeme crosses development/holdout');
    lexemeSplits.set(target.lexemeKey, target.split);
    const sense = sourceSenses.get(target.targetKey);
    if (!sense || sense.sense.identity?.senseKey !== target.senseKey)
      throw new Error(
        'Selected cohort target is not bound to its source sense',
      );
    const expectedPos = [
      ...new Set(sense.senseContext.metadata.normalizedPos),
    ].sort();
    const glossCount = sense.senseContext.enGlosses.filter(
      (row) => row.language === 'en',
    ).length;
    const hasFieldInfo = Boolean(
      sense.senseContext.metadata.field.length ||
      sense.senseContext.metadata.info.length,
    );
    const hasExistingExact = sense.existingLinks.some(
      (link) => link.relation === 'exact',
    );
    const originalStatus = hasExistingExact
      ? 'existing_exact'
      : sense.existingLinks.length
        ? 'existing_nonexact'
        : 'unlinked';
    const expectedTargetKey = hashJson({
      schemaVersion: 1,
      task: 'db4_cohort_target',
      snapshotFingerprint: cohortExport.semanticInputFingerprint,
      semanticKey: sense.sense.semanticKey,
    });
    if (
      target.targetKey !== expectedTargetKey ||
      target.senseId !== sense.sense.id ||
      target.lexemeId !== sense.sense.lexemeId ||
      target.lexemeKey !== sense.sense.identity.externalId ||
      target.level !== sense.sense.jlptLevel ||
      target.enGlossCount !== glossCount ||
      canonicalJson(target.pos) !== canonicalJson(expectedPos) ||
      target.hasFieldInfo !== hasFieldInfo ||
      target.hasExistingExact !== hasExistingExact ||
      target.originalStatus !== originalStatus ||
      target.strata.posFamily !== posFamily(expectedPos) ||
      target.strata.glossCount !==
        (glossCount === 0 ? 'zero' : glossCount === 1 ? 'one' : 'multiple') ||
      target.strata.fieldInfo !== (hasFieldInfo ? 'present' : 'absent')
    )
      throw new Error(
        `Selected cohort summary drifted from source: ${target.senseKey}`,
      );
  }
  if (
    splitCounts.development !== manifest.cohort.counts.development ||
    splitCounts.holdout !== manifest.cohort.counts.holdout ||
    shardCounts.size !== manifest.cohort.counts.shards ||
    [...shardCounts.values()].some(
      (count) => count > manifest.caps.shardTargets,
    )
  )
    throw new Error('Selected split/shard denominator mismatch');

  const sourceExport = readJsonRefChecked(
    manifest.sources.export,
    ExportManifestSchema,
    'D2 generation export',
  );
  const generation = readJsonRefChecked(
    manifest.retrieval.generationManifest,
    GenerationManifestSchema,
    'D2 generation manifest',
  );
  const snapshot = readJsonRefChecked(
    manifest.snapshot,
    SemanticSnapshotSchema,
    'Semantic snapshot',
  );
  const audit = readJsonRefChecked(
    manifest.sources.audit,
    AuditManifestSchema,
    'D2 source audit',
  );
  const expectedSnapshot = {
    ...sourceExport.snapshot,
    sourcePolicyVersion: `db4-d2-source-audit-v1:${manifest.sources.audit.sha256}`,
  };
  if (
    generation.apply ||
    generation.semanticQualityValidated ||
    !sameRef(generation.inputs.export, manifest.sources.export) ||
    !sameRef(generation.inputs.audit, manifest.sources.audit) ||
    !sameRef(generation.inputs.search, manifest.retrieval.searchManifest) ||
    !sameRef(generation.files.candidates, manifest.retrieval.candidates) ||
    !sameRef(generation.files.bundles, manifest.retrieval.bundles) ||
    !sameRef(generation.files.status, manifest.retrieval.statuses) ||
    canonicalJson(generation.snapshot) !== canonicalJson(snapshot) ||
    canonicalJson(generation.snapshot) !== canonicalJson(expectedSnapshot) ||
    sourceExport.snapshot.mode !== cohortExport.snapshot.mode ||
    canonicalJson(sourceExport.snapshot.sourceSnapshots) !==
      canonicalJson(cohortExport.snapshot.sourceSnapshots) ||
    sourceExport.snapshot.conceptInputHash !==
      cohortExport.snapshot.conceptInputHash ||
    sourceExport.snapshot.normalizerVersion !==
      cohortExport.snapshot.normalizerVersion ||
    sourceExport.snapshot.retrievalVersion !==
      cohortExport.snapshot.retrievalVersion
  )
    throw new Error('D2 generation and cohort source lineage disagree');
  Object.values(sourceExport.files).forEach((ref) =>
    rememberRef(refHashes, ref),
  );
  [
    generation.inputs.export,
    generation.inputs.audit,
    generation.inputs.search,
    generation.files.candidates,
    generation.files.bundles,
    generation.files.sourceIdentity,
    generation.files.status,
  ].forEach((ref) => rememberRef(refHashes, ref));
  if (
    semanticInputFingerprint(snapshot) !== generation.semanticInputFingerprint
  )
    throw new Error('D2 generation semantic fingerprint mismatch');

  const selectedBySenseKey = new Map(
    selected.map((target) => [target.senseKey, target]),
  );
  const matchedGenerationSenses = new Set<string>();
  await scanJsonlChecked(
    sourceExport.files.senses,
    'D2 generation export senses',
    RetrievalSenseSchema,
    (sense) => {
      const senseKey = sense.sense.identity?.senseKey;
      if (!senseKey || !selectedBySenseKey.has(senseKey)) return;
      const target = selectedBySenseKey.get(senseKey)!;
      const sourceSense = sourceSenses.get(target.targetKey);
      if (
        !sourceSense ||
        matchedGenerationSenses.has(target.targetKey) ||
        canonicalJson(sense) !== canonicalJson(sourceSense)
      )
        throw new Error(`Cohort and generation sense rows differ: ${senseKey}`);
      matchedGenerationSenses.add(target.targetKey);
    },
  );
  if (matchedGenerationSenses.size !== selected.length)
    throw new Error(
      'D2 generation export does not cover every selected source sense',
    );

  if (audit.exportSha256 !== manifest.sources.export.sha256)
    throw new Error('Source audit belongs to another D2 export');
  audit.sources
    .filter((source) => source.audit.status === 'verified')
    .flatMap((source) => source.audit.evidence)
    .forEach((ref) => rememberRef(refHashes, ref));

  const search = readJsonRefChecked(
    manifest.retrieval.searchManifest,
    SearchManifestSchema,
    'MiniLM search manifest',
  );
  if (
    search.exportSha256 !== manifest.sources.export.sha256 ||
    search.auditSha256 !== manifest.sources.audit.sha256
  )
    throw new Error('MiniLM search is not bound to the frozen D2 inputs');
  search.modelFiles.forEach((ref) => rememberRef(refHashes, ref));
  rememberRef(refHashes, search.results);
  const searchBySense = new Map<string, z.infer<typeof SearchResultSchema>>();
  await scanJsonlChecked(
    search.results,
    'MiniLM search results',
    SearchResultSchema,
    (row) => {
      if (searchBySense.has(row.senseKey))
        throw new Error('Duplicate sense in MiniLM search results');
      searchBySense.set(row.senseKey, row);
    },
  );
  if (searchBySense.size !== selected.length)
    throw new Error('MiniLM search result denominator mismatch');

  const statusBySense = new Map<
    string,
    z.infer<typeof GenerationStatusSchema>
  >();
  await scanJsonlChecked(
    generation.files.status,
    'D2 generation statuses',
    GenerationStatusSchema,
    (row) => {
      if (statusBySense.has(row.senseKey))
        throw new Error('Duplicate sense in D2 generation statuses');
      statusBySense.set(row.senseKey, row);
    },
  );
  if (statusBySense.size !== selected.length)
    throw new Error('D2 status denominator mismatch');

  const targetRows = readJsonlRefChecked(
    manifest.artifacts.targets,
    BatchTargetSchema,
    'Batch targets',
  );
  if (targetRows.length !== selected.length)
    throw new Error('Batch target denominator mismatch');
  const targetsByKey = new Map(
    targetRows.map((target) => [target.targetKey, target]),
  );
  if (targetsByKey.size !== targetRows.length)
    throw new Error('Duplicate target in batch target artifact');
  for (const selectedTarget of selected) {
    const target = targetsByKey.get(selectedTarget.targetKey);
    if (
      !target ||
      canonicalJson(targetProjection(target)) !==
        canonicalJson({
          targetKey: selectedTarget.targetKey,
          senseKey: selectedTarget.senseKey,
          senseId: selectedTarget.senseId,
          lexemeId: selectedTarget.lexemeId,
          lexemeKey: selectedTarget.lexemeKey,
          level: selectedTarget.level,
          pos: selectedTarget.pos,
          enGlossCount: selectedTarget.enGlossCount,
          hasFieldInfo: selectedTarget.hasFieldInfo,
          hasExistingExact: selectedTarget.hasExistingExact,
          originalStatus: selectedTarget.originalStatus,
          strata: selectedTarget.strata,
          sourceRef: selectedTarget.sourceRef,
          split: selectedTarget.split,
          shardId: selectedTarget.shardId,
        })
    )
      throw new Error('Batch target differs from frozen selected cohort');
  }

  const initialResults = readJsonlRefChecked(
    manifest.artifacts.initialTargetResults,
    BatchTargetResultSchema,
    'Initial target results',
  );
  if (
    initialResults.length !== selected.length ||
    new Set(initialResults.map((row) => row.targetKey)).size !== selected.length
  )
    throw new Error('Initial target result denominator mismatch');

  const promptBytes = {
    system: readArtifactChecked(manifest.prompt.system),
    r1: readArtifactChecked(manifest.prompt.r1),
    r2: readArtifactChecked(manifest.prompt.r2),
  };
  const promptHashes = {
    system: hashBytes(promptBytes.system),
    r1: hashBytes(promptBytes.r1),
    r2: hashBytes(promptBytes.r2),
  };
  const scheduleRows = readJsonlRefChecked(
    manifest.artifacts.schedule,
    z.unknown(),
    'Batch schedule',
  );
  const schedule = BatchScheduleSchema.parse({
    schemaVersion: 1,
    task: 'db4_batch_schedule',
    runId: manifest.runId,
    waveId: 'initial',
    createdAt: manifest.createdAt,
    jobs: scheduleRows,
  });
  const candidateHashes = new Map<string, string>();
  const candidateKeysBySense = new Map<string, Set<string>>();
  await scanJsonlChecked(
    generation.files.candidates,
    'Full D1 candidate source',
    z.unknown(),
    (value) => {
      const candidate = parseMappingCandidate(value);
      if (
        candidate.semanticInputFingerprint !==
          generation.semanticInputFingerprint ||
        candidateHashes.has(candidate.candidateKey)
      )
        throw new Error(
          'D2 candidate is duplicate or bound to another fingerprint',
        );
      candidateHashes.set(candidate.candidateKey, hashJson(candidate));
      const rows =
        candidateKeysBySense.get(candidate.sense.semanticKey) ??
        new Set<string>();
      rows.add(candidate.candidateKey);
      candidateKeysBySense.set(candidate.sense.semanticKey, rows);
    },
  );
  if (candidateHashes.size !== generation.counts.candidates)
    throw new Error('D2 full-candidate denominator mismatch');

  const sourceBundlesBySense = new Map<
    string,
    { bundleKey: string; bundleHash: string; candidateKeys: string[] }
  >();
  await scanJsonlChecked(
    generation.files.bundles,
    'D2 mapping bundles',
    MappingBundleSchema,
    (rawBundle) => {
      const bundle = parseMappingBundleIntegrity(rawBundle);
      if (
        bundle.semanticInputFingerprint !==
          generation.semanticInputFingerprint ||
        bundle.builderVersion !== generation.version ||
        bundle.mode !== generation.snapshot.mode ||
        sourceBundlesBySense.has(bundle.sense.semanticKey)
      )
        throw new Error(
          'D2 bundle has duplicate or mismatched generation identity',
        );
      requireSourceAudit(bundle, audit);
      sourceBundlesBySense.set(bundle.sense.semanticKey, {
        bundleKey: bundle.bundleKey,
        bundleHash: hashJson(bundle),
        candidateKeys: bundle.candidates.map(
          (candidate) => candidate.candidateKey,
        ),
      });
    },
  );
  if (sourceBundlesBySense.size !== generation.counts.bundles)
    throw new Error('D2 bundle denominator mismatch');

  const requestsByTarget = new Map<
    string,
    {
      r1?: {
        jobKey: string;
        bundleKey: string;
        dependencyJobKey: string | null;
      };
      r2?: {
        jobKey: string;
        bundleKey: string;
        dependencyJobKey: string | null;
      };
    }
  >();
  const requestJobKeys = new Set<string>();
  const scheduleByJob = new Map(schedule.jobs.map((job) => [job.jobKey, job]));
  let readyCount = 0;
  let noCandidateCount = 0;
  const statusCounts = { ready: 0, no_candidates: 0 };
  for (const shard of manifest.shards) {
    const shardTargets = readJsonlRefChecked(
      shard.targets,
      BatchTargetSchema,
      `Targets ${shard.shardId}`,
    );
    const expectedShardTargets = targetRows.filter(
      (target) => target.shardId === shard.shardId,
    );
    if (
      shardTargets.length !== shard.count ||
      canonicalJson(shardTargets.map(targetProjection)) !==
        canonicalJson(expectedShardTargets.map(targetProjection))
    )
      throw new Error(
        `Shard targets differ from batch target ledger: ${shard.shardId}`,
      );
    const fullCandidates = readJsonlRefChecked(
      shard.candidates,
      z.unknown(),
      `Full candidates ${shard.shardId}`,
    ).map((value) => parseMappingCandidate(value));
    const shardCandidateKeys = new Set<string>();
    for (const candidate of fullCandidates) {
      if (
        shardCandidateKeys.has(candidate.candidateKey) ||
        candidateHashes.get(candidate.candidateKey) !== hashJson(candidate)
      )
        throw new Error(
          `Shard candidate differs from D2 full source: ${shard.shardId}`,
        );
      shardCandidateKeys.add(candidate.candidateKey);
    }
    const shardRequests = {
      r1: readJsonlRefChecked(
        shard.requests.r1,
        RequestSchema,
        `R1 requests ${shard.shardId}`,
      ),
      r2: readJsonlRefChecked(
        shard.requests.r2,
        RequestSchema,
        `R2 requests ${shard.shardId}`,
      ),
    };
    if (
      shardRequests.r1.length !== shard.readyCount ||
      shardRequests.r2.length !== shard.readyCount ||
      shard.readyCount + shard.noCandidateCount !== shard.count
    )
      throw new Error(`Shard phase denominator mismatch: ${shard.shardId}`);
    let shardReady = 0;
    let shardNoCandidate = 0;
    const targetKeys = new Set(shardTargets.map((target) => target.targetKey));
    for (const target of shardTargets) {
      const status = statusBySense.get(
        sourceSenses.get(target.targetKey)!.sense.semanticKey,
      );
      const searchResult = searchBySense.get(
        sourceSenses.get(target.targetKey)!.sense.semanticKey,
      );
      if (
        !status ||
        !searchResult ||
        status.senseId !== target.senseId ||
        searchResult.senseId !== target.senseId
      )
        throw new Error(`D2 status/search missing target ${target.senseKey}`);
      const r1 = shardRequests.r1.find(
        (request) => request.targetKey === target.targetKey,
      );
      const r2 = shardRequests.r2.find(
        (request) => request.targetKey === target.targetKey,
      );
      if (status.status === 'no_candidates') {
        shardNoCandidate++;
        if (
          status.bundleKey !== null ||
          status.candidateCount !== 0 ||
          searchResult.hits.length !== 0 ||
          r1 ||
          r2 ||
          (candidateKeysBySense.get(
            sourceSenses.get(target.targetKey)!.sense.semanticKey,
          )?.size ?? 0) !== 0
        )
          throw new Error(
            `No-candidate target has retrieval/request rows: ${target.senseKey}`,
          );
        continue;
      }
      shardReady++;
      if (
        !r1 ||
        !r2 ||
        !status.bundleKey ||
        !status.candidateCount ||
        !searchResult.hits.length
      )
        throw new Error(
          `Ready target lacks retrieval/request rows: ${target.senseKey}`,
        );
      const sense = sourceSenses.get(target.targetKey)!.sense;
      const candidateKeys = candidateKeysBySense.get(sense.semanticKey);
      const shardRows = fullCandidates.filter(
        (candidate) => candidate.sense.semanticKey === sense.semanticKey,
      );
      if (
        !candidateKeys ||
        shardRows.length !== status.candidateCount ||
        shardRows.length !== candidateKeys.size ||
        shardRows.some(
          (candidate) => !shardCandidateKeys.has(candidate.candidateKey),
        )
      )
        throw new Error(
          `Full candidate rows do not cover target ${target.senseKey}`,
        );
      const bundle = sourceBundlesBySense.get(sense.semanticKey);
      if (!bundle || bundle.bundleKey !== status.bundleKey)
        throw new Error(`D2 bundle/status mismatch for ${target.senseKey}`);
      const rebuiltBundle = createMappingBundle(shardRows, generation.version);
      if (
        canonicalJson(
          rebuiltBundle.candidates.map((candidate) => candidate.candidateKey),
        ) !== canonicalJson(bundle.candidateKeys) ||
        hashJson(rebuiltBundle) !== bundle.bundleHash
      )
        throw new Error(
          `D2 bundle does not match full candidates: ${target.senseKey}`,
        );
      for (const request of [r1, r2]) {
        requireScheduleBinding(
          manifest,
          scheduleByJob,
          request,
          promptHashes,
          bundle.bundleHash,
        );
        if (
          requestJobKeys.has(request.jobKey) ||
          request.targetKey !== target.targetKey ||
          request.senseKey !== target.senseKey ||
          request.bundleKey !== bundle.bundleKey
        )
          throw new Error(
            `Request does not preserve the D2 bundle: ${request.jobKey}`,
          );
        requestJobKeys.add(request.jobKey);
        const group = requestsByTarget.get(target.targetKey) ?? {};
        if (group[request.phase])
          throw new Error(
            `Duplicate ${request.phase} request for ${target.targetKey}`,
          );
        group[request.phase] = {
          jobKey: request.jobKey,
          bundleKey: request.bundleKey,
          dependencyJobKey: request.dependencyJobKey,
        };
        requestsByTarget.set(target.targetKey, group);
      }
    }
    if (targetKeys.size !== shardTargets.length)
      throw new Error(`Duplicate target within shard ${shard.shardId}`);
    if (
      shardReady !== shard.readyCount ||
      shardNoCandidate !== shard.noCandidateCount
    )
      throw new Error(`Shard status counts disagree: ${shard.shardId}`);
    statusCounts.ready += shardReady;
    statusCounts.no_candidates += shardNoCandidate;
    for (const candidate of fullCandidates) {
      if (
        !shardTargets.some(
          (target) => target.senseKey === candidate.sense.identity?.senseKey,
        )
      )
        throw new Error(
          `Shard contains a candidate outside its targets: ${candidate.candidateKey}`,
        );
    }
  }
  readyCount = 0;
  noCandidateCount = 0;
  for (const target of targetRows) {
    const semanticKey = sourceSenses.get(target.targetKey)!.sense.semanticKey;
    const status = statusBySense.get(semanticKey)!;
    const searchResult = searchBySense.get(semanticKey)!;
    if (status.status === 'ready') readyCount++;
    else noCandidateCount++;
    if (
      (status.status === 'ready' && searchResult.hits.length === 0) ||
      (status.status === 'no_candidates' && searchResult.hits.length > 0)
    )
      throw new Error(
        `Search and generation status disagree: ${target.senseKey}`,
      );
  }
  if (
    readyCount !== manifest.retrieval.readyCount ||
    noCandidateCount !== manifest.retrieval.noCandidateCount ||
    readyCount + noCandidateCount !== selected.length ||
    sourceBundlesBySense.size !== readyCount ||
    generation.counts.senses !== selected.length ||
    canonicalJson(generation.counts.statuses) !== canonicalJson(statusCounts)
  )
    throw new Error('Retrieval denominator mismatch');

  for (const request of schedule.jobs) {
    if (request.phase !== 'r1' && request.phase !== 'r2')
      throw new Error('Unexpected initial batch schedule phase');
  }
  if (
    schedule.jobs.length !== readyCount * 2 ||
    requestJobKeys.size !== schedule.jobs.length ||
    requestsByTarget.size !== readyCount ||
    [...requestsByTarget.values()].some(
      (pair) =>
        !pair.r1 ||
        !pair.r2 ||
        pair.r1.dependencyJobKey !== null ||
        pair.r2.dependencyJobKey !== pair.r1.jobKey ||
        pair.r1.bundleKey !== pair.r2.bundleKey,
    )
  )
    throw new Error('Initial R1/R2 schedule denominator mismatch');

  const resultByTarget = new Map(
    initialResults.map((row) => [row.targetKey, row]),
  );
  for (const target of targetRows) {
    const status = statusBySense.get(
      sourceSenses.get(target.targetKey)!.sense.semanticKey,
    )!;
    const expectedStatus =
      status.status === 'ready' ? 'r1_pending' : 'no_candidates';
    if (
      resultByTarget.get(target.targetKey)?.senseKey !== target.senseKey ||
      resultByTarget.get(target.targetKey)?.status !== expectedStatus
    )
      throw new Error(
        `Initial result ledger differs from retrieval status: ${target.senseKey}`,
      );
  }

  const prepIntent = readJsonRefChecked(
    manifest.artifacts.preparationIntent,
    z.record(z.unknown()),
    'Preparation intent',
  );
  const prepReport = readJsonRefChecked(
    manifest.artifacts.preparationReport,
    z.record(z.unknown()),
    'Preparation report',
  );
  const intentIdentity = prepIntent.identity as
    Record<string, unknown> | undefined;
  const reportGates = prepReport.gates as Record<string, unknown> | undefined;
  if (
    prepIntent.task !== 'db4_batch_prepare_intent' ||
    prepIntent.runId !== manifest.runId ||
    prepReport.task !== 'db4_batch_preparation_report' ||
    prepReport.runId !== manifest.runId ||
    prepReport.apply !== false ||
    prepReport.dispatched !== false ||
    prepReport.selectedDenominator !== selected.length ||
    prepReport.r1Planned !== readyCount ||
    prepReport.r2ConditionalPlanned !== readyCount ||
    !intentIdentity ||
    intentIdentity.runId !== manifest.runId ||
    !sameRef(
      ArtifactRefSchema.parse(intentIdentity.sampling),
      manifest.cohort.sampling,
    ) ||
    !sameRef(
      ArtifactRefSchema.parse(intentIdentity.population),
      manifest.cohort.population,
    ) ||
    !sameRef(
      ArtifactRefSchema.parse(intentIdentity.selected),
      manifest.cohort.selected,
    ) ||
    !sameRef(
      ArtifactRefSchema.parse(intentIdentity.generation),
      manifest.retrieval.generationManifest,
    ) ||
    !sameRef(
      ArtifactRefSchema.parse(intentIdentity.audit),
      manifest.sources.audit,
    ) ||
    !sameRef(
      ArtifactRefSchema.parse(intentIdentity.bundles),
      manifest.retrieval.bundles,
    ) ||
    !sameRef(
      ArtifactRefSchema.parse(intentIdentity.statuses),
      manifest.retrieval.statuses,
    ) ||
    canonicalJson(intentIdentity.git) !== canonicalJson(manifest.git) ||
    intentIdentity.promptRevision !== manifest.prompt.revision ||
    canonicalJson(intentIdentity.promptHashes) !==
      canonicalJson(promptHashes) ||
    reportGates?.museCalled !== false ||
    reportGates.databaseWritten !== false ||
    reportGates.cohortValidated !== true ||
    reportGates.sourceAuditValidated !== true ||
    reportGates.generationValidated !== true
  )
    throw new Error(
      'Preparation intent/report is inconsistent with the frozen run',
    );

  for (const ref of refHashes.entries()) {
    const [path, expectedSha] = ref;
    if (!verifiedPaths.has(path))
      await verifyArtifactRef(root, { path, sha256: expectedSha });
  }
  return {
    runId: manifest.runId,
    manifestSha256: hashBytes(manifestBytes),
    selected: selected.length,
    ready: readyCount,
    noCandidate: noCandidateCount,
    requests: schedule.jobs.length,
    shards: manifest.shards.length,
    artifactRefsVerified: refHashes.size,
    apply: false,
    museCalled: false,
  };
}

function requireScheduleBinding(
  manifest: BatchManifest,
  jobs: Map<string, z.infer<typeof BatchScheduleSchema>['jobs'][number]>,
  request: Request,
  promptHashes: { system: string; r1: string; r2: string },
  expectedBundleHash: string,
) {
  const job = jobs.get(request.jobKey);
  const expectedVersion = promptVersion(
    manifest.prompt.revision,
    request.phase,
  );
  const expectedPromptHash = hashJson({
    revision: manifest.prompt.revision,
    version: request.promptVersion,
    systemSha256: promptHashes.system,
    phaseSha256: promptHashes[request.phase],
  });
  const inputHash = hashJson({
    bundleKey: request.bundleKey,
    contextHash: request.payload.bundle.contextHash,
  });
  if (
    !job ||
    job.targetKey !== request.targetKey ||
    job.senseKey !== request.senseKey ||
    job.phase !== request.phase ||
    job.generation !== request.generation ||
    job.bundleKey !== request.bundleKey ||
    job.inputHash !== inputHash ||
    job.promptHash !== request.promptHash ||
    job.renderedHash !== request.renderedContextHash ||
    job.dependsOn !== request.dependencyJobKey ||
    job.kind !== 'review' ||
    job.attempt !== 1 ||
    request.payload.phase !== request.phase ||
    request.payload.promptVersion !== request.promptVersion ||
    request.promptVersion !== expectedVersion ||
    request.promptHash !== expectedPromptHash ||
    request.renderedContextHash !== hashJson(request.payload) ||
    request.bundleKey !== request.payload.bundle.bundleKey ||
    hashJson(normalizeBundleCandidateOrder(request.payload.bundle)) !==
      expectedBundleHash ||
    request.jobKey !==
      createBatchJob(manifest.runId, {
        targetKey: request.targetKey,
        senseKey: request.senseKey,
        shardId: job.shardId,
        generation: request.generation,
        kind: 'review',
        phase: request.phase,
        attempt: job.attempt,
        bundleKey: request.bundleKey,
        inputHash: job.inputHash,
        promptHash: request.promptHash,
        renderedHash: request.renderedContextHash,
        dependsOn: request.dependencyJobKey,
      }).jobKey
  )
    throw new Error(`Request/schedule binding mismatch for ${request.jobKey}`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (
    args.length !== 4 ||
    args[0] !== '--artifact-dir' ||
    args[2] !== '--manifest'
  )
    throw new Error(
      'Usage: batch-preflight.ts --artifact-dir ROOT --manifest PATH',
    );
  void preflightBatchInputs(args[1], args[3])
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error: unknown) => {
      const message =
        error instanceof Error
          ? error.message.slice(0, 1000)
          : 'Preflight failed';
      console.error(
        JSON.stringify({
          errorType: error instanceof Error ? error.name : 'PreflightError',
          message,
        }),
      );
      process.exitCode = 1;
    });
}
