import { createHash } from 'node:crypto';
import {
  createReadStream,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import {
  ArtifactPath,
  ArtifactRef,
  ArtifactRefSchema,
  BigintIdSchema,
  Count,
  MappingCandidate,
  MappingCandidateSchema,
  MappingSource,
  Positive,
  SemanticSnapshotSchema,
  Sha256Schema,
  SourceSchema,
  Text,
  assertSorted,
  assertUnique,
  canonicalJson,
  createMappingBundle,
  createMappingCandidate,
  conceptSemanticKey,
  hashBytes,
  semanticInputFingerprint,
  senseSemanticKey,
  verifyArtifactBytes,
} from './_mapping-types';

export const RETRIEVAL_VERSION = 'db4-d2-hybrid-rrf-v1';
export const MODEL_ID = 'sentence-transformers/all-MiniLM-L6-v2';
export const MODEL_REVISION = '1110a243fdf4706b3f48f1d95db1a4f5529b4d41';
const Synset = z
  .object({ lexicon: Text, synsetId: Text, sourceKey: Text })
  .strict();
export const RetrievalSenseSchema = z
  .object({
    sense: MappingCandidateSchema.shape.sense,
    senseContext: MappingCandidateSchema.shape.senseContext,
    evidence: MappingCandidateSchema.shape.evidence,
    sourceKeys: z.array(Text),
    wordnetIdentity: Synset.nullable(),
    seedConceptIds: z.array(BigintIdSchema),
    existingLinks: z.array(
      z
        .object({
          conceptId: BigintIdSchema,
          relation: Text,
          method: Text,
          verified: z.boolean(),
          sourceId: z.number().int().positive().nullable(),
          batchId: z.string().uuid().nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export const RetrievalConceptSchema = z
  .object({
    concept: MappingCandidateSchema.shape.concept,
    conceptContext: MappingCandidateSchema.shape.conceptContext,
    evidence: MappingCandidateSchema.shape.evidence,
    sourceKeys: z.array(Text),
    synsetLineage: z.array(
      Synset.extend({ batchId: z.string().uuid().nullable() }).strict(),
    ),
  })
  .strict();
export type RetrievalSense = z.infer<typeof RetrievalSenseSchema>;
export type RetrievalConcept = z.infer<typeof RetrievalConceptSchema>;
export const ExportManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    task: z.literal('db4_retrieval_export'),
    createdAt: z.string().datetime(),
    cohort: Text,
    snapshot: SemanticSnapshotSchema,
    semanticInputFingerprint: Sha256Schema,
    files: z
      .object({
        senses: ArtifactRefSchema,
        concepts: ArtifactRefSchema,
        sources: ArtifactRefSchema,
        inventory: ArtifactRefSchema,
      })
      .strict(),
    counts: z.object({ senses: Count, concepts: Count }).strict(),
  })
  .strict();
export type ExportManifest = z.infer<typeof ExportManifestSchema>;
export const AuditManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    task: z.literal('db4_retrieval_source_audit'),
    exportSha256: Sha256Schema,
    sources: z.array(SourceSchema),
  })
  .strict();
const HitSchema = z
  .object({
    conceptId: BigintIdSchema,
    score: z.number().min(-1).max(1),
    branches: z.array(Text).min(1),
    features: z.record(z.unknown()),
  })
  .strict();
export const SearchResultSchema = z
  .object({
    senseKey: Text,
    senseId: BigintIdSchema,
    hits: z.array(HitSchema).max(5),
    reason: Text.nullable(),
  })
  .strict();
export const SearchManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    task: z.literal('db4_minilm_retrieval'),
    exportSha256: Sha256Schema,
    auditSha256: Sha256Schema,
    model: z.literal(MODEL_ID),
    revision: z.literal(MODEL_REVISION),
    methodVersion: z.literal(RETRIEVAL_VERSION),
    results: ArtifactRefSchema,
    modelFiles: z.array(ArtifactRefSchema),
    metrics: z.record(z.unknown()),
  })
  .strict();

/** Artifacts are immutable and rooted; refuse symlink escapes and accidental overwrites. */
export function artifactPath(root: string, path: string): string {
  ArtifactPath.parse(path);
  const base = realpathSync(root);
  let parent = resolve(base, dirname(path));
  while (!existsSync(parent)) parent = dirname(parent);
  if (
    realpathSync(parent) !== base &&
    !realpathSync(parent).startsWith(base + sep)
  )
    throw new Error('Artifact symlink escapes root');
  const target = resolve(base, path);
  if (existsSync(target) && lstatSync(target).isSymbolicLink())
    throw new Error('Artifact may not be a symlink');
  return target;
}
export function readArtifact(root: string, ref: ArtifactRef): Buffer {
  const bytes = readFileSync(artifactPath(root, ref.path));
  verifyArtifactBytes(ref, bytes);
  return bytes;
}
export function writeArtifact(
  root: string,
  path: string,
  content: string,
): ArtifactRef {
  mkdirSync(root, { recursive: true });
  const target = artifactPath(root, path);
  mkdirSync(dirname(target), { recursive: true });
  const fd = openSync(target, 'wx', 0o600);
  try {
    writeFileSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return { path, sha256: hashBytes(content) };
}
export function writeJson(
  root: string,
  path: string,
  value: unknown,
): ArtifactRef {
  canonicalJson(value);
  return writeArtifact(root, path, JSON.stringify(value, null, 2) + '\n');
}
export function jsonLines<T>(bytes: Buffer, schema: z.ZodType<T>): T[] {
  return bytes
    .toString('utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => schema.parse(JSON.parse(line)));
}
export function cliFlags(
  argv: string[],
  allowed: string[],
): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const value = argv[++i];
    if (
      !key.startsWith('--') ||
      !allowed.includes(key.slice(2)) ||
      flags[key.slice(2)] ||
      !value ||
      value.startsWith('--')
    )
      throw new Error(`Unknown/duplicate/missing flag: ${key}`);
    flags[key.slice(2)] = value;
  }
  return flags;
}
export function positiveFlag(
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (!/^[1-9][0-9]*$/.test(value))
    throw new Error('Expected positive integer');
  return Positive.parse(Number(value));
}
export async function loadExport(
  root: string,
  manifestPath: string,
  selectedIds?: Set<string>,
) {
  const bytes = readFileSync(artifactPath(root, manifestPath));
  const manifest = ExportManifestSchema.parse(JSON.parse(bytes.toString()));
  if (
    semanticInputFingerprint(manifest.snapshot) !==
    manifest.semanticInputFingerprint
  )
    throw new Error('Export fingerprint mismatch');
  if (
    manifest.snapshot.senseInputHash !== manifest.files.senses.sha256 ||
    manifest.snapshot.conceptInputHash !== manifest.files.concepts.sha256
  )
    throw new Error('Export snapshot not bound to files');
  const senses = jsonLines(
    readArtifact(root, manifest.files.senses),
    RetrievalSenseSchema,
  );
  const concepts: RetrievalConcept[] = [];
  const anchors = new Set(
    senses
      .filter((s) => s.wordnetIdentity)
      .map((s) =>
        canonicalJson([
          s.wordnetIdentity!.lexicon,
          s.wordnetIdentity!.synsetId,
        ]),
      ),
  );
  const conceptStream = createReadStream(
    artifactPath(root, manifest.files.concepts.path),
  );
  const conceptHash = createHash('sha256');
  conceptStream.on('data', (chunk: Buffer | string) => {
    conceptHash.update(chunk);
  });
  const reader = createInterface({ input: conceptStream, crlfDelay: Infinity });
  let conceptCount = 0;
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  for await (const line of reader) {
    if (!line.trim()) continue;
    const raw: unknown = JSON.parse(line);
    const identity = z
      .object({ concept: MappingCandidateSchema.shape.concept })
      .parse(raw).concept;
    if (
      !identity.id ||
      seenIds.has(identity.id) ||
      seenKeys.has(identity.semanticKey)
    )
      throw new Error('Duplicate/missing concept identity');
    seenIds.add(identity.id);
    seenKeys.add(identity.semanticKey);
    conceptCount++;
    if (
      !selectedIds ||
      selectedIds.has(identity.id) ||
      identity.synsetKeys.some((s) =>
        anchors.has(canonicalJson([s.lexicon, s.synsetId])),
      )
    )
      concepts.push(RetrievalConceptSchema.parse(raw));
  }
  if (conceptHash.digest('hex') !== manifest.files.concepts.sha256)
    throw new Error('Concept artifact hash mismatch');
  const sources = z
    .array(SourceSchema)
    .parse(JSON.parse(readArtifact(root, manifest.files.sources).toString()));
  readArtifact(root, manifest.files.inventory);
  if (
    senses.length !== manifest.counts.senses ||
    conceptCount !== manifest.counts.concepts
  )
    throw new Error('Export counts mismatch');
  assertUnique(
    senses.map((s) => s.sense.semanticKey),
    'sense semantic identities',
  );
  assertUnique(
    senses.map((s) => s.sense.id!),
    'sense ids',
  );
  assertUnique(
    concepts.map((c) => c.concept.semanticKey),
    'concept semantic identities',
  );
  assertUnique(
    concepts.map((c) => c.concept.id!),
    'concept ids',
  );
  assertSorted(
    sources.map((s) => s.key),
    'export sources',
  );
  return { manifest, bytes, senses, concepts, sources };
}
export function auditedSources(
  root: string,
  auditPath: string,
  exported: Awaited<ReturnType<typeof loadExport>>,
) {
  const bytes = readFileSync(artifactPath(root, auditPath));
  const audit = AuditManifestSchema.parse(JSON.parse(bytes.toString()));
  if (audit.exportSha256 !== hashBytes(exported.bytes))
    throw new Error('Audit belongs to another export');
  assertSorted(
    audit.sources.map((s) => s.key),
    'audit sources',
  );
  if (audit.sources.length !== exported.sources.length)
    throw new Error('Audit source coverage mismatch');
  for (let i = 0; i < audit.sources.length; i++) {
    const source = audit.sources[i];
    const original = exported.sources[i];
    // Licensing corrections live in audit artifacts; core/public metadata stays unchanged.
    if (
      canonicalJson([
        source.key,
        source.code,
        source.sourceId,
        source.version,
        source.snapshot,
        source.sha256,
        source.batchIds,
      ]) !==
      canonicalJson([
        original.key,
        original.code,
        original.sourceId,
        original.version,
        original.snapshot,
        original.sha256,
        original.batchIds,
      ])
    )
      throw new Error('Audit rewrote source identity/snapshot');
    source.audit.evidence.forEach((ref) => readArtifact(root, ref));
    if (
      source.audit.status === 'verified' &&
      exported.manifest.snapshot.mode === 'production'
    ) {
      const reports = source.audit.evidence.map((ref) => {
        const bytes = readArtifact(root, ref);
        try {
          return JSON.parse(bytes.toString()) as unknown;
        } catch {
          return null;
        }
      });
      const proof = z.object({
        task: z.literal('db4_raw_source_checks'),
        exportSha256: Sha256Schema,
        wnSha256: Sha256Schema,
        checks: z.record(
          z.object({
            checked: Count,
            failureCount: Count.optional(),
            failures: z.array(z.string()),
          }),
        ),
      });
      const matched = reports.some((raw) => {
        const parsed = proof.safeParse(raw);
        if (!parsed.success) return false;
        const report = parsed.data;
        const check = report.checks[source.key];
        return (
          report.exportSha256 === hashBytes(exported.bytes) &&
          check &&
          check.checked > 0 &&
          !check.failureCount &&
          !check.failures.length &&
          (!['oewn', 'omw-en', 'omw-ja'].includes(source.code) ||
            report.wnSha256 === source.sha256)
        );
      });
      if (!matched)
        throw new Error(
          'Verified production source requires passing raw checks bound to export',
        );
    }
  }
  return { sources: audit.sources, bytes };
}
export function makeCandidate(
  s: RetrievalSense,
  c: RetrievalConcept,
  sources: MappingSource[],
  fingerprint: string,
  rank: number,
  score: number,
  branches: string[],
  features: Record<string, unknown>,
  mode: 'production' | 'fixture' = 'production',
): MappingCandidate {
  const keys = new Set([...s.sourceKeys, ...c.sourceKeys]);
  const usedSources = sources.filter((source) => keys.has(source.key));
  if (keys.size !== usedSources.length)
    throw new Error('Unknown context source');
  const blocked = usedSources.some(
    (source) => source.audit.status !== 'verified',
  );
  const missingIdentity =
    !s.sense.identity ||
    !s.sense.id ||
    !s.sense.lexemeId ||
    !c.concept.id ||
    !c.concept.synsetKeys.length;
  const missingContext =
    !(s.senseContext.enGlosses.length || s.senseContext.definitions.length) ||
    !c.conceptContext.definitions.length;
  const reasons = [
    ...(blocked
      ? [
          {
            code: 'blocked_source' as const,
            detail: 'Source audit is blocked.',
          },
        ]
      : []),
    ...(missingIdentity
      ? [
          {
            code: 'missing_identity' as const,
            detail: 'Missing stable source anchor.',
          },
        ]
      : []),
    ...(missingContext
      ? [
          {
            code: 'missing_context' as const,
            detail: 'Incomplete sense/concept context.',
          },
        ]
      : []),
  ];
  return createMappingCandidate({
    schemaVersion: 1,
    candidateType: 'sense_concept',
    mode,
    semanticInputFingerprint: fingerprint,
    sense: s.sense,
    senseContext: s.senseContext,
    concept: c.concept,
    conceptContext: c.conceptContext,
    evidence: [...s.evidence, ...c.evidence].sort((a, b) =>
      a.key.localeCompare(b.key, 'en'),
    ),
    sources: usedSources,
    hypothesisRelation: 'exact',
    retrieval: {
      generatorVersion: RETRIEVAL_VERSION,
      branches,
      rank,
      rankScore:
        Math.round(
          Math.max(
            0,
            Math.min(
              1,
              features.rankMethod === 'normalized_rrf_v1'
                ? score
                : (score + 1) / 2,
            ),
          ) * 1e6,
        ) / 1e6,
      calibratedScore: null,
      features,
      pruningRefs: [],
    },
    classification: blocked
      ? 'blocked_source'
      : missingIdentity
        ? 'unresolved'
        : missingContext
          ? 'missing_context'
          : 'ready',
    reasons,
    predecessor: null,
  });
}
/** Direct identity audit is a separate artifact, never an invented R1/R2 decision. */
export function sourceIdentity(
  s: RetrievalSense,
  concepts: RetrievalConcept[],
  sources: MappingSource[],
) {
  const identity = s.wordnetIdentity;
  if (!identity || !s.sense.identity)
    return {
      status: 'needs_semantic_review',
      reason: 'No inherited WordNet synset identity.',
    };
  const prefix = `wn:${identity.lexicon}:${identity.synsetId}:`;
  const owner = sources.find((source) => source.key === identity.sourceKey);
  if (
    !owner ||
    !['oewn', 'omw-en', 'omw-ja'].includes(owner.code) ||
    identity.lexicon !== `${owner.code}:${owner.version}` ||
    s.sense.semanticKey !==
      senseSemanticKey(
        owner.code,
        s.sense.identity.externalId,
        s.sense.identity.senseKey,
      ) ||
    !s.sense.identity.senseKey.startsWith(prefix) ||
    s.sense.identity.sourceKey !== identity.sourceKey
  )
    return {
      status: 'unresolved',
      reason: 'WordNet sense anchor does not bind synset.',
    };
  const matches = concepts.filter((c) =>
    c.concept.synsetKeys.some(
      (key) =>
        key.lexicon === identity.lexicon &&
        key.synsetId === identity.synsetId &&
        key.sourceKey === identity.sourceKey,
    ),
  );
  if (matches.length !== 1)
    return {
      status: 'unresolved',
      reason: 'Missing or ambiguous source synset mapping.',
    };
  const target = matches[0];
  if (
    target.concept.semanticKey !==
    conceptSemanticKey(target.concept.synsetKeys, target.concept.ili)
  )
    return {
      status: 'unresolved',
      reason: 'Concept semantic identity mismatch.',
    };
  const keys = new Set([...s.sourceKeys, ...target.sourceKeys]);
  if (
    [...keys].some(
      (key) =>
        sources.find((source) => source.key === key)?.audit.status !==
        'verified',
    )
  )
    return {
      status: 'blocked_source',
      reason: 'Source lineage is not audited.',
    };
  const exact = s.existingLinks.filter((link) => link.relation === 'exact');
  if (exact.some((link) => link.conceptId !== target.concept.id))
    return {
      status: 'unresolved',
      reason: 'Existing exact link conflicts with source identity.',
    };
  const preserved = exact.some(
    (link) =>
      link.conceptId === target.concept.id &&
      link.method === 'wordnet_synset' &&
      link.verified &&
      link.sourceId === owner.sourceId &&
      link.batchId !== null &&
      owner.batchIds.includes(link.batchId),
  );
  if (exact.length && !preserved)
    return {
      status: 'unresolved',
      reason:
        'Existing exact link lacks verified source ownership; preserve it for D3/D6 audit.',
    };
  return {
    status: preserved ? 'existing_source_link' : 'source_identity_proposal',
    conceptId: target.concept.id,
    conceptKey: target.concept.semanticKey,
    lexicon: identity.lexicon,
    synsetId: identity.synsetId,
    sourceKey: owner.key,
    sourceId: owner.sourceId,
    ili: target.concept.ili,
    promoteConcept: false,
    semanticReviewRequired: false,
    apply: false,
  };
}
export function bundleReady(candidates: MappingCandidate[]) {
  const ready = candidates.filter((c) => c.classification === 'ready');
  return ready.length ? createMappingBundle(ready, RETRIEVAL_VERSION) : null;
}
