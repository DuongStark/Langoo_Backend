import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  MappingBundle,
  createMappingBundle,
  createMappingCandidate,
  hashBytes,
} from './_mapping-types';
import { readArtifact, writeArtifact, writeJson } from './_retrieval';
import { candidateInputFixture } from './fixtures/build';
import { prepareMuseReview } from './muse-review-prepare';
import { prepareMuseReviewRepairs } from './muse-review-prepare-repairs';
import { validateMuseReview } from './muse-review-validate';

function exactOutput(bundle: MappingBundle) {
  return {
    schemaVersion: 1,
    task: 'sense_concept_review',
    bundleKey: bundle.bundleKey,
    senseId: bundle.sense.id,
    contextHash: bundle.contextHash,
    reviews: bundle.candidates.map((candidate) => ({
      candidateKey: candidate.candidateKey,
      conceptId: candidate.concept.id,
      relation: 'exact',
      coveredBranches: bundle.sourceBranches,
      missingBranches: [],
      conflicts: [],
      reason: 'Synthetic contract fixture only.',
      confidence: null,
    })),
    noSuitableCandidate: false,
    unresolvedReason: null,
  };
}

function withoutConsole<T>(run: () => T): T {
  const originalLog = console.log;
  console.log = () => undefined;
  try {
    return run();
  } finally {
    console.log = originalLog;
  }
}

function fixtureGeneration(root: string) {
  const candidate = createMappingCandidate(candidateInputFixture());
  const bundle = createMappingBundle([candidate], 'prompt-revision-fixture');
  const bundles = writeArtifact(
    root,
    'generation/bundles.jsonl',
    JSON.stringify(bundle) + '\n',
  );
  writeJson(root, 'generation/manifest.json', {
    schemaVersion: 1,
    task: 'db4_retrieval_generation',
    semanticQualityValidated: false,
    apply: false,
    files: { bundles },
    counts: { bundles: 1 },
  });
}

void test('prepare binds v1 default, v2, and v2.1 to separate frozen artifacts', () => {
  const root = mkdtempSync(join(tmpdir(), 'db4-prompt-revision-'));
  try {
    fixtureGeneration(root);
    const v1 = withoutConsole(() =>
      prepareMuseReview(root, 'generation/manifest.json'),
    );
    const v2 = withoutConsole(() =>
      prepareMuseReview(root, 'generation/manifest.json', 'v2'),
    );
    const v21 = withoutConsole(() =>
      prepareMuseReview(root, 'generation/manifest.json', 'v2.1'),
    );

    const artifacts = [
      { result: v1, revision: 'v1' },
      { result: v2, revision: 'v2' },
      { result: v21, revision: 'v2.1' },
    ];
    const prompts = new Map<string, { hashes: Record<string, string> }>();
    for (const { result, revision } of artifacts) {
      const manifest = JSON.parse(
        readArtifact(root, result.manifest).toString('utf8'),
      ) as {
        prompt: { path: string; sha256: string };
        requests: { path: string; sha256: string };
        counts: { bundles: number; requests: number };
      };
      const promptBytes = readArtifact(root, manifest.prompt);
      const prompt = JSON.parse(promptBytes.toString('utf8')) as {
        system: string;
        phases: { r1: string; r2: string };
        versions: { r1: string; r2: string };
        hashes: Record<string, string>;
      };
      const requests = readArtifact(root, manifest.requests)
        .toString('utf8')
        .trim()
        .split('\n')
        .map(
          (line) =>
            JSON.parse(line) as { phase: 'r1' | 'r2'; promptVersion: string },
        );

      assert.equal(manifest.counts.bundles, 1);
      assert.equal(manifest.counts.requests, 2);
      assert.equal(prompt.versions.r1, `db4-d4-semantic-match-${revision}-r1`);
      assert.equal(prompt.versions.r2, `db4-d4-semantic-match-${revision}-r2`);
      assert.equal(prompt.hashes.system, hashBytes(prompt.system));
      assert.equal(prompt.hashes.r1, hashBytes(prompt.phases.r1));
      assert.equal(prompt.hashes.r2, hashBytes(prompt.phases.r2));
      assert.deepEqual(
        requests.map(({ phase, promptVersion }) => `${phase}:${promptVersion}`),
        [
          `r1:db4-d4-semantic-match-${revision}-r1`,
          `r2:db4-d4-semantic-match-${revision}-r2`,
        ],
      );
      prompts.set(revision, prompt);
    }

    assert.notEqual(
      prompts.get('v2')!.hashes.system,
      prompts.get('v2.1')!.hashes.system,
    );
    assert.notEqual(
      prompts.get('v2')!.hashes.r1,
      prompts.get('v2.1')!.hashes.r1,
    );
    assert.notEqual(
      prompts.get('v2')!.hashes.r2,
      prompts.get('v2.1')!.hashes.r2,
    );

    const frozenV2Files = [
      [
        'db4-d4-semantic-match-v2.system.txt',
        'a527548ae713f023f9de4a9a222880a01cb22e314d9eb32d88605c03b06776c3',
      ],
      [
        'db4-d4-semantic-match-v2.r1.txt',
        'b63986d3a1d92dd5f4ab03312d9e8063abcaf939b79fb70fb819a267e425bc8a',
      ],
      [
        'db4-d4-semantic-match-v2.r2.txt',
        '639d7a17fe0354342cd27f672fab8d1192b12399568f94d0ef85b73b9193fd57',
      ],
    ] as const;
    for (const [name, expectedHash] of frozenV2Files) {
      assert.equal(
        hashBytes(readFileSync(join(process.cwd(), 'docs/prompts', name))),
        expectedHash,
        `Frozen prompt v2 changed: ${name}`,
      );
    }

    const v21Manifest = JSON.parse(
      readArtifact(root, v21.manifest).toString('utf8'),
    ) as {
      prompt: { path: string; sha256: string };
      requests: { path: string; sha256: string };
    };
    const baseRequests = readArtifact(root, v21Manifest.requests)
      .toString('utf8')
      .trim()
      .split('\n')
      .map(
        (line) =>
          JSON.parse(line) as {
            requestId: string;
            phase: 'r1' | 'r2';
            promptVersion: string;
            bundleKey: string;
            senseId: string;
            contextHash: string;
            renderedContextHash: string;
            payload: { bundle: MappingBundle };
          },
      );
    const sourceManifestBytes = readArtifact(root, v21.manifest);
    const bothInvalidBytes = baseRequests
      .map(
        (request) =>
          JSON.stringify({
            requestId: request.requestId,
            phase: request.phase,
            bundleKey: request.bundleKey,
            senseId: request.senseId,
            contextHash: request.contextHash,
            renderedContextHash: request.renderedContextHash,
            state: 'invalid_output',
          }) + '\n',
      )
      .join('');
    writeArtifact(root, 'muse-d4-v2.1/both-invalid.jsonl', bothInvalidBytes);
    writeJson(root, 'muse-d4-v2.1/both-invalid-validation.json', {
      task: 'db4_d4_muse_validation',
      pilotManifest: { sha256: hashBytes(sourceManifestBytes) },
      responses: { sha256: hashBytes(bothInvalidBytes) },
      validationIssues: baseRequests.map((request) => ({
        requestId: request.requestId,
      })),
    });
    assert.throws(
      () =>
        prepareMuseReviewRepairs(
          root,
          'muse-d4-v2.1/manifest.json',
          'muse-d4-v2.1/both-invalid.jsonl',
          'muse-d4-v2.1/both-invalid-validation.json',
          'muse-d4-v2.1/repair-both-invalid',
        ),
      /More than one format repair selected for sense bundle/,
    );

    const invalidResponsesBytes = baseRequests
      .map(
        (request, index) =>
          JSON.stringify({
            requestId: request.requestId,
            phase: request.phase,
            bundleKey: request.bundleKey,
            senseId: request.senseId,
            contextHash: request.contextHash,
            renderedContextHash: request.renderedContextHash,
            state: index === 0 ? 'invalid_output' : 'complete',
          }) + '\n',
      )
      .join('');
    writeArtifact(root, 'muse-d4-v2.1/responses.jsonl', invalidResponsesBytes);
    writeJson(root, 'muse-d4-v2.1/validation.json', {
      task: 'db4_d4_muse_validation',
      pilotManifest: { sha256: hashBytes(sourceManifestBytes) },
      responses: { sha256: hashBytes(invalidResponsesBytes) },
      validationIssues: [{ requestId: baseRequests[0].requestId }],
    });
    const repair = withoutConsole(() =>
      prepareMuseReviewRepairs(
        root,
        'muse-d4-v2.1/manifest.json',
        'muse-d4-v2.1/responses.jsonl',
        'muse-d4-v2.1/validation.json',
        'muse-d4-v2.1/repair1',
      ),
    );
    const repairManifest = repair as {
      prompt: { path: string; sha256: string };
      requests: { path: string; sha256: string };
    };
    assert.throws(
      () =>
        prepareMuseReviewRepairs(
          root,
          'muse-d4-v2.1/repair1/manifest.json',
          'unused-responses.jsonl',
          'unused-validation.json',
          'muse-d4-v2.1/repair2',
        ),
      /cannot be repaired again/,
    );
    const repairPrompt = JSON.parse(
      readArtifact(root, repairManifest.prompt).toString('utf8'),
    ) as { versions: { r1: string; r2: string } };
    const repairRequests = readArtifact(root, repairManifest.requests)
      .toString('utf8')
      .trim()
      .split('\n')
      .map(
        (line) =>
          JSON.parse(line) as {
            requestId: string;
            repairOf: string;
            phase: 'r1' | 'r2';
            promptVersion: string;
            bundleKey: string;
            senseId: string;
            contextHash: string;
            renderedContextHash: string;
            payload: { bundle: MappingBundle };
          },
      );
    assert.equal(repairRequests.length, 1);
    assert.equal(repairRequests[0].repairOf, baseRequests[0].requestId);
    assert.deepEqual(repairPrompt.versions, {
      r1: 'db4-d4-semantic-match-v2.1-r1-repair1',
      r2: 'db4-d4-semantic-match-v2.1-r2-repair1',
    });
    assert.equal(
      repairRequests[0].promptVersion,
      repairPrompt.versions[repairRequests[0].phase],
    );

    const repairedResponsesBytes =
      JSON.stringify({
        requestId: repairRequests[0].requestId,
        phase: repairRequests[0].phase,
        bundleKey: repairRequests[0].bundleKey,
        senseId: repairRequests[0].senseId,
        contextHash: repairRequests[0].contextHash,
        renderedContextHash: repairRequests[0].renderedContextHash,
        state: 'complete',
        rawReply: JSON.stringify(exactOutput(repairRequests[0].payload.bundle)),
      }) + '\n';
    writeArtifact(
      root,
      'muse-d4-v2.1/repaired-responses.jsonl',
      repairedResponsesBytes,
    );
    const validated = withoutConsole(() =>
      validateMuseReview(
        root,
        'muse-d4-v2.1/repair1/manifest.json',
        'muse-d4-v2.1/repaired-responses.jsonl',
      ),
    );
    assert.equal(validated.counts.validatedRequests, 1);
    assert.match(validated.files.r1.path, /^muse-d4-v2\.1\/validated\//);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
