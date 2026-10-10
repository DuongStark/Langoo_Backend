import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parsePromptRevision,
  promptRevisionFromVersions,
  promptVersion,
} from './muse-prompt-version';

void test('accepts only frozen DB4 prompt revisions', () => {
  assert.equal(parsePromptRevision('v1'), 'v1');
  assert.equal(parsePromptRevision('v2'), 'v2');
  assert.equal(parsePromptRevision('v2.1'), 'v2.1');
  assert.throws(() => parsePromptRevision('v2.2'), /must be v1, v2, or v2\.1/);
});

void test('recognizes base and bounded repair versions without mixing revisions', () => {
  assert.deepEqual(
    promptRevisionFromVersions({
      r1: promptVersion('v2.1', 'r1'),
      r2: promptVersion('v2.1', 'r2'),
    }),
    { revision: 'v2.1', attempt: 'base' },
  );
  assert.deepEqual(
    promptRevisionFromVersions({
      r1: promptVersion('v2.1', 'r1', 'repair1'),
      r2: promptVersion('v2.1', 'r2', 'repair1'),
    }),
    { revision: 'v2.1', attempt: 'repair1' },
  );
  assert.throws(
    () =>
      promptRevisionFromVersions({
        r1: promptVersion('v2', 'r1'),
        r2: promptVersion('v2.1', 'r2'),
      }),
    /matching R1\/R2 revisions/,
  );
  assert.throws(
    () =>
      promptRevisionFromVersions({
        r1: promptVersion('v2.1', 'r1', 'repair1'),
        r2: promptVersion('v2.1', 'r2'),
      }),
    /matching R1\/R2 revisions/,
  );
  assert.throws(
    () =>
      promptRevisionFromVersions({
        r1: 'db4-d4-semantic-match-v2.1-r2',
        r2: promptVersion('v2.1', 'r2'),
      }),
    /matching R1\/R2 revisions/,
  );
  assert.deepEqual(
    promptRevisionFromVersions({
      r1: promptVersion('v2.1', 'r1', 'repair1'),
      r2: promptVersion('v2.1', 'r2', 'repair1'),
    }).attempt,
    'repair1',
  );
});
