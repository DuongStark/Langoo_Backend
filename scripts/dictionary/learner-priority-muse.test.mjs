import test from 'node:test';
import assert from 'node:assert/strict';
import {
  splitContexts,
  packTasks,
  validateBatchReply,
  shortlistContext,
} from './learner-priority-muse.mjs';
const sense = (id, lemma = 'cat') => ({
  senseId: String(id),
  lexemeId: '10',
  lemma,
  pos: 'noun',
  source: 'fixture',
  sourceVersion: '1',
  senseNo: id,
  definition: 'definition ' + id + 'x'.repeat(100),
  rawDefinition: 'leaf ' + id,
  glossEnContext: ['parent context'],
});
const task = (lemma, id) => ({
  id: `${lemma}:final:0`,
  context: {
    lemma,
    groups: [{ senses: [{ id: String(id), definition: 'scope' }] }],
  },
  stage: 'final',
});
const output = (lemma, id) => ({
  lemma,
  recommended_sense_ids: [String(id)],
  reason: 'Nghĩa đời thường.',
  needs_review: false,
});
test('splitting preserves every source ID and leaf definition without truncation', () => {
  const record = {
    lemma: 'cat',
    senses: Array.from({ length: 15 }, (_, i) => sense(i + 1)),
  };
  const parts = splitContexts(record, 1000);
  assert.ok(parts.length > 1);
  assert.deepEqual(
    parts.flatMap((p) => p.groups.flatMap((g) => g.senses.map((s) => s.id))),
    record.senses.map((s) => s.senseId),
  );
  for (const part of parts) {
    assert.ok(JSON.stringify(part).length <= 1000);
    for (const group of part.groups)
      for (const s of group.senses)
        assert.equal(s.leaf_definition, 'leaf ' + s.id);
  }
  assert.throws(() => splitContexts(record, 50), /no truncation/);
});
test('batches never mix two parts of the same lemma or exceed word/context cap', () => {
  const tasks = ['cat', 'dog', 'bank', 'plant', 'draw', 'eat', 'cat'].map(
    (w, i) => task(w, i + 1),
  );
  const packed = packTasks(tasks, 1000, 5);
  assert.equal(packed.flat().length, tasks.length);
  for (const batch of packed) {
    assert.ok(batch.length <= 5);
    assert.equal(new Set(batch.map((t) => t.context.lemma)).size, batch.length);
    assert.ok(JSON.stringify(batch.map((t) => t.context)).length <= 1002);
  }
});
test('rejects missing words, cross-word IDs and duplicate senses despite syntactically valid JSON', () => {
  const tasks = [task('cat', 1), task('dog', 2)];
  assert.deepEqual(
    validateBatchReply(
      JSON.stringify([output('dog', 2), output('cat', 1)]),
      tasks,
    ).map((r) => r.lemma),
    ['cat', 'dog'],
  );
  assert.throws(
    () => validateBatchReply(JSON.stringify([output('cat', 1)]), tasks),
    /Missing/,
  );
  assert.throws(
    () =>
      validateBatchReply(
        JSON.stringify([output('cat', 2), output('dog', 1)]),
        tasks,
      ),
    /out-of-scope/,
  );
  assert.throws(
    () =>
      validateBatchReply(
        JSON.stringify([output('cat', 1), output('cat', 1)]),
        tasks,
      ),
    /duplicate/,
  );
  assert.throws(
    () =>
      validateBatchReply(
        JSON.stringify([
          { ...output('cat', 1), recommended_sense_ids: ['1', '1'] },
          output('dog', 2),
        ]),
        tasks,
      ),
    /duplicate/,
  );
});
test('invalid empty decision/extra properties cannot become an accepted ranking', () => {
  const tasks = [task('cat', 1)];
  assert.throws(
    () =>
      validateBatchReply(
        JSON.stringify([{ ...output('cat', 1), recommended_sense_ids: [] }]),
        tasks,
      ),
    /review/,
  );
  assert.throws(
    () =>
      validateBatchReply(
        JSON.stringify([{ ...output('cat', 1), invented: true }]),
        tasks,
      ),
    /schema/,
  );
});
test('aggregate shortlist retains exact source scopes and rejects foreign IDs', () => {
  const record = { lemma: 'cat', senses: [sense(1), sense(2)] };
  const context = shortlistContext(record, [output('cat', 2)]);
  assert.equal(context.groups[0].senses[0].leaf_definition, 'leaf 2');
  assert.throws(() => shortlistContext(record, [output('cat', 3)]), /drift/);
});

test('semantic report rejects changed AI output and foreign manual corrections', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { spawnSync } = await import('node:child_process');
  const { hash } = await import('./learner-priority-muse.mjs');
  const directory = mkdtempSync(join(tmpdir(), 'm45-semantic-test-'));
  try {
    const selected = { ...sense(1), tags: [] };
    const row = {
      lemma: 'cat',
      selected: [selected],
      output: output('cat', 1),
      complete_context_processed: true,
      source_sense_count: 1,
    };
    const annotation = {
      lemma: 'cat',
      verdict: 'pass',
      comparison: 'similar',
      learner_vi: 'mèo',
      note: 'Đúng nghĩa.',
      output_hash: hash(row.output),
    };
    const put = (name, value) =>
      writeFileSync(join(directory, name), JSON.stringify(value));
    put('input.json', {
      records: [{ lemma: 'cat', senses: [selected], baseline: '1' }],
    });
    put('results.json', { identity: 'fixture', generated: 1, records: [row] });
    const run = (review) => {
      put('semantic-review.json', review);
      return spawnSync(
        process.execPath,
        [
          fileURLToPath(
            new URL('./learner-priority-muse-review.mjs', import.meta.url),
          ),
          directory,
        ],
        { encoding: 'utf8' },
      );
    };
    const review = {
      source_identity: 'fixture',
      reviewer: 'fixture',
      records: [annotation],
    };
    const successful = run(review);
    assert.equal(successful.status, 0, successful.stderr);
    assert.match(
      run({ ...review, records: [{ ...annotation, output_hash: 'changed' }] })
        .stderr,
      /Review\/output drift/,
    );
    assert.match(
      run({
        ...review,
        records: [{ ...annotation, proposed_sense_ids: ['2'] }],
      }).stderr,
      /proposal sense/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
