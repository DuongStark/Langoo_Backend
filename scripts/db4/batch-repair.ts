// DB4-D4: plan/verify a bounded immutable repair wave; no Muse or DB calls.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { BatchManifestSchema, BatchScheduleSchema } from './_batch-types';
import { hashBytes, hashJson, parseMappingOutput } from './_mapping-types';
import {
  RequestSchema,
  cleanReply,
  renderedIntegrityBundle,
} from './_batch-requests';
import {
  FORMAT_REPAIR_POLICY,
  RepairRequest,
  RepairRequestSchema,
  RepairWaveSchema,
  loadRepairWaves,
  repairJob,
} from './_batch-repair';
import {
  artifactPath,
  readArtifact,
  writeAtomicArtifact,
  writeAtomicJson,
} from './_retrieval';
import { scanBatchJsonl } from './_batch-jsonl';
import { validateBatchPhase, ValidationResultSchema } from './batch-validate';
import { execFileSync } from 'node:child_process';

export async function prepareBatchRepairs(
  root: string,
  manifestPath: string,
  options: { revision: string; parent?: string; maxRepairs?: number },
) {
  const bytes = readFileSync(artifactPath(root, manifestPath));
  const manifestRef = { path: manifestPath, sha256: hashBytes(bytes) };
  const manifest = BatchManifestSchema.parse(
    JSON.parse(bytes.toString('utf8')) as unknown,
  );
  const baseJobs: z.infer<typeof BatchScheduleSchema>['jobs'] = [];
  await scanBatchJsonl(
    root,
    manifest.artifacts.schedule,
    z.unknown(),
    'Base schedule',
    (job) => {
      baseJobs.push(job as (typeof baseJobs)[number]);
    },
  );
  const schedule = BatchScheduleSchema.parse({
    schemaVersion: 1,
    task: 'db4_batch_schedule',
    runId: manifest.runId,
    waveId: 'initial',
    createdAt: manifest.createdAt,
    jobs: baseJobs,
  });
  const parent = options.parent
    ? await loadRepairWaves(root, options.parent, manifestRef, schedule.jobs)
    : null;
  if (parent && parent.wave.git.revision !== options.revision)
    throw new Error('Repair parent source pin mismatch');
  const usedTargets = new Set(parent?.jobs.map((job) => job.targetKey) ?? []);
  const byJob = new Map(schedule.jobs.map((job) => [job.jobKey, job]));
  const r1 = await validateBatchPhase(root, manifestPath, 'r1', options.parent);
  const r2 = await validateBatchPhase(root, manifestPath, 'r2', options.parent);
  const invalid = new Map<string, z.infer<typeof ValidationResultSchema>>();
  for (const validation of [r1, r2])
    await scanBatchJsonl(
      root,
      validation.results,
      ValidationResultSchema,
      'Rejected phase results',
      (row) => {
        if (
          row.state === 'invalid_output' &&
          row.rawResponse &&
          !usedTargets.has(row.targetKey)
        )
          invalid.set(row.jobKey, row);
      },
    );
  const requests: RepairRequest[] = [];
  const jobs: typeof schedule.jobs = [];
  const max = options.maxRepairs ?? 1000;
  if (!Number.isInteger(max) || max < 1 || max > 1000)
    throw new Error('Repair cap must be 1..1000');
  for (const shard of manifest.shards)
    for (const phase of ['r1', 'r2'] as const) {
      await scanBatchJsonl(
        root,
        shard.requests[phase],
        RequestSchema,
        'Original requests',
        (original) => {
          const row = invalid.get(original.jobKey);
          if (
            !row?.rawResponse ||
            requests.length >= max ||
            usedTargets.has(original.targetKey)
          )
            return;
          const rawText = readArtifact(root, row.rawResponse).toString('utf8');
          let parserError = 'Review candidate order mismatch';
          try {
            parseMappingOutput(
              cleanReply(rawText),
              renderedIntegrityBundle(original.payload.bundle),
            );
          } catch (error) {
            parserError =
              error instanceof Error
                ? error.message.slice(0, 4000)
                : 'Invalid output';
          }
          const repair = {
            policyVersion: FORMAT_REPAIR_POLICY,
            originalJobKey: original.jobKey,
            originalPromptHash: original.promptHash,
            originalRenderedHash: original.renderedContextHash,
            originalRawResponse: row.rawResponse,
            originalRawText: rawText,
            parserError,
          };
          const request = RepairRequestSchema.parse({
            ...original,
            dependencyJobKey: original.jobKey,
            repair,
            promptHash: hashJson({
              originalPromptHash: original.promptHash,
              policyVersion: FORMAT_REPAIR_POLICY,
            }),
            renderedContextHash: hashJson({
              payload: original.payload,
              repair,
            }),
          });
          const job = repairJob(
            manifest.runId,
            byJob.get(original.jobKey)!,
            request,
          );
          request.jobKey = job.jobKey;
          jobs.push(job);
          requests.push(request);
          usedTargets.add(request.targetKey);
        },
      );
    }
  if (!requests.length) return { planned: 0, manifest: null, apply: false };
  const identity = hashJson({
    policyVersion: FORMAT_REPAIR_POLICY,
    runManifest: manifestRef,
    parent: parent?.ref ?? null,
    gitRevision: options.revision,
    requests,
  });
  const prefix = `${manifestPath.slice(0, manifestPath.lastIndexOf('/'))}/repairs/${identity}`;
  const requestsRef = writeAtomicArtifact(
    root,
    `${prefix}/requests.jsonl`,
    requests.map((row) => JSON.stringify(row) + '\n').join(''),
  );
  const wave = RepairWaveSchema.parse({
    schemaVersion: 1,
    task: 'db4_batch_format_repair_wave',
    policyVersion: FORMAT_REPAIR_POLICY,
    runId: manifest.runId,
    createdAt: manifest.createdAt,
    runManifest: manifestRef,
    parent: parent?.ref ?? null,
    git: { revision: options.revision, dirtySourceSha256: null },
    originalValidations: { r1: r1.manifest, r2: r2.manifest },
    requests: requestsRef,
    jobs,
    count: requests.length,
    apply: false,
  });
  const ref = writeAtomicJson(root, `${prefix}/manifest.json`, wave);
  await loadRepairWaves(root, ref.path, manifestRef, schedule.jobs);
  return { planned: requests.length, manifest: ref, apply: false };
}

export async function verifyBatchRepairs(
  root: string,
  manifestPath: string,
  repairPath: string,
) {
  const bytes = readFileSync(artifactPath(root, manifestPath));
  const manifest = BatchManifestSchema.parse(
    JSON.parse(bytes.toString('utf8')) as unknown,
  );
  const jobs: unknown[] = [];
  await scanBatchJsonl(
    root,
    manifest.artifacts.schedule,
    z.unknown(),
    'Base schedule',
    (row) => {
      jobs.push(row);
    },
  );
  const base = BatchScheduleSchema.parse({
    schemaVersion: 1,
    task: 'db4_batch_schedule',
    runId: manifest.runId,
    waveId: 'initial',
    createdAt: manifest.createdAt,
    jobs,
  });
  const wave = await loadRepairWaves(
    root,
    repairPath,
    { path: manifestPath, sha256: hashBytes(bytes) },
    base.jobs,
  );
  return {
    runId: manifest.runId,
    manifest: wave.ref,
    git: wave.wave.git,
    jobs: wave.jobs,
    requestCount: wave.requests.length,
    apply: false,
    museCalled: false,
  };
}

if (require.main === module) {
  const command = process.argv[2];
  const flags: Record<string, string> = {};
  const allowed = new Set([
    'artifact-dir',
    'manifest',
    'repair-manifest',
    'max-repairs',
  ]);
  for (let index = 3; index < process.argv.length; index += 2) {
    const key = process.argv[index],
      value = process.argv[index + 1];
    if (
      !key?.startsWith('--') ||
      !allowed.has(key.slice(2)) ||
      !value ||
      value.startsWith('--') ||
      flags[key.slice(2)]
    )
      throw new Error('Unknown/duplicate/missing repair flag');
    flags[key.slice(2)] = value;
  }
  const root = resolve(flags['artifact-dir'] ?? 'uploads/db4');
  if (!flags.manifest || !['prepare', 'verify'].includes(command))
    throw new Error('Repair requires prepare|verify and --manifest');
  void (async () => {
    if (command === 'verify') {
      if (!flags['repair-manifest'])
        throw new Error('Verify requires --repair-manifest');
      return verifyBatchRepairs(root, flags.manifest, flags['repair-manifest']);
    }
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    const dirty = execFileSync(
      'git',
      ['status', '--porcelain', '--', 'scripts/db4', 'scripts/ops/db4-batch'],
      { encoding: 'utf8' },
    ).trim();
    if (dirty)
      throw new Error('Repair prepare requires committed runner source');
    return prepareBatchRepairs(root, flags.manifest, {
      revision,
      parent: flags['repair-manifest'],
      maxRepairs: flags['max-repairs']
        ? Number(flags['max-repairs'])
        : undefined,
    });
  })()
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error: unknown) => {
      console.error(
        JSON.stringify({
          errorType: error instanceof Error ? error.name : 'RepairError',
          message:
            error instanceof Error
              ? error.message.slice(0, 1000)
              : 'Repair failed',
        }),
      );
      process.exitCode = 1;
    });
}
