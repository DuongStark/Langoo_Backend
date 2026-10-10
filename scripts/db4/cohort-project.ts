// DB4-D2: bind a frozen selector cohort to a smaller, independently audited export.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  ArtifactRefSchema,
  BigintIdSchema,
  Sha256Schema,
  Text,
  hashBytes,
  hashJson,
  semanticInputFingerprint,
} from './_mapping-types';
import {
  ExportManifestSchema,
  RETRIEVAL_VERSION,
  RetrievalSense,
  artifactPath,
  cliFlags,
  loadExport,
  readArtifact,
  writeArtifact,
  writeJson,
} from './_retrieval';

const Count = z.number().int().nonnegative();
const CohortTargetSchema = z
  .object({
    schemaVersion: z.literal(1),
    task: z.literal('db4_cohort_target'),
    targetKey: Sha256Schema,
    senseKey: Text,
    senseId: BigintIdSchema,
    lexemeId: BigintIdSchema,
    lexemeKey: Text,
    sourceRef: z
      .object({
        file: ArtifactRefSchema,
        line: z.number().int().positive(),
        rowSha256: Sha256Schema,
      })
      .strict(),
    split: z.enum(['development', 'holdout']),
    shardId: Text,
  })
  .passthrough();
const SamplingSchema = z
  .object({
    schemaVersion: z.literal(1),
    task: z.literal('db4_cohort_sampling'),
    selectorVersion: Text,
    seed: Text,
    input: z
      .object({
        exportManifest: ArtifactRefSchema,
        sourceSenseFile: ArtifactRefSchema,
      })
      .passthrough(),
    config: z.object({ shardTarget: Count, maxShards: Count }).passthrough(),
    counts: z
      .object({
        eligible: Count,
        selected: Count,
        development: Count,
        holdout: Count,
        shards: Count,
        shardCounts: z.record(Text, Count),
      })
      .passthrough(),
    files: z
      .object({ population: ArtifactRefSchema, selected: ArtifactRefSchema })
      .passthrough(),
    constraints: z
      .object({
        lexemeDisjoint: z.boolean(),
        pilotLexemesInDevelopment: z.boolean(),
        duplicateSenseKeys: z.boolean(),
        withinPlanTarget: z.boolean(),
        developmentQuotaMet: z.boolean(),
        holdoutQuotaMet: z.boolean(),
      })
      .passthrough(),
  })
  .passthrough();

type CohortTarget = z.infer<typeof CohortTargetSchema>;
type SenseIdentity = Pick<RetrievalSense, 'sense'>;

export function bindSelectedTargets(
  sourceBytes: Buffer,
  sourceRef: z.infer<typeof ArtifactRefSchema>,
  senses: SenseIdentity[],
  targets: CohortTarget[],
  snapshotFingerprint: string,
) {
  const rawLines = sourceBytes.toString('utf8').split('\n');
  if (rawLines.at(-1) !== '')
    throw new Error('Sense export must end with a newline');
  rawLines.pop();
  if (rawLines.length !== senses.length)
    throw new Error('Sense export line count mismatch');

  const seenLines = new Set<number>();
  const seenKeys = new Set<string>();
  const seenIds = new Set<string>();
  const seenLexemes = new Map<string, { split: string; shardId: string }>();
  const selected = targets.map((target) => {
    const { line, rowSha256, file } = target.sourceRef;
    if (file.path !== sourceRef.path || file.sha256 !== sourceRef.sha256)
      throw new Error('Cohort target references another sense export');
    if (line > rawLines.length || seenLines.has(line))
      throw new Error('Cohort target line is out of range or duplicated');
    const rawLine = rawLines[line - 1];
    if (!rawLine || rawLine.endsWith('\r'))
      throw new Error(`Invalid source sense line ${line}`);
    if (hashBytes(Buffer.from(`${rawLine}\n`, 'utf8')) !== rowSha256)
      throw new Error(`Cohort target row hash mismatch at line ${line}`);

    const sense = senses[line - 1].sense;
    const identity = sense.identity;
    if (
      !identity ||
      sense.id !== target.senseId ||
      sense.lexemeId !== target.lexemeId ||
      identity.senseKey !== target.senseKey ||
      identity.externalId !== target.lexemeKey
    )
      throw new Error(`Cohort target identity mismatch at line ${line}`);
    const expectedTargetKey = hashJson({
      schemaVersion: 1,
      task: 'db4_cohort_target',
      snapshotFingerprint,
      semanticKey: sense.semanticKey,
    });
    if (target.targetKey !== expectedTargetKey)
      throw new Error(`Cohort target key mismatch at line ${line}`);
    if (seenKeys.has(target.senseKey) || seenIds.has(target.senseId))
      throw new Error('Duplicate selected sense identity');
    const priorAssignment = seenLexemes.get(target.lexemeKey);
    if (priorAssignment && priorAssignment.split !== target.split)
      throw new Error('Selected lexeme is split across development/holdout');
    if (priorAssignment && priorAssignment.shardId !== target.shardId)
      throw new Error('Selected lexeme is split across shards');

    seenLines.add(line);
    seenKeys.add(target.senseKey);
    seenIds.add(target.senseId);
    seenLexemes.set(target.lexemeKey, {
      split: target.split,
      shardId: target.shardId,
    });
    return { line, target, rawLine };
  });

  return selected.sort((a, b) => a.line - b.line);
}

export async function projectCohort(flags: Record<string, string>) {
  const root = resolve(flags['artifact-dir'] ?? 'uploads/db4');
  const manifestPath = flags.manifest ?? 'export/manifest.json';
  const samplingPath = flags.sampling;
  const prefix = flags.prefix ?? 'cohort-export/jlpt-n1-n5-v1';
  if (!samplingPath) throw new Error('Missing --sampling');

  const parent = await loadExport(root, manifestPath);
  const parentManifestSha = hashBytes(parent.bytes);
  const samplingBytes = readFileSync(artifactPath(root, samplingPath));
  const sampling = SamplingSchema.parse(
    JSON.parse(samplingBytes.toString('utf8')) as unknown,
  );
  const samplingSha = hashBytes(samplingBytes);
  const sourceManifestRef = {
    path: manifestPath,
    sha256: parentManifestSha,
  };
  if (
    sampling.input.exportManifest.path !== sourceManifestRef.path ||
    sampling.input.exportManifest.sha256 !== sourceManifestRef.sha256 ||
    sampling.input.sourceSenseFile.path !== parent.manifest.files.senses.path ||
    sampling.input.sourceSenseFile.sha256 !==
      parent.manifest.files.senses.sha256 ||
    sampling.counts.eligible !== parent.manifest.counts.senses
  )
    throw new Error(
      'Sampling artifact is not bound to the complete source export',
    );
  if (
    !sampling.constraints.lexemeDisjoint ||
    !sampling.constraints.pilotLexemesInDevelopment ||
    sampling.constraints.duplicateSenseKeys ||
    !sampling.constraints.withinPlanTarget ||
    !sampling.constraints.developmentQuotaMet ||
    !sampling.constraints.holdoutQuotaMet
  )
    throw new Error('Sampling artifact has a failed cohort constraint');

  const population = JSON.parse(
    readArtifact(root, sampling.files.population).toString('utf8'),
  ) as {
    export?: { manifest?: { path?: string; sha256?: string } };
    counts?: { eligible?: number; selected?: number };
  };
  if (
    population.export?.manifest?.path !== sourceManifestRef.path ||
    population.export?.manifest?.sha256 !== sourceManifestRef.sha256 ||
    population.counts?.eligible !== sampling.counts.eligible ||
    population.counts?.selected !== sampling.counts.selected
  )
    throw new Error('Population artifact does not match the sampling manifest');

  const selectedBytes = readArtifact(root, sampling.files.selected);
  const targetLines = selectedBytes.toString('utf8').split('\n');
  if (targetLines.at(-1) !== '')
    throw new Error('Selected cohort must end with a newline');
  targetLines.pop();
  if (targetLines.some((line) => !line))
    throw new Error('Selected cohort contains a blank row');
  const selectedRows = targetLines.map((line) =>
    CohortTargetSchema.parse(JSON.parse(line) as unknown),
  );
  if (selectedRows.length !== sampling.counts.selected)
    throw new Error('Selected cohort count does not match sampling manifest');
  const splitCounts = selectedRows.reduce(
    (counts, target) => {
      counts[target.split]++;
      return counts;
    },
    { development: 0, holdout: 0 },
  );
  if (
    splitCounts.development !== sampling.counts.development ||
    splitCounts.holdout !== sampling.counts.holdout
  )
    throw new Error('Selected split counts do not match sampling manifest');
  const actualShardCounts: Record<string, number> = {};
  for (const target of selectedRows)
    actualShardCounts[target.shardId] =
      (actualShardCounts[target.shardId] ?? 0) + 1;
  if (
    JSON.stringify(Object.entries(actualShardCounts).sort()) !==
      JSON.stringify(Object.entries(sampling.counts.shardCounts).sort()) ||
    Object.values(actualShardCounts).some(
      (count) => count > sampling.config.shardTarget,
    ) ||
    Object.keys(actualShardCounts).length !== sampling.counts.shards ||
    sampling.counts.shards > sampling.config.maxShards
  )
    throw new Error('Selected shard counts do not match sampling manifest');

  const sourceSenseBytes = readArtifact(root, parent.manifest.files.senses);
  const projected = bindSelectedTargets(
    sourceSenseBytes,
    parent.manifest.files.senses,
    parent.senses,
    selectedRows,
    parent.manifest.semanticInputFingerprint,
  );
  const senseBytes = projected.map(({ rawLine }) => `${rawLine}\n`).join('');
  const sensesRef = writeArtifact(root, `${prefix}/senses.jsonl`, senseBytes);
  const originalInventory = JSON.parse(
    readArtifact(root, parent.manifest.files.inventory).toString('utf8'),
  ) as Record<string, unknown>;
  const inventoryRef = writeJson(root, `${prefix}/inventory.json`, {
    ...originalInventory,
    cohort: 'jlpt-n1-n5-selected',
    cohortCount: projected.length,
    truncated: false,
    limit: projected.length,
    projectedFrom: {
      exportManifest: sourceManifestRef,
      sourceSenseFile: parent.manifest.files.senses,
      sampling: { path: samplingPath, sha256: samplingSha },
      population: sampling.files.population,
      selected: sampling.files.selected,
      populationCount: sampling.counts.eligible,
      selectedCount: sampling.counts.selected,
      splitCounts,
      shardCounts: actualShardCounts,
    },
  });
  const snapshot = {
    ...parent.manifest.snapshot,
    identityHash: hashJson({
      inventory: inventoryRef.sha256,
      senses: sensesRef.sha256,
      concepts: parent.manifest.files.concepts.sha256,
    }),
    senseInputHash: sensesRef.sha256,
    rawAttributesHash: sensesRef.sha256,
    retrievalVersion: RETRIEVAL_VERSION,
  };
  const manifest = ExportManifestSchema.parse({
    schemaVersion: 1,
    task: 'db4_retrieval_export',
    createdAt: new Date().toISOString(),
    cohort: 'jlpt-n1-n5-selected',
    snapshot,
    semanticInputFingerprint: semanticInputFingerprint(snapshot),
    files: {
      senses: sensesRef,
      concepts: parent.manifest.files.concepts,
      sources: parent.manifest.files.sources,
      inventory: inventoryRef,
    },
    counts: {
      senses: projected.length,
      concepts: parent.manifest.counts.concepts,
    },
  });
  const manifestRef = writeJson(root, `${prefix}/manifest.json`, manifest);
  const projectionRef = writeJson(root, `${prefix}/projection.json`, {
    schemaVersion: 1,
    task: 'db4_cohort_export_projection',
    createdAt: manifest.createdAt,
    sourceExportManifest: sourceManifestRef,
    sourceSenseFile: parent.manifest.files.senses,
    sampling: { path: samplingPath, sha256: samplingSha },
    population: sampling.files.population,
    selected: sampling.files.selected,
    projectedExport: manifestRef,
    counts: {
      population: sampling.counts.eligible,
      projected: projected.length,
      development: splitCounts.development,
      holdout: splitCounts.holdout,
      shards: actualShardCounts,
    },
    checks: {
      selectedRowsBoundToSource: true,
      targetKeysBoundToSnapshot: true,
      lexemeSplitDisjoint: true,
      inventoryAndManifestRehashed: true,
    },
  });
  const result = {
    manifest: manifestRef,
    projection: projectionRef,
    counts: manifest.counts,
    splitCounts,
    apply: false,
  };
  console.log(JSON.stringify(result));
  return result;
}

if (require.main === module) {
  void projectCohort(
    cliFlags(process.argv.slice(2), [
      'artifact-dir',
      'manifest',
      'sampling',
      'prefix',
    ]),
  ).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
