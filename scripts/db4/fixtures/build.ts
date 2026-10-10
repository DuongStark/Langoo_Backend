import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  Evidence,
  MappingCandidateInput,
  MappingDecision,
  MappingJobConfig,
  MappingJobEntry,
  MappingOutput,
  MappingProvider,
  MappingSource,
  TextRow,
  createMappingBundle,
  createMappingCandidate,
  createMappingJob,
  conceptSemanticKey,
  hashBytes,
  hashJson,
  mappingTargetKey,
  parseMappingAudit,
  parseMappingDecision,
  parseMappingOutput,
  renderMappingBundle,
  semanticInputFingerprint,
  senseSemanticKey,
  textRowHash,
} from '../_mapping-types';

/** These are invented contract examples, not audited dictionary facts or gold production labels. */
export const semanticCases = [
  {
    key: 'cat-exact',
    lemma: '猫',
    glosses: ['cat', 'domestic cat'],
    definition: 'A domesticated feline animal.',
    relation: 'exact',
  },
  {
    key: 'animal-broader',
    lemma: '動物',
    glosses: ['animal'],
    definition: 'A domesticated feline animal.',
    relation: 'broader',
  },
  {
    key: 'cat-narrower',
    lemma: '猫',
    glosses: ['domestic cat'],
    definition: 'A living animal organism.',
    relation: 'narrower',
  },
  {
    key: 'doctor-related',
    lemma: '医者',
    glosses: ['medical doctor'],
    definition: 'An institution providing medical treatment.',
    relation: 'related',
  },
  {
    key: 'bank-none',
    lemma: '岸',
    glosses: ['bank of a river'],
    definition: 'A financial institution that holds deposits.',
    relation: 'none',
  },
  {
    key: 'thin-uncertain',
    lemma: '薄い',
    glosses: ['thin', 'weak', 'faint'],
    definition: 'Having small thickness between two surfaces.',
    relation: 'uncertain',
  },
  {
    key: 'director-compound',
    lemma: '監督',
    glosses: ['supervisor', 'film director'],
    definition: 'A person who directs films.',
    relation: 'broader',
  },
  {
    key: 'way-compound',
    lemma: '道',
    glosses: ['road', 'way', 'method'],
    definition: 'A route made for travelling.',
    relation: 'broader',
  },
  {
    key: 'automatic-volition',
    lemma: '自動的',
    glosses: ['automatic', 'without conscious volition'],
    definition: 'Done without conscious intention.',
    relation: 'uncertain',
  },
  {
    key: 'treat-person',
    lemma: '扱う',
    glosses: ['to treat someone', 'to handle something'],
    definition: 'To cure an illness medically.',
    relation: 'none',
  },
] as const;
const encodeFile = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
const artifact = (path: string) => ({
  path,
  sha256: hashBytes(encodeFile({ fixture: path })),
});
const source: MappingSource = {
  key: 'fixture-dictionary',
  sourceId: null,
  code: 'synthetic-fixture',
  version: '1',
  snapshot: 'fixture-v1',
  sha256: hashJson({ fixture: 'source-v1' }),
  license: 'Synthetic test data',
  attribution: 'Langoo D1 contract fixtures',
  url: 'https://example.invalid/db4-fixture',
  batchIds: [],
  audit: {
    status: 'verified',
    evidence: [artifact('fixtures/source-audit.json')],
    reasons: [],
  },
};
export const snapshotFixture = {
  schemaVersion: 1 as const,
  mode: 'fixture' as const,
  sourceSnapshots: [{ sourceKey: source.key, sha256: source.sha256! }],
  identityHash: hashJson('identities-v1'),
  senseInputHash: hashJson('JA-EN-v1'),
  conceptInputHash: hashJson('synsets-v1'),
  rawAttributesHash: hashJson('raw-pos-v1'),
  sourcePolicyVersion: 'fixture-source-v1',
  normalizerVersion: 'fixture-pos-v1',
  retrievalVersion: 'fixture-retrieval-v1',
};
export function candidateInputFixture(caseIndex = 0): MappingCandidateInput {
  const semanticCase = semanticCases[caseIndex];
  const senseKey = senseSemanticKey(
    source.code,
    semanticCase.key,
    `${semanticCase.key}#1`,
  );
  const conceptKey = conceptSemanticKey(
    [{ lexicon: 'fixture-wn', synsetId: `fixture-${caseIndex}-n` }],
    null,
  );
  function row(
    key: string,
    text: string,
    kind: TextRow['kind'],
    rank: number,
  ): TextRow {
    return {
      key,
      evidenceKey: `e:${key}`,
      id: String(9007199254741000n + BigInt(rank)),
      rank,
      language: 'en',
      kind,
      text,
    };
  }
  const glosses = semanticCase.glosses.map((text, i) =>
    row(`g:${semanticCase.key}:${i}`, text, 'gloss', i),
  );
  const definitions = [
    row(`d:${semanticCase.key}`, semanticCase.definition, 'definition', 0),
  ];
  const metadata = {
    rawAttributes: { pos: 'noun', fixture: true },
    rawPos: ['noun'],
    normalizedPos: ['noun'],
    normalizationVersion: 'fixture-pos-v1',
    appliesToKanji: [],
    appliesToKana: [],
    info: [],
    misc: [],
    field: [],
    dialect: [],
    register: [],
    languageSources: [],
  };
  const evidence: Evidence[] = [
    ...glosses.map((r) => ({
      key: r.evidenceKey,
      kind: 'text_row' as const,
      owner: { type: 'sense' as const, semanticKey: senseKey },
      sourceKey: source.key,
      sourceHash: source.sha256,
      batchId: null,
      payloadHash: textRowHash(r),
      dependencyGroup: 'fixture:JA-EN',
      sourcePath: `sense_gloss/${r.id}`,
      method: 'fixture',
    })),
    ...definitions.map((r) => ({
      key: r.evidenceKey,
      kind: 'text_row' as const,
      owner: { type: 'concept' as const, semanticKey: conceptKey },
      sourceKey: source.key,
      sourceHash: source.sha256,
      batchId: null,
      payloadHash: textRowHash(r),
      dependencyGroup: 'fixture:wordnet',
      sourcePath: `synset_definition/${r.id}`,
      method: 'fixture',
    })),
    {
      key: `e:metadata:${semanticCase.key}`,
      kind: 'sense_metadata' as const,
      owner: { type: 'sense' as const, semanticKey: senseKey },
      sourceKey: source.key,
      sourceHash: source.sha256,
      batchId: null,
      payloadHash: hashJson(metadata),
      dependencyGroup: 'fixture:JA-EN',
      sourcePath: 'sense/attributes',
      method: 'fixture',
    },
  ].sort((a, b) => (a.key < b.key ? -1 : 1));
  return {
    schemaVersion: 1,
    candidateType: 'sense_concept',
    mode: 'fixture',
    semanticInputFingerprint: semanticInputFingerprint(snapshotFixture),
    sense: {
      id: String(100 + caseIndex),
      lexemeId: String(200 + caseIndex),
      semanticKey: senseKey,
      identity: {
        sourceKey: source.key,
        externalId: semanticCase.key,
        senseKey: `${semanticCase.key}#1`,
      },
      language: 'ja',
      lemma: semanticCase.lemma,
      reading: null,
      forms: [semanticCase.lemma],
      senseNo: 1,
      isPrimary: true,
      jlptLevel: 5,
    },
    senseContext: {
      enGlosses: glosses,
      definitions: [],
      metadata,
      metadataEvidenceKey: `e:metadata:${semanticCase.key}`,
      neighbors: [],
      examples: [],
    },
    concept: {
      id: String(300 + caseIndex),
      semanticKey: conceptKey,
      ili: null,
      synsetKeys: [
        {
          lexicon: 'fixture-wn',
          synsetId: `fixture-${caseIndex}-n`,
          sourceKey: source.key,
        },
      ],
      pos: 'noun',
    },
    conceptContext: { definitions, labels: [], neighbors: [], examples: [] },
    evidence,
    sources: [structuredClone(source)],
    hypothesisRelation: 'exact',
    retrieval: {
      generatorVersion: 'fixture-retrieval-v1',
      branches: ['en-gloss'],
      rank: 1,
      rankScore: 0.8,
      calibratedScore: null,
      features: { tokenOverlap: 1 },
      pruningRefs: [],
    },
    classification: 'ready',
    reasons: [],
    predecessor: null,
  };
}
export function fixtureCase(index = 0) {
  const candidate = createMappingCandidate(candidateInputFixture(index));
  const bundle = createMappingBundle([candidate], 'fixture-bundle-v1');
  const expected = semanticCases[index].relation;
  const output: MappingOutput = {
    schemaVersion: 1,
    task: 'sense_concept_review',
    bundleKey: bundle.bundleKey,
    senseId: candidate.sense.id!,
    contextHash: bundle.contextHash,
    reviews: [
      {
        candidateKey: candidate.candidateKey,
        conceptId: candidate.concept.id!,
        relation: expected,
        coveredBranches: expected === 'none' ? [] : bundle.sourceBranches,
        missingBranches: expected === 'none' ? bundle.sourceBranches : [],
        conflicts: [],
        reason: `Synthetic scope fixture: ${semanticCases[index].key}. Relation direction is source sense to target concept.`,
        confidence: null,
      },
    ],
    noSuitableCandidate: expected === 'none',
    unresolvedReason:
      expected === 'uncertain'
        ? {
            code: 'missing_context',
            detail: 'Synthetic example requires more scope evidence.',
          }
        : null,
  };
  parseMappingOutput(output, bundle);
  const decision: MappingDecision = {
    schemaVersion: 1,
    candidateKey: candidate.candidateKey,
    inputHash: candidate.inputHash,
    outputHashR1: hashJson(output),
    outputHashR2: hashJson(output),
    policyVersion: 'fixture-decision-v1',
    proposal:
      expected === 'exact'
        ? 'accept_exact'
        : expected === 'none'
          ? 'reject_pair'
          : expected === 'uncertain'
            ? 'defer'
            : 'accept_nonexact',
    relation: expected,
    reasons:
      expected === 'uncertain'
        ? [{ code: 'missing_context', detail: 'Need semantic review.' }]
        : [],
  };
  parseMappingDecision(decision, candidate, bundle, output, output);
  const audit = parseMappingAudit(
    {
      schemaVersion: 1,
      candidateKey: candidate.candidateKey,
      inputHash: candidate.inputHash,
      outputHashR1: hashJson(output),
      outputHashR2: hashJson(output),
      decisionHash: hashJson(decision),
      reviewerKind: 'rule',
      reviewerId: 'synthetic-fixture-builder',
      reviewerSession: 'fixture-v1',
      reviewedAt: '2026-10-06T00:00:00Z',
      verdict: 'pass',
      severity: 'none',
      reason: 'Contract test only; not a semantic production audit.',
      suggestedDecision: null,
    },
    decision,
  );
  return {
    caseKey: semanticCases[index].key,
    expectedRelation: expected,
    candidate,
    bundle,
    outputR1: output,
    outputR2: output,
    decision,
    audit,
  };
}
export function providerFixture(phase: 'r1' | 'r2'): MappingProvider {
  return {
    provider: 'stub',
    model: 'fixture-stub-v1',
    endpoint: null,
    protocol: 'stub',
    promptVersion: `mapping-sense-concept-${phase}-v1`,
    responseSchemaVersion: 1,
    reasoningConfig: { effort: null, maxTokens: 0 },
    sessionId: `fixture-session-${phase}`,
    rate: {
      inputMicrousdPerMillion: 0,
      outputMicrousdPerMillion: 0,
      reasoningMicrousdPerMillion: 0,
      verifiedAt: '2026-10-06T00:00:00Z',
      evidence: artifact('fixtures/stub-rate.json'),
    },
  };
}
export function jobFixture() {
  const { bundle } = fixtureCase();
  const config: MappingJobConfig = {
    schemaVersion: 1,
    task: 'sense_concept_review',
    mode: 'fixture',
    semanticInputFingerprint: bundle.semanticInputFingerprint,
    snapshot: {
      path: 'fixtures/snapshot.json',
      sha256: hashBytes(encodeFile(snapshotFixture)),
    },
    pilotManifest: {
      path: 'fixtures/pilot.json',
      sha256: hashBytes(encodeFile(pilotFixture())),
    },
    providers: { r1: providerFixture('r1'), r2: providerFixture('r2') },
    policyVersions: {
      source: 'fixture-source-v1',
      retrieval: 'fixture-retrieval-v1',
      decision: 'fixture-decision-v1',
      audit: 'fixture-audit-v1',
    },
    seed: 'fixture-seed-v1',
    caps: {
      maxRequests: 220,
      maxTokens: 1000000,
      maxCostMicrousd: 100000,
      maxOutputTokens: 4096,
      maxContextBytes: 100000,
      maxRetries: 2,
      concurrency: 1,
    },
  };
  const entry: MappingJobEntry = {
    targetKey: mappingTargetKey(
      bundle.sense.semanticKey,
      bundle.semanticInputFingerprint,
    ),
    senseKey: bundle.sense.semanticKey,
    bundleKey: bundle.bundleKey,
    contextHash: bundle.contextHash,
    bundle: {
      path: 'fixtures/cat-exact.json',
      sha256: hashBytes(encodeFile(fixtureCase())),
    },
    renderedR1: renderMappingBundle(
      bundle,
      'r1',
      config.seed,
      config.providers.r1.promptVersion,
    ).renderedContextHash,
    renderedR2: renderMappingBundle(
      bundle,
      'r2',
      config.seed,
      config.providers.r2.promptVersion,
    ).renderedContextHash,
    state: 'queued',
    decision: null,
    audit: null,
    gate: null,
    journal: null,
    reason: null,
  };
  return createMappingJob(config, [entry]);
}
export function pilotFixture() {
  const { bundle } = fixtureCase();
  const targetKey = mappingTargetKey(
    bundle.sense.semanticKey,
    bundle.semanticInputFingerprint,
  );
  return {
    schemaVersion: 1,
    mode: 'fixture',
    pilot: 'A',
    semanticInputFingerprint: bundle.semanticInputFingerprint,
    policyVersion: 'fixture-audit-v1',
    seed: 'fixture-seed-v1',
    targetKeys: [targetKey],
    positiveTargetKeys: [targetKey],
    hardNegativeTargetKeys: [],
    strata: [
      {
        targetKey,
        jlptLevel: 5,
        isPrimary: true,
        lexemeKey: 'fixture:lexeme:cat',
      },
    ],
    exclusions: [],
  };
}
export function writeFixtures(directory: string): void {
  mkdirSync(directory, { recursive: true });
  const entries: { path: string; sha256: string }[] = [];
  function save(path: string, value: unknown) {
    const contents = encodeFile(value);
    writeFileSync(resolve(directory, path), contents, 'utf8');
    entries.push({ path, sha256: hashBytes(contents) });
  }
  semanticCases.forEach((_, i) =>
    save(`${semanticCases[i].key}.json`, fixtureCase(i)),
  );
  save('job.json', jobFixture());
  save('snapshot.json', snapshotFixture);
  save('pilot.json', pilotFixture());
  save('source-audit.json', { fixture: 'fixtures/source-audit.json' });
  save('stub-rate.json', { fixture: 'fixtures/stub-rate.json' });
  writeFileSync(
    resolve(directory, 'manifest.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        mode: 'fixture',
        hashKind: 'raw-file-sha256',
        entries,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
}
if (require.main === module) writeFixtures(resolve(__dirname));
