import test from 'node:test';
import assert from 'node:assert/strict';
import { imageAction } from './inflection-policy.mjs';
for (const [lemma, pos, definition, group, action, root] of [
  ['boiled', 'adjective', 'Cooked in boiling water.', 1, 'generate', null],
  [
    'building',
    'noun',
    'A structure with walls and a roof.',
    2,
    'generate',
    null,
  ],
  [
    'running',
    'noun',
    'The sport of moving rapidly on foot.',
    2,
    'generate',
    null,
  ],
  [
    'cooked',
    'verb',
    'simple past and past participle of cook',
    3,
    'inherit',
    'cook',
  ],
  ['ran', 'verb', 'simple past of run.', 3, 'inherit', 'run'],
  ['boxes', 'noun', 'plural of box', 3, 'inherit', 'box'],
  ['being', 'verb', 'present participle of be', 4, 'skip', 'be'],
  ['having', 'verb', 'present participle of have', 4, 'skip', 'have'],
  ['had', 'verb', 'simple past of have', 4, 'skip', 'have'],
])
  test(`${lemma}/${pos}: ${action}`, () =>
    assert.deepEqual(imageAction({ lemma, pos, definition }), {
      group,
      action,
      root,
    }));

test('grammatical senses do not stop unrelated generation or consume generation slots', async () => {
  const { partitionImageActions } = await import('./inflection-policy.mjs');
  const r = partitionImageActions([
    {
      sense_id: '1',
      lemma: 'cooked',
      pos: 'verb',
      definition: 'simple past of cook',
    },
    {
      sense_id: '2',
      lemma: 'boiled',
      pos: 'adjective',
      definition: 'Cooked in boiling water.',
    },
  ]);
  assert.deepEqual(
    r.generate.map((x) => x.sense_id),
    ['2'],
  );
  assert.deepEqual(r.deferred, {
    1: {
      lemma: 'cooked',
      group: 3,
      action: 'inherit',
      root: 'cook',
      reason: 'ROOT_SENSE_RESOLUTION_REQUIRED',
    },
  });
});
