import { existsSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { Client } from 'pg';
import {
  JsonlWriter,
  readBytes,
  resolveArtifact,
  sha256Bytes,
  stablePretty,
  writeTextAtomic,
} from './_artifacts';
import { parseMappingCli } from './_cli';
import {
  ConceptExportRecordSchema,
  ExportManifestSchema,
  IndexManifestSchema,
  SenseExportRecordSchema,
  type ConceptExportRecord,
  type ExportManifest,
  type SenseExportRecord,
} from './_export';
import {
  createMappingCandidate,
  hashJson,
  textRowHash,
  verifyArtifactBytes,
  type ArtifactRef,
  type MappingCandidate,
  type MappingSource,
} from './_mapping-types';
import {
  NORMALIZER_VERSION,
  RETRIEVAL_VERSION,
  TOKENIZER_VERSION,
  uniqueTokens,
} from './_retrieval';

/**
 * D4/D2 `mapping-generate` — retrieval offline (không LLM, không ghi DB):
 *   G1 legacy candidate (hints) + G3 EN label + G4 EN definition → union ≤40
 *   → rerank ≤12 → shortlist ≤5, dựng `MappingCandidate` theo contract D1.
 *
 * Dry-run mặc định: chỉ là read-only. Artifact: `candidates/<generation>/`.
 */

const GENERATOR_VERSION = 'db4-gen-v1';
const RANK_VERSION = 'db4-rank-v1';
const BRANCH_G1 = 'g1_legacy';
const BRANCH_G3 = 'g3_label';
const BRANCH_G4 = 'g4_definition';
const BRANCH_ORDER = [BRANCH_G1, BRANCH_G3, BRANCH_G4] as const;
const BRANCH_TOPK = 40;
const UNION_CAP = 40;
const RERANK_CAP = 12;
const SHORTLIST_CAP = 5;
const LABEL_CAP = 12;
const G1_BOOST = 0.05;

interface BranchIndex {
  postings: Map<string, string[]>;
  idf: Map<string, number>;
}

interface ShortlistEntry {
  conceptId: string;
  rank: number;
  rankScore: number;
  branches: string[];
  features: Record<string, unknown>;
}

interface UnresolvedEntry {
  senseKey: string;
  senseId: string;
  lexemeId: string;
  lemma: string;
  glossTokens: number;
  legacyHints: number;
  reason: 'no_candidates';
}

interface LegacyData {
  bySense: Map<string, Map<string, string>>;
  rows: number;
  sha256: string;
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function bigintCompare(a: string, b: string): number {
  return BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
}

function readVerified(root: string, ref: ArtifactRef): Buffer {
  const bytes = readBytes(root, ref.path);
  verifyArtifactBytes(ref, bytes);
  return bytes;
}

function findFileRef(manifest: ExportManifest, relPath: string): ArtifactRef {
  const ref = manifest.files.find((file) => file.path === relPath);
  if (!ref) throw new Error(`Thiếu file trong manifest: ${relPath}`);
  return ref;
}

function parseJsonl<T>(bytes: Buffer, parse: (value: unknown) => T): T[] {
  const out: T[] = [];
  for (const line of bytes.toString('utf8').split('\n')) {
    if (!line) continue;
    out.push(parse(JSON.parse(line)));
  }
  return out;
}

function loadBranchIndex(
  root: string,
  files: { ref: ArtifactRef }[],
  conceptsN: number,
): BranchIndex {
  const postings = new Map<string, string[]>();
  for (const file of files) {
    const bytes = readVerified(root, file.ref);
    for (const line of bytes.toString('utf8').split('\n')) {
      if (!line) continue;
      const parsed = JSON.parse(line) as { t?: unknown; c?: unknown };
      if (typeof parsed.t !== 'string' || !Array.isArray(parsed.c))
        throw new Error(`Posting sai định dạng: ${file.ref.path}`);
      postings.set(
        parsed.t,
        parsed.c.map((id) => String(id)),
      );
    }
  }
  const idf = new Map<string, number>();
  for (const [token, ids] of postings)
    idf.set(token, Math.log(1 + conceptsN / (1 + ids.length)));
  return { postings, idf };
}

function requireSha(source: MappingSource): string {
  if (!source.sha256) throw new Error(`Source ${source.key} thiếu sha256`);
  return source.sha256;
}

function loadLanguageUrl(): string {
  loadDotenv();
  const url =
    process.env.DB4_DATABASE_URL ??
    process.env.DIRECT_URL ??
    process.env.DATABASE_URL;
  if (!url || url.trim() === '')
    throw new Error('Thiếu DB4_DATABASE_URL/DIRECT_URL/DATABASE_URL');
  return url;
}

async function loadLegacy(
  root: string,
  senseIds: string[],
): Promise<LegacyData> {
  const client = new Client({ connectionString: loadLanguageUrl() });
  await client.connect();
  try {
    await client.query('SET default_transaction_read_only = on');
    const result = await client.query<{
      sense_id: string;
      concept_id: string;
      relation: string;
    }>(
      `SELECT sense_id::text AS sense_id, concept_id::text AS concept_id, relation
       FROM core.sense_concept_candidate
       WHERE sense_id = ANY($1::bigint[])`,
      [senseIds],
    );
    const bySense = new Map<string, Map<string, string>>();
    const lines: string[] = [];
    for (const row of result.rows) {
      const list = bySense.get(row.sense_id) ?? new Map<string, string>();
      list.set(row.concept_id, row.relation);
      bySense.set(row.sense_id, list);
      lines.push(`${row.sense_id}:${row.concept_id}:${row.relation}`);
    }
    lines.sort();
    return {
      bySense,
      rows: result.rows.length,
      sha256: sha256Bytes(lines.join('\n')),
    };
  } finally {
    await client.end();
  }
}

function planSense(
  record: SenseExportRecord,
  g3: BranchIndex,
  g4: BranchIndex,
  legacy: Map<string, string> | undefined,
  exportedConceptIds: Set<string>,
): { shortlist: ShortlistEntry[]; glossTokens: number; legacySkipped: number } {
  const glossTexts = record.glosses.map((gloss) => gloss.text);
  const tokens = uniqueTokens(glossTexts);

  const g3Scores = new Map<string, number>();
  const g3Tokens = new Map<string, number>();
  for (const token of tokens) {
    const ids = g3.postings.get(token);
    if (!ids) continue;
    const weight = g3.idf.get(token) ?? 0;
    for (const id of ids) {
      g3Scores.set(id, (g3Scores.get(id) ?? 0) + weight);
      g3Tokens.set(id, (g3Tokens.get(id) ?? 0) + 1);
    }
  }
  const g4Scores = new Map<string, number>();
  const g4Tokens = new Map<string, number>();
  const lengthPenalty = Math.sqrt(Math.max(1, tokens.length));
  for (const token of tokens) {
    const ids = g4.postings.get(token);
    if (!ids) continue;
    const weight = g4.idf.get(token) ?? 0;
    for (const id of ids) {
      g4Scores.set(id, (g4Scores.get(id) ?? 0) + weight);
      g4Tokens.set(id, (g4Tokens.get(id) ?? 0) + 1);
    }
  }

  const maxG3 = Math.max(0, ...g3Scores.values());
  const maxG4 = Math.max(
    0,
    ...[...g4Scores.values()].map((v) => v / lengthPenalty),
  );
  const legacyIds = [...(legacy?.keys() ?? [])].filter((id) =>
    exportedConceptIds.has(id),
  );
  const union = new Set<string>([
    ...g3Scores.keys(),
    ...g4Scores.keys(),
    ...legacyIds,
  ]);
  const scored = [...union].map((conceptId) => {
    const g3Raw = g3Scores.get(conceptId) ?? 0;
    const g4Raw = g4Scores.get(conceptId) ?? 0;
    const g3n = maxG3 > 0 ? g3Raw / maxG3 : 0;
    const g4adj = g4Raw / lengthPenalty;
    const g4n = maxG4 > 0 ? g4adj / maxG4 : 0;
    const hasLegacy = legacy?.has(conceptId) ?? false;
    const combined = Math.max(g3n, g4n) + (hasLegacy ? G1_BOOST : 0);
    return {
      conceptId,
      combined,
      g3Raw,
      g4Raw,
      g3Tokens: g3Tokens.get(conceptId) ?? 0,
      g4Tokens: g4Tokens.get(conceptId) ?? 0,
      hasLegacy,
    };
  });
  scored.sort((a, b) =>
    a.combined !== b.combined
      ? b.combined - a.combined
      : bigintCompare(a.conceptId, b.conceptId),
  );
  const top = scored.slice(0, RERANK_CAP).slice(0, SHORTLIST_CAP);
  const maxCombined =
    top.length > 0 ? Math.max(...top.map((s) => s.combined)) : 0;
  const shortlist = top.map((entry, index) => {
    const branches = BRANCH_ORDER.filter((branch) => {
      if (branch === BRANCH_G1) return entry.hasLegacy;
      if (branch === BRANCH_G3) return entry.g3Tokens > 0;
      return entry.g4Tokens > 0;
    });
    return {
      conceptId: entry.conceptId,
      rank: index + 1,
      rankScore: maxCombined > 0 ? round6(entry.combined / maxCombined) : 0,
      branches: [...branches],
      features: {
        legacy: entry.hasLegacy,
        g3_tokens: entry.g3Tokens,
        g4_tokens: entry.g4Tokens,
        g3_score: round6(entry.g3Raw),
        g4_score: round6(entry.g4Raw),
        combined: round6(entry.combined),
      },
    } satisfies ShortlistEntry;
  });
  const legacySkipped = (legacy?.size ?? 0) - legacyIds.length;
  return { shortlist, glossTokens: tokens.length, legacySkipped };
}

function buildEvidence(
  record: SenseExportRecord,
  concept: ConceptExportRecord,
  sources: { jmdict: MappingSource; oewn: MappingSource },
) {
  const evidence: Record<string, unknown>[] = [];
  const push = (
    key: string,
    owner: { type: 'sense' | 'concept'; semanticKey: string },
    sourceKey: string,
    sourceHash: string,
    batchId: string | null,
    payloadHash: string,
    dependencyGroup: string,
    sourcePath: string,
    method: string,
  ) => {
    evidence.push({
      key,
      kind: 'text_row',
      owner,
      sourceKey,
      sourceHash,
      batchId,
      payloadHash,
      dependencyGroup,
      sourcePath,
      method,
    });
  };

  const senseOwner = {
    type: 'sense' as const,
    semanticKey: record.sense.semanticKey,
  };
  for (const gloss of record.glosses) {
    const row = {
      key: `g:${gloss.id}`,
      evidenceKey: `e:g:${gloss.id}`,
      id: gloss.id,
      rank: gloss.rank,
      language: 'en',
      kind: 'gloss' as const,
      text: gloss.text,
    };
    push(
      row.evidenceKey,
      senseOwner,
      sources.jmdict.key,
      requireSha(sources.jmdict),
      gloss.batchId,
      textRowHash(row),
      'jmdict:gloss',
      gloss.sourcePath,
      'db4-export-v1',
    );
  }
  record.neighbors.forEach((neighbor, index) => {
    const row = {
      key: `n:${record.sense.id}:${String(index).padStart(4, '0')}`,
      evidenceKey: `e:n:${record.sense.id}:${String(index).padStart(4, '0')}`,
      id: neighbor.id,
      rank: neighbor.rank,
      language: null,
      kind: 'neighbor' as const,
      text: neighbor.text,
    };
    push(
      row.evidenceKey,
      senseOwner,
      sources.jmdict.key,
      requireSha(sources.jmdict),
      neighbor.batchId,
      textRowHash(row),
      'jmdict:gloss',
      neighbor.sourcePath,
      'db4-export-v1',
    );
  });
  evidence.push({
    key: `e:meta:${record.sense.id}`,
    kind: 'sense_metadata',
    owner: senseOwner,
    sourceKey: sources.jmdict.key,
    sourceHash: requireSha(sources.jmdict),
    batchId: record.metadataBatchId,
    payloadHash: hashJson(record.metadata),
    dependencyGroup: 'jmdict:sense',
    sourcePath: record.metadataPath,
    method: 'db4-export-v1',
  });

  const conceptOwner = {
    type: 'concept' as const,
    semanticKey: concept.concept.semanticKey,
  };
  concept.definitions.forEach((definition, index) => {
    const key = `d:${concept.concept.id}:${String(index).padStart(4, '0')}`;
    const row = {
      key,
      evidenceKey: `e:${key}`,
      id: definition.id,
      rank: definition.rank,
      language: 'en',
      kind: 'definition' as const,
      text: definition.text,
    };
    push(
      row.evidenceKey,
      conceptOwner,
      sources.oewn.key,
      requireSha(sources.oewn),
      definition.batchId,
      textRowHash(row),
      'oewn:definition',
      definition.sourcePath,
      'db4-export-v1',
    );
  });
  concept.labels.slice(0, LABEL_CAP).forEach((label, index) => {
    const key = `l:${concept.concept.id}:${String(index).padStart(4, '0')}`;
    const row = {
      key,
      evidenceKey: `e:${key}`,
      id: label.id,
      rank: label.rank,
      language: 'en',
      kind: 'synonym' as const,
      text: label.text,
    };
    push(
      row.evidenceKey,
      conceptOwner,
      sources.oewn.key,
      requireSha(sources.oewn),
      label.batchId,
      textRowHash(row),
      'oewn:members',
      label.sourcePath,
      'db4-export-v1',
    );
  });

  evidence.sort((a, b) => (String(a.key) < String(b.key) ? -1 : 1));
  return evidence;
}

function buildCandidate(
  record: SenseExportRecord,
  entry: ShortlistEntry,
  concept: ConceptExportRecord,
  sources: { jmdict: MappingSource; oewn: MappingSource },
  fingerprint: string,
): MappingCandidate {
  const enGlosses = record.glosses.map((gloss) => ({
    key: `g:${gloss.id}`,
    evidenceKey: `e:g:${gloss.id}`,
    id: gloss.id,
    rank: gloss.rank,
    language: 'en',
    kind: 'gloss',
    text: gloss.text,
  }));
  const neighbors = record.neighbors.map((neighbor, index) => ({
    key: `n:${record.sense.id}:${String(index).padStart(4, '0')}`,
    evidenceKey: `e:n:${record.sense.id}:${String(index).padStart(4, '0')}`,
    id: neighbor.id,
    rank: neighbor.rank,
    language: null,
    kind: 'neighbor',
    text: neighbor.text,
  }));
  const definitions = concept.definitions.map((definition, index) => ({
    key: `d:${concept.concept.id}:${String(index).padStart(4, '0')}`,
    evidenceKey: `e:d:${concept.concept.id}:${String(index).padStart(4, '0')}`,
    id: definition.id,
    rank: definition.rank,
    language: 'en',
    kind: 'definition',
    text: definition.text,
  }));
  const labels = concept.labels.slice(0, LABEL_CAP).map((label, index) => ({
    key: `l:${concept.concept.id}:${String(index).padStart(4, '0')}`,
    evidenceKey: `e:l:${concept.concept.id}:${String(index).padStart(4, '0')}`,
    id: label.id,
    rank: label.rank,
    language: 'en',
    kind: 'synonym',
    text: label.text,
  }));

  return createMappingCandidate({
    schemaVersion: 1,
    candidateType: 'sense_concept',
    mode: 'production',
    semanticInputFingerprint: fingerprint,
    sense: record.sense,
    senseContext: {
      enGlosses,
      definitions: [],
      metadata: record.metadata,
      metadataEvidenceKey: `e:meta:${record.sense.id}`,
      neighbors,
      examples: [],
    },
    concept: concept.concept,
    conceptContext: {
      definitions,
      labels,
      neighbors: [],
      examples: [],
    },
    evidence: buildEvidence(record, concept, sources),
    sources: [sources.jmdict, sources.oewn],
    hypothesisRelation: 'related',
    retrieval: {
      generatorVersion: GENERATOR_VERSION,
      branches: entry.branches,
      rank: entry.rank,
      rankScore: entry.rankScore,
      calibratedScore: null,
      features: entry.features,
      pruningRefs: [],
    },
    classification: 'ready',
    reasons: [],
    predecessor: null,
  });
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const started = Date.now();
  const cli = parseMappingCli('mapping-generate', argv);
  const root = cli.artifactDir;
  const exportRel = String(cli.flags.export);
  const limit = typeof cli.flags.limit === 'number' ? cli.flags.limit : null;

  const exportBytes = readBytes(root, exportRel);
  const manifest = ExportManifestSchema.parse(
    JSON.parse(exportBytes.toString('utf8')),
  );
  const exportSha = sha256Bytes(exportBytes);
  const indexBytes = readVerified(root, manifest.index);
  const index = IndexManifestSchema.parse(
    JSON.parse(indexBytes.toString('utf8')),
  );

  const g3 = loadBranchIndex(
    root,
    index.label.files,
    manifest.scope.conceptsExported,
  );
  const g4 = loadBranchIndex(
    root,
    index.definition.files,
    manifest.scope.conceptsExported,
  );

  const senseRef = findFileRef(
    manifest,
    `${path.posix.dirname(exportRel)}/sense-context.jsonl`,
  );
  const conceptRef = findFileRef(
    manifest,
    `${path.posix.dirname(exportRel)}/concept-context.jsonl`,
  );
  const senseBytes = readVerified(root, senseRef);
  const conceptBytes = readVerified(root, conceptRef);
  const senseRecords = parseJsonl(senseBytes, (v) =>
    SenseExportRecordSchema.parse(v),
  );
  const scoped = limit === null ? senseRecords : senseRecords.slice(0, limit);

  const exportedConceptIds = new Set<string>();
  for (const line of conceptBytes.toString('utf8').split('\n')) {
    if (!line) continue;
    const idMatch = /"concept":\{"id":"([0-9]+)"/.exec(line);
    if (idMatch) exportedConceptIds.add(idMatch[1]);
  }

  const legacy = await loadLegacy(
    root,
    scoped.map((record) => record.sense.id),
  );

  const plans: { record: SenseExportRecord; shortlist: ShortlistEntry[] }[] =
    [];
  const unresolved: UnresolvedEntry[] = [];
  const neededConcepts = new Set<string>();
  let legacyHintsSkipped = 0;
  for (const record of scoped) {
    const { shortlist, glossTokens, legacySkipped } = planSense(
      record,
      g3,
      g4,
      legacy.bySense.get(record.sense.id),
      exportedConceptIds,
    );
    legacyHintsSkipped += legacySkipped;
    const legacyHints = legacy.bySense.get(record.sense.id)?.size ?? 0;
    if (shortlist.length === 0) {
      unresolved.push({
        senseKey: record.sense.semanticKey,
        senseId: record.sense.id,
        lexemeId: record.sense.lexemeId,
        lemma: record.sense.lemma,
        glossTokens,
        legacyHints,
        reason: 'no_candidates',
      });
      continue;
    }
    for (const entry of shortlist) neededConcepts.add(entry.conceptId);
    plans.push({ record, shortlist });
  }

  const concepts = new Map<string, ConceptExportRecord>();
  for (const line of conceptBytes.toString('utf8').split('\n')) {
    if (!line) continue;
    const idMatch = /"concept":\{"id":"([0-9]+)"/.exec(line);
    if (!idMatch || !neededConcepts.has(idMatch[1])) continue;
    const record = ConceptExportRecordSchema.parse(JSON.parse(line));
    concepts.set(record.concept.id, record);
  }

  const jmdictSource = manifest.sources.find(
    (source) => source.key === 'jmdict',
  );
  const oewnSource = manifest.sources.find((source) => source.key === 'oewn');
  if (!jmdictSource || !oewnSource)
    throw new Error('Manifest thiếu source jmdict/oewn');
  const sources = { jmdict: jmdictSource, oewn: oewnSource };

  const generation = `${manifest.semanticInputFingerprint.slice(0, 16)}-${GENERATOR_VERSION}${limit === null ? '' : `-limit${limit}`}`;
  const finalRel = `candidates/${generation}`;
  const tmpRel = `candidates/.tmp-${process.pid}`;
  const pairsWriter = new JsonlWriter(root, `${tmpRel}/pairs.jsonl`);
  const unresolvedWriter = new JsonlWriter(root, `${tmpRel}/unresolved.jsonl`);
  let candidates = 0;
  let skippedNoDefinition = 0;
  const branchUse = new Map<string, number>();
  for (const plan of plans) {
    for (const entry of plan.shortlist) {
      const concept = concepts.get(entry.conceptId);
      if (!concept)
        throw new Error(`Thiếu concept ${entry.conceptId} trong export`);
      if (concept.definitions.length === 0) {
        skippedNoDefinition += 1;
        continue;
      }
      const candidate = buildCandidate(
        plan.record,
        entry,
        concept,
        sources,
        manifest.semanticInputFingerprint,
      );
      pairsWriter.write(candidate);
      candidates += 1;
      for (const branch of entry.branches)
        branchUse.set(branch, (branchUse.get(branch) ?? 0) + 1);
    }
  }
  for (const entry of unresolved) unresolvedWriter.write(entry);
  const pairs = pairsWriter.close();
  const unresolvedFile = unresolvedWriter.close();

  const remap = (ref: ArtifactRef): ArtifactRef => ({
    path: ref.path.replace(`${tmpRel}/`, `${finalRel}/`),
    sha256: ref.sha256,
  });
  const summary = {
    kind: 'db4-candidates',
    handoffVersion: 1,
    mode: 'production',
    generatorVersion: GENERATOR_VERSION,
    rankVersion: RANK_VERSION,
    tokenizerVersion: TOKENIZER_VERSION,
    normalizerVersion: NORMALIZER_VERSION,
    retrievalVersion: RETRIEVAL_VERSION,
    export: { path: exportRel, sha256: exportSha },
    index: { path: manifest.index.path, sha256: manifest.index.sha256 },
    legacy: { rows: legacy.rows, sha256: legacy.sha256 },
    caps: {
      branchTopK: BRANCH_TOPK,
      union: UNION_CAP,
      rerank: RERANK_CAP,
      shortlist: SHORTLIST_CAP,
    },
    counts: {
      senses: scoped.length,
      candidates,
      unresolved: unresolved.length,
      conceptsUsed: concepts.size,
      branchG1: branchUse.get(BRANCH_G1) ?? 0,
      branchG3: branchUse.get(BRANCH_G3) ?? 0,
      branchG4: branchUse.get(BRANCH_G4) ?? 0,
      legacyHintsSkipped,
      skippedNoDefinition,
    },
    files: [remap(pairs.ref), remap(unresolvedFile.ref)],
  };
  const summaryRef = writeTextAtomic(
    root,
    `${tmpRel}/summary.json`,
    stablePretty(summary),
  );
  const tmpAbs = resolveArtifact(root, tmpRel);
  const finalAbs = resolveArtifact(root, finalRel);
  if (existsSync(finalAbs)) {
    const existing = readBytes(root, `${finalRel}/summary.json`);
    const created = readBytes(root, `${tmpRel}/summary.json`);
    if (sha256Bytes(existing) !== sha256Bytes(created))
      throw new Error(`Generation đã tồn tại khác nội dung: ${finalRel}`);
    rmSync(tmpAbs, { recursive: true, force: true });
  } else {
    renameSync(tmpAbs, finalAbs);
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log('== DB4 mapping-generate (offline) ==');
  console.log(
    `  senses: ${scoped.length} | candidates: ${candidates} | unresolved: ${unresolved.length} | concepts: ${concepts.size}`,
  );
  console.log(
    `  branches: g1=${summary.counts.branchG1} g3=${summary.counts.branchG3} g4=${summary.counts.branchG4}`,
  );
  console.log(
    `  dir: ${finalRel} (${seconds}s) | summary sha ${summaryRef.sha256.slice(0, 12)}`,
  );
  if (unresolved.length > 0)
    console.log(`  view: ${finalRel}/unresolved.jsonl`);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(
      `mapping-generate: LỖI — ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
