// DB4-D3 adapter for frozen DB4-D2 generation and DB4-D4 Muse validation files.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  ArtifactRef,
  ArtifactRefSchema,
  Count,
  MappingBundle,
  MappingOutputSchema,
  PhaseSchema,
  Sha256Schema,
  SemanticSnapshotSchema,
  Text,
  hashBytes,
  hashJson,
  parseMappingBundle,
  parseMappingBundleIntegrity,
  parseMappingCandidates,
  parseMappingOutput,
  renderMappingBundle,
  semanticInputFingerprint,
} from './_mapping-types';
import { DECISION_POLICY_VERSION, decideMappingBundle } from './_decisions';
import {
  artifactPath,
  jsonLines,
  readArtifact as readSourceArtifact,
  writeArtifact,
} from './_retrieval';

// Process a frozen batch rather than loading the whole dictionary into memory.
export const MAX_DECISION_TARGETS = 500;
export const MAX_DECISION_ARTIFACT_BYTES = 64 * 1024 * 1024;
function boundedPath(root: string, path: string): string {
  const file = artifactPath(root, path);
  if (statSync(file).size > MAX_DECISION_ARTIFACT_BYTES)
    throw new Error('D3 artifact exceeds 64 MiB; split the upstream batch.');
  return file;
}
function readArtifact(root: string, ref: ArtifactRef): Buffer {
  boundedPath(root, ref.path);
  return readSourceArtifact(root, ref);
}

const PilotSchema = z.object({
  schemaVersion: z.literal(1),
  task: z.literal('db4_d4_muse_pilot'),
  generation: ArtifactRefSchema.extend({ bundleFileSha256: Sha256Schema }),
  prompt: ArtifactRefSchema,
  requests: ArtifactRefSchema,
  counts: z.object({
    bundles: Count,
    requests: Count,
    candidatesPerPhase: Count,
  }),
});
const ValidationSchema = z.object({
  schemaVersion: z.literal(1),
  task: z.literal('db4_d4_muse_validation'),
  pilotManifest: ArtifactRefSchema,
  responses: ArtifactRefSchema,
  files: z.object({ r1: ArtifactRefSchema, r2: ArtifactRefSchema }),
  counts: z.object({
    bundlesPlanned: Count,
    requests: Count,
    validatedRequests: Count,
    unresolvedRequests: Count,
    bundlesWithBothValidatedPasses: Count,
  }),
});
const GenerationSchema = z.object({
  schemaVersion: z.literal(1),
  task: z.literal('db4_retrieval_generation'),
  snapshot: SemanticSnapshotSchema,
  semanticInputFingerprint: Sha256Schema,
  inputs: z.record(ArtifactRefSchema),
  files: z.object({
    candidates: ArtifactRefSchema,
    bundles: ArtifactRefSchema,
    status: ArtifactRefSchema,
  }),
  counts: z.object({ senses: Count, candidates: Count, bundles: Count }),
});
const RequestSchema = z.object({
  requestId: Text,
  phase: PhaseSchema,
  promptVersion: Text,
  bundleKey: Sha256Schema,
  senseId: Text,
  contextHash: Sha256Schema,
  renderedContextHash: Sha256Schema,
  payload: z.object({ seed: Text, bundle: z.unknown() }).passthrough(),
});
const ResponseSchema = RequestSchema.omit({
  promptVersion: true,
  payload: true,
}).extend({ state: Text, rawReply: z.string().optional() });
const StatusSchema = z.object({
  senseKey: Text,
  senseId: Text.nullable(),
  status: Text,
  bundleKey: Sha256Schema.nullable(),
});
const PromptSchema = z.object({
  system: Text,
  phases: z.object({ r1: Text, r2: Text }),
  versions: z.object({ r1: Text, r2: Text }),
  hashes: z.object({
    system: Sha256Schema,
    r1: Sha256Schema,
    r2: Sha256Schema,
  }),
});

function uniqueBy<T>(rows: T[], key: (row: T) => string, name: string) {
  const result = new Map(rows.map((row) => [key(row), row]));
  if (result.size !== rows.length) throw new Error(`Duplicate ${name}`);
  return result;
}
function rawOutput(raw: string): unknown {
  return JSON.parse(
    raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, ''),
  ) as unknown;
}
function store(root: string, path: string, content: string): ArtifactRef {
  const ref = { path, sha256: hashBytes(content) };
  if (existsSync(artifactPath(root, path))) readArtifact(root, ref);
  else writeArtifact(root, path, content);
  return ref;
}

export function decideMuseReview(
  root: string,
  pilotPath: string,
  validationPath: string,
) {
  const validationBytes = readFileSync(boundedPath(root, validationPath));
  const validation = ValidationSchema.parse(
    JSON.parse(validationBytes.toString()),
  );
  if (validation.pilotManifest.path !== pilotPath)
    throw new Error('Validation belongs to another pilot');
  const pilotBytes = readArtifact(root, validation.pilotManifest);
  const pilot = PilotSchema.parse(JSON.parse(pilotBytes.toString()));
  const generationRef = {
    path: pilot.generation.path,
    sha256: pilot.generation.sha256,
  };
  const generation = GenerationSchema.parse(
    JSON.parse(readArtifact(root, generationRef).toString()),
  );
  if (
    generation.counts.senses > MAX_DECISION_TARGETS ||
    generation.counts.bundles > MAX_DECISION_TARGETS
  )
    throw new Error(
      'D3 generation exceeds 500 targets; split the upstream batch.',
    );
  if (
    generation.files.bundles.sha256 !== pilot.generation.bundleFileSha256 ||
    semanticInputFingerprint(generation.snapshot) !==
      generation.semanticInputFingerprint
  )
    throw new Error('Generation fingerprint or bundle file mismatch');
  Object.values(generation.inputs).forEach((ref) => readArtifact(root, ref));
  const candidates = parseMappingCandidates(
    jsonLines(readArtifact(root, generation.files.candidates), z.unknown()),
  );
  const byCandidate = uniqueBy(candidates, (c) => c.candidateKey, 'candidate');
  const proofRefs = uniqueBy(
    [
      ...new Map(
        candidates
          .flatMap((c) => c.sources.flatMap((s) => s.audit.evidence))
          .map((ref) => [hashJson(ref), ref]),
      ).values(),
    ],
    (ref) => hashJson(ref),
    'source proof',
  );
  proofRefs.forEach((ref) => readArtifact(root, ref));
  function boundCandidates(bundle: MappingBundle) {
    return bundle.candidates.map((c) => {
      const candidate = byCandidate.get(c.candidateKey);
      if (!candidate)
        throw new Error('Bundle has a foreign generation candidate');
      return candidate;
    });
  }
  const bundles = jsonLines(
    readArtifact(root, generation.files.bundles),
    z.unknown(),
  )
    .map((value) => {
      const b = parseMappingBundleIntegrity(value);
      return parseMappingBundle(b, boundCandidates(b));
    })
    .sort((a, b) => a.bundleKey.localeCompare(b.bundleKey));
  const byBundle = uniqueBy(bundles, (b) => b.bundleKey, 'bundle');
  uniqueBy(bundles, (b) => b.sense.semanticKey, 'bundle sense');
  if (
    candidates.length !== generation.counts.candidates ||
    bundles.length !== generation.counts.bundles ||
    candidates.some(
      (c) =>
        c.mode !== generation.snapshot.mode ||
        c.semanticInputFingerprint !== generation.semanticInputFingerprint,
    ) ||
    bundles.some(
      (b) =>
        b.mode !== generation.snapshot.mode ||
        b.semanticInputFingerprint !== generation.semanticInputFingerprint,
    )
  )
    throw new Error('Generation counts/mode/fingerprint mismatch');
  const statuses = jsonLines(
    readArtifact(root, generation.files.status),
    StatusSchema,
  );
  uniqueBy(statuses, (s) => s.senseKey, 'retrieval status');
  if (
    statuses.length !== generation.counts.senses ||
    statuses.filter((s) => s.bundleKey !== null).length !== bundles.length
  )
    throw new Error('Retrieval target denominator mismatch');
  for (const status of statuses) {
    if (!status.bundleKey) continue;
    const b = byBundle.get(status.bundleKey);
    if (
      !b ||
      status.status !== 'ready' ||
      status.senseKey !== b.sense.semanticKey ||
      status.senseId !== b.sense.id
    )
      throw new Error('Retrieval status not bound to bundle');
  }
  const prompt = PromptSchema.parse(
    JSON.parse(readArtifact(root, pilot.prompt).toString()),
  );
  for (const part of ['system', 'r1', 'r2'] as const)
    if (
      hashBytes(part === 'system' ? prompt.system : prompt.phases[part]) !==
      prompt.hashes[part]
    )
      throw new Error('Prompt text/hash mismatch');
  // Verify each large request payload, then keep only small binding metadata.
  // R1/R2 already refer to the same generation; retaining two full context copies
  // per bundle wastes memory on a VPS.
  const requests: Array<
    Omit<z.infer<typeof RequestSchema>, 'payload'> & {
      candidateOrder: string[];
    }
  > = [];
  for (const line of readArtifact(root, pilot.requests)
    .toString('utf8')
    .split('\n')) {
    if (!line.trim()) continue;
    const request = RequestSchema.parse(JSON.parse(line));
    const { payload, ...metadata } = request;
    const bundle = byBundle.get(request.bundleKey);
    if (
      !bundle ||
      request.requestId !== `${bundle.bundleKey}:${request.phase}` ||
      request.senseId !== bundle.sense.id ||
      request.contextHash !== bundle.contextHash ||
      request.promptVersion !== prompt.versions[request.phase]
    )
      throw new Error('Request is not bound to frozen bundle/prompt');
    const rendered = renderMappingBundle(
      bundle,
      request.phase,
      payload.seed,
      request.promptVersion,
    );
    if (
      hashJson(payload) !== rendered.renderedContextHash ||
      request.renderedContextHash !== rendered.renderedContextHash
    )
      throw new Error('Request render binding mismatch');
    requests.push({
      ...metadata,
      candidateOrder: rendered.payload.bundle.candidates.map(
        (c) => c.candidateKey,
      ),
    });
  }
  const responses = jsonLines(
    readArtifact(root, validation.responses),
    ResponseSchema,
  );
  const byRequest = uniqueBy(requests, (r) => r.requestId, 'request');
  const byResponse = uniqueBy(responses, (r) => r.requestId, 'response');
  if (
    requests.length !== pilot.counts.requests ||
    requests.length !== bundles.length * 2 ||
    responses.length !== requests.length ||
    pilot.counts.bundles !== bundles.length ||
    pilot.counts.candidatesPerPhase !==
      bundles.reduce((n, b) => n + b.candidates.length, 0)
  )
    throw new Error('Pilot denominator mismatch');
  const outputs = {
    r1: uniqueBy(
      jsonLines(readArtifact(root, validation.files.r1), MappingOutputSchema),
      (o) => o.bundleKey,
      'r1 output',
    ),
    r2: uniqueBy(
      jsonLines(readArtifact(root, validation.files.r2), MappingOutputSchema),
      (o) => o.bundleKey,
      'r2 output',
    ),
  };
  for (const phase of ['r1', 'r2'] as const)
    for (const key of outputs[phase].keys())
      if (!byBundle.has(key)) throw new Error('Foreign normalized output');
  for (const request of requests) {
    const bundle = byBundle.get(request.bundleKey);
    const response = byResponse.get(request.requestId);
    if (
      !bundle ||
      request.requestId !== `${bundle.bundleKey}:${request.phase}` ||
      !response ||
      request.senseId !== bundle.sense.id ||
      request.contextHash !== bundle.contextHash
    )
      throw new Error('Request is not bound to frozen bundle/prompt');
    if (
      response.phase !== request.phase ||
      response.bundleKey !== request.bundleKey ||
      response.senseId !== request.senseId ||
      response.contextHash !== request.contextHash ||
      response.renderedContextHash !== request.renderedContextHash
    )
      throw new Error('Request/response render binding mismatch');
    const output = outputs[request.phase].get(bundle.bundleKey);
    let actual = null;
    if (response.state === 'complete' && response.rawReply !== undefined) {
      try {
        actual = parseMappingOutput(rawOutput(response.rawReply), bundle);
      } catch {
        /* A D4 validation failure remains unresolved. */
      }
    }
    if (
      actual &&
      actual.reviews.map((r) => r.candidateKey).join('\n') !==
        request.candidateOrder.join('\n')
    )
      actual = null;
    if (
      (actual !== null) !== (output !== undefined) ||
      (actual &&
        output &&
        hashJson(actual) !== hashJson(parseMappingOutput(output, bundle)))
    )
      throw new Error(
        'Normalized output differs from source response validation',
      );
  }
  if (byResponse.size !== byRequest.size) throw new Error('Foreign response');
  const paired = bundles.filter(
    (b) => outputs.r1.has(b.bundleKey) && outputs.r2.has(b.bundleKey),
  ).length;
  const validatedCount = outputs.r1.size + outputs.r2.size;
  if (
    validation.counts.requests !== requests.length ||
    validation.counts.bundlesPlanned !== bundles.length ||
    validation.counts.validatedRequests !== validatedCount ||
    validation.counts.unresolvedRequests !== requests.length - validatedCount ||
    validation.counts.bundlesWithBothValidatedPasses !== paired
  )
    throw new Error('Validation count mismatch');
  const results = bundles.map((b) =>
    decideMappingBundle(
      b,
      boundCandidates(b),
      outputs.r1.get(b.bundleKey) ?? null,
      outputs.r2.get(b.bundleKey) ?? null,
    ),
  );
  const decisions = results.flatMap((r) =>
    r.decisions.map((d) => ({
      bundleKey: r.bundleKey,
      senseId: r.senseId,
      decision: d,
      decisionHash: hashJson(d),
    })),
  );
  const exacts = results
    .filter((r) => r.status === 'accept_exact')
    .map((r) => ({
      bundleKey: r.bundleKey,
      senseId: r.senseId,
      senseKey: r.senseKey,
      candidateKey: r.selectedCandidateKey!,
      conceptId: r.selectedConceptId!,
      decisionHash: hashJson(
        r.decisions.find((d) => d.proposal === 'accept_exact')!,
      ),
      policyVersion: DECISION_POLICY_VERSION,
      verified: false,
      calibratedScore: null,
    }));
  const inputs = {
    pilot: validation.pilotManifest,
    validation: { path: validationPath, sha256: hashBytes(validationBytes) },
    generation: generationRef,
    responses: validation.responses,
    outputs: validation.files,
  };
  const runKey = hashJson({
    schemaVersion: 1,
    policyVersion: DECISION_POLICY_VERSION,
    inputs,
  });
  const prefix = `muse-d3-v1/${runKey}`;
  const lines = (rows: unknown[]) =>
    rows.map((r) => JSON.stringify(r) + '\n').join('');
  // Publish the manifest last. Re-running the exact same inputs verifies existing
  // bytes and resumes missing files; it cannot overwrite a different artifact.
  const files = {
    bundles: store(root, `${prefix}/bundles.jsonl`, lines(results)),
    decisions: store(root, `${prefix}/decisions.jsonl`, lines(decisions)),
    exactProposals: store(
      root,
      `${prefix}/exact-proposals.jsonl`,
      lines(exacts),
    ),
    retrievalStatus: generation.files.status,
  };
  const counts = {
    retrievalTargets: statuses.length,
    bundles: results.length,
    targetsWithoutBundle: statuses.filter((s) => s.bundleKey === null).length,
    validatedPasses: validatedCount,
    pairedBundles: paired,
    bundleStatuses: results.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {}),
    candidateDecisions: decisions.length,
    proposals: decisions.reduce<Record<string, number>>((acc, r) => {
      const p = r.decision.proposal;
      acc[p] = (acc[p] ?? 0) + 1;
      return acc;
    }, {}),
    exactProposals: exacts.length,
  };
  const manifest = {
    schemaVersion: 1,
    task: 'db4_d3_muse_decisions',
    runKey,
    mode: generation.snapshot.mode,
    policyVersion: DECISION_POLICY_VERSION,
    inputs,
    files,
    counts,
    apply: false,
    semanticQualityValidated: false,
    independentJudges: false,
    needsHumanApprovalPerMapping: false,
    promotionReady: false,
    remainingGates: [
      'DB4-D5_quality',
      'DB4-D6_preflight_journal',
      'DB4-D7_serving',
    ],
  };
  const ref = store(
    root,
    `${prefix}/manifest.json`,
    JSON.stringify(manifest, null, 2) + '\n',
  );
  return { manifest: ref, counts, apply: false, promotionReady: false };
}

if (require.main === module) {
  const [root, pilot, validation] = process.argv.slice(2);
  if (!root || !pilot || !validation || process.argv.length !== 5)
    throw new Error(
      'Usage: tsx scripts/db4/muse-review-decide.ts ARTIFACT_ROOT PILOT_MANIFEST VALIDATION_SUMMARY',
    );
  console.log(
    JSON.stringify(decideMuseReview(resolve(root), pilot, validation)),
  );
}
