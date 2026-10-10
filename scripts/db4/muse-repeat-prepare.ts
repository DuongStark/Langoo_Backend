// DB4-D5: repeat the original R2 requests for all D3 exact proposals, once.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { ArtifactRefSchema, Sha256Schema, hashBytes } from './_mapping-types';
import { artifactPath, jsonLines, readArtifact } from './_retrieval';
import { decideMuseReview } from './muse-review-decide';
import { storeAuditArtifact } from './mapping-audit';

export function prepareMuseRepeat(
  root: string,
  decisionPath: string,
  prefix: string,
) {
  artifactPath(root, `${prefix}/manifest.json`);
  const decisionBytes = readFileSync(artifactPath(root, decisionPath));
  const decisions = z
    .object({
      task: z.literal('db4_d3_muse_decisions'),
      inputs: z.object({
        pilot: ArtifactRefSchema,
        validation: ArtifactRefSchema,
      }),
      files: z.object({ exactProposals: ArtifactRefSchema }),
    })
    .parse(JSON.parse(decisionBytes.toString()));
  const replay = decideMuseReview(
    root,
    decisions.inputs.pilot.path,
    decisions.inputs.validation.path,
  );
  if (
    replay.manifest.path !== decisionPath ||
    replay.manifest.sha256 !== hashBytes(decisionBytes)
  )
    throw new Error('D3 source lineage mismatch');
  const proposals = jsonLines(
    readArtifact(root, decisions.files.exactProposals),
    z.object({ bundleKey: Sha256Schema, candidateKey: Sha256Schema }),
  );
  if (!proposals.length || proposals.length > 100)
    throw new Error('Repeat requires 1–100 exact proposals');
  const pilot = z
    .object({
      task: z.literal('db4_d4_muse_pilot'),
      prompt: ArtifactRefSchema,
      requests: ArtifactRefSchema,
    })
    .passthrough()
    .parse(JSON.parse(readArtifact(root, decisions.inputs.pilot).toString()));
  const selected = new Set(proposals.map((p) => p.bundleKey));
  const requests = jsonLines(
    readArtifact(root, pilot.requests),
    z
      .object({
        phase: z.enum(['r1', 'r2']),
        bundleKey: Sha256Schema,
        candidateKeys: z.array(Sha256Schema),
      })
      .passthrough(),
  ).filter((r) => r.phase === 'r2' && selected.has(r.bundleKey));
  if (
    requests.length !== proposals.length ||
    new Set(requests.map((r) => r.bundleKey)).size !== proposals.length
  )
    throw new Error('Repeat request denominator mismatch');
  const files = {
    prompt: storeAuditArtifact(
      root,
      `${prefix}/prompt.json`,
      readArtifact(root, pilot.prompt).toString(),
    ),
    requests: storeAuditArtifact(
      root,
      `${prefix}/requests.jsonl`,
      requests.map((r) => JSON.stringify(r) + '\n').join(''),
    ),
  };
  const manifest = {
    ...pilot,
    ...files,
    counts: {
      bundles: requests.length,
      requests: requests.length,
      perPhase: { r1: 0, r2: requests.length },
      candidatesPerPhase: requests.reduce(
        (n, r) => n + r.candidateKeys.length,
        0,
      ),
    },
    requestedWorkers: 8,
    apply: false,
    repeat: {
      task: 'DB4-D5',
      policyVersion: 'same-prompt-r2-repeat-v1',
      originalDecisions: {
        path: decisionPath,
        sha256: hashBytes(decisionBytes),
      },
      originalPilot: decisions.inputs.pilot,
      selectedCandidateKeys: proposals.map((p) => p.candidateKey),
      dispatchCap: requests.length,
      automaticResends: false,
      auditOrPriorVerdictsSent: false,
    },
  };
  const ref = storeAuditArtifact(
    root,
    `${prefix}/manifest.json`,
    JSON.stringify(manifest, null, 2) + '\n',
  );
  return { manifest: ref, counts: manifest.counts, apply: false };
}

if (require.main === module) {
  const [root, decisions, prefix] = process.argv.slice(2);
  if (!root || !decisions || !prefix || process.argv.length !== 5)
    throw new Error(
      'Usage: tsx scripts/db4/muse-repeat-prepare.ts ARTIFACT_ROOT D3_MANIFEST OUTPUT_PREFIX',
    );
  console.log(
    JSON.stringify(prepareMuseRepeat(resolve(root), decisions, prefix)),
  );
}
