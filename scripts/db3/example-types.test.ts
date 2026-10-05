import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createExampleCandidate,
  parseExampleCandidate,
  type ExampleCandidateInput,
} from './_example-types';
import { hashGlossText } from './_gloss-types';

function fixture(): ExampleCandidateInput {
  const batchId = 'f08e6b39-955e-4f82-a6e7-a118a2f466cb';
  return {
    schemaVersion: 1,
    candidateType: 'example_pair',
    datasetFingerprint: hashGlossText('fixture'),
    ja: {
      sentenceId: '9007199254740993',
      language: 'ja',
      text: '猫がいる。',
      textHash: hashGlossText('猫がいる。'),
      sourceCode: 'tatoeba',
      batchId,
    },
    vi: {
      sentenceId: '9007199254740994',
      language: 'vi',
      text: 'Có một con mèo.',
      textHash: hashGlossText('Có một con mèo.'),
      sourceCode: 'tatoeba',
      batchId,
    },
    links: [
      {
        sentenceId: '9007199254740993',
        translationId: '9007199254740994',
        sourceCode: 'tatoeba',
        batchId,
      },
    ],
    sources: [
      {
        sourceId: 10,
        code: 'tatoeba',
        version: null,
        snapshot: null,
        sha256: hashGlossText('raw'),
        license: 'CC BY 2.0 FR',
        attribution: 'Fixture only',
        url: 'https://example.org/tatoeba',
        batchIds: [batchId],
        audit: {
          status: 'blocked',
          evidence: [],
          reasons: ['Snapshot not verified'],
        },
      },
    ],
    alignment: 'unmapped',
    notes: ['Synthetic test, never apply.'],
    classification: 'blocked_source',
    blockedReasons: ['Snapshot not verified'],
  };
}
void test('direct/reverse links preserve bigint/source text without implying sense mapping', () => {
  const input = fixture();
  input.links.push({
    ...input.links[0],
    sentenceId: input.vi.sentenceId,
    translationId: input.ja.sentenceId,
  });
  const pair = createExampleCandidate(input);
  assert.equal(parseExampleCandidate(pair).ja.sentenceId, '9007199254740993');
  assert.equal(pair.alignment, 'unmapped');
  assert.throws(() => parseExampleCandidate({ ...pair, verified: true }));
});
void test('wrong endpoints, duplicate links, wrong text hash and missing batch rejected', () => {
  for (const kind of ['endpoint', 'duplicate', 'text', 'batch']) {
    const input = fixture();
    if (kind === 'endpoint') input.links[0].translationId = '42';
    if (kind === 'duplicate') input.links.push(input.links[0]);
    if (kind === 'text') input.vi.text += ' changed';
    if (kind === 'batch') input.sources[0].batchIds = [];
    assert.throws(() => createExampleCandidate(input));
  }
});
void test('source_pair requires audited source; changing text changes key', () => {
  const input = fixture();
  assert.throws(() =>
    createExampleCandidate({
      ...input,
      classification: 'source_pair',
      blockedReasons: [],
    }),
  );
  const a = createExampleCandidate(input);
  input.vi.text = 'Một con mèo ở đây.';
  input.vi.textHash = hashGlossText(input.vi.text);
  const b = createExampleCandidate(input);
  assert.notEqual(a.candidateKey, b.candidateKey);
  assert.throws(() => parseExampleCandidate({ ...a, ja: b.vi }));
});
