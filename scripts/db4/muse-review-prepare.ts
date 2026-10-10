// DB4-D4: freeze D1 bundles and prompt renders for a two-pass Muse review.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MappingBundleSchema,
  parseMappingBundleIntegrity,
  renderMappingBundle,
  hashBytes,
} from './_mapping-types';
import {
  artifactPath,
  jsonLines,
  readArtifact,
  writeArtifact,
  writeJson,
} from './_retrieval';
import {
  PromptRevision,
  parsePromptRevision,
  promptFilename,
  promptVersion,
} from './muse-prompt-version';

const PROMPT_DIR = resolve('docs/prompts');

export function prepareMuseReview(
  root: string,
  generationPath: string,
  promptRevision: PromptRevision = 'v1',
) {
  const revision = parsePromptRevision(promptRevision);
  const versions = {
    r1: promptVersion(revision, 'r1'),
    r2: promptVersion(revision, 'r2'),
  };
  const generationBytes = readFileSync(artifactPath(root, generationPath));
  const generation = JSON.parse(generationBytes.toString()) as {
    task: string;
    semanticQualityValidated: boolean;
    apply: boolean;
    files: { bundles: { path: string; sha256: string } };
    counts: { bundles: number };
  };
  if (
    generation.task !== 'db4_retrieval_generation' ||
    generation.semanticQualityValidated !== false ||
    generation.apply !== false
  )
    throw new Error('Expected an unapplied D2 retrieval generation');
  const bundlesBytes = readArtifact(root, generation.files.bundles);
  const bundles = jsonLines(bundlesBytes, MappingBundleSchema).map(
    parseMappingBundleIntegrity,
  );
  if (
    bundles.length !== generation.counts.bundles ||
    !bundles.length ||
    new Set(bundles.map((bundle) => bundle.bundleKey)).size !== bundles.length
  )
    throw new Error('Generation bundle denominator/identity mismatch');

  const system = readFileSync(
    resolve(PROMPT_DIR, promptFilename(revision, 'system')),
    'utf8',
  ).trim();
  const phases = {
    r1: readFileSync(
      resolve(PROMPT_DIR, promptFilename(revision, 'r1')),
      'utf8',
    ).trim(),
    r2: readFileSync(
      resolve(PROMPT_DIR, promptFilename(revision, 'r2')),
      'utf8',
    ).trim(),
  };
  const requests: Record<string, unknown>[] = [];
  for (const bundle of bundles) {
    for (const phase of ['r1', 'r2'] as const) {
      const rendered = renderMappingBundle(
        bundle,
        phase,
        'db4-d4-muse-pilot-2026-10-08',
        versions[phase],
      );
      requests.push({
        requestId: `${bundle.bundleKey}:${phase}`,
        phase,
        promptVersion: versions[phase],
        bundleKey: bundle.bundleKey,
        senseId: bundle.sense.id,
        contextHash: bundle.contextHash,
        renderedContextHash: rendered.renderedContextHash,
        candidateKeys: bundle.candidates.map(
          (candidate) => candidate.candidateKey,
        ),
        conceptIds: bundle.candidates.map((candidate) => candidate.concept.id),
        sourceBranches: bundle.sourceBranches,
        payload: rendered.payload,
      });
    }
  }
  const prefix = `muse-d4-${revision}`;
  const prompt = {
    schemaVersion: 1,
    task: 'db4_d4_muse_prompt_pilot',
    system,
    phases,
    versions,
    hashes: {
      system: hashBytes(system),
      r1: hashBytes(phases.r1),
      r2: hashBytes(phases.r2),
    },
  };
  const files = {
    requests: writeArtifact(
      root,
      `${prefix}/requests.jsonl`,
      requests.map((request) => JSON.stringify(request) + '\n').join(''),
    ),
    prompt: writeJson(root, `${prefix}/prompt.json`, prompt),
  };
  const manifest = {
    schemaVersion: 1,
    task: 'db4_d4_muse_pilot',
    createdAt: new Date().toISOString(),
    generation: {
      path: generationPath,
      sha256: hashBytes(generationBytes),
      bundleFileSha256: generation.files.bundles.sha256,
    },
    prompt: files.prompt,
    requests: files.requests,
    counts: {
      bundles: bundles.length,
      requests: requests.length,
      perPhase: { r1: bundles.length, r2: bundles.length },
      candidatesPerPhase: bundles.reduce(
        (sum, bundle) => sum + bundle.candidates.length,
        0,
      ),
    },
    requestedWorkers: 8,
    transport: 'Muse native gateway; fresh side-chat per request',
    apply: false,
  };
  const manifestRef = writeJson(root, `${prefix}/manifest.json`, manifest);
  const chars = requests.map(
    (request) =>
      Buffer.byteLength(system + phases[request.phase as 'r1' | 'r2']) +
      Buffer.byteLength(JSON.stringify(request.payload)),
  );
  const result = {
    manifest: manifestRef,
    counts: manifest.counts,
    totalInputChars: chars.reduce((sum, count) => sum + count, 0),
    maxInputChars: Math.max(...chars),
    minInputChars: Math.min(...chars),
  };
  console.log(JSON.stringify(result));
  return result;
}

if (require.main === module) {
  const [artifactDir, generation, revisionArg = 'v1'] = process.argv.slice(2);
  let revision: PromptRevision;
  try {
    revision = parsePromptRevision(revisionArg);
  } catch {
    throw new Error(
      'Usage: tsx scripts/db4/muse-review-prepare.ts ARTIFACT_ROOT GENERATION_MANIFEST [v1|v2|v2.1]',
    );
  }
  if (!artifactDir || !generation || process.argv.length > 5)
    throw new Error(
      'Usage: tsx scripts/db4/muse-review-prepare.ts ARTIFACT_ROOT GENERATION_MANIFEST [v1|v2|v2.1]',
    );
  prepareMuseReview(resolve(artifactDir), generation, revision);
}
