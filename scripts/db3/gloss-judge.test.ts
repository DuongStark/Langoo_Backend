import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createGlossJob, parseGlossJob } from './_gloss-types';
import { buildGlossJudgeReview } from './gloss-judge';

void test('DB3-B2.1 judge minor failure stays failed in the durable apply review', () => {
  const fixture = parseGlossJob(
    JSON.parse(
      readFileSync(path.join(__dirname, 'fixtures/gloss/job-v1.json'), 'utf8'),
    ),
  );
  const job = createGlossJob({
    ...fixture,
    entries: fixture.entries.map((entry) => ({
      ...entry,
      state: 'validated',
      validation: 'passed',
      output: {
        target_type: 'sense',
        target_id: '9007199254740993',
        gloss_vi: 'mèo',
        reason: null,
      },
    })),
  });
  const fail = {
    target_id: '9007199254740993',
    verdict: 'fail' as const,
    severity: 'minor' as const,
    reason: 'Thiếu nghĩa',
  };
  const review = buildGlossJudgeReview(
    job,
    job.entries,
    [fail],
    'GPT fixture reviewer',
  );
  assert.equal(review.entries[0].verdict, 'fail');
  assert.equal(
    review.entries.filter((entry) => entry.verdict === 'pass').length,
    0,
  );
  assert.throws(
    () => buildGlossJudgeReview(job, job.entries, [], 'GPT fixture reviewer'),
    /coverage/,
  );
});
