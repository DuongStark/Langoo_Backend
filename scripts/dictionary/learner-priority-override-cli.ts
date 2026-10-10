/** M4.5: report-only learner proposals; preserve baseline and source evidence. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { digest } from './learner-priority';
import type { PilotWord } from './learner-priority-report';

interface Manifest {
  expectedPilotContentHash: string;
  reviewerType: 'assistant_proposal';
  entries: {
    lemma: string;
    senseId: string;
    expectedInputHash: string;
    labelVi: string;
    reason: string;
  }[];
}

function main(): void {
  const [baseline, manifestPath, output] = process.argv.slice(2);
  if (!baseline || !manifestPath || !output || process.argv.length !== 5)
    throw new Error(
      'Use <baseline-directory> <manifest.json> <new-output-directory>',
    );
  const pilot = JSON.parse(
    readFileSync(resolve(baseline, 'pilot.json'), 'utf8'),
  ) as {
    summary: Record<string, unknown> & { contentHash: string };
    records: PilotWord[];
  };
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  if (
    digest(pilot.records) !== pilot.summary.contentHash ||
    manifest.expectedPilotContentHash !== pilot.summary.contentHash ||
    manifest.reviewerType !== 'assistant_proposal'
  )
    throw new Error('Baseline hash or proposal provenance mismatch');
  const notes = JSON.parse(
    readFileSync(resolve(baseline, 'annotations.json'), 'utf8'),
  ) as {
    expectedPilotContentHash: string;
    labelsVi: Record<string, string>;
    reviewNotes: Record<string, string>;
  };
  if (notes.expectedPilotContentHash !== pilot.summary.contentHash)
    throw new Error('Baseline notes mismatch');
  const entries = new Map(
    manifest.entries.map((entry) => [entry.lemma, entry]),
  );
  if (
    entries.size !== manifest.entries.length ||
    [...entries.keys()].some(
      (lemma) => !pilot.records.some((row) => row.lemma === lemma),
    )
  )
    throw new Error('Duplicate or unknown override lemma');
  const records = pilot.records.map((row) => {
    const entry = entries.get(row.lemma);
    if (!entry) return row;
    const matches = row.senses.filter(
      (sense) => sense.senseId === entry.senseId,
    );
    const selected = matches[0];
    if (
      matches.length !== 1 ||
      selected.inputHash !== entry.expectedInputHash ||
      !selected.definition ||
      selected.tier !== 0 ||
      !entry.reason.trim() ||
      !entry.labelVi.trim()
    )
      throw new Error(`Invalid/stale learner proposal: ${row.lemma}`);
    const previous = row.senses
      .filter((sense) => sense.lexemeId === selected.lexemeId)
      .sort((a, b) => a.senseNo - b.senseNo)[0];
    notes.labelsVi[row.lemma] = entry.labelVi;
    notes.reviewNotes[row.lemma] =
      `Đã đề xuất đổi nghĩa đầu cho người học: ${entry.reason}. Cần kiểm đề xuất; giữ nguyên các nghĩa khác.`;
    return {
      ...row,
      recommended: selected,
      previous,
      changed: previous.senseId !== selected.senseId,
      learnerOverride: {
        automaticSenseId: row.recommended.senseId,
        reason: entry.reason,
      },
    };
  });
  const summary = {
    ...pilot.summary,
    policy: 'm4.5-learner-proposals-v1',
    parentContentHash: pilot.summary.contentHash,
    contentHash: digest(records),
    recommendationsChangedWithinSelectedLexeme: records.filter(
      (row) => row.changed,
    ).length,
    proposalCreatedAt: new Date().toISOString(),
    learnerOverrideCount: entries.size,
    overrideReviewerType: manifest.reviewerType,
    semanticGate:
      'not graded; learner proposals do not establish usage frequency',
  };
  notes.expectedPilotContentHash = summary.contentHash;
  mkdirSync(output, { recursive: false });
  for (const [name, value] of Object.entries({
    'pilot.json': { summary, records },
    'summary.json': summary,
    'annotations.json': notes,
    'learner-overrides.json': manifest,
  }))
    writeFileSync(
      resolve(output, name),
      JSON.stringify(value, null, 2) + '\n',
      { flag: 'wx' },
    );
  console.log(
    JSON.stringify({
      words: records.length,
      overrides: entries.size,
      dbWrites: 0,
      apiAiRequests: 0,
    }),
  );
}

try {
  main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : 'Override failed');
  process.exitCode = 1;
}
