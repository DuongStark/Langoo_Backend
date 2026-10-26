// DB4-D5: freeze 30 v2 bundles whose lemmas were not in the prior exact audit.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  ArtifactRefSchema,
  MappingBundle,
  MappingBundleSchema,
  Sha256Schema,
  hashBytes,
  hashJson,
  parseMappingBundleIntegrity,
  renderMappingBundle,
} from './_mapping-types';
import { artifactPath, jsonLines, readArtifact } from './_retrieval';
import { storeAuditArtifact } from './mapping-audit';

const SEED = 'db4-d5-v2-unseen30-20261010';
const SIZE = 30;
export function buildSampleAuditInput(
  requests: { phase: 'r1' | 'r2'; payload: { bundle: MappingBundle } }[],
) {
  return requests
    .filter((r) => r.phase === 'r1')
    .map((r) => {
      const b = r.payload.bundle;
      return {
        bundleKey: b.bundleKey,
        contextHash: b.contextHash,
        sense: b.sense,
        source: {
          glosses: b.senseContext.enGlosses,
          definitions: b.senseContext.definitions,
          metadata: b.senseContext.metadata,
        },
        candidates: b.candidates.map((c) => ({
          candidateKey: c.candidateKey,
          conceptId: c.concept.id,
          context: c.conceptContext,
        })),
      };
    });
}
const RequestSchema = z
  .object({
    requestId: z.string(),
    phase: z.enum(['r1', 'r2']),
    promptVersion: z.string(),
    bundleKey: Sha256Schema,
    contextHash: Sha256Schema,
    renderedContextHash: Sha256Schema,
    payload: z
      .object({
        seed: z.string(),
        bundle: MappingBundleSchema,
      })
      .passthrough(),
  })
  .passthrough();

export function prepareMuseV2Sample(
  root: string,
  pilotPath: string,
  priorAuditPath: string,
  prefix: string,
) {
  artifactPath(root, `${prefix}/manifest.json`);
  const pilotBytes = readFileSync(artifactPath(root, pilotPath));
  const pilot = z
    .object({
      task: z.literal('db4_d4_muse_pilot'),
      apply: z.literal(false),
      prompt: ArtifactRefSchema,
      requests: ArtifactRefSchema,
      counts: z
        .object({ bundles: z.number(), requests: z.number() })
        .passthrough(),
    })
    .passthrough()
    .parse(JSON.parse(pilotBytes.toString()));
  const promptBytes = readArtifact(root, pilot.prompt);
  const prompt = z
    .object({
      system: z.string(),
      phases: z.object({ r1: z.string(), r2: z.string() }),
      versions: z.object({
        r1: z.literal('db4-d4-semantic-match-v2-r1'),
        r2: z.literal('db4-d4-semantic-match-v2-r2'),
      }),
      hashes: z.object({
        system: Sha256Schema,
        r1: Sha256Schema,
        r2: Sha256Schema,
      }),
    })
    .parse(JSON.parse(promptBytes.toString()));
  for (const [name, content] of [
    ['system', prompt.system],
    ['r1', prompt.phases.r1],
    ['r2', prompt.phases.r2],
  ] as const) {
    if (hashBytes(content) !== prompt.hashes[name])
      throw new Error('Prompt text hash mismatch');
    const file = resolve(`docs/prompts/db4-d4-semantic-match-v2.${name}.txt`);
    if (readFileSync(file, 'utf8').trim() !== content)
      throw new Error('Frozen v2 prompt differs from repository prompt');
  }
  const requests = jsonLines(readArtifact(root, pilot.requests), RequestSchema);
  if (
    requests.length !== pilot.counts.requests ||
    new Set(requests.map((r) => r.requestId)).size !== requests.length
  )
    throw new Error('Pilot request denominator mismatch');
  const bundles = new Map<string, z.infer<typeof MappingBundleSchema>>();
  for (const request of requests) {
    const canonical = {
      ...request.payload.bundle,
      candidates: [...request.payload.bundle.candidates].sort((a, b) =>
        a.candidateKey < b.candidateKey
          ? -1
          : a.candidateKey > b.candidateKey
            ? 1
            : 0,
      ),
    };
    const bundle = parseMappingBundleIntegrity(canonical);
    const rendered = renderMappingBundle(
      bundle,
      request.phase,
      request.payload.seed,
      prompt.versions[request.phase],
    );
    if (
      request.promptVersion !== prompt.versions[request.phase] ||
      request.bundleKey !== bundle.bundleKey ||
      request.contextHash !== bundle.contextHash ||
      request.renderedContextHash !== rendered.renderedContextHash ||
      hashJson(request.payload) !== rendered.renderedContextHash
    )
      throw new Error('Request render/bundle binding mismatch');
    bundles.set(bundle.bundleKey, bundle);
  }
  if (
    bundles.size !== pilot.counts.bundles ||
    requests.length !== 2 * bundles.size
  )
    throw new Error('Expected complete two-phase pilot');
  const auditBytes = readFileSync(resolve(priorAuditPath));
  const audits = jsonLines(
    auditBytes,
    z.object({ candidateKey: Sha256Schema }),
  );
  const priorKeys = new Set(audits.map((r) => r.candidateKey));
  if (audits.length !== 20 || priorKeys.size !== 20)
    throw new Error('Expected all 20 prior audited pairs');
  const previous = [...bundles.values()].filter((b) =>
    b.candidates.some((c) => priorKeys.has(c.candidateKey)),
  );
  if (previous.length !== 20)
    throw new Error('Prior audit does not bind to pilot');
  const excludedLemmas = new Set(previous.map((b) => b.sense.lemma));
  const eligible = [...bundles.values()].filter(
    (b) => !excludedLemmas.has(b.sense.lemma),
  );
  const ranked = eligible.map((bundle) => ({
    bundle,
    rank: hashJson({ seed: SEED, bundleKey: bundle.bundleKey }),
  }));
  ranked.sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
  if (ranked.length < SIZE)
    throw new Error('Fewer than 30 unseen-lemma bundles');
  const selected = ranked.slice(0, SIZE).map((r) => r.bundle);
  const selectedKeys = new Set(selected.map((b) => b.bundleKey));
  const sample = requests.filter((r) => selectedKeys.has(r.bundleKey));
  if (
    sample.length !== SIZE * 2 ||
    selected.some(
      (b) =>
        sample.filter((r) => r.bundleKey === b.bundleKey && r.phase === 'r1')
          .length !== 1 ||
        sample.filter((r) => r.bundleKey === b.bundleKey && r.phase === 'r2')
          .length !== 1,
    )
  )
    throw new Error('Sample phase denominator mismatch');
  const files = {
    prompt: storeAuditArtifact(
      root,
      `${prefix}/prompt.json`,
      promptBytes.toString(),
    ),
    requests: storeAuditArtifact(
      root,
      `${prefix}/requests.jsonl`,
      sample.map((r) => JSON.stringify(r) + '\n').join(''),
    ),
  };
  // Derived public dictionary input, not labels; never sent to the model.
  // Preserve the manifest shape of this already-dispatched immutable trial.
  storeAuditArtifact(
    root,
    `${prefix}/audit-input.json`,
    JSON.stringify(buildSampleAuditInput(sample), null, 2) + '\n',
  );
  const manifest = {
    ...pilot,
    ...files,
    counts: {
      bundles: SIZE,
      requests: sample.length,
      perPhase: { r1: SIZE, r2: SIZE },
      candidatesPerPhase: selected.reduce((n, b) => n + b.candidates.length, 0),
    },
    sample: {
      task: 'DB4-D5',
      policyVersion: SEED,
      originalPilot: { path: pilotPath, sha256: hashBytes(pilotBytes) },
      priorAuditSha256: hashBytes(auditBytes),
      excludedPriorPairs: 20,
      excludedLemmas: [...excludedLemmas].sort(),
      eligibleBundles: eligible.length,
      selectedBundleKeys: [...selectedKeys].sort(),
      dispatchCap: sample.length,
      automaticResends: false,
      auditOrPriorVerdictsSent: false,
    },
    apply: false,
  };
  const ref = storeAuditArtifact(
    root,
    `${prefix}/manifest.json`,
    JSON.stringify(manifest, null, 2) + '\n',
  );
  return {
    manifest: ref,
    counts: manifest.counts,
    eligibleBundles: eligible.length,
    apply: false,
  };
}

if (require.main === module) {
  const [root, pilot, priorAudit, prefix] = process.argv.slice(2);
  if (!root || !pilot || !priorAudit || !prefix || process.argv.length !== 6)
    throw new Error(
      'Usage: tsx scripts/db4/muse-v2-sample-prepare.ts ARTIFACT_ROOT V2_MANIFEST PRIOR_AUDIT_JSONL OUTPUT_PREFIX',
    );
  console.log(
    JSON.stringify(
      prepareMuseV2Sample(resolve(root), pilot, priorAudit, prefix),
    ),
  );
}
