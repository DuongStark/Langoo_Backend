import { z } from 'zod';
import { readBytes, stablePretty, writeTextAtomic } from './_artifacts';
import {
  DecisionSchema,
  Sha256Schema,
  evaluateMappingGate,
  hashJson,
  jobBudgetUsage,
  parseMappingAudit,
  parseMappingOutput,
  parsePilotManifest,
  verifyArtifactBytes,
  type ArtifactRef,
  type MappingBundle,
  type MappingDecision,
  type MappingJob,
  type MappingOutput,
} from './_mapping-types';
import { parseMappingCli } from './_cli';
import { callChatCompletion, extractJsonObject } from './_adapter_openai';
import { createStubAdapter, loadBoundJob } from './_runner';

/**
 * `mapping-audit` (D5) — audit từng target của job theo rubric plan §12.2:
 *  - packet deterministic từ bundle + R1/R2 validated output + decision
 *  - reviewer LLM (env DB4_AUDIT_*; mặc định cùng endpoint free) → verdict/severity/reason
 *  - mỗi candidate 1 record `parseMappingAudit`-valid; tổng hợp target verdict + gate draft
 *  - env: DB4_AUDIT_LIMIT (smoke), DB4_AUDIT_DRY=1 (chỉ ghi packet), DB4_AUDIT_REASONING=none|minimal
 *  - KHÔNG ghi DB.
 */

const DecisionFileSchema = z.object({
  schemaVersion: z.literal(1),
  targetKey: Sha256Schema,
  decisions: z.array(DecisionSchema),
});

const ReviewerItemSchema = z.object({
  index: z.number().int().min(1),
  verdict: z.enum(['pass', 'fail', 'deferred']),
  severity: z.enum(['none', 'minor', 'severe']),
  reason: z.string().min(1).max(4000),
  suggested: z
    .enum(['accept_exact', 'accept_nonexact', 'reject_pair', 'defer'])
    .nullable(),
});

const ReviewerResponseSchema = z.object({
  audits: z.array(ReviewerItemSchema),
});

export interface AuditPacket {
  lemma: string;
  reading: string | null;
  jlptLevel: number | null;
  isPrimary: boolean;
  normalizedPos: string[];
  glosses: { key: string; text: string }[];
  definitions: { key: string; text: string }[];
  sourceBranches: string[];
  candidates: {
    index: number;
    conceptId: string;
    definitions: string[];
    labels: string[];
  }[];
  passR1: { index: number; relation: string; reason: string }[];
  passR2: { index: number; relation: string; reason: string }[];
  proposal: { index: number; proposal: string; relation: string }[];
}

const AUDIT_RULES = [
  'You audit a Japanese dictionary sense -> WordNet concept mapping. For EACH candidate index 1..N, judge the mapping decision against the sense glosses/definitions and the concept definitions/labels.',
  'Rubric:',
  '- severe: exact claimed on a wrong meaning/sense, broader/narrower claimed exact, wrong identity, branches from another sense, or promoting unverifiable source.',
  '- minor: verdict/link is right but reasoning/branch qualifier is unclear or incomplete.',
  '- none: correct identity/source, relations (exact/broader/narrower/related/none/uncertain) are appropriate, branch coverage complete.',
  'Relations: exact = identical meaning scope; broader = sense broader than concept; narrower = sense narrower than concept; related = associated not equivalent; none = wrong concept; uncertain = insufficient evidence.',
  'Final proposals: accept_exact (promote exact), accept_nonexact (promote broader/narrower/related), reject_pair (no link), defer (needs review).',
  'Output ONLY one JSON object, no markdown: {"audits":[{"index":1,"verdict":"pass|fail|deferred","severity":"none|minor|severe","reason":"<=300 chars English","suggested":null|"accept_exact"|"accept_nonexact"|"reject_pair"|"defer"}]}',
  'Exactly one entry per candidate, same index values as the input, in order. "suggested" is null when you agree with the proposal, otherwise the proposal you would make.',
].join('\n');

export function buildAuditPrompt(packet: AuditPacket): {
  system: string;
  user: string;
} {
  return { system: AUDIT_RULES, user: JSON.stringify(packet) };
}

export function parseAuditResponse(
  value: unknown,
  candidateCount: number,
): z.infer<typeof ReviewerItemSchema>[] {
  const response = ReviewerResponseSchema.parse(value);
  if (response.audits.length !== candidateCount)
    throw new Error(
      `Reviewer trả ${response.audits.length}/${candidateCount} audit entry`,
    );
  const seen = new Set<number>();
  for (const item of response.audits) {
    if (item.index < 1 || item.index > candidateCount)
      throw new Error(`Reviewer index ngoài phạm vi: ${item.index}`);
    if (seen.has(item.index))
      throw new Error(`Reviewer index trùng: ${item.index}`);
    seen.add(item.index);
  }
  return [...response.audits].sort((a, b) => a.index - b.index);
}

export function aggregateTargetVerdict(
  audits: {
    verdict: 'pass' | 'fail' | 'deferred';
    severity: 'none' | 'minor' | 'severe';
  }[],
): {
  verdict: 'pass' | 'fail' | 'deferred';
  severity: 'none' | 'minor' | 'severe';
} {
  const order = { none: 0, minor: 1, severe: 2 } as const;
  const severity = audits.reduce<'none' | 'minor' | 'severe'>(
    (max, audit) => (order[audit.severity] > order[max] ? audit.severity : max),
    'none',
  );
  if (audits.some((audit) => audit.verdict === 'fail'))
    return { verdict: 'fail', severity };
  if (audits.some((audit) => audit.verdict === 'deferred'))
    return { verdict: 'deferred', severity };
  return { verdict: 'pass', severity };
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function readPhaseOutput(
  root: string,
  job: MappingJob,
  targetKey: string,
  phase: 'r1' | 'r2',
  bundle: MappingBundle,
): MappingOutput {
  const attempt = job.attempts
    .filter(
      (item) =>
        item.targetKey === targetKey &&
        item.phase === phase &&
        item.validatedOutput,
    )
    .at(-1);
  if (!attempt?.validatedOutput)
    throw new Error(`Thiếu ${phase} validated cho ${targetKey.slice(0, 12)}`);
  const bytes = readBytes(root, attempt.validatedOutput.path);
  verifyArtifactBytes(attempt.validatedOutput, bytes);
  return parseMappingOutput(JSON.parse(bytes.toString('utf8')), bundle);
}

function buildPacket(
  bundle: MappingBundle,
  r1: MappingOutput,
  r2: MappingOutput,
  decisions: MappingDecision[],
): AuditPacket {
  const indexOf = new Map(
    bundle.candidates.map((candidate, index) => [
      candidate.candidateKey,
      index + 1,
    ]),
  );
  const verdicts = (output: MappingOutput): AuditPacket['passR1'] =>
    output.reviews
      .filter((review) => indexOf.has(review.candidateKey))
      .map((review) => ({
        index: indexOf.get(review.candidateKey)!,
        relation: review.relation,
        reason: truncate(review.reason, 300),
      }))
      .sort((a, b) => a.index - b.index);
  return {
    lemma: bundle.sense.lemma,
    reading: bundle.sense.reading,
    jlptLevel: bundle.sense.jlptLevel,
    isPrimary: bundle.sense.isPrimary,
    normalizedPos: bundle.senseContext.metadata.normalizedPos,
    glosses: bundle.senseContext.enGlosses.map((row) => ({
      key: row.key,
      text: row.text,
    })),
    definitions: bundle.senseContext.definitions.map((row) => ({
      key: row.key,
      text: row.text,
    })),
    sourceBranches: bundle.sourceBranches,
    candidates: bundle.candidates.map((candidate, index) => ({
      index: index + 1,
      conceptId: candidate.concept.id ?? '',
      definitions: candidate.conceptContext.definitions.map((row) =>
        truncate(row.text, 240),
      ),
      labels: candidate.conceptContext.labels.map((row) => row.text),
    })),
    passR1: verdicts(r1),
    passR2: verdicts(r2),
    proposal: decisions
      .map((decision) => ({
        index: indexOf.get(decision.candidateKey) ?? -1,
        proposal: decision.proposal,
        relation: decision.relation,
      }))
      .filter((row) => row.index > 0)
      .sort((a, b) => a.index - b.index),
  };
}

interface ReviewerRuntime {
  endpoint: string;
  apiKey: string;
  model: string;
  sessionId: string;
  timeoutMs: number;
  extraBody: Record<string, unknown>;
}

function reviewerFromEnv(): ReviewerRuntime {
  const endpoint =
    process.env.DB4_AUDIT_ENDPOINT ?? process.env.DB4_PROVIDER_ENDPOINT;
  const apiKey =
    process.env.DB4_AUDIT_API_KEY ?? process.env.DB4_PROVIDER_API_KEY;
  const model = process.env.DB4_AUDIT_MODEL ?? process.env.DB4_PROVIDER_MODEL;
  if (!endpoint || !apiKey || !model)
    throw new Error(
      'Cần DB4_AUDIT_ENDPOINT/MODEL/API_KEY (hoặc DB4_PROVIDER_*) cho reviewer',
    );
  const slug = model.toLowerCase().replace(/[^a-z0-9.-]+/g, '-');
  const thinking = process.env.DB4_AUDIT_THINKING ?? 'off';
  const reasoning = process.env.DB4_AUDIT_REASONING ?? 'minimal';
  const extraBody =
    thinking === 'off'
      ? { thinking: { type: 'disabled' } }
      : { reasoning_effort: reasoning };
  return {
    endpoint,
    apiKey,
    model,
    sessionId: process.env.DB4_AUDIT_SESSION ?? `db4-audit-${slug}`,
    timeoutMs: 240_000,
    extraBody,
  };
}

interface TargetAuditResult {
  targetKey: string;
  verdict: 'pass' | 'fail' | 'deferred';
  severity: 'none' | 'minor' | 'severe';
  auditRef: ArtifactRef;
  audits: ReturnType<typeof parseMappingAudit>[];
  usageTokens: number;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const started = Date.now();
  const cli = parseMappingCli('mapping-audit', argv);
  const root = cli.artifactDir;
  const jobRel = String(cli.flags.job);
  const limit = process.env.DB4_AUDIT_LIMIT
    ? Number(process.env.DB4_AUDIT_LIMIT)
    : null;
  const dry = process.env.DB4_AUDIT_DRY === '1';
  if (limit !== null && (!Number.isSafeInteger(limit) || limit < 1))
    throw new Error('DB4_AUDIT_LIMIT không hợp lệ');

  const loaded = loadBoundJob({
    root,
    jobRel,
    adapter: createStubAdapter(),
  });
  const job = loaded.job;
  const bundles = loaded.bundles;
  const pilot = parsePilotManifest(
    JSON.parse(readBytes(root, job.pilotManifest.path).toString('utf8')),
  );
  const entries = limit === null ? job.entries : job.entries.slice(0, limit);
  const reviewer = dry ? null : reviewerFromEnv();
  const tokenUsage = { tokens: 0, costMicrousd: 0 };

  const results: TargetAuditResult[] = [];
  const failures: { targetKey: string; error: string }[] = [];
  const packets: unknown[] = [];

  for (const entry of entries) {
    const bundle = bundles.get(entry.bundleKey);
    if (!bundle)
      throw new Error(`Thiếu bundle ${entry.bundleKey.slice(0, 12)}`);
    const decisionsRef: ArtifactRef =
      entry.decision ?? throwMissing(entry.targetKey);
    const decisionBytes = readBytes(root, decisionsRef.path);
    verifyArtifactBytes(decisionsRef, decisionBytes);
    const decisionFile = DecisionFileSchema.parse(
      JSON.parse(decisionBytes.toString('utf8')),
    );
    const r1 = readPhaseOutput(root, job, entry.targetKey, 'r1', bundle);
    const r2 = readPhaseOutput(root, job, entry.targetKey, 'r2', bundle);
    const packet = buildPacket(bundle, r1, r2, decisionFile.decisions);
    if (dry) {
      packets.push({ targetKey: entry.targetKey, packet });
      continue;
    }
    for (const decision of decisionFile.decisions) {
      if (
        decision.outputHashR1 !== hashJson(r1) ||
        decision.outputHashR2 !== hashJson(r2)
      )
        throw new Error(`Decision lineage lệch output: ${entry.targetKey}`);
    }
    try {
      const prompt = buildAuditPrompt(packet);
      const completion = await callChatCompletion(
        {
          endpoint: reviewer!.endpoint,
          apiKey: reviewer!.apiKey,
          model: reviewer!.model,
          sessionId: reviewer!.sessionId,
          maxTokens: 2400,
          timeoutMs: reviewer!.timeoutMs,
          extraBody: reviewer!.extraBody,
        },
        {
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
          maxTokens: 2400,
        },
      );
      tokenUsage.tokens += completion.usage.totalTokens;
      const items = parseAuditResponse(
        extractJsonObject(completion.content),
        bundle.candidates.length,
      );
      const reviewedAt = new Date().toISOString();
      const audits = items.map((item) => {
        const decision = decisionFile.decisions.find(
          (candidate) =>
            candidate.candidateKey ===
            bundle.candidates[item.index - 1].candidateKey,
        );
        if (!decision)
          throw new Error(`Thiếu decision cho index ${item.index}`);
        return parseMappingAudit(
          {
            schemaVersion: 1,
            candidateKey: decision.candidateKey,
            inputHash: decision.inputHash,
            outputHashR1: decision.outputHashR1,
            outputHashR2: decision.outputHashR2,
            decisionHash: hashJson(decision),
            reviewerKind: 'llm',
            reviewerId: reviewer!.model,
            reviewerSession: reviewer!.sessionId,
            reviewedAt,
            verdict: item.verdict,
            severity: item.severity,
            reason: item.reason,
            suggestedDecision: item.suggested,
          },
          decision,
        );
      });
      const aggregate = aggregateTargetVerdict(audits);
      const auditRef = writeTextAtomic(
        root,
        `audits/${job.jobKey}/${entry.targetKey}.json`,
        stablePretty({
          schemaVersion: 1,
          targetKey: entry.targetKey,
          reviewer: {
            model: reviewer!.model,
            session: reviewer!.sessionId,
            packet,
          },
          audits,
        }),
      );
      results.push({
        targetKey: entry.targetKey,
        verdict: aggregate.verdict,
        severity: aggregate.severity,
        auditRef,
        audits,
        usageTokens: completion.usage.totalTokens,
      });
    } catch (error) {
      failures.push({
        targetKey: entry.targetKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (dry) {
    const ref = writeTextAtomic(
      root,
      `audits/${job.jobKey}/packets.jsonl`,
      packets.map((row) => JSON.stringify(row)).join('\n') + '\n',
    );
    console.log(`== DB4 mapping-audit (dry) ==`);
    console.log(`  packets: ${packets.length} → ${ref.path}`);
    return;
  }

  const counts = {
    pass: results.filter((result) => result.verdict === 'pass').length,
    fail: results.filter((result) => result.verdict === 'fail').length,
    deferred: results.filter((result) => result.verdict === 'deferred').length,
    severe: results.filter((result) => result.severity === 'severe').length,
    minor: results.filter((result) => result.severity === 'minor').length,
  };
  const usage = jobBudgetUsage(job);
  const budgetWithinCaps =
    usage.requests <= job.caps.maxRequests &&
    usage.tokens <= job.caps.maxTokens &&
    usage.costMicrousd <= job.caps.maxCostMicrousd;
  const budgetRef = writeTextAtomic(
    root,
    `reports/pilot-a-budget-${job.jobKey.slice(0, 12)}.json`,
    stablePretty({
      schemaVersion: 1,
      jobKey: job.jobKey,
      usage,
      caps: job.caps,
      budgetWithinCaps,
      unknownRequests: usage.unknownRequests,
    }),
  );
  const reportRef = writeTextAtomic(
    root,
    `reports/pilot-a-audit-${job.jobKey.slice(0, 12)}.json`,
    stablePretty({
      schemaVersion: 1,
      kind: 'db4-pilot-audit',
      jobKey: job.jobKey,
      jobRel,
      auditedTargets: results.length,
      requestedTargets: entries.length,
      counts,
      reviewer: reviewer
        ? {
            model: reviewer.model,
            session: reviewer.sessionId,
            tokens: tokenUsage.tokens,
          }
        : null,
      failures,
      targets: results.map((result) => ({
        targetKey: result.targetKey,
        verdict: result.verdict,
        severity: result.severity,
        audit: result.auditRef,
        tokens: result.usageTokens,
      })),
      seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
    }),
  );

  let gateSummary: { eligible: boolean; reasons: string[] } | null = null;
  if (failures.length === 0 && results.length === pilot.targetKeys.length) {
    const gateValue = {
      schemaVersion: 1,
      pilotManifestHash: hashJson(pilot),
      policyVersion: pilot.policyVersion,
      report: reportRef,
      budgetReport: budgetRef,
      targetAudits: results.map((result) => ({
        targetKey: result.targetKey,
        verdict: result.verdict,
        severity: result.severity,
        audit: result.auditRef,
        twoPassValidated: true,
        noCandidatesAudited: false,
        proposalAudited: true,
      })),
      budgetWithinCaps,
      unknownRequests: usage.unknownRequests,
    };
    writeTextAtomic(root, `gates/${job.jobKey}.json`, stablePretty(gateValue));
    const evaluation = evaluateMappingGate(pilot, gateValue);
    gateSummary = {
      eligible: evaluation.eligible,
      reasons: evaluation.reasons,
    };
  }

  console.log('== DB4 mapping-audit ==');
  console.log(
    `  target: ${results.length}/${entries.length} | pass ${counts.pass} | fail ${counts.fail} | deferred ${counts.deferred} | severe ${counts.severe} | minor ${counts.minor}`,
  );
  console.log(
    `  reviewer: ${reviewer!.model} (${reviewer!.sessionId}) | tokens ${tokenUsage.tokens}`,
  );
  if (failures.length)
    console.log(`  lỗi ${failures.length}: ${failures[0].error.slice(0, 120)}`);
  if (gateSummary)
    console.log(
      `  gate: ${gateSummary.eligible ? 'ELIGIBLE' : 'CHƯA ĐỦ'} ${gateSummary.reasons.join(',')}`,
    );
  console.log(`  report: ${reportRef.path}`);
  console.log(`  xong trong ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

function throwMissing(targetKey: string): never {
  throw new Error(`Target chưa có decision: ${targetKey}`);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(
      `mapping-audit: LỖI — ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
