import { z } from 'zod';
import { parseMappingJob, parsePilotManifest } from './_job';
import {
  ArtifactRefSchema,
  BigintIdSchema,
  Count,
  JsonObject,
  Language,
  Positive,
  Score,
  Sha256Schema,
  SourceSchema,
  Text,
  Timestamp,
  assertSorted,
  assertUnique,
  canonicalJson,
  compareIds,
  hashJson,
  mappingTargetKey,
} from './_primitives';
export * from './_primitives';
export * from './_job';
export * from './_cli';

export const LinkRelationSchema = z.enum([
  'exact',
  'broader',
  'narrower',
  'related',
]);
export const ReviewRelationSchema = z.enum([
  'exact',
  'broader',
  'narrower',
  'related',
  'none',
  'uncertain',
]);
export const ReasonCodeSchema = z.enum([
  'blocked_source',
  'missing_identity',
  'missing_context',
  'pos_conflict',
  'restriction_conflict',
  'definition_conflict',
  'compound_sense',
  'ambiguous_concepts',
  'no_candidates',
  'no_suitable_concept',
  'retrieval_miss',
  'context_too_large',
  'legacy_unverifiable',
  'stale_input',
  'review_disagreement',
  'budget_exhausted',
]);
const ReasonSchema = z
  .object({ code: ReasonCodeSchema, detail: Text })
  .strict();
const IdentitySchema = z
  .object({ sourceKey: Text, externalId: Text, senseKey: Text })
  .strict();
export const SenseSchema = z
  .object({
    id: BigintIdSchema.nullable(),
    lexemeId: BigintIdSchema.nullable(),
    semanticKey: Text,
    identity: IdentitySchema.nullable(),
    language: Language,
    lemma: Text,
    reading: Text.nullable(),
    forms: z.array(Text),
    senseNo: Positive,
    isPrimary: z.boolean(),
    jlptLevel: z.number().int().min(1).max(5).nullable(),
  })
  .strict();
const SynsetSchema = z
  .object({ lexicon: Text, synsetId: Text, sourceKey: Text })
  .strict();
export function senseSemanticKey(
  sourceCode: string,
  externalId: string,
  sourceSenseKey: string,
): string {
  Text.parse(sourceCode);
  Text.parse(externalId);
  Text.parse(sourceSenseKey);
  return (
    'sense:' +
    hashJson({ schemaVersion: 1, sourceCode, externalId, sourceSenseKey })
  );
}
export function conceptSemanticKey(
  synsetKeys: { lexicon: string; synsetId: string }[],
  ili: string | null,
): string {
  const keys = synsetKeys.map((s) => ({
    lexicon: Text.parse(s.lexicon),
    synsetId: Text.parse(s.synsetId),
  }));
  if (!keys.length)
    throw new Error('Concept semantic identity needs synset keys');
  assertSorted(
    keys.map((s) => canonicalJson([s.lexicon, s.synsetId])),
    'semantic synset keys',
  );
  if (ili !== null) Text.parse(ili);
  return 'concept:' + hashJson({ schemaVersion: 1, synsetKeys: keys, ili });
}
export const ConceptSchema = z
  .object({
    id: BigintIdSchema.nullable(),
    semanticKey: Text,
    ili: Text.nullable(),
    synsetKeys: z.array(SynsetSchema),
    pos: Text.nullable(),
  })
  .strict();
export const TextRowSchema = z
  .object({
    key: Text,
    evidenceKey: Text,
    id: BigintIdSchema.nullable(),
    rank: Count,
    language: Language.nullable(),
    kind: z.enum([
      'gloss',
      'definition',
      'lemma',
      'synonym',
      'translation',
      'example',
      'neighbor',
    ]),
    text: Text,
  })
  .strict();
export type TextRow = z.infer<typeof TextRowSchema>;
const SenseMetadataSchema = z
  .object({
    rawAttributes: JsonObject,
    rawPos: z.array(Text),
    normalizedPos: z.array(Text),
    normalizationVersion: Text,
    appliesToKanji: z.array(Text),
    appliesToKana: z.array(Text),
    info: z.array(Text),
    misc: z.array(Text),
    field: z.array(Text),
    dialect: z.array(Text),
    register: z.array(Text),
    languageSources: z.array(Text),
  })
  .strict();
const SenseContextSchema = z
  .object({
    enGlosses: z.array(TextRowSchema),
    definitions: z.array(TextRowSchema),
    metadata: SenseMetadataSchema,
    metadataEvidenceKey: Text,
    neighbors: z.array(TextRowSchema),
    examples: z.array(TextRowSchema).max(2),
  })
  .strict();
const ConceptContextSchema = z
  .object({
    definitions: z.array(TextRowSchema),
    labels: z.array(TextRowSchema),
    neighbors: z.array(TextRowSchema),
    examples: z.array(TextRowSchema).max(2),
  })
  .strict();
export const EvidenceSchema = z
  .object({
    key: Text,
    kind: z.enum(['text_row', 'sense_metadata']),
    owner: z
      .object({ type: z.enum(['sense', 'concept']), semanticKey: Text })
      .strict(),
    sourceKey: Text,
    sourceHash: Sha256Schema.nullable(),
    batchId: z.string().uuid().nullable(),
    payloadHash: Sha256Schema,
    dependencyGroup: Text,
    sourcePath: Text,
    method: Text,
  })
  .strict();
const RetrievalSchema = z
  .object({
    generatorVersion: Text,
    branches: z.array(Text).min(1),
    rank: Positive,
    rankScore: Score,
    calibratedScore: z.null(),
    features: JsonObject,
    pruningRefs: z.array(ArtifactRefSchema),
  })
  .strict();
const CandidateInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    candidateType: z.literal('sense_concept'),
    mode: z.enum(['fixture', 'production']),
    semanticInputFingerprint: Sha256Schema,
    sense: SenseSchema,
    senseContext: SenseContextSchema,
    concept: ConceptSchema,
    conceptContext: ConceptContextSchema,
    evidence: z.array(EvidenceSchema),
    sources: z.array(SourceSchema),
    hypothesisRelation: LinkRelationSchema,
    retrieval: RetrievalSchema,
    classification: z.enum([
      'ready',
      'blocked_source',
      'missing_context',
      'unresolved',
      'stale',
    ]),
    reasons: z.array(ReasonSchema),
    predecessor: z
      .object({ candidateKey: Sha256Schema, inputHash: Sha256Schema })
      .strict()
      .nullable(),
  })
  .strict();
export const MappingCandidateSchema = CandidateInputSchema.extend({
  pairKey: Sha256Schema,
  candidateKey: Sha256Schema,
  inputHash: Sha256Schema,
}).strict();
export type MappingCandidateInput = z.infer<typeof CandidateInputSchema>;
export type MappingCandidate = z.infer<typeof MappingCandidateSchema>;
export type Sense = z.infer<typeof SenseSchema>;
export type Concept = z.infer<typeof ConceptSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;

export function textRowHash(row: TextRow): string {
  const { evidenceKey: _evidenceKey, ...payload } = row;
  void _evidenceKey;
  return hashJson(payload);
}
function sourceRows(c: MappingCandidateInput): TextRow[] {
  return [
    ...c.senseContext.enGlosses,
    ...c.senseContext.definitions,
    ...c.senseContext.neighbors,
    ...c.senseContext.examples,
  ];
}
function conceptRows(c: MappingCandidateInput): TextRow[] {
  return [
    ...c.conceptContext.definitions,
    ...c.conceptContext.labels,
    ...c.conceptContext.neighbors,
    ...c.conceptContext.examples,
  ];
}
function validateRows(
  rows: TextRow[],
  kind: TextRow['kind'][],
  label: string,
): void {
  assertUnique(
    rows.map((r) => r.key),
    label,
  );
  rows.forEach((row, i) => {
    if (!kind.includes(row.kind))
      throw new Error(`Invalid row kind in ${label}`);
    const previous = rows[i - 1];
    if (
      previous &&
      (previous.rank > row.rank ||
        (previous.rank === row.rank &&
          (previous.id === null || row.id === null
            ? previous.key > row.key
            : compareIds(previous.id, row.id) > 0)))
    )
      throw new Error(
        `Unsorted ${label}: rank then bigint ID (key for null IDs)`,
      );
  });
}
function validateCandidateInput(c: MappingCandidateInput): void {
  assertUnique(
    [...sourceRows(c), ...conceptRows(c)].map((r) => r.key),
    'context row keys',
  );
  assertSorted(
    c.sources.map((s) => s.key),
    'sources',
  );
  assertSorted(
    c.evidence.map((e) => e.key),
    'evidence',
  );
  assertSorted(
    c.concept.synsetKeys.map((s) => canonicalJson([s.lexicon, s.synsetId])),
    'synset keys',
  );
  assertUnique(c.sense.forms, 'forms');
  assertUnique(c.retrieval.branches, 'retrieval branches');
  validateRows(c.senseContext.enGlosses, ['gloss'], 'EN glosses');
  if (c.senseContext.enGlosses.some((r) => r.language !== 'en'))
    throw new Error('EN gloss language must be en');
  validateRows(c.senseContext.definitions, ['definition'], 'sense definitions');
  validateRows(c.senseContext.neighbors, ['neighbor'], 'sense neighbors');
  validateRows(c.senseContext.examples, ['example'], 'sense examples');
  validateRows(
    c.conceptContext.definitions,
    ['definition'],
    'concept definitions',
  );
  validateRows(
    c.conceptContext.labels,
    ['lemma', 'synonym', 'translation'],
    'concept labels',
  );
  validateRows(c.conceptContext.neighbors, ['neighbor'], 'concept neighbors');
  validateRows(c.conceptContext.examples, ['example'], 'concept examples');
  const sources = new Map(c.sources.map((s) => [s.key, s]));
  if (c.sense.identity) {
    const identity = c.sense.identity;
    const source = sources.get(identity.sourceKey);
    if (
      !source ||
      c.sense.semanticKey !==
        senseSemanticKey(source.code, identity.externalId, identity.senseKey)
    )
      throw new Error('Sense semantic key does not bind source identity');
  }
  if (
    c.concept.synsetKeys.length &&
    c.concept.semanticKey !==
      conceptSemanticKey(c.concept.synsetKeys, c.concept.ili)
  )
    throw new Error('Concept semantic key does not bind lexicon/synset/ILI');
  const evidence = new Map(c.evidence.map((e) => [e.key, e]));
  const used = new Set<string>();
  const sourceKeys = new Set<string>();
  function bind(
    key: string,
    owner: Evidence['owner'],
    kind: Evidence['kind'],
    payloadHash: string,
  ): void {
    if (used.has(key))
      throw new Error('Evidence reused for different input rows');
    const e = evidence.get(key);
    if (
      !e ||
      e.kind !== kind ||
      canonicalJson(e.owner) !== canonicalJson(owner) ||
      e.payloadHash !== payloadHash
    )
      throw new Error(`Unbound evidence: ${key}`);
    used.add(key);
    sourceKeys.add(e.sourceKey);
  }
  sourceRows(c).forEach((r) =>
    bind(
      r.evidenceKey,
      { type: 'sense', semanticKey: c.sense.semanticKey },
      'text_row',
      textRowHash(r),
    ),
  );
  conceptRows(c).forEach((r) =>
    bind(
      r.evidenceKey,
      { type: 'concept', semanticKey: c.concept.semanticKey },
      'text_row',
      textRowHash(r),
    ),
  );
  bind(
    c.senseContext.metadataEvidenceKey,
    { type: 'sense', semanticKey: c.sense.semanticKey },
    'sense_metadata',
    hashJson(c.senseContext.metadata),
  );
  if (used.size !== c.evidence.length)
    throw new Error('Unused evidence must stay in retrieval sidecar');
  for (const e of c.evidence) {
    const source = sources.get(e.sourceKey);
    if (
      !source ||
      source.sha256 !== e.sourceHash ||
      (e.batchId !== null && !source.batchIds.includes(e.batchId))
    )
      throw new Error('Evidence source/hash/batch not bound');
  }
  if (c.sense.identity) sourceKeys.add(c.sense.identity.sourceKey);
  c.concept.synsetKeys.forEach((s) => sourceKeys.add(s.sourceKey));
  if (
    [...sourceKeys].some((key) => !sources.has(key)) ||
    sourceKeys.size !== sources.size
  )
    throw new Error('Missing or unused source');
  const blocked = c.sources.some((s) => s.audit.status !== 'verified');
  const missingIdentity =
    !c.sense.id ||
    !c.sense.lexemeId ||
    !c.sense.identity ||
    !c.concept.id ||
    !c.concept.synsetKeys.length;
  const missingContext =
    !(c.senseContext.enGlosses.length || c.senseContext.definitions.length) ||
    !c.conceptContext.definitions.length;
  if (
    c.classification === 'ready' &&
    (blocked || missingIdentity || missingContext || c.reasons.length)
  )
    throw new Error(
      'Ready candidate requires audited identity/context and no unresolved reasons',
    );
  if (c.classification !== 'ready' && !c.reasons.length)
    throw new Error('Non-ready candidate requires reasons');
  if (blocked && !c.reasons.some((r) => r.code === 'blocked_source'))
    throw new Error('Missing blocked_source reason');
  if (missingIdentity && !c.reasons.some((r) => r.code === 'missing_identity'))
    throw new Error('Missing identity reason');
  if (missingContext && !c.reasons.some((r) => r.code === 'missing_context'))
    throw new Error('Missing context reason');
}
export function candidateSemanticInput(c: MappingCandidateInput) {
  return {
    schemaVersion: c.schemaVersion,
    candidateType: c.candidateType,
    mode: c.mode,
    semanticInputFingerprint: c.semanticInputFingerprint,
    sense: c.sense,
    senseContext: c.senseContext,
    concept: c.concept,
    conceptContext: c.conceptContext,
    evidence: c.evidence,
    sources: c.sources,
  };
}
export function createMappingCandidate(value: unknown): MappingCandidate {
  canonicalJson(value);
  const input = CandidateInputSchema.parse(value);
  validateCandidateInput(input);
  const pairKey = hashJson({
    family: 'sense_concept_pair',
    schemaVersion: 1,
    semanticInputFingerprint: input.semanticInputFingerprint,
    senseKey: input.sense.semanticKey,
    conceptKey: input.concept.semanticKey,
  });
  const inputHash = hashJson(candidateSemanticInput(input));
  const candidateKey = hashJson({
    family: 'sense_concept',
    schemaVersion: 1,
    pairKey,
    inputHash,
    generatorVersion: input.retrieval.generatorVersion,
  });
  return { ...input, pairKey, inputHash, candidateKey };
}
export function parseMappingCandidate(value: unknown): MappingCandidate {
  canonicalJson(value);
  const c = MappingCandidateSchema.parse(value);
  const { pairKey, inputHash, candidateKey, ...input } = c;
  const expected = createMappingCandidate(input);
  if (
    pairKey !== expected.pairKey ||
    inputHash !== expected.inputHash ||
    candidateKey !== expected.candidateKey
  )
    throw new Error('Candidate hash mismatch');
  return c;
}
export function parseMappingCandidates(values: unknown): MappingCandidate[] {
  if (!Array.isArray(values)) throw new Error('Expected candidate array');
  const candidates = values.map((v: unknown) => parseMappingCandidate(v));
  assertUnique(
    candidates.map((c) => c.pairKey),
    'canonical pair in generation',
  );
  if (
    new Set(candidates.map((c) => c.semanticInputFingerprint)).size > 1 ||
    new Set(candidates.map((c) => c.retrieval.generatorVersion)).size > 1 ||
    new Set(candidates.map((c) => c.mode)).size > 1
  )
    throw new Error('Mixed generation snapshot/version/mode');
  return candidates;
}

const SemanticCandidateSchema = z
  .object({
    candidateKey: Sha256Schema,
    inputHash: Sha256Schema,
    concept: ConceptSchema,
    conceptContext: ConceptContextSchema,
    evidence: z.array(EvidenceSchema),
    sources: z.array(SourceSchema),
  })
  .strict();
const BundleContentSchema = z
  .object({
    schemaVersion: z.literal(1),
    task: z.literal('sense_concept_review'),
    mode: z.enum(['fixture', 'production']),
    semanticInputFingerprint: Sha256Schema,
    builderVersion: Text,
    sense: SenseSchema,
    senseContext: SenseContextSchema,
    sourceBranches: z.array(Text).min(1),
    candidates: z.array(SemanticCandidateSchema).min(1).max(5),
  })
  .strict();
export const MappingBundleSchema = BundleContentSchema.extend({
  bundleKey: Sha256Schema,
  contextHash: Sha256Schema,
}).strict();
export type MappingBundle = z.infer<typeof MappingBundleSchema>;
export function parseMappingBundleIntegrity(value: unknown): MappingBundle {
  canonicalJson(value);
  const b = MappingBundleSchema.parse(value);
  const { bundleKey, contextHash, ...content } = b;
  assertSorted(
    b.candidates.map((c) => c.candidateKey),
    'bundle candidates',
  );
  assertUnique(
    b.candidates.map((c) => c.concept.semanticKey),
    'bundle concepts',
  );
  const branches = [
    ...b.senseContext.enGlosses,
    ...b.senseContext.definitions,
  ].map((r) => r.key);
  assertUnique(branches, 'bundle source branches');
  if (canonicalJson(b.sourceBranches) !== canonicalJson(branches))
    throw new Error('Bundle source branches mismatch');
  const expectedKey = hashJson({
    schemaVersion: 1,
    family: 'sense_concept_bundle',
    senseKey: b.sense.semanticKey,
    candidates: b.candidates.map((c) => ({
      candidateKey: c.candidateKey,
      inputHash: c.inputHash,
    })),
    builderVersion: b.builderVersion,
    semanticInputFingerprint: b.semanticInputFingerprint,
  });
  if (contextHash !== hashJson(content) || bundleKey !== expectedKey)
    throw new Error('Bundle hash mismatch');
  for (const c of b.candidates) {
    const input: MappingCandidateInput = {
      schemaVersion: 1,
      candidateType: 'sense_concept',
      mode: b.mode,
      semanticInputFingerprint: b.semanticInputFingerprint,
      sense: b.sense,
      senseContext: b.senseContext,
      concept: c.concept,
      conceptContext: c.conceptContext,
      evidence: c.evidence,
      sources: c.sources,
      hypothesisRelation: 'exact',
      retrieval: {
        generatorVersion: 'integrity-only',
        branches: ['integrity-only'],
        rank: 1,
        rankScore: 0,
        calibratedScore: null,
        features: {},
        pruningRefs: [],
      },
      classification: 'ready',
      reasons: [],
      predecessor: null,
    };
    validateCandidateInput(input);
    if (c.inputHash !== hashJson(candidateSemanticInput(input)))
      throw new Error('Bundle candidate input hash mismatch');
  }
  return b;
}

export function createMappingBundle(
  values: unknown,
  builderVersion: string,
): MappingBundle {
  const candidates = parseMappingCandidates(values).sort((a, b) =>
    a.candidateKey < b.candidateKey ? -1 : 1,
  );
  if (
    !candidates.length ||
    candidates.length > 5 ||
    candidates.some((c) => c.classification !== 'ready')
  )
    throw new Error('Bundle needs 1..5 ready candidates');
  const first = candidates[0];
  if (
    candidates.some(
      (c) =>
        canonicalJson([c.sense, c.senseContext]) !==
        canonicalJson([first.sense, first.senseContext]),
    )
  )
    throw new Error('Bundle mixed source sense/context');
  const sourceProvenance = (c: MappingCandidate) => {
    const evidence = c.evidence.filter((e) => e.owner.type === 'sense');
    const keys = new Set([
      c.sense.identity!.sourceKey,
      ...evidence.map((e) => e.sourceKey),
    ]);
    return { evidence, sources: c.sources.filter((s) => keys.has(s.key)) };
  };
  if (
    candidates.some(
      (c) =>
        canonicalJson(sourceProvenance(c)) !==
        canonicalJson(sourceProvenance(first)),
    )
  )
    throw new Error('Bundle mixed source provenance');
  const content = BundleContentSchema.parse({
    schemaVersion: 1,
    task: 'sense_concept_review',
    mode: first.mode,
    semanticInputFingerprint: first.semanticInputFingerprint,
    builderVersion,
    sense: first.sense,
    senseContext: first.senseContext,
    sourceBranches: [
      ...first.senseContext.enGlosses,
      ...first.senseContext.definitions,
    ].map((r) => r.key),
    candidates: candidates.map((c) => ({
      candidateKey: c.candidateKey,
      inputHash: c.inputHash,
      concept: c.concept,
      conceptContext: c.conceptContext,
      evidence: c.evidence,
      sources: c.sources,
    })),
  });
  assertUnique(content.sourceBranches, 'source branches');
  const bundleKey = hashJson({
    schemaVersion: 1,
    family: 'sense_concept_bundle',
    senseKey: content.sense.semanticKey,
    candidates: content.candidates.map((c) => ({
      candidateKey: c.candidateKey,
      inputHash: c.inputHash,
    })),
    builderVersion,
    semanticInputFingerprint: content.semanticInputFingerprint,
  });
  const contextHash = hashJson(content);
  return { ...content, bundleKey, contextHash };
}
/** Bind an on-disk bundle to its generation; shape-only parsing is not an integrity check. */
export function parseMappingBundle(
  value: unknown,
  candidates: unknown,
): MappingBundle {
  canonicalJson(value);
  const b = parseMappingBundleIntegrity(value);
  const rebuilt = createMappingBundle(candidates, b.builderVersion);
  if (canonicalJson(b) !== canonicalJson(rebuilt))
    throw new Error('Bundle not bound to generation');
  return b;
}
export const PhaseSchema = z.enum(['r1', 'r2']);
export type Phase = z.infer<typeof PhaseSchema>;
export function renderMappingBundle(
  bundle: MappingBundle,
  phase: Phase,
  seed: string,
  promptVersion: string,
) {
  bundle = parseMappingBundleIntegrity(bundle);
  PhaseSchema.parse(phase);
  Text.parse(seed);
  Text.parse(promptVersion);
  const candidates = [...bundle.candidates].sort((a, b) => {
    const left = hashJson({ seed, phase, candidateKey: a.candidateKey });
    const right = hashJson({ seed, phase, candidateKey: b.candidateKey });
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const payload = {
    schemaVersion: 1,
    phase,
    seed,
    promptVersion,
    bundle: { ...bundle, candidates },
  };
  return {
    payload,
    renderedContextHash: hashJson(payload),
    contextHash: bundle.contextHash,
    utf8Bytes: Buffer.byteLength(canonicalJson(payload), 'utf8'),
  };
}

export type RenderedMappingBundle = ReturnType<typeof renderMappingBundle>;
const ConflictSchema = z
  .object({
    code: ReasonCodeSchema,
    sourceEvidenceKeys: z.array(Text),
    conceptEvidenceKeys: z.array(Text),
    detail: z.string().max(1000).pipe(Text),
  })
  .strict();
const VerdictSchema = z
  .object({
    candidateKey: Sha256Schema,
    conceptId: BigintIdSchema,
    relation: ReviewRelationSchema,
    coveredBranches: z.array(Text),
    missingBranches: z.array(Text),
    conflicts: z.array(ConflictSchema),
    reason: z.string().max(2000).pipe(Text),
    confidence: Score.nullable(),
  })
  .strict();
export const MappingOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    task: z.literal('sense_concept_review'),
    bundleKey: Sha256Schema,
    senseId: BigintIdSchema,
    contextHash: Sha256Schema,
    reviews: z.array(VerdictSchema).min(1).max(5),
    noSuitableCandidate: z.boolean(),
    unresolvedReason: ReasonSchema.nullable(),
  })
  .strict();
export type MappingOutput = z.infer<typeof MappingOutputSchema>;
export function parseMappingOutput(
  value: unknown,
  bundle: MappingBundle,
): MappingOutput {
  canonicalJson(value);
  bundle = parseMappingBundleIntegrity(bundle);
  const output = MappingOutputSchema.parse(value);
  if (
    output.bundleKey !== bundle.bundleKey ||
    output.contextHash !== bundle.contextHash ||
    output.senseId !== bundle.sense.id
  )
    throw new Error('Review input echo mismatch');
  assertUnique(
    output.reviews.map((r) => r.candidateKey),
    'review candidate',
  );
  if (output.reviews.length !== bundle.candidates.length)
    throw new Error('Incomplete shortlist verdicts');
  for (const r of output.reviews) {
    const candidate = bundle.candidates.find(
      (c) => c.candidateKey === r.candidateKey,
    );
    if (!candidate || r.conceptId !== candidate.concept.id)
      throw new Error('Unknown candidate/concept');
    const coverage = [...r.coveredBranches, ...r.missingBranches];
    assertUnique(coverage, 'coverage branch');
    if (
      coverage.length !== bundle.sourceBranches.length ||
      coverage.some((key) => !bundle.sourceBranches.includes(key))
    )
      throw new Error('Coverage must partition all source branches');
    if (
      r.relation === 'exact' &&
      (r.missingBranches.length || r.conflicts.length)
    )
      throw new Error('Exact requires full coverage and no conflict');
    for (const conflict of r.conflicts) {
      assertUnique(conflict.sourceEvidenceKeys, 'conflict source refs');
      assertUnique(conflict.conceptEvidenceKeys, 'conflict concept refs');
      if (
        !conflict.sourceEvidenceKeys.length &&
        !conflict.conceptEvidenceKeys.length
      )
        throw new Error('Conflict needs evidence');
      for (const [keys, owner] of [
        [conflict.sourceEvidenceKeys, 'sense'],
        [conflict.conceptEvidenceKeys, 'concept'],
      ] as const)
        if (
          keys.some(
            (key) =>
              !candidate.evidence.some(
                (e) => e.key === key && e.owner.type === owner,
              ),
          )
        )
          throw new Error('Invented or foreign conflict evidence');
    }
  }
  if (
    output.noSuitableCandidate !==
    output.reviews.every((r) => r.relation === 'none')
  )
    throw new Error('noSuitableCandidate must mean all verdicts none');
  if (
    (output.reviews.some((r) => r.relation === 'uncertain') ||
      output.reviews.filter((r) => r.relation === 'exact').length > 1) &&
    !output.unresolvedReason
  )
    throw new Error('Ambiguity/uncertainty requires unresolvedReason');
  return output;
}
export function mappingOutputHash(
  value: unknown,
  bundle: MappingBundle,
): string {
  return hashJson(parseMappingOutput(value, bundle));
}

/** D4 loads and byte-verifies artifacts first, then binds checkpoint to manifest and validated bundles here. */
export function parseMappingJobBound(
  jobValue: unknown,
  bundleValues: readonly unknown[],
  manifestValue: unknown,
) {
  const job = parseMappingJob(jobValue);
  const manifest = parsePilotManifest(manifestValue);
  const bundles = bundleValues.map((b) => parseMappingBundleIntegrity(b));
  assertUnique(
    bundles.map((b) => b.bundleKey),
    'job bundle keys',
  );
  if (
    manifest.mode !== job.mode ||
    manifest.semanticInputFingerprint !== job.semanticInputFingerprint ||
    manifest.policyVersion !== job.policyVersions.audit ||
    manifest.seed !== job.seed ||
    canonicalJson(manifest.targetKeys) !==
      canonicalJson(job.entries.map((e) => e.targetKey)) ||
    bundles.length !== job.entries.length
  )
    throw new Error('Job manifest binding mismatch');
  for (const entry of job.entries) {
    const bundle = bundles.find((b) => b.bundleKey === entry.bundleKey);
    if (
      !bundle ||
      bundle.mode !== job.mode ||
      bundle.semanticInputFingerprint !== job.semanticInputFingerprint ||
      entry.targetKey !==
        mappingTargetKey(
          bundle.sense.semanticKey,
          bundle.semanticInputFingerprint,
        ) ||
      entry.contextHash !== bundle.contextHash
    )
      throw new Error('Job bundle binding mismatch');
    for (const phase of ['r1', 'r2'] as const) {
      const rendered = renderMappingBundle(
        bundle,
        phase,
        job.seed,
        job.providers[phase].promptVersion,
      );
      if (
        rendered.renderedContextHash !==
        (phase === 'r1' ? entry.renderedR1 : entry.renderedR2)
      )
        throw new Error('Frozen rendering mismatch');
      if (rendered.utf8Bytes > job.caps.maxContextBytes)
        throw new Error('context_too_large');
    }
  }
  return job;
}

export const DecisionSchema = z
  .object({
    schemaVersion: z.literal(1),
    candidateKey: Sha256Schema,
    inputHash: Sha256Schema,
    outputHashR1: Sha256Schema,
    outputHashR2: Sha256Schema,
    policyVersion: Text,
    proposal: z.enum([
      'accept_exact',
      'accept_nonexact',
      'reject_pair',
      'defer',
    ]),
    relation: ReviewRelationSchema,
    reasons: z.array(ReasonSchema),
  })
  .strict();
export type MappingDecision = z.infer<typeof DecisionSchema>;
export function parseMappingDecision(
  value: unknown,
  candidate: MappingCandidate,
  bundle: MappingBundle,
  r1: unknown,
  r2: unknown,
): MappingDecision {
  canonicalJson(value);
  const d = DecisionSchema.parse(value);
  const outputs = [
    parseMappingOutput(r1, bundle),
    parseMappingOutput(r2, bundle),
  ];
  if (
    d.candidateKey !== candidate.candidateKey ||
    d.inputHash !== candidate.inputHash ||
    d.outputHashR1 !== hashJson(outputs[0]) ||
    d.outputHashR2 !== hashJson(outputs[1])
  )
    throw new Error('Unbound decision');
  const verdicts = outputs.map((o) =>
    o.reviews.find((r) => r.candidateKey === d.candidateKey),
  );
  if (verdicts.some((v) => !v))
    throw new Error('Decision candidate not in shortlist');
  const agreed = verdicts.every((v) => v?.relation === d.relation);
  if (
    d.proposal !== 'defer' &&
    (!agreed || outputs.some((o) => o.unresolvedReason))
  )
    throw new Error('Non-consensus decision');
  if (
    d.proposal === 'accept_exact' &&
    (d.relation !== 'exact' ||
      outputs.some(
        (o) => o.reviews.filter((r) => r.relation === 'exact').length !== 1,
      ))
  )
    throw new Error('Exact proposal needs unambiguous two-pass exact');
  if (
    d.proposal === 'accept_nonexact' &&
    !['broader', 'narrower', 'related'].includes(d.relation)
  )
    throw new Error('Nonexact relation required');
  if (d.proposal === 'reject_pair' && d.relation !== 'none')
    throw new Error('Reject requires none');
  if (d.proposal === 'defer' && !d.reasons.length)
    throw new Error('Defer requires reasons');
  return d;
}
export const MappingAuditSchema = z
  .object({
    schemaVersion: z.literal(1),
    candidateKey: Sha256Schema,
    inputHash: Sha256Schema,
    outputHashR1: Sha256Schema,
    outputHashR2: Sha256Schema,
    decisionHash: Sha256Schema,
    reviewerKind: z.enum(['llm', 'human', 'rule']),
    reviewerId: Text,
    reviewerSession: Text,
    reviewedAt: Timestamp,
    verdict: z.enum(['pass', 'fail', 'deferred']),
    severity: z.enum(['none', 'minor', 'severe']),
    reason: z.string().max(4000).pipe(Text),
    suggestedDecision: z
      .enum(['accept_exact', 'accept_nonexact', 'reject_pair', 'defer'])
      .nullable(),
  })
  .strict();
export function parseMappingAudit(value: unknown, decision: MappingDecision) {
  canonicalJson(value);
  const a = MappingAuditSchema.parse(value);
  if (
    a.candidateKey !== decision.candidateKey ||
    a.inputHash !== decision.inputHash ||
    a.outputHashR1 !== decision.outputHashR1 ||
    a.outputHashR2 !== decision.outputHashR2 ||
    a.decisionHash !== hashJson(decision)
  )
    throw new Error('Audit lineage mismatch');
  if (a.verdict === 'pass' && a.severity === 'severe')
    throw new Error('Severe cannot pass');
  return a;
}
export type MappingAudit = z.infer<typeof MappingAuditSchema>;
export const DisplayPrioritySchema = z
  .object({
    schemaVersion: z.literal(1),
    senseKey: Text,
    displayPriority: Count,
    priorityBasis: z.enum([
      'source_order',
      'ai_estimate',
      'curated',
      'corpus_frequency',
    ]),
    measuredFrequency: Count.nullable(),
    evidenceRefs: z.array(ArtifactRefSchema),
    policyVersion: Text,
  })
  .strict()
  .superRefine((p, ctx) => {
    if (
      (p.priorityBasis === 'corpus_frequency' &&
        (p.measuredFrequency === null || !p.evidenceRefs.length)) ||
      (p.priorityBasis !== 'corpus_frequency' && p.measuredFrequency !== null)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Measured frequency requires corpus evidence',
      });
  });
