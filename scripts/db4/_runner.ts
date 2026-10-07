import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import {
  verifyArtifactBytes,
  type ArtifactRef,
  type MappingProvider,
} from './_mapping-types';
import {
  readBytes,
  resolveArtifact,
  sha256File,
  stablePretty,
  writeTextAtomic,
} from './_artifacts';
import {
  ArtifactRefSchema,
  createMappingReservation,
  jobBudgetUsage,
  mappingCacheKey,
  parseMappingBundleIntegrity,
  parseMappingJob,
  parseMappingJobBound,
  parseMappingOutput,
  parsePilotManifest,
  renderMappingBundle,
  transitionMappingTarget,
  hashJson,
  type MappingBundle,
  DecisionSchema,
  type MappingDecision,
  type MappingJob,
  type MappingOutput,
  type Phase,
  type RenderedMappingBundle,
} from './_mapping-types';

/**
 * D4 runner — scheduler R1/R2 cho một job `mapping-review` (offline-first):
 *  - load + byte-verify bundle/pilot/snapshot refs, bind job (parseMappingJobBound)
 *  - lock per job, checkpoint atomic, attempts append-only
 *  - cache theo mappingCacheKey; reservation/budget theo caps; retry bounded
 *  - response validator luôn gọi parseMappingOutput (không tự Zod parse)
 *  - KHÔNG ghi DB; audit/promote là D5/D6.
 */

export interface ProviderAdapterRequest {
  phase: Phase;
  bundle: MappingBundle;
  rendered: RenderedMappingBundle;
  provider: MappingProvider;
  attemptIndex: number;
}

export interface ProviderAdapter {
  /** Nhãn provenance (ghi log/attempt retryReason), không dùng làm cache key. */
  readonly id: string;
  review(request: ProviderAdapterRequest): Promise<{ raw: unknown }>;
}

export interface RunnerDeps {
  root: string;
  jobRel: string;
  adapter: ProviderAdapter;
  /** Thời điểm tuần tự cho attempt (test inject); mặc định new Date().toISOString(). */
  now?: () => string;
  /** Fixture bundle lồng trong file (fixtures/*.json) — mặc định lấy `.bundle` nếu có. */
  extractBundle?: (value: unknown) => unknown;
  log?: (message: string) => void;
}

export class BudgetExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetExhaustedError';
  }
}

function defaultExtractBundle(value: unknown): unknown {
  if (value !== null && typeof value === 'object' && 'bundle' in value)
    return value.bundle;
  return value;
}

interface LoadedJob {
  job: MappingJob;
  bundles: Map<string, MappingBundle>;
}

export function loadBoundJob(deps: RunnerDeps): LoadedJob {
  const jobBytes = readBytes(deps.root, deps.jobRel);
  const job = parseMappingJob(JSON.parse(jobBytes.toString('utf8')));
  for (const ref of [job.snapshot, job.pilotManifest]) {
    const bytes = readBytes(deps.root, ref.path);
    verifyArtifactBytes(ref, bytes);
  }
  const pilot = parsePilotManifest(
    JSON.parse(readBytes(deps.root, job.pilotManifest.path).toString('utf8')),
  );
  const bundles: MappingBundle[] = [];
  for (const entry of job.entries) {
    const bytes = readBytes(deps.root, entry.bundle.path);
    verifyArtifactBytes(entry.bundle, bytes);
    const parsed: unknown = JSON.parse(bytes.toString('utf8'));
    const value = (deps.extractBundle ?? defaultExtractBundle)(parsed);
    bundles.push(parseMappingBundleIntegrity(value));
  }
  const bound = parseMappingJobBound(job, bundles, pilot);
  return {
    job: bound,
    bundles: new Map(bundles.map((bundle) => [bundle.bundleKey, bundle])),
  };
}

function persistJob(deps: RunnerDeps, job: MappingJob): void {
  writeTextAtomic(deps.root, deps.jobRel, stablePretty(job));
}

interface JobLock {
  release: () => void;
}

export function acquireJobLock(root: string, jobKey: string): JobLock {
  const dirRel = `jobs/${jobKey}`;
  const dirAbs = resolveArtifact(root, dirRel);
  mkdirSync(dirAbs, { recursive: true });
  const lockRel = `${dirRel}/lock`;
  const lockAbs = resolveArtifact(root, lockRel);
  const writeLock = (): void => {
    const fd = openSync(lockAbs, 'w');
    try {
      writeSync(fd, JSON.stringify({ pid: process.pid }));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  };
  if (existsSync(lockAbs)) {
    const holder = JSON.parse(readFileSync(lockAbs, 'utf8')) as {
      pid?: number;
    };
    const alive =
      typeof holder.pid === 'number' &&
      (() => {
        try {
          process.kill(holder.pid, 0);
          return true;
        } catch {
          return false;
        }
      })();
    if (alive)
      throw new Error(`Job đang chạy ở pid ${holder.pid}: ${dirRel}/lock`);
    writeLock();
  } else {
    writeLock();
  }
  return {
    release: () => {
      try {
        unlinkSync(lockAbs);
      } catch {
        // lock đã bị dọn — bỏ qua
      }
    },
  };
}

function nextState(phase: Phase, kind: 'running' | 'received' | 'validated') {
  if (kind === 'running') return phase === 'r1' ? 'r1_running' : 'r2_running';
  if (kind === 'received')
    return phase === 'r1' ? 'r1_received' : 'r2_received';
  return phase === 'r1' ? 'r1_validated' : 'r2_validated';
}

function estimateLimits(
  rendered: RenderedMappingBundle,
  provider: MappingProvider,
  caps: MappingJob['caps'],
) {
  return {
    inputTokens: Math.ceil(rendered.utf8Bytes / 3.5) + 500,
    outputTokens: caps.maxOutputTokens,
    reasoningTokens: provider.reasoningConfig.maxTokens,
  };
}

function stubUsage(reservation: MappingJob['attempts'][number]['reservation']) {
  const tokens = Math.max(1, Math.min(reservation.tokens, 800));
  return { tokens, costMicrousd: 0 };
}

function readOutput(
  root: string,
  ref: ArtifactRef,
  bundle: MappingBundle,
): MappingOutput {
  const bytes = readBytes(root, ref.path);
  verifyArtifactBytes(ref, bytes);
  return parseMappingOutput(JSON.parse(bytes.toString('utf8')), bundle);
}

function proposeDecisions(
  bundle: MappingBundle,
  r1: MappingOutput,
  r2: MappingOutput,
  policyVersion: string,
): MappingDecision[] {
  return bundle.candidates.map((candidate) => {
    const v1 = r1.reviews.find(
      (review) => review.candidateKey === candidate.candidateKey,
    )!;
    const v2 = r2.reviews.find(
      (review) => review.candidateKey === candidate.candidateKey,
    )!;
    const unresolved = r1.unresolvedReason ?? r2.unresolvedReason;
    const base = {
      schemaVersion: 1 as const,
      candidateKey: candidate.candidateKey,
      inputHash: candidate.inputHash,
      outputHashR1: hashJson(r1),
      outputHashR2: hashJson(r2),
      policyVersion,
    };
    const build = (
      proposal: MappingDecision['proposal'],
      relation: MappingDecision['relation'],
      reasons: MappingDecision['reasons'],
    ): MappingDecision => {
      const decision = DecisionSchema.parse({
        ...base,
        proposal,
        relation,
        reasons,
      });
      if (
        decision.outputHashR1 !== base.outputHashR1 ||
        decision.outputHashR2 !== base.outputHashR2 ||
        decision.inputHash !== candidate.inputHash
      )
        throw new Error('Decision lineage mismatch');
      return decision;
    };
    if (unresolved !== null)
      return build('defer', v1.relation, [
        {
          code: 'review_disagreement',
          detail: `unresolved: ${unresolved.code}`,
        },
      ]);
    if (v1.relation !== v2.relation)
      return build('defer', v1.relation, [
        {
          code: 'review_disagreement',
          detail: `R1=${v1.relation} vs R2=${v2.relation}`,
        },
      ]);
    if (v1.relation === 'exact') {
      const exactR1 = r1.reviews.filter(
        (review) => review.relation === 'exact',
      ).length;
      const exactR2 = r2.reviews.filter(
        (review) => review.relation === 'exact',
      ).length;
      if (exactR1 === 1 && exactR2 === 1)
        return build('accept_exact', 'exact', []);
      return build('defer', 'exact', [
        {
          code: 'ambiguous_concepts',
          detail: 'nhiều hơn một exact trong shortlist',
        },
      ]);
    }
    if (
      v1.relation === 'broader' ||
      v1.relation === 'narrower' ||
      v1.relation === 'related'
    )
      return build('accept_nonexact', v1.relation, []);
    return build('reject_pair', 'none', []);
  });
}

const TERMINAL_STATES = [
  'blocked',
  'rejected',
  'deferred',
  'error',
  'stale',
] as const;

function replaceAttempt(
  attempts: MappingJob['attempts'],
  index: number,
  value: MappingJob['attempts'][number],
): MappingJob['attempts'] {
  const next = [...attempts];
  next[index - 1] = value;
  return next;
}

/** Phục hồi crash: response đã durable thì validate lại, không dispatch thêm. */
function recoverTargetPhase(
  deps: RunnerDeps,
  job: MappingJob,
  bundle: MappingBundle,
  targetKey: string,
  phase: Phase,
  now: () => string,
  log: (message: string) => void,
): MappingJob {
  const entry = job.entries.find((item) => item.targetKey === targetKey)!;
  const running = nextState(phase, 'running');
  const received = nextState(phase, 'received');
  if (entry.state !== running && entry.state !== received) return job;
  const phaseAttempts = job.attempts.filter(
    (attempt) => attempt.targetKey === targetKey && attempt.phase === phase,
  );
  const last = phaseAttempts.at(-1);
  if (!last) return job;
  if (last.outcome === 'in_flight') {
    const rawRel = `responses/${job.jobKey}/${phase}/${bundle.bundleKey}/${last.index}.raw.json`;
    if (existsSync(resolveArtifact(deps.root, rawRel))) {
      const rawRef: ArtifactRef = {
        path: rawRel,
        sha256: sha256File(resolveArtifact(deps.root, rawRel)),
      };
      const raw: unknown = JSON.parse(
        readFileSync(resolveArtifact(deps.root, rawRel), 'utf8'),
      );
      const output = parseMappingOutput(raw, bundle);
      const outRef = writeTextAtomic(
        deps.root,
        rawRel.replace(/\.raw\.json$/, '.validated.json'),
        stablePretty(output),
      );
      const finished = {
        ...last,
        finishedAt: now(),
        outcome: 'response' as const,
        rawResponse: rawRef,
        validatedOutput: outRef,
        actualUsage: stubUsage(last.reservation),
      };
      let next = transitionMappingTarget(job, targetKey, received, {
        attempts: replaceAttempt(job.attempts, last.index, finished),
      });
      next = transitionMappingTarget(
        next,
        targetKey,
        nextState(phase, 'validated'),
      );
      persistJob(deps, next);
      log(`recovered ${phase} ${targetKey.slice(0, 12)} từ response durable`);
      return next;
    }
    const unknown = {
      ...last,
      finishedAt: now(),
      outcome: 'unknown' as const,
    };
    const next = transitionMappingTarget(job, targetKey, 'error', {
      attempts: replaceAttempt(job.attempts, last.index, unknown),
      artifacts: {
        reason: 'unknown dispatch (crash trước khi có response durable)',
      },
    });
    persistJob(deps, next);
    return next;
  }
  if (
    entry.state === received &&
    last.outcome === 'response' &&
    last.rawResponse &&
    !last.validatedOutput
  ) {
    const raw: unknown = JSON.parse(
      readBytes(deps.root, last.rawResponse.path).toString('utf8'),
    );
    const output = parseMappingOutput(raw, bundle);
    const outRef = writeTextAtomic(
      deps.root,
      `responses/${job.jobKey}/${phase}/${bundle.bundleKey}/${last.index}.validated.json`,
      stablePretty(output),
    );
    const done = { ...last, validatedOutput: outRef };
    const next = transitionMappingTarget(
      job,
      targetKey,
      nextState(phase, 'validated'),
      {
        attempts: replaceAttempt(job.attempts, last.index, done),
      },
    );
    persistJob(deps, next);
    log(`validated lại ${phase} ${targetKey.slice(0, 12)} từ raw đã lưu`);
    return next;
  }
  if (
    entry.state === received &&
    last.outcome === 'response' &&
    last.validatedOutput
  ) {
    const next = transitionMappingTarget(
      job,
      targetKey,
      nextState(phase, 'validated'),
    );
    persistJob(deps, next);
    return next;
  }
  return job;
}

const RESUMABLE_STATES = [
  'queued',
  'r1_running',
  'r1_received',
  'r1_validated',
  'r2_running',
  'r2_received',
] as const;

export async function runJob(deps: RunnerDeps): Promise<MappingJob> {
  const log = deps.log ?? (() => undefined);
  const now = deps.now ?? (() => new Date().toISOString());
  const loaded = loadBoundJob(deps);
  let job = loaded.job;
  const lock = acquireJobLock(deps.root, job.jobKey);
  try {
    if (job.status === 'prepared') {
      job = parseMappingJob({ ...job, status: 'running' });
      persistJob(deps, job);
    }
    outer: for (const entry of job.entries) {
      if (!(RESUMABLE_STATES as readonly string[]).includes(entry.state))
        continue;
      const bundle = loaded.bundles.get(entry.bundleKey)!;
      for (const phase of ['r1', 'r2'] as const) {
        job = recoverTargetPhase(
          deps,
          job,
          bundle,
          entry.targetKey,
          phase,
          now,
          log,
        );
        let currentEntry = job.entries.find(
          (item) => item.targetKey === entry.targetKey,
        )!;
        if ((TERMINAL_STATES as readonly string[]).includes(currentEntry.state))
          break;
        if (currentEntry.state === nextState(phase, 'validated')) continue;
        try {
          job = await runPhase(
            deps,
            job,
            bundle,
            entry.targetKey,
            phase,
            now,
            log,
          );
        } catch (error) {
          if (error instanceof BudgetExhaustedError) {
            job = parseMappingJob({ ...job, status: 'budget_exhausted' });
            persistJob(deps, job);
            log(`budget exhausted: ${error.message}`);
            break outer;
          }
          throw error;
        }
        currentEntry = job.entries.find(
          (item) => item.targetKey === entry.targetKey,
        )!;
        if ((TERMINAL_STATES as readonly string[]).includes(currentEntry.state))
          break;
      }
      const after = job.entries.find(
        (item) => item.targetKey === entry.targetKey,
      )!;
      if (after.state === 'r2_validated') {
        const r1Ref = job.attempts
          .filter(
            (a) =>
              a.targetKey === entry.targetKey &&
              a.phase === 'r1' &&
              a.validatedOutput,
          )
          .at(-1)!.validatedOutput!;
        const r2Ref = job.attempts
          .filter(
            (a) =>
              a.targetKey === entry.targetKey &&
              a.phase === 'r2' &&
              a.validatedOutput,
          )
          .at(-1)!.validatedOutput!;
        const r1 = readOutput(deps.root, r1Ref, bundle);
        const r2 = readOutput(deps.root, r2Ref, bundle);
        const decisions = proposeDecisions(
          bundle,
          r1,
          r2,
          job.policyVersions.decision,
        );
        const decisionRef = writeTextAtomic(
          deps.root,
          `decisions/${job.jobKey}/${entry.targetKey}.json`,
          stablePretty({
            schemaVersion: 1,
            targetKey: entry.targetKey,
            decisions,
          }),
        );
        job = transitionMappingTarget(job, entry.targetKey, 'decision_ready', {
          artifacts: { decision: decisionRef },
        });
        persistJob(deps, job);
        const accepted = decisions.filter((d) =>
          d.proposal.startsWith('accept'),
        ).length;
        log(
          `decision ${entry.targetKey.slice(0, 12)}: ${decisions.length} pair, accept ${accepted}, ${decisions.filter((d) => d.proposal === 'defer').length} defer`,
        );
      }
    }
    if (
      job.entries.every((entry) =>
        [
          'decision_ready',
          'awaiting_audit',
          'eligible',
          'imported',
          'promoted',
        ].includes(entry.state),
      )
    ) {
      job = parseMappingJob({ ...job, status: 'awaiting_audit' });
      persistJob(deps, job);
    }
    return job;
  } finally {
    lock.release();
  }
}

async function runPhase(
  deps: RunnerDeps,
  job: MappingJob,
  bundle: MappingBundle,
  targetKey: string,
  phase: Phase,
  now: () => string,
  log: (message: string) => void,
): Promise<MappingJob> {
  const provider = job.providers[phase];
  const rendered = renderMappingBundle(
    bundle,
    phase,
    job.seed,
    provider.promptVersion,
  );
  const cacheKey = mappingCacheKey(
    provider,
    phase,
    rendered.renderedContextHash,
  );
  const cacheRel = `cache/${provider.provider}/${phase}/${cacheKey}.json`;
  const cacheAbs = resolveArtifact(deps.root, cacheRel);

  if (existsSync(cacheAbs)) {
    const cacheRef: ArtifactRef = {
      path: cacheRel,
      sha256: sha256File(cacheAbs),
    };
    const cached = JSON.parse(readFileSync(cacheAbs, 'utf8')) as {
      output?: unknown;
      raw?: unknown;
    };
    if (cached.output === undefined || cached.raw === undefined)
      throw new Error(`Cache thiếu ref raw/output: ${cacheRel}`);
    const outputRef: ArtifactRef = ArtifactRefSchema.parse(cached.output);
    const rawRefCached: ArtifactRef = ArtifactRefSchema.parse(cached.raw);
    const outputBytes = readBytes(deps.root, outputRef.path);
    verifyArtifactBytes(outputRef, outputBytes);
    parseMappingOutput(JSON.parse(outputBytes.toString('utf8')), bundle);
    const attempt = {
      index: job.attempts.length + 1,
      phase,
      kind: 'cache' as const,
      cacheOrigin: cacheRef,
      targetKey,
      renderedContextHash: rendered.renderedContextHash,
      cacheKey,
      startedAt: now(),
      finishedAt: now(),
      outcome: 'response' as const,
      retryReason: null,
      reservation: {
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        tokens: 0,
        costMicrousd: 0,
      },
      actualUsage: { tokens: 0, costMicrousd: 0 },
      rawResponse: rawRefCached,
      validatedOutput: outputRef,
    };
    let next = transitionMappingTarget(
      job,
      targetKey,
      nextState(phase, 'received'),
      {
        attempts: [...job.attempts, attempt],
      },
    );
    next = transitionMappingTarget(
      next,
      targetKey,
      nextState(phase, 'validated'),
    );
    persistJob(deps, next);
    log(`cache hit ${phase} ${targetKey.slice(0, 12)}`);
    return next;
  }

  const budget = jobBudgetUsage(job);
  const reservation = createMappingReservation(
    provider,
    estimateLimits(rendered, provider, job.caps),
  );
  if (
    budget.requests + 1 > job.caps.maxRequests ||
    budget.tokens + reservation.tokens > job.caps.maxTokens ||
    budget.costMicrousd + reservation.costMicrousd > job.caps.maxCostMicrousd
  )
    throw new BudgetExhaustedError(
      `requests=${budget.requests + 1}/${job.caps.maxRequests} tokens=${budget.tokens + reservation.tokens}/${job.caps.maxTokens} cost=${budget.costMicrousd + reservation.costMicrousd}/${job.caps.maxCostMicrousd}`,
    );

  const index = job.attempts.length + 1;
  const startedAt = now();
  const baseAttempt = {
    index,
    phase,
    kind: 'review' as const,
    cacheOrigin: null,
    targetKey,
    renderedContextHash: rendered.renderedContextHash,
    cacheKey,
    startedAt,
    finishedAt: null,
    outcome: 'in_flight' as const,
    retryReason: null,
    reservation,
    actualUsage: null,
    rawResponse: null,
    validatedOutput: null,
  };
  let current = transitionMappingTarget(
    job,
    targetKey,
    nextState(phase, 'running'),
    {
      attempts: [...job.attempts, baseAttempt],
    },
  );
  persistJob(deps, current);

  let attempt: MappingJob['attempts'][number] = baseAttempt;
  let rawValue: unknown = null;
  const validationError = (output: unknown): string | null => {
    try {
      parseMappingOutput(output, bundle);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };
  dispatchLoop: for (;;) {
    let message: string;
    try {
      const { raw } = await deps.adapter.review({
        phase,
        bundle,
        rendered,
        provider,
        attemptIndex: attempt.index,
      });
      const invalid = validationError(raw);
      if (invalid === null) {
        rawValue = raw;
        break dispatchLoop;
      }
      message = `schema: ${invalid}`;
    } catch (error) {
      message = `adapter: ${error instanceof Error ? error.message : String(error)}`;
    }
    const failedAttempt = {
      ...attempt,
      finishedAt: now(),
      outcome: 'failed' as const,
    };
    const settled =
      current.attempts.filter(
        (a) =>
          a.targetKey === targetKey &&
          a.phase === phase &&
          a.outcome !== 'in_flight',
      ).length + 1;
    if (settled < 1 + job.caps.maxRetries) {
      attempt = {
        ...attempt,
        index: current.attempts.length + 1,
        startedAt: now(),
        retryReason: message,
      };
      current = transitionMappingTarget(
        current,
        targetKey,
        nextState(phase, 'running'),
        {
          attempts: [...current.attempts.slice(0, -1), failedAttempt, attempt],
        },
      );
      persistJob(deps, current);
      log(`retry ${phase} ${targetKey.slice(0, 12)}: ${message}`);
      continue;
    }
    current = transitionMappingTarget(current, targetKey, 'error', {
      attempts: [...current.attempts.slice(0, -1), failedAttempt],
      artifacts: {
        reason: message.startsWith('schema')
          ? `schema lỗi: ${message.slice('schema: '.length)}`
          : `adapter lỗi: ${message.slice('adapter: '.length)}`,
      },
    });
    persistJob(deps, current);
    return current;
  }

  const rawRel = `responses/${job.jobKey}/${phase}/${bundle.bundleKey}/${attempt.index}.raw.json`;
  const rawRef = writeTextAtomic(deps.root, rawRel, stablePretty(rawValue));
  const outRel = `responses/${job.jobKey}/${phase}/${bundle.bundleKey}/${attempt.index}.validated.json`;
  const outRef = writeTextAtomic(deps.root, outRel, stablePretty(rawValue));
  const responseAttempt = {
    ...attempt,
    finishedAt: now(),
    outcome: 'response' as const,
    rawResponse: rawRef,
    validatedOutput: outRef,
    actualUsage: stubUsage(reservation),
  };
  current = transitionMappingTarget(
    current,
    targetKey,
    nextState(phase, 'received'),
    {
      attempts: [...current.attempts.slice(0, -1), responseAttempt],
    },
  );
  persistJob(deps, current);
  current = transitionMappingTarget(
    current,
    targetKey,
    nextState(phase, 'validated'),
  );
  persistJob(deps, current);
  writeTextAtomic(
    deps.root,
    cacheRel,
    stablePretty({
      schemaVersion: 1,
      provider: provider.provider,
      model: provider.model,
      phase,
      renderedContextHash: rendered.renderedContextHash,
      cacheKey,
      raw: rawRef,
      output: outRef,
    }),
  );
  log(`done ${phase} ${targetKey.slice(0, 12)} (request ${index})`);
  return current;
}

/** Stub adapter: output soạn sẵn theo renderedContextHash, hoặc all-`none` mặc định (smoke). */
export interface StubAdapterOptions {
  outputs?: Map<string, unknown>;
  id?: string;
}

export function defaultStubOutput(
  bundleValue: MappingBundle,
  phase: Phase,
): MappingOutput {
  const bundle = parseMappingBundleIntegrity(bundleValue);
  return parseMappingOutput(
    {
      schemaVersion: 1,
      task: 'sense_concept_review',
      bundleKey: bundle.bundleKey,
      senseId: bundle.sense.id,
      contextHash: bundle.contextHash,
      reviews: bundle.candidates.map((candidate) => ({
        candidateKey: candidate.candidateKey,
        conceptId: candidate.concept.id,
        relation: 'none',
        coveredBranches: [],
        missingBranches: [...bundle.sourceBranches],
        conflicts: [],
        reason: `stub ${phase}: chưa xác nhận được liên hệ`,
        confidence: null,
      })),
      noSuitableCandidate: true,
      unresolvedReason: null,
    },
    bundle,
  );
}

export function createStubAdapter(
  options: StubAdapterOptions = {},
): ProviderAdapter {
  return {
    id: options.id ?? 'stub',
    review: ({ bundle, rendered, phase }) => {
      const scripted = options.outputs?.get(rendered.renderedContextHash);
      if (scripted !== undefined) return Promise.resolve({ raw: scripted });
      if (options.outputs)
        throw new Error(
          `Stub thiếu output cho renderedContextHash ${rendered.renderedContextHash}`,
        );
      return Promise.resolve({ raw: defaultStubOutput(bundle, phase) });
    },
  };
}
