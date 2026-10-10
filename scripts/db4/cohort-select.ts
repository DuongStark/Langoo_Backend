// DB4-D2: freeze an accepted JLPT N1-N5 sample and lexeme-disjoint split.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  ArtifactPath,
  ArtifactRefSchema,
  BigintIdSchema,
  Count,
  Sha256Schema,
  Text,
  canonicalJson,
  hashBytes,
  hashJson,
  semanticInputFingerprint,
} from './_mapping-types';
import {
  ExportManifestSchema,
  RETRIEVAL_VERSION,
  RetrievalSense,
  RetrievalSenseSchema,
  artifactPath,
  cliFlags,
  readArtifact,
  writeArtifact,
  writeJson,
} from './_retrieval';

const SELECTOR_VERSION = 'db4-d2-jlpt-lexeme-split-v1';
const TARGETS = 1000;
const DEVELOPMENT_TARGET = 200;
const HOLDOUT_TARGET = 800;
const SPLIT_DEVELOPMENT_PER_10K = 2000;
const MAX_SENSES_PER_LEXEME = 5;
const SHARD_TARGET = 100;
const MAX_SHARDS = 10;
const SenseKey = z.string().regex(/^jmdict:[0-9]+:[1-9][0-9]*$/);
const LexemeKey = z.string().regex(/^jmdict:[0-9]+$/);
const PositiveInt = z.number().int().positive();

const KnownDevelopmentSchema = z
  .object({
    schemaVersion: z.literal(1),
    task: z.literal('db4_known_development_lexemes'),
    sources: z
      .array(
        z
          .object({
            id: Text,
            path: ArtifactPath,
            sha256: Sha256Schema,
            recordCount: Count,
            identityExtraction: Text,
            selectedR1Rows: Count.optional(),
            uniqueLexemes: Count.optional(),
            note: Text.optional(),
          })
          .strict(),
      )
      .min(1),
    lexemeExternalIds: z.array(LexemeKey).min(1),
  })
  .strict()
  .superRefine((known, ctx) => {
    if (
      new Set(known.lexemeExternalIds).size !== known.lexemeExternalIds.length
    )
      ctx.addIssue({ code: 'custom', message: 'Duplicate known lexeme id' });
    if (
      known.lexemeExternalIds.some(
        (id, index) => index > 0 && known.lexemeExternalIds[index - 1] >= id,
      )
    )
      ctx.addIssue({ code: 'custom', message: 'Known lexemes must be sorted' });
  });

const SourceRowRefSchema = z
  .object({
    file: ArtifactRefSchema,
    line: PositiveInt,
    rowSha256: Sha256Schema,
  })
  .strict();
const OriginalStatus = z.enum([
  'unlinked',
  'existing_nonexact',
  'existing_exact',
]);
const PosFamily = z.enum([
  'noun',
  'verb',
  'adjective_adverb',
  'expression',
  'other',
]);
const GlossCount = z.enum(['zero', 'one', 'multiple']);
const FieldInfo = z.enum(['present', 'absent']);
const Split = z.enum(['development', 'holdout']);
const lexicalSort = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const TargetStrataSchema = z
  .object({
    level: z.number().int().min(1).max(5),
    posFamily: PosFamily,
    glossCount: GlossCount,
    fieldInfo: FieldInfo,
    originalStatus: OriginalStatus,
  })
  .strict();
const CohortTargetSchema = z
  .object({
    schemaVersion: z.literal(1),
    task: z.literal('db4_cohort_target'),
    targetKey: Sha256Schema,
    senseKey: SenseKey,
    senseId: BigintIdSchema,
    lexemeId: BigintIdSchema,
    lexemeKey: LexemeKey,
    level: z.number().int().min(1).max(5),
    pos: z.array(Text),
    enGlossCount: Count,
    hasFieldInfo: z.boolean(),
    hasExistingExact: z.boolean(),
    originalStatus: OriginalStatus,
    strata: TargetStrataSchema,
    sourceRef: SourceRowRefSchema,
    split: Split,
    shardId: z.string().regex(/^(dev|holdout)-[0-9]{2}$/),
  })
  .strict()
  .superRefine((target, ctx) => {
    if (
      target.hasExistingExact !==
      (target.originalStatus === 'existing_exact')
    )
      ctx.addIssue({
        code: 'custom',
        path: ['originalStatus'],
        message: 'Existing exact status does not match link flag',
      });
    if (
      target.level !== target.strata.level ||
      (target.enGlossCount === 0) !== (target.strata.glossCount === 'zero') ||
      target.hasFieldInfo !== (target.strata.fieldInfo === 'present') ||
      target.originalStatus !== target.strata.originalStatus
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Target strata are inconsistent',
      });
  });

type StratumDimension =
  'level' | 'posFamily' | 'glossCount' | 'fieldInfo' | 'originalStatus';
type SenseRecord = {
  row: RetrievalSense;
  line: number;
  rowSha256: string;
  senseKey: string;
  lexemeKey: string;
  strata: z.infer<typeof TargetStrataSchema>;
  pos: string[];
  originalStatus: z.infer<typeof OriginalStatus>;
};
type LexemeGroup = {
  lexemeKey: string;
  knownDevelopment: boolean;
  split: z.infer<typeof Split>;
  eligibleRows: SenseRecord[];
  selectableRows: SenseRecord[];
};

function stableHash(seed: string, key: string): string {
  return hashJson({ schemaVersion: 1, task: 'db4_cohort_select', seed, key });
}

function cmpHash(a: string, b: string): number {
  return lexicalSort(a, b);
}

function hashBucket(seed: string, key: string, modulo: number): number {
  return Number(
    BigInt(`0x${stableHash(seed, key).slice(0, 16)}`) % BigInt(modulo),
  );
}

function posFamily(values: string[]): z.infer<typeof PosFamily> {
  const normalized = values.map((value) => value.toLowerCase().trim());
  const has = (expression: RegExp) =>
    normalized.some((value) => expression.test(value));
  if (has(/^(noun|proper noun|nouns?|n-pr|n-pref|n-suf)$/)) return 'noun';
  if (has(/^(verb|v[0-9a-z-]*|verb-[0-9a-z-]*)$/)) return 'verb';
  if (
    has(
      /^(adjective|adverb|adj(?:ective)?[-_].*|adv(?:erb)?[-_].*|i-adjective|na-adjective)$/,
    )
  )
    return 'adjective_adverb';
  if (
    has(
      /^(expression|interjection|pronoun|conjunction|prefix|suffix|particle|auxiliary|copula|determiner|numeral|counter)$/,
    )
  )
    return 'expression';
  return 'other';
}

function textRows(values: RetrievalSense['senseContext']['enGlosses']) {
  return values.filter((row) => row.language === 'en');
}

function toSenseRecord(
  row: RetrievalSense,
  line: number,
  rowSha256: string,
): SenseRecord | { excluded: string } {
  const sense = row.sense;
  if (sense.language !== 'ja') return { excluded: 'not_japanese' };
  if (!sense.id || !sense.lexemeId) return { excluded: 'missing_database_id' };
  if (
    sense.identity?.sourceKey !== 'jmdict' ||
    !LexemeKey.safeParse(sense.identity.externalId).success ||
    !SenseKey.safeParse(sense.identity.senseKey).success ||
    !sense.identity.senseKey.startsWith(`${sense.identity.externalId}:`)
  )
    return { excluded: 'invalid_jmdict_identity' };
  if (sense.jlptLevel === null) return { excluded: 'missing_jlpt_level' };
  const glossCount = textRows(row.senseContext.enGlosses).length;
  const definitionCount = row.senseContext.definitions.filter(
    (definition) => definition.language === 'en',
  ).length;
  if (!glossCount && !definitionCount)
    return { excluded: 'no_english_context' };
  const pos = [...new Set(row.senseContext.metadata.normalizedPos)].sort();
  const hasFieldInfo = Boolean(
    row.senseContext.metadata.field.length ||
    row.senseContext.metadata.info.length,
  );
  const hasExistingExact = row.existingLinks.some(
    (link) => link.relation === 'exact',
  );
  const originalStatus = hasExistingExact
    ? 'existing_exact'
    : row.existingLinks.length
      ? 'existing_nonexact'
      : 'unlinked';
  return {
    row,
    line,
    rowSha256,
    senseKey: sense.identity.senseKey,
    lexemeKey: sense.identity.externalId,
    pos,
    originalStatus,
    strata: {
      level: sense.jlptLevel,
      posFamily: posFamily(pos),
      glossCount:
        glossCount === 0 ? 'zero' : glossCount === 1 ? 'one' : 'multiple',
      fieldInfo: hasFieldInfo ? 'present' : 'absent',
      originalStatus,
    },
  };
}

function stratumValue(
  record: SenseRecord,
  dimension: StratumDimension,
): string {
  const value = record.strata[dimension];
  return dimension === 'level' ? `N${value}` : String(value);
}

function countValues(rows: SenseRecord[], dimension: StratumDimension) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = stratumValue(row, dimension);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.fromEntries(
    [...counts.entries()].sort(([a], [b]) => lexicalSort(a, b)),
  );
}

function splitGroups(groups: LexemeGroup[], seed: string, known: Set<string>) {
  for (const group of groups) {
    group.knownDevelopment = known.has(group.lexemeKey);
    group.split =
      group.knownDevelopment ||
      hashBucket(seed, `split:${group.lexemeKey}`, 10_000) <
        SPLIT_DEVELOPMENT_PER_10K
        ? 'development'
        : 'holdout';
    group.selectableRows = [...group.eligibleRows]
      .sort(
        (a, b) =>
          cmpHash(
            stableHash(seed, `sense-cap:${a.senseKey}`),
            stableHash(seed, `sense-cap:${b.senseKey}`),
          ) || lexicalSort(a.senseKey, b.senseKey),
      )
      .slice(0, MAX_SENSES_PER_LEXEME);
  }
  const capacity = (split: z.infer<typeof Split>) =>
    groups
      .filter((group) => group.split === split)
      .reduce((total, group) => total + group.selectableRows.length, 0);
  const groupOrder = (split: z.infer<typeof Split>, phase: string) =>
    groups
      .filter((group) => group.split === split && !group.knownDevelopment)
      .sort(
        (a, b) =>
          a.selectableRows.length - b.selectableRows.length ||
          cmpHash(
            stableHash(seed, `${phase}:${a.lexemeKey}`),
            stableHash(seed, `${phase}:${b.lexemeKey}`),
          ) ||
          lexicalSort(a.lexemeKey, b.lexemeKey),
      );

  let devCapacity = capacity('development');
  let holdoutCapacity = capacity('holdout');
  const totalCapacity = groups.reduce(
    (sum, group) => sum + group.selectableRows.length,
    0,
  );
  const devTarget = Math.min(DEVELOPMENT_TARGET, totalCapacity);
  const holdoutTarget = Math.min(
    HOLDOUT_TARGET,
    Math.max(0, totalCapacity - devTarget),
  );
  for (const group of groupOrder('holdout', 'rebalance-to-development')) {
    if (devCapacity >= devTarget) break;
    if (holdoutCapacity - group.selectableRows.length < holdoutTarget) continue;
    group.split = 'development';
    devCapacity += group.selectableRows.length;
    holdoutCapacity -= group.selectableRows.length;
  }
  for (const group of groupOrder('development', 'rebalance-to-holdout')) {
    if (holdoutCapacity >= holdoutTarget) break;
    if (devCapacity - group.selectableRows.length < devTarget) continue;
    group.split = 'holdout';
    devCapacity -= group.selectableRows.length;
    holdoutCapacity += group.selectableRows.length;
  }
  if (
    groups.some(
      (group) => group.knownDevelopment && group.split !== 'development',
    )
  )
    throw new Error('Known pilot lexeme assigned outside development');
}

function dimensionsFor() {
  return [
    'level',
    'posFamily',
    'glossCount',
    'fieldInfo',
    'originalStatus',
  ].map((name) => name as StratumDimension);
}

function stratifiedSelection(
  groups: LexemeGroup[],
  split: z.infer<typeof Split>,
  target: number,
  seed: string,
) {
  const candidates = groups
    .filter((group) => group.split === split)
    .flatMap((group) => group.selectableRows)
    .sort((a, b) => lexicalSort(a.senseKey, b.senseKey));
  const targetCount = Math.min(target, candidates.length);
  const dimensions = dimensionsFor();
  const quota = new Map<StratumDimension, Map<string, number>>();
  for (const dimension of dimensions) {
    const counts = countValues(candidates, dimension);
    quota.set(
      dimension,
      new Map(
        Object.entries(counts).map(([value, count]) => [
          value,
          (targetCount * count) / candidates.length,
        ]),
      ),
    );
  }
  const chosen = new Set<string>();
  const selected: SenseRecord[] = [];
  const countsByDimension = new Map(
    dimensions.map((dimension) => [dimension, new Map<string, number>()]),
  );
  while (selected.length < targetCount) {
    let best: SenseRecord | undefined;
    let bestScore = -1;
    let bestTie = '';
    for (const candidate of candidates) {
      if (chosen.has(candidate.senseKey)) continue;
      let score = 0;
      for (const dimension of dimensions) {
        const value = stratumValue(candidate, dimension);
        const goal = quota.get(dimension)?.get(value) ?? 0;
        const count = countsByDimension.get(dimension)?.get(value) ?? 0;
        score += Math.max(0, goal - count) / Math.max(1, targetCount);
      }
      const tie = stableHash(seed, `sample:${candidate.senseKey}`);
      if (
        score > bestScore + Number.EPSILON ||
        (Math.abs(score - bestScore) <= Number.EPSILON &&
          (!best ||
            tie < bestTie ||
            (tie === bestTie && candidate.senseKey < best.senseKey)))
      ) {
        best = candidate;
        bestScore = score;
        bestTie = tie;
      }
    }
    if (!best) break;
    selected.push(best);
    chosen.add(best.senseKey);
    for (const dimension of dimensions) {
      const value = stratumValue(best, dimension);
      const dimensionCounts = countsByDimension.get(dimension)!;
      dimensionCounts.set(value, (dimensionCounts.get(value) ?? 0) + 1);
    }
  }
  return { candidates, selected, targetCount };
}

function assignShards(
  selected: SenseRecord[],
  groups: LexemeGroup[],
  seed: string,
): Map<string, string> {
  const selectedKeys = new Set(selected.map((row) => row.senseKey));
  const assignment = new Map<string, string>();
  for (const split of ['development', 'holdout'] as const) {
    const selectedByLexeme = groups
      .filter((group) => group.split === split)
      .map((group) => ({
        group,
        count: group.selectableRows.filter((row) =>
          selectedKeys.has(row.senseKey),
        ).length,
      }))
      .filter((item) => item.count > 0)
      .sort(
        (a, b) =>
          b.count - a.count ||
          cmpHash(
            stableHash(seed, `shard:${a.group.lexemeKey}`),
            stableHash(seed, `shard:${b.group.lexemeKey}`),
          ) ||
          lexicalSort(a.group.lexemeKey, b.group.lexemeKey),
      );
    const shardCount = Math.min(
      MAX_SHARDS,
      Math.ceil(
        selectedByLexeme.reduce((total, item) => total + item.count, 0) /
          SHARD_TARGET,
      ),
    );
    let packed:
      { bins: number[]; shardByLexeme: Map<string, number> } | undefined;
    for (let attempt = 0; attempt < 128 && !packed; attempt++) {
      const ordered = [...selectedByLexeme].sort(
        (a, b) =>
          b.count - a.count ||
          cmpHash(
            stableHash(seed, `shard:${split}:${attempt}:${a.group.lexemeKey}`),
            stableHash(seed, `shard:${split}:${attempt}:${b.group.lexemeKey}`),
          ) ||
          lexicalSort(a.group.lexemeKey, b.group.lexemeKey),
      );
      const bins = Array.from({ length: shardCount }, () => 0);
      const shardByLexeme = new Map<string, number>();
      let failed = false;
      for (const item of ordered) {
        let index = -1;
        for (let candidate = 0; candidate < bins.length; candidate++) {
          if (
            bins[candidate] + item.count <= SHARD_TARGET &&
            (index === -1 || bins[candidate] < bins[index])
          )
            index = candidate;
        }
        if (index === -1) {
          failed = true;
          break;
        }
        bins[index] += item.count;
        shardByLexeme.set(item.group.lexemeKey, index);
      }
      if (!failed) packed = { bins, shardByLexeme };
    }
    if (!packed || packed.bins.some((count) => count > SHARD_TARGET))
      throw new Error(`Could not pack ${split} lexemes within shard target`);
    for (const [lexemeKey, index] of packed.shardByLexeme)
      assignment.set(
        lexemeKey,
        `${split === 'development' ? 'dev' : 'holdout'}-${String(index + 1).padStart(2, '0')}`,
      );
  }
  return assignment;
}

function makeStratificationReport(
  split: z.infer<typeof Split>,
  eligible: SenseRecord[],
  selectable: SenseRecord[],
  selected: SenseRecord[],
  target: number,
) {
  const selectedCount = Math.min(target, selectable.length);
  const dimensions = Object.fromEntries(
    dimensionsFor().map((dimension) => {
      const populationCounts = countValues(eligible, dimension);
      const selectableCounts = countValues(selectable, dimension);
      const selectedCounts = countValues(selected, dimension);
      const values = [
        ...new Set([
          ...Object.keys(populationCounts),
          ...Object.keys(selectableCounts),
          ...Object.keys(selectedCounts),
        ]),
      ].sort(lexicalSort);
      return [
        dimension,
        Object.fromEntries(
          values.map((value) => [
            value,
            {
              population: populationCounts[value] ?? 0,
              selectable: selectableCounts[value] ?? 0,
              quota:
                selectable.length === 0
                  ? 0
                  : Number(
                      (
                        (selectedCount * (selectableCounts[value] ?? 0)) /
                        selectable.length
                      ).toFixed(3),
                    ),
              selected: selectedCounts[value] ?? 0,
            },
          ]),
        ),
      ];
    }),
  );
  return {
    split,
    target,
    available: selectable.length,
    selected: selected.length,
    dimensions,
  };
}

export function selectCohort(
  rows: SenseRecord[],
  seed: string,
  knownDevelopmentIds: string[],
  sourceFile: z.infer<typeof ArtifactRefSchema>,
  snapshotFingerprint: string,
) {
  const groupsByKey = new Map<string, LexemeGroup>();
  for (const row of rows) {
    let group = groupsByKey.get(row.lexemeKey);
    if (!group) {
      group = {
        lexemeKey: row.lexemeKey,
        knownDevelopment: false,
        split: 'holdout',
        eligibleRows: [],
        selectableRows: [],
      };
      groupsByKey.set(row.lexemeKey, group);
    }
    group.eligibleRows.push(row);
  }
  const groups = [...groupsByKey.values()];
  const knownSet = new Set(knownDevelopmentIds);
  splitGroups(groups, seed, knownSet);
  const dev = stratifiedSelection(
    groups,
    'development',
    DEVELOPMENT_TARGET,
    seed,
  );
  const holdout = stratifiedSelection(groups, 'holdout', HOLDOUT_TARGET, seed);
  const selected = [...dev.selected, ...holdout.selected];
  const shardByLexeme = assignShards(selected, groups, seed);
  const targets = selected
    .map((record) => {
      const identity = record.row.sense.identity!;
      const split = groupsByKey.get(record.lexemeKey)!.split;
      const target = {
        schemaVersion: 1 as const,
        task: 'db4_cohort_target' as const,
        targetKey: hashJson({
          schemaVersion: 1,
          task: 'db4_cohort_target',
          snapshotFingerprint,
          semanticKey: record.row.sense.semanticKey,
        }),
        senseKey: record.senseKey,
        senseId: record.row.sense.id!,
        lexemeId: record.row.sense.lexemeId!,
        lexemeKey: record.lexemeKey,
        level: record.row.sense.jlptLevel!,
        pos: record.pos,
        enGlossCount: textRows(record.row.senseContext.enGlosses).length,
        hasFieldInfo: record.strata.fieldInfo === 'present',
        hasExistingExact: record.originalStatus === 'existing_exact',
        originalStatus: record.originalStatus,
        strata: record.strata,
        sourceRef: {
          file: sourceFile,
          line: record.line,
          rowSha256: record.rowSha256,
        },
        split,
        shardId: shardByLexeme.get(record.lexemeKey)!,
      };
      return CohortTargetSchema.parse({
        ...target,
        senseKey: identity.senseKey,
      });
    })
    .sort(
      (a, b) =>
        lexicalSort(a.split, b.split) ||
        lexicalSort(a.shardId, b.shardId) ||
        lexicalSort(a.senseKey, b.senseKey),
    );
  const lexemeSplits = new Map<string, Set<string>>();
  for (const target of targets) {
    const values = lexemeSplits.get(target.lexemeKey) ?? new Set<string>();
    values.add(target.split);
    lexemeSplits.set(target.lexemeKey, values);
  }
  if ([...lexemeSplits.values()].some((splits) => splits.size !== 1))
    throw new Error('Lexeme split leakage detected');
  if (new Set(targets.map((target) => target.senseKey)).size !== targets.length)
    throw new Error('Duplicate selected sense key');
  const shardCounts = new Map<string, number>();
  for (const target of targets)
    shardCounts.set(target.shardId, (shardCounts.get(target.shardId) ?? 0) + 1);
  if (
    targets.length > TARGETS ||
    [...shardCounts.values()].some((n) => n > SHARD_TARGET) ||
    shardCounts.size > MAX_SHARDS
  )
    throw new Error('Selected/shard target cap exceeded');
  const splitAssignment = groups
    .map((group) => ({
      lexemeKey: group.lexemeKey,
      split: group.split,
      knownDevelopment: group.knownDevelopment,
      eligibleRows: group.eligibleRows.length,
      selectableRows: group.selectableRows.length,
    }))
    .sort((a, b) => lexicalSort(a.lexemeKey, b.lexemeKey));
  return {
    targets,
    groups,
    shardCounts: Object.fromEntries(
      [...shardCounts.entries()].sort(([a], [b]) => lexicalSort(a, b)),
    ),
    stratification: [
      makeStratificationReport(
        'development',
        rows.filter(
          (row) => groupsByKey.get(row.lexemeKey)!.split === 'development',
        ),
        dev.candidates,
        dev.selected,
        DEVELOPMENT_TARGET,
      ),
      makeStratificationReport(
        'holdout',
        rows.filter(
          (row) => groupsByKey.get(row.lexemeKey)!.split === 'holdout',
        ),
        holdout.candidates,
        holdout.selected,
        HOLDOUT_TARGET,
      ),
    ],
    splitCounts: {
      development: {
        population: rows.filter(
          (row) => groupsByKey.get(row.lexemeKey)!.split === 'development',
        ).length,
        lexemes: groups.filter((group) => group.split === 'development').length,
        selectableCapacity: dev.candidates.length,
        selected: dev.selected.length,
        requested: DEVELOPMENT_TARGET,
      },
      holdout: {
        population: rows.filter(
          (row) => groupsByKey.get(row.lexemeKey)!.split === 'holdout',
        ).length,
        lexemes: groups.filter((group) => group.split === 'holdout').length,
        selectableCapacity: holdout.candidates.length,
        selected: holdout.selected.length,
        requested: HOLDOUT_TARGET,
      },
    },
    unmatchedKnownLexemes: knownDevelopmentIds
      .filter((id) => !groupsByKey.has(id))
      .sort(),
    splitAssignmentSha256: hashBytes(canonicalJson(splitAssignment)),
  };
}

function loadVerifiedInput(root: string, manifestPath: string) {
  const manifestBytes = readFileSync(artifactPath(root, manifestPath));
  const manifest = ExportManifestSchema.parse(
    JSON.parse(manifestBytes.toString()),
  );
  if (manifest.cohort !== 'jlpt-n1-n5')
    throw new Error(
      'Selector requires a jlpt-n1-n5 export; legacy jlpt is N4/N5 only',
    );
  if (
    semanticInputFingerprint(manifest.snapshot) !==
      manifest.semanticInputFingerprint ||
    manifest.snapshot.senseInputHash !== manifest.files.senses.sha256 ||
    manifest.snapshot.conceptInputHash !== manifest.files.concepts.sha256 ||
    manifest.snapshot.retrievalVersion !== RETRIEVAL_VERSION
  )
    throw new Error(
      'Export manifest fingerprint or retrieval version mismatch',
    );
  const inventory = z
    .object({
      cohort: z.string(),
      cohortCount: Count,
      truncated: z.boolean(),
    })
    .passthrough()
    .parse(JSON.parse(readArtifact(root, manifest.files.inventory).toString()));
  if (
    inventory.cohort !== manifest.cohort ||
    inventory.truncated ||
    inventory.cohortCount !== manifest.counts.senses
  )
    throw new Error('Export is partial or its population count does not match');
  const sourceBytes = readArtifact(root, manifest.files.senses);
  const rawLines = sourceBytes.toString('utf8').split('\n');
  if (rawLines.at(-1) !== '')
    throw new Error('Sense export must end with a newline');
  rawLines.pop();
  const rows: SenseRecord[] = [];
  const exclusions: Record<string, number> = {};
  const seenSenseKeys = new Set<string>();
  for (const [index, rawLine] of rawLines.entries()) {
    if (!rawLine)
      throw new Error(`Unexpected blank sense export line ${index + 1}`);
    if (rawLine.endsWith('\r'))
      throw new Error('CRLF sense export is unsupported');
    const row = RetrievalSenseSchema.parse(JSON.parse(rawLine));
    const normalized = toSenseRecord(
      row,
      index + 1,
      hashBytes(Buffer.from(`${rawLine}\n`, 'utf8')),
    );
    if ('excluded' in normalized) {
      exclusions[normalized.excluded] =
        (exclusions[normalized.excluded] ?? 0) + 1;
      continue;
    }
    if (seenSenseKeys.has(normalized.senseKey))
      throw new Error(`Duplicate source sense key: ${normalized.senseKey}`);
    seenSenseKeys.add(normalized.senseKey);
    rows.push(normalized);
  }
  if (rawLines.length !== manifest.counts.senses)
    throw new Error('Export sense denominator mismatch');
  const exportRef = {
    path: manifestPath,
    sha256: hashBytes(manifestBytes),
  };
  return {
    manifest,
    exportRef,
    rows,
    exclusions,
    sourceFile: manifest.files.senses,
  };
}

export function runCohortSelect(flags: Record<string, string>) {
  const root = resolve(flags['artifact-dir'] ?? 'uploads/db4');
  const manifestPath = flags.manifest ?? 'export/manifest.json';
  const knownPath = resolve(
    flags['known-development'] ??
      'docs/reviews/db4-d2-known-development-lexemes-2026-10-10.json',
  );
  const prefix = flags.prefix ?? 'cohort/db4-d2-jlpt-n1-n5-v1';
  const seed = z
    .string()
    .min(1)
    .max(128)
    .parse(flags.seed ?? 'db4-d4-d5-cohort-2026-10-10-v1');
  const knownBytes = readFileSync(knownPath);
  const known = KnownDevelopmentSchema.parse(JSON.parse(knownBytes.toString()));
  const input = loadVerifiedInput(root, manifestPath);
  const result = selectCohort(
    input.rows,
    seed,
    known.lexemeExternalIds,
    input.sourceFile,
    input.manifest.semanticInputFingerprint,
  );
  const outputPaths = [
    `${prefix}/population.json`,
    `${prefix}/selected.jsonl`,
    `${prefix}/sampling.json`,
  ];
  for (const path of outputPaths)
    if (existsSync(artifactPath(root, path)))
      throw new Error(`Immutable cohort artifact already exists: ${path}`);
  const selectedRef = writeArtifact(
    root,
    `${prefix}/selected.jsonl`,
    result.targets.map((target) => canonicalJson(target)).join('\n') + '\n',
  );
  const population = {
    schemaVersion: 1,
    task: 'db4_cohort_population',
    selectorVersion: SELECTOR_VERSION,
    export: {
      manifest: input.exportRef,
      semanticInputFingerprint: input.manifest.semanticInputFingerprint,
      senses: input.sourceFile,
    },
    counts: {
      exportRows: input.manifest.counts.senses,
      eligible: input.rows.length,
      selected: result.targets.length,
      development: result.splitCounts.development.population,
      holdout: result.splitCounts.holdout.population,
      developmentLexemes: result.splitCounts.development.lexemes,
      holdoutLexemes: result.splitCounts.holdout.lexemes,
      cappedPool:
        result.splitCounts.development.selectableCapacity +
        result.splitCounts.holdout.selectableCapacity,
      cappedAway:
        input.rows.length -
        result.splitCounts.development.selectableCapacity -
        result.splitCounts.holdout.selectableCapacity,
      splitAssignmentSha256: result.splitAssignmentSha256,
      exclusions: input.exclusions,
      unmatchedKnownDevelopmentLexemes: result.unmatchedKnownLexemes.length,
    },
    populationStrata: {
      level: countValues(input.rows, 'level'),
      posFamily: countValues(input.rows, 'posFamily'),
      glossCount: countValues(input.rows, 'glossCount'),
      fieldInfo: countValues(input.rows, 'fieldInfo'),
      originalStatus: countValues(input.rows, 'originalStatus'),
    },
    splitCapacity: result.splitCounts,
    unmatchedKnownDevelopmentLexemes: result.unmatchedKnownLexemes,
  };
  const populationRef = writeJson(
    root,
    `${prefix}/population.json`,
    population,
  );
  const shardCounts = result.shardCounts;
  const sampling = {
    schemaVersion: 1,
    task: 'db4_cohort_sampling',
    selectorVersion: SELECTOR_VERSION,
    createdAt: new Date().toISOString(),
    seed,
    input: {
      exportManifest: input.exportRef,
      sourceSenseFile: input.sourceFile,
      knownDevelopment: {
        path:
          flags['known-development'] ??
          'docs/reviews/db4-d2-known-development-lexemes-2026-10-10.json',
        sha256: hashBytes(knownBytes),
        lexemeCount: known.lexemeExternalIds.length,
        lexemeExternalIds: known.lexemeExternalIds,
        sources: known.sources,
      },
    },
    config: {
      requestedTargets: TARGETS,
      requestedDevelopment: DEVELOPMENT_TARGET,
      requestedHoldout: HOLDOUT_TARGET,
      defaultDevelopmentShare: SPLIT_DEVELOPMENT_PER_10K / 10_000,
      maxSensesPerLexeme: MAX_SENSES_PER_LEXEME,
      shardTarget: SHARD_TARGET,
      maxShards: MAX_SHARDS,
      splitAssignment:
        'seeded 20/80 lexeme hash; known pilot lexemes forced to development; deterministic capacity rebalance',
      selection:
        'greedy proportional marginal deficits across five independent strata; deterministic SHA-256 tie-break',
      stratumDimensions: [
        'level',
        'posFamily',
        'glossCount',
        'fieldInfo',
        'originalStatus',
      ],
      popularityNote:
        'No corpus frequency field is present in this export. JLPT level is reported directly and is not presented as measured word frequency.',
      noSamplingWeights: true,
    },
    counts: {
      eligible: input.rows.length,
      selected: result.targets.length,
      development: result.targets.filter(
        (target) => target.split === 'development',
      ).length,
      holdout: result.targets.filter((target) => target.split === 'holdout')
        .length,
      shards: Object.keys(shardCounts).length,
      shardCounts,
      splitAssignmentSha256: result.splitAssignmentSha256,
    },
    stratification: result.stratification,
    files: {
      population: populationRef,
      selected: selectedRef,
    },
    constraints: {
      lexemeDisjoint: true,
      pilotLexemesInDevelopment: true,
      duplicateSenseKeys: false,
      maxSensesPerLexeme: MAX_SENSES_PER_LEXEME,
      shardMaximum: SHARD_TARGET,
      withinPlanTarget: result.targets.length === TARGETS,
      developmentQuotaMet:
        result.targets.filter((target) => target.split === 'development')
          .length === DEVELOPMENT_TARGET,
      holdoutQuotaMet:
        result.targets.filter((target) => target.split === 'holdout').length ===
        HOLDOUT_TARGET,
    },
  };
  const samplingRef = writeJson(root, `${prefix}/sampling.json`, sampling);
  console.log(
    JSON.stringify({
      population: populationRef,
      selected: selectedRef,
      sampling: samplingRef,
      counts: sampling.counts,
      gates: sampling.constraints,
      readOnly: true,
      museCalls: 0,
      databaseWrites: 0,
    }),
  );
  return { population, sampling, targets: result.targets };
}

if (require.main === module) {
  const flags = cliFlags(process.argv.slice(2), [
    'artifact-dir',
    'manifest',
    'known-development',
    'prefix',
    'seed',
  ]);
  try {
    runCohortSelect(flags);
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message.replace(
            /postgres(?:ql)?:\/\/[^\s]+/g,
            '[redacted DB URL]',
          )
        : 'Unknown selector error';
    console.error(`DB4-D2 cohort selection failed; no DB writes: ${detail}`);
    process.exitCode = 1;
  }
}
