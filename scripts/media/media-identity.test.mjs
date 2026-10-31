import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMediaIdentity,
  coveredByLaterRequests,
} from './media-identity.mjs';
const plans = [{ sense_id: '12', lemma: 'receipt', file: 'm142-12.png' }];
test('accept unique request lemma with explicit matching numeric receipt', () =>
  assert.equal(
    normalizeMediaIdentity(
      [
        {
          text: 'm142-12.png',
          media: [{ label: 'Open generated image receipt' }],
        },
      ],
      plans,
    )[0].label,
    'Open generated image m142-12.png',
  ));
test('reject ambiguous lemma, missing receipt, unknown label and prefix IDs', () => {
  for (const [p, text, label] of [
    [plans, 'm142-123.png', 'receipt'],
    [plans, '', 'receipt'],
    [plans, 'm142-12.png', 'other'],
    [
      [
        ...plans,
        ...plans.map((p) => ({ ...p, sense_id: '13', file: 'm142-13.png' })),
      ],
      'm142-12.png m142-13.png',
      'receipt',
    ],
  ])
    assert.equal(
      normalizeMediaIdentity(
        [{ text, media: [{ label: `Open generated image ${label}` }] }],
        p,
      )[0].label,
      `Open generated image ${label}`,
    );
});
test('resume older record only when all its targets complete or already dispatched later', () => {
  assert.equal(
    coveredByLaterRequests(
      { target_ids: ['1', '2'] },
      [{ target_ids: ['2'] }],
      { 1: { status: 'complete' } },
    ),
    true,
  );
  assert.equal(
    coveredByLaterRequests(
      { target_ids: ['1', '2', '3'] },
      [{ target_ids: ['2'] }],
      { 1: { status: 'complete' } },
    ),
    false,
  );
});
