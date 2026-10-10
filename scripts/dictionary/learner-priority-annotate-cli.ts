/** M4.5: attach report-only reading notes to an immutable pilot hash. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { digest } from './learner-priority';
import { renderPilot, type PilotWord } from './learner-priority-report';

interface Pilot {
  summary: Record<string, unknown> & { contentHash: string };
  records: PilotWord[];
}
interface Annotations {
  expectedPilotContentHash: string;
  reviewerType: string;
  scope: string;
  labelsVi: Record<string, string>;
  reviewNotes: Record<string, string>;
}

function main(): void {
  const dir = process.argv[2];
  if (!dir || process.argv.length !== 3)
    throw new Error('Use <pilot-directory>');
  const pilot = JSON.parse(
    readFileSync(resolve(dir, 'pilot.json'), 'utf8'),
  ) as Pilot;
  const notes = JSON.parse(
    readFileSync(resolve(dir, 'annotations.json'), 'utf8'),
  ) as Annotations;
  if (
    digest(pilot.records) !== pilot.summary.contentHash ||
    notes.expectedPilotContentHash !== pilot.summary.contentHash
  )
    throw new Error('Pilot/annotation content hash mismatch');
  const words = new Set(pilot.records.map((row) => row.lemma));
  if (
    words.size !== 100 ||
    Object.keys(notes.labelsVi).length !== 100 ||
    Object.keys(notes.labelsVi).some((word) => !words.has(word)) ||
    Object.keys(notes.reviewNotes).some((word) => !words.has(word))
  )
    throw new Error('Notes must cover exactly the original 100 words');
  const records = pilot.records.map((row) => ({
    ...row,
    viNote: notes.labelsVi[row.lemma],
    reviewNote: notes.reviewNotes[row.lemma],
  }));
  const summary = {
    ...pilot.summary,
    annotationScope: notes.scope,
    annotationReviewer: notes.reviewerType,
    priorityReviewFlags: Object.keys(notes.reviewNotes),
    semanticGate:
      'not graded; preliminary priority flags are not a 100-word accuracy score',
  };
  writeFileSync(resolve(dir, 'review.html'), renderPilot(records, summary), {
    flag: 'wx',
  });
  const csv = (text: string) => '"' + text.replaceAll('"', '""') + '"';
  const rows = records.map((row, i) =>
    [
      String(i + 1),
      row.lemma,
      row.recommended.pos,
      row.recommended.senseId,
      row.viNote,
      row.recommended.definition,
      row.learnerOverride
        ? `Đề xuất ưu tiên người học: ${row.learnerOverride.reason}; bằng chứng nguồn: ${row.recommended.priorityReason}`
        : row.recommended.priorityReason,
      row.reviewNote ?? '',
    ]
      .map(csv)
      .join(','),
  );
  writeFileSync(
    resolve(dir, 'review.csv'),
    '\uFEFF' +
      [
        'STT,Từ,POS,Sense ID,Diễn giải VI chỉ cho báo cáo,Định nghĩa nguồn,Căn cứ,Ghi nhận kiểm mẫu',
        ...rows,
      ].join('\n') +
      '\n',
    { flag: 'wx' },
  );
  console.log(
    JSON.stringify({
      words: records.length,
      readingNotes: records.length,
      priorityReviewFlags: Object.keys(notes.reviewNotes).length,
      apiAiRequests: 0,
      dbWrites: 0,
    }),
  );
}

try {
  main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : 'Annotation failed');
  process.exitCode = 1;
}
