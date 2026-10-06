import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  TokenPostingBuilder,
  shardIndex,
  tokenizeEn,
  uniqueTokens,
} from './_retrieval';

void test('tokenizeEn: NFKC, lowercase, stopwords, order', () => {
  assert.deepEqual(tokenizeEn('A CAT—the DOG’s toy!'), ['cat', 'dog', 'toy']);
  assert.deepEqual(tokenizeEn('CAFÉ naïve'), ['cafe', 'naive']);
  assert.deepEqual(tokenizeEn('x a the'), []);
  assert.deepEqual(uniqueTokens(['cat dog', 'dog cat', 'cat']), ['cat', 'dog']);
});

void test('shardIndex: deterministic và trong khoảng', () => {
  const first = shardIndex('object');
  assert.equal(first, shardIndex('object'));
  assert.ok(first >= 0 && first < 64);
});

void test('TokenPostingBuilder: tokens/ids sort + hash ổn định giữa hai build', () => {
  const rootA = mkdtempSync(path.join(tmpdir(), 'db4-index-a-'));
  const rootB = mkdtempSync(path.join(tmpdir(), 'db4-index-b-'));
  const build = (root: string) => {
    const builder = new TokenPostingBuilder(
      root,
      'index/tmp/x',
      'index/x',
      'x',
    );
    builder.add('cat', '2');
    builder.add('cat', '1');
    builder.add('dog', '10');
    builder.add('cat', '1');
    return builder.finish();
  };
  try {
    const a = build(rootA);
    const b = build(rootB);
    assert.deepEqual(a, b);
    assert.equal(a.tokens, 2);
    assert.equal(a.postings, 3);
    assert.equal(a.shards.length, 64);
  } finally {
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
  }
});
