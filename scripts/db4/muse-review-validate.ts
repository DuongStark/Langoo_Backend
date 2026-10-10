// DB4-D4: bind actual Muse replies to frozen prompt renders and D1 validators.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MappingBundleSchema,
  MappingBundle,
  MappingOutput,
  parseMappingBundleIntegrity,
  parseMappingOutput,
  hashBytes,
  hashJson,
} from './_mapping-types';
import {
  artifactPath,
  readArtifact,
  writeArtifact,
  writeJson,
} from './_retrieval';

type Request = {
  requestId: string;
  phase: 'r1' | 'r2';
  promptVersion: string;
  bundleKey: string;
  senseId: string;
  contextHash: string;
  renderedContextHash: string;
  payload: { bundle: MappingBundle };
};
type Response = {
  requestId: string;
  phase: 'r1' | 'r2';
  bundleKey: string;
  senseId: string;
  contextHash: string;
  renderedContextHash: string;
  state: string;
  rawReply?: string;
};

function jsonl<T>(bytes: Buffer): T[] {
  return bytes
    .toString('utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as T);
}

function responseObject(raw: string) {
  let value: unknown;
  try {
    value = JSON.parse(raw.trim());
  } catch {
    const clean = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    value = JSON.parse(clean);
  }
  return value;
}

function integrityBundleFromRendered(value: unknown): MappingBundle {
  const rendered = MappingBundleSchema.parse(value);
  const candidates = [...rendered.candidates].sort((a, b) =>
    a.candidateKey < b.candidateKey
      ? -1
      : a.candidateKey > b.candidateKey
        ? 1
        : 0,
  );
  return parseMappingBundleIntegrity({ ...rendered, candidates });
}

export function validateMuseReview(
  root: string,
  manifestPath: string,
  responsePath: string,
) {
  const manifestBytes = readFileSync(artifactPath(root, manifestPath));
  const manifest = JSON.parse(manifestBytes.toString()) as {
    task: string;
    prompt: { path: string; sha256: string };
    requests: { path: string; sha256: string };
    counts: { bundles: number; requests: number; candidatesPerPhase: number };
  };
  if (manifest.task !== 'db4_d4_muse_pilot')
    throw new Error('Wrong DB4-D4 pilot manifest');
  const promptBytes = readArtifact(root, manifest.prompt);
  const prompt = JSON.parse(promptBytes.toString()) as {
    hashes: Record<string, string>;
  };
  if (!prompt.hashes.system || !prompt.hashes.r1 || !prompt.hashes.r2)
    throw new Error('Prompt hashes are incomplete');
  const requestBytes = readArtifact(root, manifest.requests);
  const requests = jsonl<Request>(requestBytes);
  requests.forEach((request) =>
    MappingBundleSchema.parse(request.payload.bundle),
  );
  const responseBytes = readFileSync(artifactPath(root, responsePath));
  const responses = jsonl<Response>(responseBytes);
  if (
    requests.length !== manifest.counts.requests ||
    responses.length !== requests.length ||
    new Set(requests.map((request) => request.requestId)).size !==
      requests.length ||
    new Set(responses.map((response) => response.requestId)).size !==
      responses.length
  )
    throw new Error('Request/response denominator or uniqueness mismatch');

  const responseById = new Map(
    responses.map((response) => [response.requestId, response]),
  );
  const outputs: Record<'r1' | 'r2', MappingOutput[]> = { r1: [], r2: [] };
  const summaries = {
    r1: { relations: {} as Record<string, number>, noSuitableCandidate: 0 },
    r2: { relations: {} as Record<string, number>, noSuitableCandidate: 0 },
  };
  const rows: Record<'r1' | 'r2', string[]> = { r1: [], r2: [] };
  const paired = new Map<string, Partial<Record<'r1' | 'r2', MappingOutput>>>();
  const responseStates: Record<string, number> = {};
  const validationIssues: { requestId: string; errorType: string }[] = [];
  let validatedRequests = 0;
  for (const request of requests) {
    const response = responseById.get(request.requestId);
    if (
      !response ||
      response.phase !== request.phase ||
      response.bundleKey !== request.bundleKey ||
      response.senseId !== request.senseId ||
      response.contextHash !== request.contextHash ||
      response.renderedContextHash !== request.renderedContextHash
    )
      throw new Error(`Missing or unbound Muse response: ${request.requestId}`);
    responseStates[response.state] = (responseStates[response.state] ?? 0) + 1;
    if (response.state !== 'complete') continue;
    if (typeof response.rawReply !== 'string') {
      validationIssues.push({
        requestId: request.requestId,
        errorType: 'NoReply',
      });
      continue;
    }
    const renderedBundle = MappingBundleSchema.parse(request.payload.bundle);
    const bundle = integrityBundleFromRendered(renderedBundle);
    let output: MappingOutput;
    try {
      output = parseMappingOutput(responseObject(response.rawReply), bundle);
      if (
        output.reviews.map((review) => review.candidateKey).join('\n') !==
        renderedBundle.candidates
          .map((candidate) => candidate.candidateKey)
          .join('\n')
      )
        throw new Error('Review candidate order mismatch');
    } catch (error) {
      validationIssues.push({
        requestId: request.requestId,
        errorType: error instanceof Error ? error.name : 'InvalidOutput',
      });
      continue;
    }
    validatedRequests++;
    outputs[request.phase].push(output);
    rows[request.phase].push(JSON.stringify(output) + '\n');
    const summary = summaries[request.phase];
    if (output.noSuitableCandidate) summary.noSuitableCandidate++;
    for (const review of output.reviews)
      summary.relations[review.relation] =
        (summary.relations[review.relation] ?? 0) + 1;
    paired.set(request.bundleKey, {
      ...paired.get(request.bundleKey),
      [request.phase]: output,
    });
  }
  const decisions = [...paired.values()];
  const pairedPasses = decisions.filter((pair) => pair.r1 && pair.r2);
  const candidateAgreement = {
    compared: 0,
    sameRelation: 0,
    sameExactness: 0,
    sameCoverage: 0,
  };
  for (const pair of pairedPasses) {
    const byKey = new Map(
      pair.r2!.reviews.map((review) => [review.candidateKey, review]),
    );
    for (const left of pair.r1!.reviews) {
      const right = byKey.get(left.candidateKey);
      if (!right) continue;
      candidateAgreement.compared++;
      if (left.relation === right.relation) candidateAgreement.sameRelation++;
      if ((left.relation === 'exact') === (right.relation === 'exact'))
        candidateAgreement.sameExactness++;
      if (
        JSON.stringify([...left.coveredBranches].sort()) ===
          JSON.stringify([...right.coveredBranches].sort()) &&
        JSON.stringify([...left.missingBranches].sort()) ===
          JSON.stringify([...right.missingBranches].sort())
      )
        candidateAgreement.sameCoverage++;
    }
  }
  const agreement = decisions.filter(
    (pair) =>
      pair.r1 &&
      pair.r2 &&
      hashJson(pair.r1.reviews) === hashJson(pair.r2.reviews) &&
      pair.r1.noSuitableCandidate === pair.r2.noSuitableCandidate &&
      hashJson(pair.r1.unresolvedReason) === hashJson(pair.r2.unresolvedReason),
  ).length;
  const responseHash = hashBytes(responseBytes);
  const prefix = `muse-d4-v1/validated/${responseHash.slice(0, 12)}`;
  const files = {
    r1: writeArtifact(root, `${prefix}/r1.jsonl`, rows.r1.join('')),
    r2: writeArtifact(root, `${prefix}/r2.jsonl`, rows.r2.join('')),
  };
  const summary = {
    schemaVersion: 1,
    task: 'db4_d4_muse_validation',
    createdAt: new Date().toISOString(),
    pilotManifest: { path: manifestPath, sha256: hashBytes(manifestBytes) },
    responses: { path: responsePath, sha256: responseHash },
    counts: {
      bundlesPlanned: manifest.counts.bundles,
      bundlesWithAnyValidatedPass: paired.size,
      bundlesWithBothValidatedPasses: pairedPasses.length,
      requests: requests.length,
      validatedRequests,
      unresolvedRequests: requests.length - validatedRequests,
      invalidD1Outputs: validationIssues.length,
      responseStates,
      validatedReviews: outputs.r1.length + outputs.r2.length,
      candidateReviewsPerPhase: manifest.counts.candidatesPerPhase,
      candidateReviewsR1: outputs.r1.reduce(
        (sum, output) => sum + output.reviews.length,
        0,
      ),
      candidateReviewsR2: outputs.r2.reduce(
        (sum, output) => sum + output.reviews.length,
        0,
      ),
      exactR1: summaries.r1.relations.exact ?? 0,
      exactR2: summaries.r2.relations.exact ?? 0,
      exactAgreements: agreement,
      candidateReviewsCompared: candidateAgreement.compared,
      sameCandidateRelation: candidateAgreement.sameRelation,
      sameCandidateExactness: candidateAgreement.sameExactness,
      sameCandidateCoverage: candidateAgreement.sameCoverage,
      noSuitableR1: summaries.r1.noSuitableCandidate,
      noSuitableR2: summaries.r2.noSuitableCandidate,
    },
    relationCounts: summaries,
    sameModelTwoPass: true,
    independentJudges: false,
    semanticQualityValidated: false,
    validationIssues,
    apply: false,
    files,
  };
  const summaryRef = writeJson(root, `${prefix}/summary.json`, summary);
  console.log(JSON.stringify({ summary: summaryRef, counts: summary.counts }));
  return summary;
}

if (require.main === module) {
  const [artifactDir, manifest, responses] = process.argv.slice(2);
  if (!artifactDir || !manifest || !responses || process.argv.length !== 5)
    throw new Error(
      'Usage: tsx scripts/db4/muse-review-validate.ts ARTIFACT_ROOT PILOT_MANIFEST RESPONSES_JSONL',
    );
  validateMuseReview(resolve(artifactDir), manifest, responses);
}
