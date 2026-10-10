import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { candidateInputFixture, snapshotFixture } from './fixtures/build';
import {
  conceptSemanticKey,
  hashBytes,
  semanticInputFingerprint,
  senseSemanticKey,
} from './_mapping-types';
import {
  MODEL_ID,
  MODEL_REVISION,
  RETRIEVAL_VERSION,
  RetrievalSense,
  RetrievalConcept,
  artifactPath,
  auditedSources,
  bundleReady,
  cliFlags,
  loadExport,
  makeCandidate,
  sourceIdentity,
  writeArtifact,
  writeJson,
} from './_retrieval';
import { runGenerate } from './retrieval-generate';

function records() {
  const input = candidateInputFixture();
  const sense: RetrievalSense = {
    sense: input.sense,
    senseContext: input.senseContext,
    evidence: input.evidence.filter((e) => e.owner.type === 'sense'),
    sourceKeys: input.sources.map((s) => s.key),
    wordnetIdentity: null,
    seedConceptIds: [],
    existingLinks: [],
  };
  const concept: RetrievalConcept = {
    concept: input.concept,
    conceptContext: input.conceptContext,
    evidence: input.evidence.filter((e) => e.owner.type === 'concept'),
    sourceKeys: input.sources.map((s) => s.key),
    synsetLineage: input.concept.synsetKeys.map((s) => ({
      ...s,
      batchId: null,
    })),
  };
  return { input, sense, concept };
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'langoo-db4-d2-'));
  const { input, sense, concept } = records();
  const proof = writeJson(root, 'proof.json', { fixture: true });
  const source = {
    ...input.sources[0],
    audit: { status: 'verified' as const, evidence: [proof], reasons: [] },
  };
  const pending = {
    ...source,
    audit: {
      status: 'blocked' as const,
      evidence: [],
      reasons: ['Not audited.'],
    },
  };
  const files = {
    senses: writeArtifact(root, 'senses.jsonl', JSON.stringify(sense) + '\n'),
    concepts: writeArtifact(
      root,
      'concepts.jsonl',
      JSON.stringify(concept) + '\n',
    ),
    sources: writeJson(root, 'sources.json', [pending]),
    inventory: writeJson(root, 'inventory.json', {}),
  };
  const snapshot = {
    ...snapshotFixture,
    senseInputHash: files.senses.sha256,
    conceptInputHash: files.concepts.sha256,
  };
  const manifest = {
    schemaVersion: 1,
    task: 'db4_retrieval_export',
    createdAt: '2026-10-08T00:00:00.000Z',
    cohort: 'fixture',
    snapshot,
    semanticInputFingerprint: semanticInputFingerprint(snapshot),
    files,
    counts: { senses: 1, concepts: 1 },
  };
  const exported = writeJson(root, 'export.json', manifest);
  const audit = {
    schemaVersion: 1,
    task: 'db4_retrieval_source_audit',
    exportSha256: exported.sha256,
    sources: [source],
  };
  const auditRef = writeJson(root, 'audit.json', audit);
  const results = [
    {
      senseKey: sense.sense.semanticKey,
      senseId: sense.sense.id,
      hits: [
        {
          conceptId: concept.concept.id,
          score: 0.85,
          branches: ['minilm_global'],
          features: { scoreIsExactProbability: false },
        },
      ],
      reason: null,
    },
  ];
  const resultRef = writeArtifact(
    root,
    'results.jsonl',
    JSON.stringify(results[0]) + '\n',
  );
  const search = {
    schemaVersion: 1,
    task: 'db4_minilm_retrieval',
    exportSha256: exported.sha256,
    auditSha256: auditRef.sha256,
    model: MODEL_ID,
    revision: MODEL_REVISION,
    methodVersion: RETRIEVAL_VERSION,
    results: resultRef,
    modelFiles: [],
    metrics: { fixture: true },
  };
  writeJson(root, 'search.json', search);
  return { root, input, sense, concept, source, manifest, audit, search };
}

void test('retrieval candidate preserves every EN gloss and never calibrates similarity as exact', () => {
  const { input, sense, concept } = records();
  const candidate = makeCandidate(
    sense,
    concept,
    input.sources,
    semanticInputFingerprint(snapshotFixture),
    1,
    0.9,
    ['minilm_global'],
    {},
    'fixture',
  );
  assert.deepEqual(
    candidate.senseContext.enGlosses,
    input.senseContext.enGlosses,
  );
  assert.equal(candidate.retrieval.calibratedScore, null);
  const bundle = bundleReady([candidate])!;
  assert.ok(!JSON.stringify(bundle).includes('rankScore'));
  assert.ok(!JSON.stringify(bundle).includes('hypothesisRelation'));
});
void test('blocked source cannot produce a ready bundle even with maximum score', () => {
  const { input, sense, concept } = records();
  const sources = input.sources.map((s) => ({
    ...s,
    audit: {
      status: 'blocked' as const,
      evidence: [],
      reasons: ['Unknown source.'],
    },
  }));
  const c = makeCandidate(
    sense,
    concept,
    sources,
    semanticInputFingerprint(snapshotFixture),
    1,
    1,
    ['minilm_global'],
    {},
    'fixture',
  );
  assert.equal(c.classification, 'blocked_source');
  assert.equal(bundleReady([c]), null);
});
void test('JMdict lexical match and ILI alone never take source identity fast path', () => {
  const { input, sense, concept } = records();
  assert.equal(
    sourceIdentity(sense, [concept], input.sources).status,
    'needs_semantic_review',
  );
});
void test('direct identity requires exact version, source anchor and keeps original link ownership', () => {
  const { input, sense, concept } = records();
  const batch = '00000000-0000-4000-8000-000000000001';
  const source = {
    ...input.sources[0],
    key: 'oewn',
    code: 'oewn',
    sourceId: 5,
    version: '2024',
    batchIds: [batch],
  };
  sense.sourceKeys = ['oewn'];
  concept.sourceKeys = ['oewn'];
  sense.wordnetIdentity = {
    lexicon: 'oewn:2024',
    synsetId: 'cat-n',
    sourceKey: 'oewn',
  };
  sense.sense.identity = {
    sourceKey: 'oewn',
    externalId: 'oewn:2024:cat-n',
    senseKey: 'wn:oewn:2024:cat-n:cat',
  };
  sense.sense.semanticKey = senseSemanticKey(
    source.code,
    sense.sense.identity.externalId,
    sense.sense.identity.senseKey,
  );
  concept.concept.synsetKeys = [{ ...sense.wordnetIdentity }];
  concept.concept.semanticKey = conceptSemanticKey(
    concept.concept.synsetKeys,
    concept.concept.ili,
  );
  sense.existingLinks = [
    {
      conceptId: concept.concept.id!,
      relation: 'exact',
      method: 'wordnet_synset',
      verified: true,
      sourceId: 5,
      batchId: batch,
    },
  ];
  assert.equal(
    sourceIdentity(sense, [concept], [source]).status,
    'existing_source_link',
  );
  assert.equal(
    sourceIdentity(sense, [concept], [{ ...source, version: '2023' }]).status,
    'unresolved',
  );
  const foreign = structuredClone(concept);
  foreign.concept.id = '999';
  assert.equal(
    sourceIdentity(sense, [concept, foreign], [source]).status,
    'unresolved',
  );
  sense.existingLinks[0].conceptId = '999';
  assert.equal(sourceIdentity(sense, [concept], [source]).status, 'unresolved');
});
void test('artifact writes are immutable and symlink traversal is rejected', () => {
  const root = mkdtempSync(join(tmpdir(), 'langoo-db4-artifacts-'));
  writeJson(root, 'manifest.json', {});
  assert.throws(() => writeJson(root, 'manifest.json', {}));
  assert.throws(() => artifactPath(root, '../escape.json'));
  const outside = mkdtempSync(join(tmpdir(), 'langoo-outside-'));
  symlinkSync(outside, join(root, 'escape'));
  assert.throws(() => artifactPath(root, 'escape/result.json'));
  mkdirSync(join(root, 'safe'));
  assert.equal(
    artifactPath(root, 'safe/file.json'),
    join(root, 'safe/file.json'),
  );
});
void test('source audit requires actual proof bytes and cannot rewrite source identity', async () => {
  const f = fixture();
  const exported = await loadExport(f.root, 'export.json');
  auditedSources(f.root, 'audit.json', exported);
  writeFileSync(join(f.root, 'proof.json'), 'changed');
  assert.throws(
    () => auditedSources(f.root, 'audit.json', exported),
    /hash mismatch/,
  );
  const other = fixture();
  other.audit.sources[0].sha256 = 'a'.repeat(64);
  writeFileSync(join(other.root, 'audit.json'), JSON.stringify(other.audit));
  assert.throws(
    () => auditedSources(other.root, 'audit.json', exported),
    /another export|rewrote/,
  );
});
void test('production cannot elevate a verified flag without passing raw-source checks', async () => {
  const f = fixture();
  const manifest = {
    ...f.manifest,
    snapshot: { ...f.manifest.snapshot, mode: 'production' as const },
  };
  manifest.semanticInputFingerprint = semanticInputFingerprint(
    manifest.snapshot,
  );
  const content = JSON.stringify(manifest) + '\n';
  writeFileSync(join(f.root, 'export.json'), content);
  f.audit.exportSha256 = hashBytes(content);
  writeFileSync(join(f.root, 'audit.json'), JSON.stringify(f.audit));
  const exported = await loadExport(f.root, 'export.json');
  assert.throws(
    () => auditedSources(f.root, 'audit.json', exported),
    /passing raw checks/,
  );
});
void test('generation binds export/audit/search, keeps denominator and emits valid contract bundles', async () => {
  const f = fixture();
  const result = await runGenerate({
    'artifact-dir': f.root,
    export: 'export.json',
    audit: 'audit.json',
    search: 'search.json',
  });
  assert.equal(result.counts.senses, 1);
  assert.equal(result.counts.bundles, 1);
  assert.equal(result.apply, false);
  const bytes = readFileSync(join(f.root, result.files.bundles.path));
  assert.equal(hashBytes(bytes), result.files.bundles.sha256);
  assert.equal(result.semanticQualityValidated, false);
});
void test('missing, duplicate and foreign retrieval results cannot silently become completion', async () => {
  for (const variant of ['empty', 'duplicate', 'foreign'] as const) {
    const f = fixture();
    let rows: unknown[] = [];
    const original = JSON.parse(
      readFileSync(join(f.root, 'results.jsonl'), 'utf8'),
    ) as { senseKey: string; hits: { conceptId: string }[] };
    if (variant === 'duplicate') rows = [original, original];
    if (variant === 'foreign') {
      original.hits[0].conceptId = '999';
      rows = [original];
    }
    const content = rows.map((r) => JSON.stringify(r) + '\n').join('');
    writeFileSync(join(f.root, 'results.jsonl'), content);
    f.search.results.sha256 = hashBytes(content);
    writeFileSync(join(f.root, 'search.json'), JSON.stringify(f.search));
    await assert.rejects(() =>
      runGenerate({
        'artifact-dir': f.root,
        export: 'export.json',
        audit: 'audit.json',
        search: 'search.json',
      }),
    );
  }
});
void test('concept streaming verifies bytes beyond selected hits', async () => {
  const f = fixture();
  writeFileSync(
    join(f.root, 'concepts.jsonl'),
    readFileSync(join(f.root, 'concepts.jsonl'), 'utf8') + '\n',
  );
  await assert.rejects(
    () => loadExport(f.root, 'export.json', new Set()),
    /hash mismatch/,
  );
});
void test('CLI rejects mutation flags and accidental credential arguments', () => {
  assert.throws(() => cliFlags(['--apply', 'true'], ['export']));
  assert.throws(() => cliFlags(['--database-url', 'secret'], ['export']));
  assert.throws(() =>
    cliFlags(['--export', 'one', '--export', 'two'], ['export']),
  );
});
