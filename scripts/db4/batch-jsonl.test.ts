import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { z } from 'zod';
import { hashBytes } from './_mapping-types';
import { scanBatchJsonl } from './_batch-jsonl';

void test('stream visits ordered rows and rejects tampered or unterminated input', async () => {
  const root = mkdtempSync(join(tmpdir(), 'db4-jsonl-'));
  try {
    const text = '{"index":1}\n{"index":2}\n';
    const ref = { path: 'rows.jsonl', sha256: hashBytes(text) };
    const schema = z.object({ index: z.number() }).strict();
    writeFileSync(join(root, ref.path), text);
    const visited: number[] = [];
    assert.equal(
      await scanBatchJsonl(root, ref, schema, 'rows', async (row) => {
        await Promise.resolve();
        visited.push(row.index);
      }),
      2,
    );
    assert.deepEqual(visited, [1, 2]);
    writeFileSync(join(root, ref.path), '{"index":3}\n');
    await assert.rejects(
      () => scanBatchJsonl(root, ref, schema, 'rows', () => {}),
      /hash mismatch/,
    );
    const truncated = '{"index":1}';
    writeFileSync(join(root, ref.path), truncated);
    await assert.rejects(
      () =>
        scanBatchJsonl(
          root,
          { ...ref, sha256: hashBytes(truncated) },
          schema,
          'rows',
          () => {},
        ),
      /LF/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('stream rejects blank rows and byte caps before trusting artifact', async () => {
  const root = mkdtempSync(join(tmpdir(), 'db4-jsonl-'));
  try {
    const text = '{}\n\n';
    const ref = { path: 'rows.jsonl', sha256: hashBytes(text) };
    writeFileSync(join(root, ref.path), text);
    await assert.rejects(
      () => scanBatchJsonl(root, ref, z.unknown(), 'rows', () => {}),
      /empty/,
    );
    await assert.rejects(
      () => scanBatchJsonl(root, ref, z.unknown(), 'rows', () => {}, 2),
      /cap/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
