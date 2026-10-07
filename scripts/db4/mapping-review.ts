import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import {
  readBytes,
  resolveArtifact,
  sha256Bytes,
  stablePretty,
  writeTextAtomic,
} from './_artifacts';
import { parseMappingCli } from './_cli';
import {
  ArtifactRefSchema,
  Count,
  Sha256Schema,
  Text,
  createMappingJob,
  jobBudgetUsage,
  parseMappingBundleIntegrity,
  parseMappingJob,
  renderMappingBundle,
  verifyArtifactBytes,
  type ArtifactRef,
  type MappingJob,
  type MappingJobEntry,
} from './_mapping-types';
import { createStubAdapter, runJob, type ProviderAdapter } from './_runner';

/**
 * D4 `mapping-review` — CLI điều phối runner R1/R2 (offline-first, chưa ghi DB):
 *
 *   # tạo job mới từ bundles manifest + chạy (stub, không tốn quota)
 *   npx tsx scripts/db4/mapping-review.ts --generate \
 *     --bundles bundles/<gen>/manifest.json --provider stub \
 *     --job jobs/mapping-review-stub.json [--artifact-dir uploads/db4]
 *
 *   # chạy tiếp job đã checkpoint (resume)
 *   npx tsx scripts/db4/mapping-review.ts --generate --resume \
 *     --job jobs/mapping-review-stub.json
 *
 * Provider `openai-compatible` (longcat…) sẽ bổ sung sau pilot mock — hiện từ chối rõ ràng.
 * Caps qua env: DB4_CAP_MAX_REQUESTS / _TOKENS / _COST_MICROUSD / _OUTPUT_TOKENS /
 * _CONTEXT_BYTES / _RETRIES (mặc định: 300 req, 5M token, $0,10, 4096, 2MB, 1 retry).
 */

const STUB_PROMPT_R1 = 'mapping-sense-concept-r1-v1';
const STUB_PROMPT_R2 = 'mapping-sense-concept-r2-v1';
const STUB_VERIFIED_AT = '2026-10-07T00:00:00+07:00';

const BundlesManifestSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('db4-bundles'),
  mode: z.enum(['fixture', 'production']),
  semanticInputFingerprint: Sha256Schema,
  snapshot: ArtifactRefSchema,
  pilot: ArtifactRefSchema,
  policyVersion: Text,
  seed: Text,
  bundles: z.array(
    z.object({
      bundleKey: Sha256Schema,
      targetKey: Sha256Schema,
      senseKey: Text,
      contextHash: Sha256Schema,
      ref: ArtifactRefSchema,
      candidateCount: Count,
    }),
  ),
});

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`Env ${key} không hợp lệ: ${raw}`);
  return value;
}

function capsFromEnv(): MappingJob['caps'] {
  const maxRetries = envInt('DB4_CAP_MAX_RETRIES', 1);
  if (maxRetries > 2) throw new Error('DB4_CAP_MAX_RETRIES tối đa 2');
  return {
    maxRequests: Math.max(1, envInt('DB4_CAP_MAX_REQUESTS', 300)),
    maxTokens: Math.max(1, envInt('DB4_CAP_MAX_TOKENS', 5_000_000)),
    maxCostMicrousd: envInt('DB4_CAP_MAX_COST_MICROUSD', 100_000),
    maxOutputTokens: Math.max(1, envInt('DB4_CAP_MAX_OUTPUT_TOKENS', 4096)),
    maxContextBytes: Math.max(
      1,
      envInt('DB4_CAP_MAX_CONTEXT_BYTES', 2_000_000),
    ),
    maxRetries,
    concurrency: 1,
  };
}

function stubRateEvidence(root: string): ArtifactRef {
  const rel = 'providers/stub-rate.json';
  const abs = resolveArtifact(root, rel);
  if (existsSync(abs))
    return { path: rel, sha256: sha256Bytes(readFileSync(abs)) };
  return writeTextAtomic(
    root,
    rel,
    stablePretty({
      provider: 'stub',
      note: 'stub nội bộ: 0 quota, dùng cho mock/pilot khô',
      verifiedAt: STUB_VERIFIED_AT,
    }),
  );
}

function stubProviders(root: string): MappingJob['providers'] {
  const evidence = stubRateEvidence(root);
  const rate = {
    inputMicrousdPerMillion: 0,
    outputMicrousdPerMillion: 0,
    reasoningMicrousdPerMillion: 0,
    verifiedAt: STUB_VERIFIED_AT,
    evidence,
  };
  return {
    r1: {
      provider: 'stub',
      model: 'stub-r1-v1',
      endpoint: null,
      protocol: 'stub',
      promptVersion: STUB_PROMPT_R1,
      responseSchemaVersion: 1,
      reasoningConfig: { effort: null, maxTokens: 0 },
      sessionId: 'stub-session-r1',
      rate,
    },
    r2: {
      provider: 'stub',
      model: 'stub-r2-v1',
      endpoint: null,
      protocol: 'stub',
      promptVersion: STUB_PROMPT_R2,
      responseSchemaVersion: 1,
      reasoningConfig: { effort: null, maxTokens: 0 },
      sessionId: 'stub-session-r2',
      rate,
    },
  };
}

function adapterFor(job: MappingJob, providerFlag: unknown): ProviderAdapter {
  if (providerFlag !== 'stub')
    throw new Error(
      'Provider openai-compatible chưa hỗ trợ ở bản runner này (sẽ thêm sau pilot mock)',
    );
  if (
    job.providers.r1.provider !== 'stub' ||
    job.providers.r2.provider !== 'stub'
  )
    throw new Error('Job hiện tại không phải provider stub');
  return createStubAdapter();
}

function newRun(
  root: string,
  jobRel: string,
  bundlesRel: string,
  providerFlag: unknown,
): void {
  if (providerFlag !== 'stub')
    throw new Error(`Provider chưa hỗ trợ: ${String(providerFlag)}`);
  const manifestBytes = readBytes(root, bundlesRel);
  const manifest = BundlesManifestSchema.parse(
    JSON.parse(manifestBytes.toString('utf8')),
  );
  for (const ref of [manifest.snapshot, manifest.pilot]) {
    verifyArtifactBytes(ref, readBytes(root, ref.path));
  }
  const providers = stubProviders(root);
  const sortedRows = [...manifest.bundles].sort((a, b) =>
    a.targetKey < b.targetKey ? -1 : 1,
  );
  const entries: MappingJobEntry[] = sortedRows.map((row) => {
    const bytes = readBytes(root, row.ref.path);
    verifyArtifactBytes(row.ref, bytes);
    const bundle = parseMappingBundleIntegrity(
      JSON.parse(bytes.toString('utf8')),
    );
    if (
      bundle.bundleKey !== row.bundleKey ||
      bundle.contextHash !== row.contextHash ||
      bundle.sense.semanticKey !== row.senseKey
    )
      throw new Error(`Bundle lệch manifest: ${row.bundleKey.slice(0, 12)}`);
    return {
      targetKey: row.targetKey,
      senseKey: row.senseKey,
      bundleKey: row.bundleKey,
      contextHash: row.contextHash,
      bundle: row.ref,
      renderedR1: renderMappingBundle(
        bundle,
        'r1',
        manifest.seed,
        providers.r1.promptVersion,
      ).renderedContextHash,
      renderedR2: renderMappingBundle(
        bundle,
        'r2',
        manifest.seed,
        providers.r2.promptVersion,
      ).renderedContextHash,
      state: 'queued',
      decision: null,
      audit: null,
      gate: null,
      journal: null,
      reason: null,
    };
  });
  const job = createMappingJob(
    {
      schemaVersion: 1,
      task: 'sense_concept_review',
      mode: manifest.mode,
      semanticInputFingerprint: manifest.semanticInputFingerprint,
      snapshot: manifest.snapshot,
      pilotManifest: manifest.pilot,
      providers,
      policyVersions: {
        source: 'db4-sources-v1',
        retrieval: 'db4-retrieval-v1',
        decision: 'mapping-decision-v1',
        audit: manifest.policyVersion,
      },
      seed: manifest.seed,
      caps: capsFromEnv(),
    },
    entries,
  );
  const serialized = stablePretty(job);
  const abs = resolveArtifact(root, jobRel);
  if (existsSync(abs)) {
    if (readFileSync(abs, 'utf8') !== serialized)
      throw new Error(`Job đã tồn tại khác nội dung: ${jobRel}`);
  } else {
    writeTextAtomic(root, jobRel, serialized);
  }
  console.log(
    `  job mới: ${jobRel} (${job.jobKey.slice(0, 12)}, ${job.entries.length} target, mode ${job.mode})`,
  );
}

function summarizeStates(job: MappingJob): string {
  const counts = new Map<string, number>();
  for (const entry of job.entries)
    counts.set(entry.state, (counts.get(entry.state) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([state, count]) => `${state}=${count}`)
    .join(' ');
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const started = Date.now();
  const cli = parseMappingCli('mapping-review', argv);
  const root = cli.artifactDir;
  const jobRel = String(cli.flags.job);
  const resume = cli.flags.resume === true;

  console.log('== DB4 mapping-review ==');
  if (resume) {
    const job = parseMappingJob(
      JSON.parse(readBytes(root, jobRel).toString('utf8')),
    );
    if (job.status === 'awaiting_audit' || job.status === 'completed') {
      console.log(`  job đã ở trạng thái ${job.status} — không cần chạy lại`);
      return;
    }
  } else {
    newRun(root, jobRel, String(cli.flags.bundles), cli.flags.provider);
  }

  const frozen = parseMappingJob(
    JSON.parse(readBytes(root, jobRel).toString('utf8')),
  );
  const adapter = adapterFor(frozen, resume ? 'stub' : cli.flags.provider);
  const finalJob = await runJob({
    root,
    jobRel,
    adapter,
    log: (message) => {
      console.log(`  ${message}`);
    },
  });
  const usage = jobBudgetUsage(finalJob);
  console.log(`  trạng thái: ${summarizeStates(finalJob)}`);
  console.log(
    `  usage: ${usage.requests} request | ${usage.tokens} token | ${usage.costMicrousd} µ$ | unknown ${usage.unknownRequests}`,
  );
  console.log(`  job.status: ${finalJob.status}`);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`  xong trong ${seconds}s`);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(
      `mapping-review: LỖI — ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
