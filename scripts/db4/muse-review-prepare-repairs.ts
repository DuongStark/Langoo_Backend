// DB4-D4: prepare one bounded output-contract repair for rejected Muse replies.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MappingBundle,
  MappingBundleSchema,
  hashBytes,
  parseMappingBundleIntegrity,
  renderMappingBundle,
} from './_mapping-types';
import {
  artifactPath,
  readArtifact,
  writeArtifact,
  writeJson,
} from './_retrieval';
import {
  PromptPhase,
  promptRevisionFromVersions,
  promptVersion,
} from './muse-prompt-version';

type Phase = PromptPhase;
type Request = {
  requestId: string;
  phase: Phase;
  promptVersion: string;
  bundleKey: string;
  senseId: string;
  contextHash: string;
  renderedContextHash: string;
  candidateKeys: string[];
  conceptIds: string[];
  sourceBranches: string[];
  payload: {
    seed: string;
    bundle: MappingBundle;
  };
};
type Response = {
  requestId: string;
  phase: Phase;
  bundleKey: string;
  senseId: string;
  contextHash: string;
  renderedContextHash: string;
  state: string;
};

function jsonLines<T>(bytes: Buffer): T[] {
  return bytes
    .toString('utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as T);
}

const REPAIR_REMINDER = `

COMPLETION REPAIR CHECK
This is one bounded retry of the same frozen sense and candidate shortlist. Re-evaluate every candidate using the rules above. First count bundle.candidates. Return exactly one reviews item for each candidate, in the exact input order; never omit a candidate, even when its verdict is uncertain or none. Every item must include every required field, including missingBranches (use [] when empty), conflicts (use [] when empty), reason, and confidence. Keep reasons concise so the complete JSON fits. Before returning, verify reviews.length equals bundle.candidates.length and that the candidateKey and conceptId at every position match that input candidate. Return only the contract JSON.`;

export function prepareMuseReviewRepairs(
  root: string,
  manifestPath: string,
  responsesPath: string,
  validationPath: string,
  outputPrefix: string,
) {
  const manifestBytes = readFileSync(artifactPath(root, manifestPath));
  const manifest = JSON.parse(manifestBytes.toString()) as {
    task: string;
    prompt: { path: string; sha256: string };
    requests: { path: string; sha256: string };
    counts: { requests: number };
  };
  if (manifest.task !== 'db4_d4_muse_pilot')
    throw new Error('Wrong DB4-D4 source manifest');

  const promptBytes = readArtifact(root, manifest.prompt);
  const prompt = JSON.parse(promptBytes.toString()) as {
    task: string;
    system: string;
    phases: Record<Phase, string>;
    versions: Record<Phase, string>;
  };
  if (prompt.task !== 'db4_d4_muse_prompt_pilot')
    throw new Error('Wrong DB4-D4 prompt artifact');
  const { revision, attempt } = promptRevisionFromVersions(prompt.versions);
  if (attempt !== 'base')
    throw new Error('A DB4-D4 repair request cannot be repaired again');
  const requestBytes = readArtifact(root, manifest.requests);
  const requests = jsonLines<Request>(requestBytes);
  const responseBytes = readFileSync(artifactPath(root, responsesPath));
  const responses = jsonLines<Response>(responseBytes);
  const validationBytes = readFileSync(artifactPath(root, validationPath));
  const validation = JSON.parse(validationBytes.toString()) as {
    task: string;
    pilotManifest: { sha256: string };
    responses: { sha256: string };
    validationIssues: { requestId: string }[];
  };
  if (
    validation.task !== 'db4_d4_muse_validation' ||
    validation.pilotManifest.sha256 !== hashBytes(manifestBytes) ||
    validation.responses.sha256 !== hashBytes(responseBytes)
  )
    throw new Error('Validation report is not bound to these frozen artifacts');
  if (
    requests.length !== manifest.counts.requests ||
    responses.length !== requests.length ||
    new Set(requests.map((row) => row.requestId)).size !== requests.length ||
    new Set(responses.map((row) => row.requestId)).size !== responses.length
  )
    throw new Error('Request/response denominator or uniqueness mismatch');

  const requestById = new Map(requests.map((row) => [row.requestId, row]));
  const responseById = new Map(responses.map((row) => [row.requestId, row]));
  for (const request of requests) {
    if (request.promptVersion !== prompt.versions[request.phase])
      throw new Error(`Request prompt version mismatch: ${request.requestId}`);
    const response = responseById.get(request.requestId);
    if (
      !response ||
      response.phase !== request.phase ||
      response.bundleKey !== request.bundleKey ||
      response.senseId !== request.senseId ||
      response.contextHash !== request.contextHash ||
      response.renderedContextHash !== request.renderedContextHash
    )
      throw new Error(`Unbound response: ${request.requestId}`);
    MappingBundleSchema.parse(request.payload.bundle);
  }

  const repairIds = new Set(
    responses
      .filter((response) => response.state === 'invalid_output')
      .map((response) => response.requestId),
  );
  for (const issue of validation.validationIssues) {
    if (!requestById.has(issue.requestId))
      throw new Error(`Foreign validation issue: ${issue.requestId}`);
    repairIds.add(issue.requestId);
  }
  if (!repairIds.size) throw new Error('No rejected outputs to repair');
  const repairBundleKeys = new Set<string>();
  for (const request of requests) {
    if (!repairIds.has(request.requestId)) continue;
    if (repairBundleKeys.has(request.bundleKey))
      throw new Error(
        `More than one format repair selected for sense bundle: ${request.bundleKey}`,
      );
    repairBundleKeys.add(request.bundleKey);
  }

  const versions: Record<Phase, string> = {
    r1: promptVersion(revision, 'r1', 'repair1'),
    r2: promptVersion(revision, 'r2', 'repair1'),
  };
  const phases: Record<Phase, string> = {
    r1: prompt.phases.r1 + REPAIR_REMINDER,
    r2: prompt.phases.r2 + REPAIR_REMINDER,
  };
  const repairPrompt = {
    schemaVersion: 1,
    task: 'db4_d4_muse_prompt_pilot',
    system: prompt.system,
    phases,
    versions,
    hashes: {
      system: hashBytes(prompt.system),
      r1: hashBytes(phases.r1),
      r2: hashBytes(phases.r2),
    },
  };

  const repairRequests: Record<string, unknown>[] = [];
  for (const request of requests) {
    if (!repairIds.has(request.requestId)) continue;
    const renderedInput = MappingBundleSchema.parse(request.payload.bundle);
    const canonicalBundle = parseMappingBundleIntegrity({
      ...renderedInput,
      candidates: [...renderedInput.candidates].sort((a, b) =>
        a.candidateKey < b.candidateKey
          ? -1
          : a.candidateKey > b.candidateKey
            ? 1
            : 0,
      ),
    });
    const rendered = renderMappingBundle(
      canonicalBundle,
      request.phase,
      request.payload.seed,
      versions[request.phase],
    );
    const payload = rendered.payload;
    if (
      payload.bundle.candidates
        .map((candidate) => candidate.candidateKey)
        .join('\n') !==
      renderedInput.candidates
        .map((candidate) => candidate.candidateKey)
        .join('\n')
    )
      throw new Error(
        `Repair rendering changed candidate order: ${request.requestId}`,
      );
    repairRequests.push({
      requestId: `${request.bundleKey}:${request.phase}:repair1`,
      repairOf: request.requestId,
      phase: request.phase,
      promptVersion: versions[request.phase],
      bundleKey: request.bundleKey,
      senseId: request.senseId,
      contextHash: request.contextHash,
      renderedContextHash: rendered.renderedContextHash,
      candidateKeys: request.candidateKeys,
      conceptIds: request.conceptIds,
      sourceBranches: payload.bundle.sourceBranches,
      payload,
    });
  }

  const prefix = outputPrefix.replace(/\/$/, '');
  const repairRequestBytes = repairRequests
    .map((row) => JSON.stringify(row) + '\n')
    .join('');
  const files = {
    prompt: writeJson(root, `${prefix}/prompt.json`, repairPrompt),
    requests: writeArtifact(
      root,
      `${prefix}/requests.jsonl`,
      repairRequestBytes,
    ),
  };
  const perPhase = {
    r1: repairRequests.filter((row) => row.phase === 'r1').length,
    r2: repairRequests.filter((row) => row.phase === 'r2').length,
  };
  const candidateReviewsByPhase = {
    r1: repairRequests
      .filter((row) => row.phase === 'r1')
      .reduce((sum, row) => sum + (row.candidateKeys as string[]).length, 0),
    r2: repairRequests
      .filter((row) => row.phase === 'r2')
      .reduce((sum, row) => sum + (row.candidateKeys as string[]).length, 0),
  };
  const repairManifest = {
    schemaVersion: 1,
    task: 'db4_d4_muse_pilot',
    createdAt: new Date().toISOString(),
    prompt: files.prompt,
    requests: files.requests,
    counts: {
      bundles: new Set(repairRequests.map((row) => row.bundleKey)).size,
      requests: repairRequests.length,
      perPhase,
      candidatesPerPhase: Math.max(
        candidateReviewsByPhase.r1,
        candidateReviewsByPhase.r2,
      ),
      candidateReviewsByPhase,
    },
    requestedWorkers: 8,
    transport:
      'Muse native gateway; one bounded contract repair per rejected output',
    parent: {
      manifestPath,
      responsesPath,
      validationPath,
    },
    repair: {
      attempt: 1,
      selectedRequestIds: [...repairIds],
      sourceManifestSha256: hashBytes(manifestBytes),
      sourceResponsesSha256: hashBytes(responseBytes),
      validationSha256: hashBytes(validationBytes),
    },
    apply: false,
  };
  const manifestRef = writeJson(
    root,
    `${prefix}/manifest.json`,
    repairManifest,
  );
  console.log(
    JSON.stringify({
      manifest: manifestRef,
      counts: repairManifest.counts,
      versions,
      apply: false,
    }),
  );
  return repairManifest;
}

if (require.main === module) {
  const [root, manifest, responses, validation, prefix] = process.argv.slice(2);
  if (!root || !manifest || !responses || !validation || !prefix)
    throw new Error(
      'Usage: tsx scripts/db4/muse-review-prepare-repairs.ts ARTIFACT_ROOT MANIFEST RESPONSES VALIDATION_SUMMARY OUTPUT_PREFIX',
    );
  prepareMuseReviewRepairs(
    resolve(root),
    manifest,
    responses,
    validation,
    prefix,
  );
}
