import { existsSync } from 'node:fs';
import { parseCli, log, loadEnv } from './_shared';
import {
  readArtifactJson,
  resolveArtifactPath,
  writeArtifactJson,
  withArtifactLock,
} from './_gloss-artifacts';
import {
  parseGlossJob,
  parseGlossReview,
  hashGlossOutput,
  validateGlossJobCandidates,
  type GlossCandidate,
  type GlossJob,
  type GlossReview,
} from './_gloss-types';
import { loadGlossCandidates } from './gloss-translate';

/**
 * DB3-B — auto-judge batch bằng model phụ (mặc định space-bunny-free).
 *
 * Với mỗi job đã có đủ output, gọi model chấm từng gloss theo rubric, ghi
 * `reviews/<jobKey>-review.json` (đúng schema) + `-judge-details.json`.
 * Không apply; việc apply do runner/daemon riêng quyết định theo gate.
 *
 * An toàn:
 *  - Bỏ qua job thiếu output (null/rejected) vì gate apply yêu cầu đủ 100.
 *  - Cache verdict theo `judge/<jobKey>/<candidateKey>.json` để resume.
 *  - Không ghi đè review đã tồn tại (ưu tiên review người/GPT).
 */

const JUDGE_PROMPT =
  'You are a strict but calibrated bilingual lexicographer reviewing ONE machine-generated Vietnamese gloss for language learners.\n' +
  'The input gives a single Japanese dictionary sense: its EN gloss list (synonyms AND distinct usage branches of the SAME sense) and a VI gloss to review.\n' +
  'Check: 1) Does the VI gloss convey the CORE meaning of this sense correctly (most important)? ' +
  '2) Does it avoid meanings that belong to another sense of the same word? ' +
  '3) Does it respect POS/register/participants where relevant? ' +
  '4) Are important secondary branches reasonably covered (secondary branches may be summarized or omitted when the core is right)?\n' +
  'Severity calibration — be precise, do not over-flag:\n' +
  '- severe: core meaning wrong, contradictory, misleading, replaced by another sense, or the main meaning missing entirely. ' +
  'Cross-sense contamination is severe: a VI item that actually belongs to a DIFFERENT sense of the same word, ' +
  'e.g. EN "direction|way" VI "hướng, cách thức" -> fail/severe (cách thức = method, another sense). ' +
  'Example: EN "thin|slender|fine" VI "mỏng, mảnh, thon" -> fail/severe (mỏng is thickness, wrong dimension).\n' +
  '- minor: core meaning correct but wording is unnatural, or a secondary sub-branch/nuance is missing or imprecise. ' +
  'Example: EN "question (e.g. on a test)|problem" VI "câu hỏi; vấn đề" -> fail/minor (too broad). ' +
  'Example: a long synonym list where one specific object/condition is omitted while the core is covered -> fail/minor, never severe.\n' +
  '- none (pass): core meaning correct with no significant problem. Example: EN "to run|to move quickly on foot" VI "chạy" -> pass/none.\n' +
  'Return ONLY one JSON object, no markdown, exactly: {"target_id":"<id>","verdict":"pass|fail","severity":"none|minor|severe","reason":"<một câu tiếng Việt hoặc null>"}. ' +
  'reason=null only when severity is none. Echo target_id exactly.';

interface JudgeVerdict {
  target_id: string;
  verdict: 'pass' | 'fail';
  severity: 'none' | 'minor' | 'severe';
  reason: string | null;
}

interface JudgeOptions {
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  concurrency: number;
  protocol: 'chat_completions' | 'responses';
  effort: string | null;
}

function glossInputForJudge(
  candidate: GlossCandidate,
  viGloss: string,
): string {
  const target = candidate.target;
  const rows = (candidate.context?.rows ?? []).map((row) => row.text);
  return JSON.stringify({
    target: {
      target_id: target?.targetId ?? null,
      target_type: target?.targetType ?? null,
      lemma: target?.targetType === 'sense' ? target.lemma : null,
      reading: target?.targetType === 'sense' ? target.reading : null,
      pos: target?.targetType === 'sense' ? target.pos : null,
    },
    en_gloss: rows,
    vi_gloss: viGloss,
  });
}

async function callJudge(
  options: JudgeOptions,
  payload: string,
  targetId: string,
): Promise<JudgeVerdict> {
  let lastError = 'judge failed';
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const endpoint =
        options.protocol === 'responses' ? 'responses' : 'chat/completions';
      const requestBody =
        options.protocol === 'responses'
          ? {
              model: options.model,
              instructions: JUDGE_PROMPT,
              input: payload,
              max_output_tokens: 2000,
              ...(options.effort
                ? { reasoning: { effort: options.effort } }
                : {}),
            }
          : {
              model: options.model,
              max_tokens: 1500,
              messages: [
                { role: 'system', content: JUDGE_PROMPT },
                { role: 'user', content: payload },
              ],
            };
      const response = await fetch(
        `${options.baseUrl.replace(/\/$/, '')}/${endpoint}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
            'User-Agent': 'LangooDB3-judge/1.0',
            'x-opencode-session': 'b6e09b4e-6e5a-4a2e-9d0e-9f1a2b3c4d5e',
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
          redirect: 'error',
        },
      );
      if (!response.ok) {
        const retryAfter = Number(response.headers.get('retry-after') ?? '');
        await response.body?.cancel();
        lastError = `HTTP ${response.status}`;
        const waitMs =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 30000)
            : attempt * 2500;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }
      const body = (await response.json()) as {
        choices?: { message?: { content?: string | null } }[];
        output?: { type?: string; content?: { text?: string }[] }[];
      };
      let content = '';
      if (options.protocol === 'responses') {
        for (const item of body.output ?? []) {
          if (item.type === 'message') {
            for (const part of item.content ?? []) {
              if (typeof part.text === 'string') content += part.text;
            }
          }
        }
      } else {
        content = body.choices?.[0]?.message?.content ?? '';
      }
      const jsonText = content
        .replace(/^```(?:json)?/i, '')
        .replace(/```\s*$/, '')
        .trim();
      const start = jsonText.indexOf('{');
      const end = jsonText.lastIndexOf('}');
      if (start < 0 || end <= start) {
        lastError = 'no JSON in judge response';
        continue;
      }
      const parsed = JSON.parse(jsonText.slice(start, end + 1)) as JudgeVerdict;
      if (
        parsed.target_id !== targetId ||
        !['pass', 'fail'].includes(parsed.verdict) ||
        !['none', 'minor', 'severe'].includes(parsed.severity)
      ) {
        lastError = 'invalid judge verdict shape';
        continue;
      }
      if (parsed.verdict === 'pass' && parsed.severity !== 'none') {
        lastError = 'pass verdict with non-none severity';
        continue;
      }
      return {
        target_id: parsed.target_id,
        verdict: parsed.verdict,
        severity: parsed.severity,
        reason:
          typeof parsed.reason === 'string' && parsed.reason.trim() !== ''
            ? parsed.reason
            : null,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(lastError);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, limit) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function main(): Promise<void> {
  const cli = parseCli('gloss-judge', process.argv.slice(2));
  const flag = (key: string, fallback?: string): string | undefined => {
    const value = cli.flags.get(key);
    return typeof value === 'string' ? value : fallback;
  };
  const root = flag('artifact-dir', 'uploads/db3b')!;
  const candidatesFile = flag('candidates', 'candidates.jsonl')!;
  const jobFile = flag('job', 'job.json')!;
  const model = flag('model', 'deepseek-v4.1-flash')!;
  const baseUrl = flag('base-url', 'https://opencode.ai/zen/go/v1')!;
  const concurrency = Number(flag('concurrency', '3'));
  const protocolFlag = flag('protocol', 'chat_completions')!;
  if (protocolFlag !== 'chat_completions' && protocolFlag !== 'responses') {
    throw new Error('Invalid protocol');
  }
  const protocol = protocolFlag;
  const effort = flag('effort') ?? null;
  const timeoutMs = Number(flag('timeout-ms', '60000'));
  const limit = flag('limit') ? Number(flag('limit')) : undefined;
  const reviewer = flag(
    'reviewer',
    `auto-judge:${model} (owner-authorized 2026-10-06)`,
  )!;
  const reviewSuffix = (flag('review-name', 'review') ?? 'review')
    .replace(/[^a-z0-9-]/gi, '-')
    .toLowerCase();
  const apiKey = (loadEnv(), process.env.DB3_AI_API_KEY ?? '');
  if (!apiKey) throw new Error('Missing DB3_AI_API_KEY');

  const candidates = loadGlossCandidates(root, candidatesFile);
  const lockName = `judge-${jobFile.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}`;
  await withArtifactLock(root, lockName, () => {
    const job = parseGlossJob(readArtifactJson(root, jobFile));
    validateGlossJobCandidates(job, candidates);
    if (job.entries.length !== 100) {
      log(
        `skip: job chỉ có ${job.entries.length} entry (apply gate yêu cầu đúng 100)`,
      );
      return Promise.resolve();
    }
    if (job.entries.some((entry) => !entry.output?.gloss_vi)) {
      log('skip: job còn entry thiếu output (null/rejected) — để runner xử lý');
      return Promise.resolve();
    }
    if (
      job.entries.some(
        (entry) => !['validated', 'applied'].includes(entry.state),
      )
    ) {
      log('skip: job chưa hoàn tất (còn entry pending/running/failed)');
      return Promise.resolve();
    }
    return judgeAndWrite(job, candidates).then(() => Promise.resolve());
  });

  async function judgeAndWrite(
    job: GlossJob,
    allCandidates: GlossCandidate[],
  ): Promise<void> {
    const byKey = new Map(allCandidates.map((c) => [c.candidateKey, c]));
    const reviewPath = `reviews/${job.jobKey}-${reviewSuffix}.json`;
    if (existsSync(resolveArtifactPath(root, reviewPath))) {
      log(`đã có review (không ghi đè): ${reviewPath}`);
      return;
    }
    const entries = limit ? job.entries.slice(0, limit) : job.entries;
    const results = await mapWithConcurrency(
      entries,
      concurrency,
      async (entry) => {
        const candidate = byKey.get(entry.candidateKey);
        if (!candidate || !entry.output?.gloss_vi) {
          throw new Error(`candidate/output thiếu cho ${entry.candidateKey}`);
        }
        const modelSegment = [
          model,
          protocol === 'chat_completions' ? null : protocol,
          effort,
        ]
          .filter(Boolean)
          .join('-');
        const cacheFile = `judge/${job.jobKey}/${modelSegment}/${entry.candidateKey}.json`;
        if (existsSync(resolveArtifactPath(root, cacheFile))) {
          return {
            ok: true as const,
            verdict: readArtifactJson(root, cacheFile) as JudgeVerdict,
          };
        }
        try {
          const verdict = await callJudge(
            {
              baseUrl,
              model,
              apiKey,
              timeoutMs,
              concurrency,
              protocol,
              effort,
            },
            glossInputForJudge(candidate, entry.output.gloss_vi),
            candidate.target!.targetId,
          );
          writeArtifactJson(root, cacheFile, verdict);
          return { ok: true as const, verdict };
        } catch (error) {
          return {
            ok: false as const,
            candidateKey: entry.candidateKey,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );
    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      log(
        `judge ${job.jobKey.slice(0, 12)}…: ${failed.length}/${results.length} entry lỗi (thử lại vòng sau): ${failed
          .slice(0, 3)
          .map((f) => f.candidateKey.slice(0, 10))
          .join(', ')}`,
      );
      return;
    }
    const verdicts = results.map((r) => (r.ok ? r.verdict : null));
    const pass = verdicts.filter((v) => v?.verdict === 'pass').length;
    const severe = verdicts.filter((v) => v?.severity === 'severe').length;
    log(
      `judge ${job.jobKey.slice(0, 12)}…: pass=${pass}/${verdicts.length} severe=${severe} model=${model}`,
    );
    if (limit) {
      log('--limit: chỉ chấm thử, không ghi review.');
      return;
    }
    const review: GlossReview = parseGlossReview({
      schemaVersion: 1,
      jobKey: job.jobKey,
      entries: entries.map((entry, index) => {
        const verdict = verdicts[index]!;
        const blocked = verdict.severity === 'severe';
        return {
          candidateKey: entry.candidateKey,
          inputHash: entry.inputHash,
          outputHash: hashGlossOutput(entry.output!),
          verdict: blocked ? 'fail' : 'pass',
          severity: verdict.severity,
          reviewer,
          reviewedAt: new Date().toISOString(),
          reason: verdict.reason,
        };
      }),
    });
    writeArtifactJson(root, reviewPath, review);
    const detailsPath =
      reviewSuffix === 'review'
        ? `reviews/${job.jobKey}-judge-details.json`
        : `reviews/${job.jobKey}-judge-details-${reviewSuffix}.json`;
    writeArtifactJson(root, detailsPath, {
      schemaVersion: 1,
      jobKey: job.jobKey,
      model,
      entries: entries.map((entry, index) => ({
        candidateKey: entry.candidateKey,
        targetId: byKey.get(entry.candidateKey)?.target?.targetId ?? null,
        glossVi: entry.output?.gloss_vi ?? null,
        verdict: verdicts[index],
      })),
    });
    log(`review: ${reviewPath} (${review.entries.length} entry, pass=${pass})`);
  }
}

if (require.main === module)
  void main().catch((error: unknown) => {
    console.error(
      `gloss-judge: LỖI — ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
