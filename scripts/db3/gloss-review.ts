import { existsSync } from 'node:fs';
import { parseCli } from './_shared';
import { loadGlossCandidates, verifyGlossSources } from './gloss-translate';
import {
  readArtifactJson,
  writeArtifactJson,
  withArtifactLock,
  resolveArtifactPath,
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

export function createGlossReviewTemplate(
  job: GlossJob,
  candidates: GlossCandidate[],
): GlossReview {
  validateGlossJobCandidates(job, candidates);
  if (
    job.entries.length !== 100 ||
    job.entries.some((e) => e.state !== 'validated' || !e.output?.gloss_vi)
  )
    throw new Error(
      'Review template requires 100 validated, non-null pilot outputs',
    );
  const targets = new Map(candidates.map((c) => [c.candidateKey, c.target]));
  if (
    new Set(
      job.entries.map((e) => {
        const target = targets.get(e.candidateKey)!;
        return `${target.targetType}:${target.targetId}`;
      }),
    ).size !== 100
  )
    throw new Error('Review requires 100 distinct targets');
  return parseGlossReview({
    schemaVersion: 1,
    jobKey: job.jobKey,
    entries: job.entries.map((e) => ({
      candidateKey: e.candidateKey,
      inputHash: e.inputHash,
      outputHash: hashGlossOutput(e.output!),
      verdict: 'fail',
      severity: 'minor',
      reviewer: 'UNREVIEWED',
      reviewedAt: new Date().toISOString(),
      reason:
        'Not reviewed; bilingual human must set verdict/reviewer/time/severity/reason.',
    })),
  });
}
export async function main(args = process.argv.slice(2)): Promise<void> {
  const cli = parseCli('gloss-review', args);
  if (cli.apply || cli.flags.has('generate') || cli.flags.has('rollback'))
    throw new Error('Review exporter does not generate or apply gloss');
  const flag = (key: string, fallback: string): string => {
    const value = cli.flags.get(key);
    return typeof value === 'string' ? value : fallback;
  };
  const root = flag('artifact-dir', 'uploads/db3b');
  const candidates = loadGlossCandidates(
    root,
    flag('candidates', 'candidates.jsonl'),
  );
  await withArtifactLock(root, 'job', () => {
    const job = parseGlossJob(readArtifactJson(root, flag('job', 'job.json')));
    const template = createGlossReviewTemplate(job, candidates);
    for (const suffix of ['template', 'context']) {
      if (
        existsSync(
          resolveArtifactPath(root, `reviews/${job.jobKey}-${suffix}.json`),
        )
      )
        throw new Error(
          'Review artifact already exists; preserve human review edits',
        );
    }
    const map = new Map(candidates.map((c) => [c.candidateKey, c]));
    verifyGlossSources(
      root,
      job.entries.map((e) => map.get(e.candidateKey)!),
    );
    writeArtifactJson(root, `reviews/${job.jobKey}-template.json`, template);
    writeArtifactJson(root, `reviews/${job.jobKey}-context.json`, {
      schemaVersion: 1,
      jobKey: job.jobKey,
      entries: job.entries.map((e) => ({
        candidate: map.get(e.candidateKey),
        output: e.output,
      })),
    });
    console.log(
      JSON.stringify({
        targets: template.entries.length,
        autoApproved: 0,
        path: `reviews/${job.jobKey}-template.json`,
      }),
    );
    return Promise.resolve();
  });
}
if (require.main === module)
  void main().catch(() => {
    console.error(
      'Review export failed; 100 validated targets and audited artifacts are required.',
    );
    process.exitCode = 1;
  });
