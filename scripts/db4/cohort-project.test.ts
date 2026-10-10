import assert from 'node:assert/strict';
import test from 'node:test';
import { RetrievalSense } from './_retrieval';
import { hashBytes, hashJson } from './_mapping-types';
import { bindSelectedTargets } from './cohort-project';

type Identity = {
  id: string;
  lexemeId: string;
  semanticKey: string;
  identity: { externalId: string; senseKey: string };
};

const fingerprint = 'a'.repeat(64);

function makeSense(id: string, entryId: string, senseNo: number): Identity {
  return {
    id,
    lexemeId: `lexeme-${entryId}`,
    semanticKey: `sense:${id}`,
    identity: {
      externalId: `jmdict:${entryId}`,
      senseKey: `jmdict:${entryId}:${senseNo}`,
    },
  };
}

function makeTarget(
  sense: Identity,
  line: number,
  rawLine: string,
  sourceRef: { path: string; sha256: string },
  split: 'development' | 'holdout',
  shardId: string,
) {
  return {
    schemaVersion: 1 as const,
    task: 'db4_cohort_target' as const,
    targetKey: hashJson({
      schemaVersion: 1,
      task: 'db4_cohort_target',
      snapshotFingerprint: fingerprint,
      semanticKey: sense.semanticKey,
    }),
    senseKey: sense.identity.senseKey,
    senseId: sense.id,
    lexemeId: sense.lexemeId,
    lexemeKey: sense.identity.externalId,
    sourceRef: {
      file: sourceRef,
      line,
      rowSha256: hashBytes(Buffer.from(`${rawLine}\n`, 'utf8')),
    },
    split,
    shardId,
  };
}

void test('binds selected targets to exact source lines and returns source order', () => {
  const first = makeSense('11', '101', 1);
  const second = makeSense('22', '202', 2);
  const rawLines = [
    JSON.stringify({ sense: first }),
    JSON.stringify({ sense: second }),
  ];
  const sourceBytes = Buffer.from(`${rawLines.join('\n')}\n`, 'utf8');
  const sourceRef = {
    path: 'export/senses.jsonl',
    sha256: hashBytes(sourceBytes),
  };
  const selected = bindSelectedTargets(
    sourceBytes,
    sourceRef,
    [{ sense: first }, { sense: second }] as unknown as Pick<
      RetrievalSense,
      'sense'
    >[],
    [
      makeTarget(second, 2, rawLines[1], sourceRef, 'holdout', 'holdout-01'),
      makeTarget(first, 1, rawLines[0], sourceRef, 'development', 'dev-01'),
    ],
    fingerprint,
  );

  assert.deepEqual(
    selected.map((row) => [row.line, row.rawLine]),
    [
      [1, rawLines[0]],
      [2, rawLines[1]],
    ],
  );
});

void test('rejects a selected row whose source line hash has drifted', () => {
  const sense = makeSense('11', '101', 1);
  const rawLine = JSON.stringify({ sense });
  const sourceBytes = Buffer.from(`${rawLine}\n`, 'utf8');
  const sourceRef = {
    path: 'export/senses.jsonl',
    sha256: hashBytes(sourceBytes),
  };
  const target = makeTarget(
    sense,
    1,
    rawLine,
    sourceRef,
    'development',
    'dev-01',
  );
  target.sourceRef.rowSha256 = 'b'.repeat(64);

  assert.throws(
    () =>
      bindSelectedTargets(
        sourceBytes,
        sourceRef,
        [{ sense }] as unknown as Pick<RetrievalSense, 'sense'>[],
        [target],
        fingerprint,
      ),
    /row hash mismatch/,
  );
});

void test('rejects a lexeme split across the development and holdout sets', () => {
  const first = makeSense('11', '101', 1);
  const second = makeSense('12', '101', 2);
  const rawLines = [
    JSON.stringify({ sense: first }),
    JSON.stringify({ sense: second }),
  ];
  const sourceBytes = Buffer.from(`${rawLines.join('\n')}\n`, 'utf8');
  const sourceRef = {
    path: 'export/senses.jsonl',
    sha256: hashBytes(sourceBytes),
  };

  assert.throws(
    () =>
      bindSelectedTargets(
        sourceBytes,
        sourceRef,
        [{ sense: first }, { sense: second }] as unknown as Pick<
          RetrievalSense,
          'sense'
        >[],
        [
          makeTarget(first, 1, rawLines[0], sourceRef, 'development', 'dev-01'),
          makeTarget(
            second,
            2,
            rawLines[1],
            sourceRef,
            'holdout',
            'holdout-01',
          ),
        ],
        fingerprint,
      ),
    /split across development\/holdout/,
  );
});

void test('rejects a lexeme split across shards', () => {
  const first = makeSense('11', '101', 1);
  const second = makeSense('12', '101', 2);
  const rawLines = [
    JSON.stringify({ sense: first }),
    JSON.stringify({ sense: second }),
  ];
  const sourceBytes = Buffer.from(`${rawLines.join('\n')}\n`, 'utf8');
  const sourceRef = {
    path: 'export/senses.jsonl',
    sha256: hashBytes(sourceBytes),
  };

  assert.throws(
    () =>
      bindSelectedTargets(
        sourceBytes,
        sourceRef,
        [{ sense: first }, { sense: second }] as unknown as Pick<
          RetrievalSense,
          'sense'
        >[],
        [
          makeTarget(first, 1, rawLines[0], sourceRef, 'development', 'dev-01'),
          makeTarget(
            second,
            2,
            rawLines[1],
            sourceRef,
            'development',
            'dev-02',
          ),
        ],
        fingerprint,
      ),
    /split across shards/,
  );
});
