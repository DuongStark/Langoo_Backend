import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import {
  BatchManifestSchema,
  BatchScheduleSchema,
  createBatchEvent,
} from './_batch-types';
import {
  ArtifactRefSchema,
  MappingBundle,
  createMappingBundle,
  createMappingCandidate,
  hashBytes,
  hashJson,
  semanticInputFingerprint,
} from './_mapping-types';
import {
  MODEL_ID,
  MODEL_REVISION,
  RETRIEVAL_VERSION,
  RetrievalSense,
  SearchResultSchema,
  writeArtifact,
  writeAtomicArtifact,
  writeJson,
} from './_retrieval';
import { candidateInputFixture, snapshotFixture } from './fixtures/build';
import { prepareAutomatedBatch } from './batch-prepare';
import { validateBatchPhase } from './batch-validate';
import { preflightBatchInputs } from './batch-preflight';
import { buildBatchReport } from './batch-report';

function jsonl(rows: unknown[]) {
  return rows.map((row) => JSON.stringify(row) + '\n').join('');
}

function fixtureSourceRows() {
  return [0, 1].map((index) => {
    const candidate = candidateInputFixture(index);
    const value: RetrievalSense = {
      sense: candidate.sense,
      senseContext: candidate.senseContext,
      evidence: candidate.evidence,
      sourceKeys: [candidate.sense.identity!.sourceKey],
      wordnetIdentity: null,
      seedConceptIds: [],
      existingLinks: [],
    };
    return { candidate, value };
  });
}

function prepareFixture(root: string) {
  const fixtureRows = fixtureSourceRows();
  const sourceBytes = jsonl(fixtureRows.map((row) => row.value));
  const sourceSenseRef = writeArtifact(
    root,
    'export/senses.jsonl',
    sourceBytes,
  );
  const fixtureSources = fixtureRows[0].candidate.sources;
  const sourceListRef = writeArtifact(
    root,
    'export/sources.json',
    JSON.stringify(fixtureSources) + '\n',
  );
  const conceptsRef = writeArtifact(root, 'export/concepts.jsonl', '{}\n');
  const inventoryRef = writeArtifact(root, 'export/inventory.json', '{}\n');
  const sourceSnapshot = { ...snapshotFixture, mode: 'production' as const };
  const parentManifest = {
    schemaVersion: 1,
    task: 'db4_retrieval_export',
    createdAt: '2026-10-10T00:00:00.000Z',
    cohort: 'fixture-jlpt',
    snapshot: sourceSnapshot,
    semanticInputFingerprint: semanticInputFingerprint(sourceSnapshot),
    files: {
      senses: sourceSenseRef,
      concepts: conceptsRef,
      sources: sourceListRef,
      inventory: inventoryRef,
    },
    counts: { senses: fixtureRows.length, concepts: 1 },
  };
  const parentRef = writeJson(root, 'export/manifest.json', parentManifest);

  const selectedRows = fixtureRows.map(({ value }, index) => {
    const sense = value.sense;
    const senseKey = sense.identity!.senseKey;
    const lexemeKey = sense.identity!.externalId;
    const enGlossCount = value.senseContext.enGlosses.length;
    const targetKey = hashJson({
      schemaVersion: 1,
      task: 'db4_cohort_target',
      snapshotFingerprint: parentManifest.semanticInputFingerprint,
      semanticKey: sense.semanticKey,
    });
    const line = sourceBytes.split('\n')[index];
    const pos = value.senseContext.metadata.normalizedPos;
    return {
      schemaVersion: 1,
      task: 'db4_cohort_target',
      targetKey,
      senseKey,
      senseId: sense.id!,
      lexemeId: sense.lexemeId!,
      lexemeKey,
      sourceRef: {
        file: sourceSenseRef,
        line: index + 1,
        rowSha256: hashBytes(`${line}\n`),
      },
      split: index === 0 ? 'development' : 'holdout',
      shardId: index === 0 ? 'dev-01' : 'holdout-01',
      strata: {
        level: sense.jlptLevel,
        posFamily: pos.includes('noun') ? 'noun' : 'other',
        glossCount: enGlossCount > 1 ? 'multiple' : 'one',
        fieldInfo: 'absent',
        originalStatus: 'unlinked',
      },
      enGlossCount,
      hasFieldInfo: false,
      hasExistingExact: false,
      originalStatus: 'unlinked',
      level: sense.jlptLevel,
      pos,
    };
  });
  const selectedRef = writeArtifact(
    root,
    'cohort/selected.jsonl',
    jsonl(selectedRows),
  );
  const populationRef = writeJson(root, 'cohort/population.json', {
    schemaVersion: 1,
    task: 'db4_cohort_population',
    export: { manifest: parentRef, senses: sourceSenseRef },
    counts: { eligible: fixtureRows.length, selected: fixtureRows.length },
  });
  const samplingRef = writeJson(root, 'cohort/sampling.json', {
    schemaVersion: 1,
    task: 'db4_cohort_sampling',
    selectorVersion: 'fixture-selector-v1',
    seed: 'fixture-seed',
    input: { exportManifest: parentRef, sourceSenseFile: sourceSenseRef },
    config: { shardTarget: 100, maxShards: 10 },
    counts: {
      eligible: fixtureRows.length,
      selected: fixtureRows.length,
      development: 1,
      holdout: 1,
      shards: 2,
      shardCounts: { 'dev-01': 1, 'holdout-01': 1 },
    },
    files: { population: populationRef, selected: selectedRef },
    constraints: {
      lexemeDisjoint: true,
      pilotLexemesInDevelopment: true,
      duplicateSenseKeys: false,
      withinPlanTarget: true,
      developmentQuotaMet: true,
      holdoutQuotaMet: true,
    },
  });

  const auditEvidence = fixtureSources[0].audit.evidence[0];
  writeArtifact(
    root,
    auditEvidence.path,
    JSON.stringify({ fixture: auditEvidence.path }, null, 2) + '\n',
  );
  const d2ExportManifest = {
    ...parentManifest,
    cohort: 'fixture-d2-export',
  };
  const d2ExportRef = writeJson(
    root,
    'cohort-export/manifest.json',
    d2ExportManifest,
  );
  const auditRef = writeJson(root, 'audit/sources.json', {
    schemaVersion: 1,
    task: 'db4_retrieval_source_audit',
    exportSha256: d2ExportRef.sha256,
    sources: fixtureSources,
  });
  const expectedSnapshot = {
    ...d2ExportManifest.snapshot,
    sourcePolicyVersion: `db4-d2-source-audit-v1:${auditRef.sha256}`,
  };
  const generationFingerprint = semanticInputFingerprint(expectedSnapshot);
  const candidateInput = {
    ...fixtureRows[0].candidate,
    mode: 'production' as const,
    semanticInputFingerprint: generationFingerprint,
  };
  const candidate = createMappingCandidate(candidateInput);
  const bundle: MappingBundle = createMappingBundle(
    [candidate],
    RETRIEVAL_VERSION,
  );
  const bundleRef = writeArtifact(
    root,
    'generation/bundles.jsonl',
    jsonl([bundle]),
  );
  const candidateRef = writeArtifact(
    root,
    'generation/candidates.jsonl',
    jsonl([candidate]),
  );
  const sourceIdentityRef = writeArtifact(
    root,
    'generation/source-identity.jsonl',
    '\n',
  );
  const statusRows = [
    {
      senseKey: fixtureRows[0].value.sense.semanticKey,
      senseId: fixtureRows[0].value.sense.id,
      status: 'ready',
      bundleKey: bundle.bundleKey,
      reason: null,
      candidateCount: 1,
    },
    {
      senseKey: fixtureRows[1].value.sense.semanticKey,
      senseId: fixtureRows[1].value.sense.id,
      status: 'no_candidates',
      bundleKey: null,
      reason: 'no_candidates_after_pos_filter',
      candidateCount: 0,
    },
  ];
  const statusRef = writeArtifact(
    root,
    'generation/status.jsonl',
    jsonl(statusRows),
  );
  const searchResults = [
    {
      senseKey: fixtureRows[0].value.sense.semanticKey,
      senseId: fixtureRows[0].value.sense.id,
      hits: [
        {
          conceptId: candidate.concept.id!,
          score: 0.8,
          branches: bundle.sourceBranches,
          features: {},
        },
      ],
      reason: null,
    },
    {
      senseKey: fixtureRows[1].value.sense.semanticKey,
      senseId: fixtureRows[1].value.sense.id,
      hits: [],
      reason: 'no_candidates_after_pos_filter',
    },
  ];
  searchResults.forEach((row) => SearchResultSchema.parse(row));
  const searchResultsRef = writeArtifact(
    root,
    'search/results.jsonl',
    jsonl(searchResults),
  );
  const searchRef = writeJson(root, 'search/manifest.json', {
    schemaVersion: 1,
    task: 'db4_minilm_retrieval',
    exportSha256: d2ExportRef.sha256,
    auditSha256: auditRef.sha256,
    model: MODEL_ID,
    revision: MODEL_REVISION,
    methodVersion: RETRIEVAL_VERSION,
    results: searchResultsRef,
    modelFiles: [],
    metrics: {},
  });
  const generationRef = writeJson(root, 'generation/manifest.json', {
    schemaVersion: 1,
    task: 'db4_retrieval_generation',
    version: RETRIEVAL_VERSION,
    createdAt: '2026-10-10T00:00:00.000Z',
    snapshot: expectedSnapshot,
    semanticInputFingerprint: generationFingerprint,
    inputs: { export: d2ExportRef, audit: auditRef, search: searchRef },
    files: {
      candidates: candidateRef,
      bundles: bundleRef,
      sourceIdentity: sourceIdentityRef,
      status: statusRef,
    },
    counts: {
      senses: 2,
      candidates: 1,
      bundles: 1,
      statuses: { ready: 1, no_candidates: 1 },
    },
    apply: false,
    semanticQualityValidated: false,
  });
  return {
    samplingRef,
    generationRef,
    parentRef,
    generationPath: 'generation/manifest.json',
    samplingPath: 'cohort/sampling.json',
    exportPath: 'export/manifest.json',
    selectedRef,
  };
}

void test('batch preparation preserves no-candidate denominator and plans conditional R2', async () => {
  const root = mkdtempSync(join(tmpdir(), 'db4-batch-prepare-'));
  try {
    const inputs = prepareFixture(root);
    const options = {
      runId: 'fixture-run',
      samplingPath: inputs.samplingPath,
      generationPath: inputs.generationPath,
      exportPath: inputs.exportPath,
      outputPrefix: 'batch-runs/fixture-run',
      promptRevision: 'v2.1' as const,
      promptDirectory: resolve('docs/prompts'),
      gitRevision: 'abcdef0123456789',
      dirtySourceSha256: null,
      now: () => '2026-10-10T12:00:00.000Z',
    };
    const result = await prepareAutomatedBatch(root, options);
    const preflight = await preflightBatchInputs(root, result.manifest.path);
    assert.deepEqual(
      {
        selected: preflight.selected,
        ready: preflight.ready,
        noCandidate: preflight.noCandidate,
        requests: preflight.requests,
        apply: preflight.apply,
        museCalled: preflight.museCalled,
      },
      {
        selected: 2,
        ready: 1,
        noCandidate: 1,
        requests: 2,
        apply: false,
        museCalled: false,
      },
    );
    assert.deepEqual(result.counts, {
      selected: 2,
      development: 1,
      holdout: 1,
      r1Planned: 1,
      r2ConditionalPlanned: 1,
      noCandidates: 1,
      jobs: 2,
      shards: 2,
    });

    const manifest = BatchManifestSchema.parse(
      JSON.parse(readFileSync(join(root, result.manifest.path), 'utf8')),
    );
    assert.equal(manifest.mode, 'shadow');
    assert.equal(manifest.apply, false);
    assert.equal(manifest.promotionReady, false);
    assert.equal(manifest.cohort.counts.selected, 2);
    assert.equal(manifest.retrieval.noCandidateCount, 1);
    assert.equal(manifest.caps.workers, 8);
    assert.equal(manifest.shards.length, 2);
    for (const shard of manifest.shards) {
      assert.equal(shard.count, 1);
      assert.equal(shard.readyCount + shard.noCandidateCount, 1);
    }

    const scheduleRows = readFileSync(
      join(root, manifest.artifacts.schedule.path),
      'utf8',
    )
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as unknown);
    const schedule = BatchScheduleSchema.parse({
      schemaVersion: 1,
      task: 'db4_batch_schedule',
      runId: 'fixture-run',
      waveId: 'initial',
      createdAt: '2026-10-10T12:00:00.000Z',
      jobs: scheduleRows,
    });
    assert.deepEqual(schedule.jobs.map((job) => job.phase).sort(), [
      'r1',
      'r2',
    ]);
    const r1 = schedule.jobs.find((job) => job.phase === 'r1')!;
    const r2 = schedule.jobs.find((job) => job.phase === 'r2')!;
    assert.equal(r2.dependsOn, r1.jobKey);

    const noCandidateShard = manifest.shards.find(
      (shard) => shard.noCandidateCount === 1,
    )!;
    assert.equal(
      readFileSync(join(root, noCandidateShard.requests.r1.path), 'utf8'),
      '',
    );
    const initialResults = readFileSync(
      join(root, manifest.artifacts.initialTargetResults.path),
      'utf8',
    )
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { status: string });
    assert.deepEqual(initialResults.map((row) => row.status).sort(), [
      'no_candidates',
      'r1_pending',
    ]);
    assert.equal(result.dispatched, false);
    assert.equal(result.apply, false);

    const readyShard = manifest.shards.find((shard) => shard.readyCount === 1)!;
    const request = JSON.parse(
      readFileSync(join(root, readyShard.requests.r1.path), 'utf8').trim(),
    ) as {
      jobKey: string;
      targetKey: string;
      senseKey: string;
      phase: 'r1';
      bundleKey: string;
      promptHash: string;
      renderedContextHash: string;
      payload: {
        bundle: {
          bundleKey: string;
          contextHash: string;
          sense: { id: string };
          sourceBranches: string[];
          candidates: {
            candidateKey: string;
            concept: { id: string };
          }[];
        };
      };
    };
    const rawOutput = {
      schemaVersion: 1,
      task: 'sense_concept_review',
      bundleKey: request.bundleKey,
      senseId: request.payload.bundle.sense.id,
      contextHash: request.payload.bundle.contextHash,
      reviews: request.payload.bundle.candidates.map((candidate) => ({
        candidateKey: candidate.candidateKey,
        conceptId: candidate.concept.id,
        relation: 'exact',
        coveredBranches: request.payload.bundle.sourceBranches,
        missingBranches: [],
        conflicts: [],
        reason: 'Synthetic exact fixture for validator wiring only.',
        confidence: null,
      })),
      noSuitableCandidate: false,
      unresolvedReason: null,
    };
    const rawText = JSON.stringify(rawOutput);
    const responsePath = `batch-runs/fixture-run/responses/raw/${request.jobKey}.txt`;
    const rawRef = writeArtifact(root, responsePath, rawText);
    const eventInputs: Parameters<typeof createBatchEvent>[0][] = [
      {
        runId: 'fixture-run',
        sequence: 0,
        previousEventSha256: null,
        at: '2026-10-10T12:00:01.000Z',
        jobKey: null,
        type: 'run_started',
        details: {},
      },
      {
        runId: 'fixture-run',
        sequence: 1,
        previousEventSha256: null,
        at: '2026-10-10T12:00:02.000Z',
        jobKey: request.jobKey,
        type: 'job_planned',
        details: { phase: 'r1' },
      },
      {
        runId: 'fixture-run',
        sequence: 2,
        previousEventSha256: null,
        at: '2026-10-10T12:00:03.000Z',
        jobKey: request.jobKey,
        type: 'dispatch_intent_persisted',
        details: { phase: 'r1' },
      },
      {
        runId: 'fixture-run',
        sequence: 3,
        previousEventSha256: null,
        at: '2026-10-10T12:00:04.000Z',
        jobKey: request.jobKey,
        type: 'response_saved',
        details: {
          phase: 'r1',
          responsePath,
          responseSha256: rawRef.sha256,
          bytes: Buffer.byteLength(rawText),
        },
      },
    ];
    const events = [];
    let previous: string | null = null;
    for (const input of eventInputs) {
      const event = createBatchEvent({
        ...input,
        previousEventSha256: previous,
      });
      events.push(event);
      previous = event.eventSha256;
    }
    writeArtifact(
      root,
      'batch-runs/fixture-run/ledger/events.jsonl',
      jsonl(events),
    );
    const validated = await validateBatchPhase(
      root,
      result.manifest.path,
      'r1',
    );
    assert.equal(validated.counts.validated, 1);
    assert.equal(validated.counts.r2_eligible, 1);

    const report = await buildBatchReport(root, result.manifest.path);
    const summary = JSON.parse(
      readFileSync(join(root, report.summary.path), 'utf8'),
    ) as {
      selected: number;
      nonterminal: number;
      byStatus: Record<string, number>;
      gates: { promotionReady: boolean; apply: boolean };
    };
    assert.equal(summary.selected, 2);
    assert.equal(summary.nonterminal, 1);
    assert.equal(summary.byStatus.r2_pending, 1);
    assert.equal(summary.byStatus.no_candidates, 1);
    assert.equal(summary.gates.promotionReady, false);
    assert.equal(summary.gates.apply, false);
    const reportPrefix = report.manifest.path.slice(
      0,
      report.manifest.path.lastIndexOf('/'),
    );
    const checkpointPath = join(
      root,
      reportPrefix,
      'shards',
      `${readyShard.shardId}.json`,
    );
    const checkpointState = JSON.parse(
      readFileSync(checkpointPath, 'utf8'),
    ) as { rows: { status: string }[] };
    assert.equal(checkpointState.rows[0].status, 'r2_pending');
    const sameReport = await buildBatchReport(root, result.manifest.path);
    assert.equal(sameReport.manifest.sha256, report.manifest.sha256);
    const checkpointText = readFileSync(checkpointPath, 'utf8');
    const corruptCheckpoint = JSON.parse(checkpointText) as {
      rows: { status: string }[];
    };
    corruptCheckpoint.rows[0].status = 'proposed_exact';
    writeFileSync(checkpointPath, JSON.stringify(corruptCheckpoint));
    await assert.rejects(
      () => buildBatchReport(root, result.manifest.path),
      /checkpoint/i,
    );
    writeFileSync(checkpointPath, checkpointText);

    const repeated = await prepareAutomatedBatch(root, options);
    assert.equal(repeated.manifest.sha256, result.manifest.sha256);
    assert.equal(repeated.counts.jobs, 2);

    const requestPath = join(root, readyShard.requests.r1.path);
    writeFileSync(requestPath, readFileSync(requestPath, 'utf8') + ' ');
    await assert.rejects(
      () => preflightBatchInputs(root, result.manifest.path),
      /hash mismatch/i,
    );

    const selectedPath = join(root, inputs.selectedRef.path);
    writeFileSync(selectedPath, readFileSync(selectedPath, 'utf8') + '\n');
    await assert.rejects(
      () => prepareAutomatedBatch(root, options),
      /Artifact hash mismatch/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('immutable atomic artifact reuses identical bytes and refuses replacement', () => {
  const root = mkdtempSync(join(tmpdir(), 'db4-atomic-artifact-'));
  try {
    const first = writeAtomicArtifact(root, 'evidence/input.json', '{"x":1}\n');
    const same = writeAtomicArtifact(root, 'evidence/input.json', '{"x":1}\n');
    assert.deepEqual(same, first);
    assert.throws(
      () => writeAtomicArtifact(root, 'evidence/input.json', '{"x":2}\n'),
      /Artifact hash mismatch/,
    );
    assert.deepEqual(ArtifactRefSchema.parse(first), first);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('batch format repair binds rejected raw, enables R2 only after D1 and cannot repair a target twice', async () => {
  const root = mkdtempSync(join(tmpdir(), 'db4-batch-repair-'));
  try {
    const { prepareBatchRepairs, verifyBatchRepairs } =
      await import('./batch-repair');
    const { RepairWaveSchema } = await import('./_batch-repair');
    const inputs = prepareFixture(root);
    const prepared = await prepareAutomatedBatch(root, {
      runId: 'repair-fixture',
      samplingPath: inputs.samplingPath,
      generationPath: inputs.generationPath,
      exportPath: inputs.exportPath,
      outputPrefix: 'batch-runs/repair-fixture',
      promptRevision: 'v2.1',
      promptDirectory: resolve('docs/prompts'),
      gitRevision: 'abcdef0123456789',
      dirtySourceSha256: null,
      now: () => '2026-10-10T12:00:00.000Z',
    });
    const manifest = BatchManifestSchema.parse(
      JSON.parse(readFileSync(join(root, prepared.manifest.path), 'utf8')),
    );
    const shard = manifest.shards.find((row) => row.readyCount === 1)!;
    const original = JSON.parse(
      readFileSync(join(root, shard.requests.r1.path), 'utf8').trim(),
    ) as {
      jobKey: string;
      bundleKey: string;
      payload: {
        bundle: {
          sense: { id: string };
          contextHash: string;
          candidates: { candidateKey: string; concept: { id: string } }[];
          sourceBranches: string[];
        };
      };
    };
    const valid = {
      schemaVersion: 1,
      task: 'sense_concept_review',
      bundleKey: original.bundleKey,
      senseId: original.payload.bundle.sense.id,
      contextHash: original.payload.bundle.contextHash,
      reviews: original.payload.bundle.candidates.map(
        (row: { candidateKey: string; concept: { id: string } }) => ({
          candidateKey: row.candidateKey,
          conceptId: row.concept.id,
          relation: 'exact',
          coveredBranches: original.payload.bundle.sourceBranches,
          missingBranches: [],
          conflicts: [],
          reason: 'Fixture whole-sense coverage.',
          confidence: null,
        }),
      ),
      noSuitableCandidate: false,
      unresolvedReason: null,
    };
    const broken = structuredClone(valid);
    Reflect.deleteProperty(broken.reviews[0], 'confidence');
    const ledger: ReturnType<typeof createBatchEvent>[] = [];
    const prefix = 'batch-runs/repair-fixture';
    const append = (
      jobKey: string | null,
      type: Parameters<typeof createBatchEvent>[0]['type'],
      details: Parameters<typeof createBatchEvent>[0]['details'],
    ) => {
      ledger.push(
        createBatchEvent({
          runId: manifest.runId,
          sequence: ledger.length,
          previousEventSha256: ledger.at(-1)?.eventSha256 ?? null,
          at: '2026-10-10T12:00:01.000Z',
          jobKey,
          type,
          details,
        }),
      );
      writeFileSync(join(root, `${prefix}/ledger/events.jsonl`), jsonl(ledger));
    };
    // writeArtifact creates the ledger directory before the append helper writes.
    writeArtifact(root, `${prefix}/ledger/events.jsonl`, '');
    const save = (jobKey: string, reply: unknown) => {
      const ref = writeAtomicArtifact(
        root,
        `${prefix}/responses/raw/${jobKey}.txt`,
        JSON.stringify(reply),
      );
      append(jobKey, 'job_planned', { phase: 'r1' });
      append(jobKey, 'dispatch_intent_persisted', { phase: 'r1' });
      append(jobKey, 'response_saved', {
        phase: 'r1',
        responsePath: ref.path,
        responseSha256: ref.sha256,
      });
    };
    append(null, 'run_started', { mode: 'shadow', apply: false });
    save(original.jobKey, broken);
    const initial = await validateBatchPhase(
      root,
      prepared.manifest.path,
      'r1',
    );
    assert.equal(initial.counts.invalid_output, 1);
    const planned = await prepareBatchRepairs(root, prepared.manifest.path, {
      revision: 'abcdef0123456789',
      maxRepairs: 1,
    });
    assert.equal(planned.planned, 1);
    assert.ok(planned.manifest);
    const wave = RepairWaveSchema.parse(
      JSON.parse(readFileSync(join(root, planned.manifest.path), 'utf8')),
    );
    const repair = JSON.parse(
      readFileSync(join(root, wave.requests.path), 'utf8').trim(),
    ) as { jobKey: string; repair: { originalJobKey: string } };
    assert.notEqual(repair.jobKey, original.jobKey);
    assert.equal(repair.repair.originalJobKey, original.jobKey);
    const pending = await validateBatchPhase(
      root,
      prepared.manifest.path,
      'r1',
      planned.manifest.path,
    );
    assert.equal(pending.counts.invalid_output, 1);
    save(repair.jobKey, valid);
    const repaired = await validateBatchPhase(
      root,
      prepared.manifest.path,
      'r1',
      planned.manifest.path,
    );
    assert.equal(repaired.counts.validated, 1);
    assert.equal(repaired.counts.r2_eligible, 1);
    const effective = JSON.parse(
      readFileSync(join(root, repaired.results.path), 'utf8').trim(),
    ) as {
      jobKey: string;
      formatRepair: { jobKey: string; state: string };
      rawResponse: { path: string };
    };
    assert.equal(effective.jobKey, original.jobKey);
    assert.equal(effective.formatRepair.jobKey, repair.jobKey);
    assert.equal(effective.formatRepair.state, 'validated');
    assert.equal(
      effective.rawResponse.path,
      `${prefix}/responses/raw/${repair.jobKey}.txt`,
    );
    const report = await buildBatchReport(
      root,
      prepared.manifest.path,
      planned.manifest.path,
    );
    const summary = JSON.parse(
      readFileSync(join(root, report.summary.path), 'utf8'),
    ) as {
      byStatus: Record<string, number>;
      dispatchesByPhase: Record<string, number>;
      gates: Record<string, unknown>;
    };
    assert.equal(summary.byStatus.r2_pending, 1);
    assert.equal(summary.dispatchesByPhase.r1, 2);
    assert.equal(summary.gates.apply, false);
    const next = await prepareBatchRepairs(root, prepared.manifest.path, {
      revision: 'abcdef0123456789',
      parent: planned.manifest.path,
    });
    assert.equal(next.planned, 0);
    assert.equal(next.manifest, null);
    const incompatibleRef = writeJson(
      root,
      `${prefix}/repairs/incompatible/manifest.json`,
      {
        ...wave,
        parent: planned.manifest,
        git: { revision: 'b'.repeat(40), dirtySourceSha256: null },
      },
    );
    await assert.rejects(
      () =>
        verifyBatchRepairs(root, prepared.manifest.path, incompatibleRef.path),
      /source pin/,
    );

    await assert.rejects(
      () => validateBatchPhase(root, prepared.manifest.path, 'r1'),
      /unknown job/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
