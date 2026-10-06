import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import {
  readArtifactJson,
  readArtifactText,
  resolveArtifactPath,
  withArtifactLock,
  writeArtifactJson,
} from './_gloss-artifacts';
import {
  createGlossJob,
  computeGlossCacheKey,
  parseGlossCandidate,
  parseGlossJob,
  parseGlossOutput,
  parseGlossResponseArtifact,
  validateGlossJobCandidates,
  type GlossCandidate,
  type GlossJob,
  type GlossResponseArtifact,
} from './_gloss-types';
import {
  createGoGlossProvider,
  createStubGlossProvider,
  GLOSS_PROMPT_VERSION,
  GlossProviderError,
  reservedUsage,
  type GlossProvider,
  type ProviderResult,
} from './_gloss-provider';
import { loadEnv, parseCli } from './_shared';

export function loadGlossCandidates(
  artifactDir: string,
  file: string,
): GlossCandidate[] {
  const candidates = readArtifactText(artifactDir, file)
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => parseGlossCandidate(JSON.parse(line) as unknown));
  if (new Set(candidates.map((c) => c.candidateKey)).size !== candidates.length)
    throw new Error('Duplicate candidate in JSONL');
  return candidates;
}
export function verifyGlossSources(
  root: string,
  candidates: GlossCandidate[],
): void {
  const checked = new Map<string, string>();
  for (const candidate of candidates) {
    for (const source of candidate.sources) {
      if (source.audit.status !== 'verified')
        throw new Error('Translation source not verified');
      for (const evidence of source.audit.evidence) {
        if (
          checked.has(evidence.path) &&
          checked.get(evidence.path) !== evidence.sha256
        )
          throw new Error('Conflicting source evidence hash');
        if (!checked.has(evidence.path)) {
          readArtifactText(root, evidence.path, evidence.sha256);
          checked.set(evidence.path, evidence.sha256);
        }
      }
    }
  }
}

/** Select JA pilot targets, including ten senses from lexemes with multiple meanings. */
export function selectGlossPilotCandidates(
  candidates: GlossCandidate[],
  limit: number,
): GlossCandidate[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new Error('max-targets must be 1..100');
  const pool = candidates.filter(
    (c) =>
      c.classification === 'needs_translation' &&
      c.target.targetType === 'sense' &&
      c.target.language === 'ja',
  );
  const ids = pool.map((c) => c.target!.targetId);
  if (new Set(ids).size !== ids.length)
    throw new Error(
      'Pilot input contains multiple candidates for a target; resolve before selecting',
    );
  pool.sort((a, b) => {
    const aa = a.target!.targetType === 'sense' ? a.target : null,
      bb = b.target!.targetType === 'sense' ? b.target : null;
    return (
      (bb?.jlptLevel ?? 0) - (aa?.jlptLevel ?? 0) ||
      Number(bb?.isPrimary ?? false) - Number(aa?.isPrimary ?? false) ||
      a.candidateKey.localeCompare(b.candidateKey)
    );
  });
  const meanings = new Map<string, number>();
  for (const c of pool)
    if (c.target?.targetType === 'sense')
      meanings.set(
        c.target.lexemeId,
        (meanings.get(c.target.lexemeId) ?? 0) + 1,
      );
  const difficult = pool
    .filter(
      (c) =>
        c.target?.targetType === 'sense' &&
        (meanings.get(c.target.lexemeId) ?? 0) > 1,
    )
    .slice(0, Math.min(10, limit));
  if (limit === 100 && (pool.length < 100 || difficult.length < 10))
    throw new Error(
      'Pilot requires 100 unique JA senses including ten multi-sense cases',
    );
  const chosen = new Set(difficult.map((c) => c.candidateKey));
  return [
    ...difficult,
    ...pool.filter((c) => !chosen.has(c.candidateKey)),
  ].slice(0, limit);
}
export interface TranslateOptions {
  artifactDir: string;
  job: GlossJob;
  candidates: GlossCandidate[];
  adapter: GlossProvider;
  generate?: boolean;
  retryUnknown?: boolean;
  maxAttempts?: number;
  jobFile?: string;
  persist?: typeof writeArtifactJson;
  sleep?: (ms: number) => Promise<void>;
}
function responsePath(
  jobKey: string,
  candidateKey: string,
  attempt: number,
): string {
  return `responses/${jobKey}/${candidateKey}-${attempt}.json`;
}
function intentPath(
  jobKey: string,
  candidateKey: string,
  attempt: number,
): string {
  return `attempts/${jobKey}/${candidateKey}-${attempt}.json`;
}
const intentSchema = z
  .object({
    jobKey: z.string(),
    candidateKey: z.string(),
    inputHash: z.string(),
    cacheKey: z.string(),
    reserved: z
      .object({
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
        tokens: z.number().int().nonnegative(),
        costUsd: z.number().nonnegative(),
      })
      .strict(),
  })
  .strict();
function matchResponse(
  response: GlossResponseArtifact,
  candidate: GlossCandidate,
  job: GlossJob,
  requireJob = true,
): void {
  if (
    response.candidateKey !== candidate.candidateKey ||
    response.inputHash !== candidate.inputHash ||
    response.cacheKey !== computeGlossCacheKey(candidate, job.provider) ||
    (requireJob && response.jobKey !== job.jobKey)
  )
    throw new Error('Response provenance/cache mismatch');
  if (response.output) {
    if (!candidate.target) throw new Error('Response candidate lacks target');
    parseGlossOutput(response.output, candidate.target);
  }
}
export async function translateGlossJob(
  options: TranslateOptions,
): Promise<GlossJob> {
  const { artifactDir, adapter } = options;
  const job = parseGlossJob(structuredClone(options.job));
  validateGlossJobCandidates(job, options.candidates);
  const byKey = new Map(options.candidates.map((c) => [c.candidateKey, c]));
  const selected = job.entries.map((e) => byKey.get(e.candidateKey)!);
  verifyGlossSources(artifactDir, selected);
  readArtifactText(
    artifactDir,
    job.snapshot.inventory.path,
    job.snapshot.inventory.sha256,
  );
  if (!options.generate) return job; // No network, locks or writes on dry-run.
  if (job.provider.promptVersion !== GLOSS_PROMPT_VERSION)
    throw new Error('Job prompt version is not implemented');
  const maxAttempts = options.maxAttempts ?? 3;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3)
    throw new Error('maxAttempts must be 1..3');
  const persist = options.persist ?? writeArtifactJson;
  const save = () => {
    parseGlossJob(job);
    persist(artifactDir, options.jobFile ?? 'job.json', job);
  };
  const sleep =
    options.sleep ?? ((ms: number) => delay(ms).then(() => undefined));
  return withArtifactLock(artifactDir, `job-${job.jobKey.slice(0, 16)}`, async () => {
    // Protect against two callers loading the old checkpoint before acquiring the lock.
    const existing = resolveArtifactPath(
      artifactDir,
      options.jobFile ?? 'job.json',
    );
    if (existsSync(existing)) {
      const current = parseGlossJob(
        readArtifactJson(artifactDir, options.jobFile ?? 'job.json'),
      );
      if (JSON.stringify(current) !== JSON.stringify(job))
        throw new Error('Checkpoint changed; reload before resume');
    }
    save();
    for (const entry of job.entries) {
      const candidate = byKey.get(entry.candidateKey)!;
      const cacheKey = computeGlossCacheKey(candidate, job.provider);
      const cachePath = `cache/${cacheKey}.json`;
      if (['validated', 'applied', 'rejected'].includes(entry.state)) {
        // Completed outputs still need durable evidence; never silently trust a checkpoint alone.
        const response = entry.attempts.findLast(
          (a) => a.outcome === 'response',
        )?.response;
        if (response) {
          const record = parseGlossResponseArtifact(
            readArtifactJson(artifactDir, response.path, response.sha256),
          );
          matchResponse(record, candidate, job);
          if (JSON.stringify(record.output) !== JSON.stringify(entry.output))
            throw new Error('Checkpoint output differs from response');
          if (
            record.output?.gloss_vi &&
            !record.validationError &&
            !existsSync(resolveArtifactPath(artifactDir, cachePath))
          )
            persist(artifactDir, cachePath, record);
        } else if (entry.state !== 'rejected') {
          const record = parseGlossResponseArtifact(
            readArtifactJson(artifactDir, cachePath),
          );
          matchResponse(record, candidate, job, false);
          if (JSON.stringify(record.output) !== JSON.stringify(entry.output))
            throw new Error('Checkpoint output differs from cache');
        }
        continue;
      }
      if (entry.state === 'running') {
        const attempt = entry.attempts.at(-1)!;
        const intent = intentSchema.parse(
          readArtifactJson(
            artifactDir,
            intentPath(job.jobKey, entry.candidateKey, attempt.attempt),
          ),
        );
        if (
          intent.jobKey !== job.jobKey ||
          intent.cacheKey !== cacheKey ||
          intent.candidateKey !== candidate.candidateKey ||
          intent.inputHash !== candidate.inputHash
        )
          throw new Error('Attempt intent mismatch');
        const file = responsePath(
          job.jobKey,
          entry.candidateKey,
          attempt.attempt,
        );
        if (existsSync(resolveArtifactPath(artifactDir, file))) {
          const record = parseGlossResponseArtifact(
            readArtifactJson(artifactDir, file),
          );
          matchResponse(record, candidate, job);
          if (record.attempt !== attempt.attempt)
            throw new Error('Response attempt mismatch');
          finalize(
            entry,
            record,
            intent.reserved,
            persist(artifactDir, file, record),
          );
          save();
          if (
            record.output?.gloss_vi &&
            !record.validationError &&
            !existsSync(resolveArtifactPath(artifactDir, cachePath))
          )
            persist(artifactDir, cachePath, record);
          continue;
        } else {
          attempt.outcome = 'unknown';
          entry.state = 'failed';
          entry.error =
            'Unknown previous attempt; explicit retryUnknown required';
          save();
        }
      }
      if (
        entry.attempts.some((a) => a.outcome === 'unknown') &&
        !options.retryUnknown
      )
        throw new Error(
          'Unknown attempt may have consumed quota; resume requires explicit --retry-unknown',
        );
      if (entry.state === 'failed' && entry.validation === 'failed') continue;
      if (
        entry.attemptCount === 0 &&
        existsSync(resolveArtifactPath(artifactDir, cachePath))
      ) {
        const cache = parseGlossResponseArtifact(
          readArtifactJson(artifactDir, cachePath),
        );
        matchResponse(cache, candidate, job, false);
        if (!cache.output?.gloss_vi || cache.validationError)
          throw new Error('Cache does not contain validated output');
        entry.output = cache.output;
        entry.state = 'validated';
        entry.validation = 'passed';
        entry.error = null;
        save();
        continue;
      }
      while (entry.attemptCount < maxAttempts) {
        const reserve = reservedUsage(candidate, adapter);
        if (
          job.usage.attemptCount >= job.caps.maxRequests ||
          job.usage.costUsd + reserve.costUsd > job.caps.maxCostUsd + 1e-12 ||
          (job.caps.maxTokens !== null &&
            job.usage.tokens + reserve.tokens > job.caps.maxTokens)
        ) {
          save();
          return job;
        }
        const attempt = {
          attempt: entry.attemptCount + 1,
          startedAt: new Date().toISOString(),
          outcome: 'in_flight' as const,
          response: null,
        };
        // Intent and budget checkpoint must both be durable before a provider can consume quota.
        persist(
          artifactDir,
          intentPath(job.jobKey, entry.candidateKey, attempt.attempt),
          {
            jobKey: job.jobKey,
            candidateKey: candidate.candidateKey,
            inputHash: candidate.inputHash,
            cacheKey,
            reserved: reserve,
          },
        );
        entry.attempts.push(attempt);
        entry.attemptCount++;
        job.usage.attemptCount++;
        job.usage.tokens += reserve.tokens;
        job.usage.costUsd += reserve.costUsd;
        entry.state = 'running';
        entry.error = null;
        entry.validation = 'pending';
        save();
        let result: ProviderResult;
        try {
          result = await adapter.call(candidate, job.provider, job.sessionId);
        } catch (error) {
          const failure =
            error instanceof GlossProviderError
              ? error
              : new GlossProviderError(
                  'Provider adapter failed',
                  false,
                  'unknown',
                );
          entry.attempts.at(-1)!.outcome = failure.outcome;
          entry.state = 'failed';
          entry.error = failure.message;
          save();
          if (failure.outcome === 'unknown' && !options.retryUnknown)
            throw failure;
          if (!failure.retryable || entry.attemptCount >= maxAttempts)
            throw failure;
          const wait = Math.max(
            failure.retryAfterMs,
            Math.min(
              30_000,
              500 * 2 ** (entry.attemptCount - 1) +
                Math.floor(Math.random() * 250),
            ),
          );
          // Long Retry-After yields a checkpoint for a later resume instead of blocking the operator.
          if (wait > 30_000)
            throw new Error('Retry-After exceeds 30s; resume later');
          await sleep(wait);
          continue;
        }
        let output: GlossResponseArtifact['output'] = null;
        let validationError = result.validationError;
        try {
          if (validationError === null)
            output = parseGlossOutput(result.output, candidate.target!);
        } catch {
          validationError = 'Output JSON/schema/target validation failed';
        }
        const inputTokens = result.usage?.inputTokens ?? reserve.inputTokens;
        const outputTokens = result.usage?.outputTokens ?? reserve.outputTokens;
        const record = parseGlossResponseArtifact({
          schemaVersion: 1,
          jobKey: job.jobKey,
          candidateKey: candidate.candidateKey,
          inputHash: candidate.inputHash,
          cacheKey,
          attempt: attempt.attempt,
          output,
          validationError,
          usage: {
            inputTokens,
            outputTokens,
            tokens: inputTokens + outputTokens,
            costUsd:
              (inputTokens * adapter.inputRatePerMillion +
                outputTokens * adapter.outputRatePerMillion) /
              1_000_000,
            estimated: result.usage === null,
          },
          raw: result.raw,
        });
        const response = persist(
          artifactDir,
          responsePath(job.jobKey, entry.candidateKey, attempt.attempt),
          record,
        );
        finalize(entry, record, reserve, response);
        save();
        if (record.output?.gloss_vi && !record.validationError) {
          if (existsSync(resolveArtifactPath(artifactDir, cachePath)))
            throw new Error('Cache unexpectedly exists; refusing overwrite');
          persist(artifactDir, cachePath, record);
        }
        if (
          job.usage.costUsd > job.caps.maxCostUsd ||
          (job.caps.maxTokens !== null && job.usage.tokens > job.caps.maxTokens)
        )
          return job;
        break;
      }
    }
    return job;
    function finalize(
      entry: GlossJob['entries'][number],
      record: GlossResponseArtifact,
      reserve: { tokens: number; costUsd: number },
      response: { path: string; sha256: string },
    ): void {
      const a = entry.attempts.at(-1)!;
      a.outcome = 'response';
      a.response = response;
      job.usage.tokens = Math.max(
        0,
        job.usage.tokens - reserve.tokens + record.usage.tokens,
      );
      job.usage.costUsd = Math.max(
        0,
        job.usage.costUsd - reserve.costUsd + record.usage.costUsd,
      );
      entry.output = record.output;
      entry.state =
        record.output?.gloss_vi && !record.validationError
          ? 'validated'
          : 'rejected';
      entry.validation = entry.state === 'validated' ? 'passed' : 'failed';
      entry.error = record.validationError ?? record.output?.reason ?? null;
    }
  });
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const cli = parseCli('gloss-translate', args);
  const flag = (key: string, fallback?: string) => {
    const value = cli.flags.get(key);
    return typeof value === 'string' ? value : fallback;
  };
  const root = flag('artifact-dir', 'uploads/db3b')!;
  const candidates = loadGlossCandidates(
    root,
    flag('candidates', 'candidates.jsonl')!,
  );
  const jobFile = flag('job', 'job.json')!;
  const generate = cli.flags.get('generate') === true;
  if (
    cli.apply ||
    cli.flags.has('rollback') ||
    (cli.flags.has('generate') && !generate) ||
    (cli.flags.has('dry-run') && generate)
  )
    throw new Error(
      'Translation only: --generate is explicit and separate from apply/dry-run',
    );
  loadEnv();
  const providerName = flag('provider', 'stub');
  if (providerName !== 'stub' && providerName !== 'opencode-go')
    throw new Error('Provider must be stub or opencode-go');
  const model =
    providerName === 'stub'
      ? 'fixture'
      : (process.env.DB3_AI_MODEL ?? 'muse-spark-1.3-contributor');
  const protocol =
    providerName === 'stub'
      ? 'responses'
      : (process.env.DB3_AI_PROTOCOL ?? 'responses');
  if (protocol !== 'responses' && protocol !== 'chat_completions')
    throw new Error('Invalid protocol');
  if (providerName === 'opencode-go') {
    if ((process.env.DB3_AI_CONCURRENCY ?? '1') !== '1')
      throw new Error('Pilot requires concurrency 1');
    if ((process.env.DB3_AI_REASONING_EFFORT ?? 'minimal') !== 'minimal')
      throw new Error('Pilot requires reasoning effort minimal');
    if (model === 'muse-spark-1.3-contributor' && protocol !== 'responses')
      throw new Error('Muse pilot requires Responses API');
  }
  const numeric = (key: string, fallback: number): number => {
    const value = Number(process.env[key] ?? fallback);
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${key}`);
    return value;
  };
  let job: GlossJob;
  if (existsSync(resolveArtifactPath(root, jobFile)))
    job = parseGlossJob(readArtifactJson(root, jobFile));
  else {
    const inventoryPath = flag('inventory');
    if (!inventoryPath)
      throw new Error(
        'New job requires --inventory <root-relative B0 artifact>',
      );
    const inventoryText = readArtifactText(root, inventoryPath);
    const inventory = z
      .object({
        summary: z.object({
          fingerprint: z.object({
            dataset_digest: z.string(),
            host: z.string(),
            port: z.string(),
            db: z.string(),
          }),
        }),
      })
      .parse(JSON.parse(inventoryText) as unknown);
    const limit = Number(flag('max-targets', '100'));
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new Error('max-targets must be 1..100');
    const selected = selectGlossPilotCandidates(candidates, limit);
    const { artifactHash } = await import('./_gloss-artifacts');
    job = createGlossJob({
      schemaVersion: 1,
      snapshot: {
        datasetFingerprint: inventory.summary.fingerprint.dataset_digest,
        inventory: { path: inventoryPath, sha256: artifactHash(inventoryText) },
        host: inventory.summary.fingerprint.host,
        port: Number(inventory.summary.fingerprint.port),
        database: inventory.summary.fingerprint.db,
      },
      provider: {
        name: providerName,
        baseUrl:
          providerName === 'stub'
            ? 'https://example.org/stub'
            : (process.env.DB3_AI_BASE_URL ?? 'https://opencode.ai/zen/go/v1'),
        protocol,
        model,
        promptVersion: GLOSS_PROMPT_VERSION,
      },
      sessionId: randomUUID(),
      caps: {
        maxRequests: numeric('DB3_AI_MAX_REQUESTS', 100),
        maxTokens: process.env.DB3_AI_MAX_TOKENS
          ? numeric('DB3_AI_MAX_TOKENS', 0)
          : null,
        maxCostUsd:
          providerName === 'stub' ? 0 : numeric('DB3_AI_MAX_COST_USD', 0.05),
        concurrency: 1,
      },
      usage: { attemptCount: 0, tokens: 0, costUsd: 0 },
      entries: selected.map((c) => ({
        candidateKey: c.candidateKey,
        inputHash: c.inputHash,
        state: 'pending',
        attemptCount: 0,
        attempts: [],
        output: null,
        validation: 'pending',
        error: null,
        childRunKey: null,
      })),
      children: [],
    });
  }
  if (
    job.provider.name !== providerName ||
    job.provider.model !== model ||
    job.provider.protocol !== protocol
  )
    throw new Error(
      'Resume provider/model/protocol mismatch; keep existing job configuration',
    );
  let adapter: GlossProvider = createStubGlossProvider({});
  if (providerName === 'stub' && flag('stub-outputs'))
    adapter = createStubGlossProvider(
      z
        .record(z.string().nullable())
        .parse(readArtifactJson(root, flag('stub-outputs')!)),
    );
  if (providerName === 'opencode-go' && generate) {
    // Only the explicitly selected, documented models; no implicit paid fallback.
    const rates =
      model === 'muse-spark-1.3-contributor'
        ? [0.1, 0.2]
        : model === 'space-bunny-free'
          ? [0, 0]
          : null;
    if (!rates) throw new Error('Model has no approved rate policy');
    const apiKey = process.env.DB3_AI_API_KEY ?? '';
    if (!apiKey) throw new Error('Missing DB3_AI_API_KEY');
    adapter = createGoGlossProvider({
      apiKey,
      timeoutMs: numeric('DB3_AI_TIMEOUT_MS', 60000),
      maxOutputTokens: numeric('DB3_AI_MAX_OUTPUT_TOKENS', 1200),
      reasoningEffort: 'minimal',
      inputRatePerMillion: rates[0],
      outputRatePerMillion: rates[1],
    });
  }
  const result = await translateGlossJob({
    artifactDir: root,
    job,
    candidates,
    adapter,
    generate,
    retryUnknown: cli.flags.get('retry-unknown') === true,
    jobFile,
  });
  console.log(
    JSON.stringify({
      dryRun: !generate,
      targets: result.entries.length,
      states: result.entries.reduce<Record<string, number>>(
        (count, e) => ({ ...count, [e.state]: (count[e.state] ?? 0) + 1 }),
        {},
      ),
      usage: result.usage,
    }),
  );
}
if (require.main === module)
  void main().catch(() => {
    console.error(
      'gloss-translate failed; check configuration, schema, budget and durable checkpoint (no secrets logged)',
    );
    process.exitCode = 1;
  });
