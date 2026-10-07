import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashJson, parsePilotManifest } from './_mapping-types';
import { samplePilotA, type PilotPopulationEntry } from './_pilot';

const POS_BY_MOD = [['verb'], ['adjective'], ['adverb'], ['noun']] as const;

function entry(
  level: 1 | 2 | 3 | 4 | 5,
  primary: boolean,
  index: number,
  lexeme = `lex:${level}:${primary ? 'p' : 's'}:${index}`,
): PilotPopulationEntry {
  return {
    targetKey: hashJson({ family: 'pilot-test-target', level, primary, index }),
    jlptLevel: level,
    isPrimary: primary,
    lexemeKey: lexeme,
    features: {
      normalizedPos: [...POS_BY_MOD[index % 4]],
      multiSenseLexeme: index % 3 === 0,
      longLemma: index % 2 === 0,
      manyGlosses: index % 4 < 3,
      manyForms: index % 2 === 0,
    },
  };
}

function population(): PilotPopulationEntry[] {
  const list: PilotPopulationEntry[] = [];
  for (const level of [1, 2, 3, 4, 5] as const)
    for (const primary of [true, false])
      for (let index = 0; index < 24; index += 1)
        list.push(entry(level, primary, index));
  return list;
}

void test('pilot A: đúng 100 target, 20/level 10+10, sorted, deterministic', () => {
  const first = samplePilotA(population(), { seed: 'seed-v1' });
  const second = samplePilotA(population(), { seed: 'seed-v1' });
  assert.deepEqual(first, second);
  assert.equal(first.targetKeys.length, 100);
  assert.deepEqual(first.targetKeys, [...first.targetKeys].sort());
  const byLevel = new Map<string, number>();
  for (const row of first.strata) {
    const key = `${row.jlptLevel}/${row.isPrimary ? 'p' : 's'}`;
    byLevel.set(key, (byLevel.get(key) ?? 0) + 1);
  }
  for (const level of [1, 2, 3, 4, 5]) {
    assert.equal(byLevel.get(`${level}/p`), 10);
    assert.equal(byLevel.get(`${level}/s`), 10);
  }
  assert.deepEqual(first.notes, []);
  assert.deepEqual(first.unfulfilled, []);
  const manifest = parsePilotManifest({
    schemaVersion: 1,
    mode: 'production',
    pilot: 'A',
    semanticInputFingerprint: 'a'.repeat(64),
    policyVersion: 'pilot-test-v1',
    seed: 'seed-v1',
    targetKeys: first.targetKeys,
    positiveTargetKeys: [],
    hardNegativeTargetKeys: [],
    strata: first.strata,
    exclusions: [],
  });
  assert.equal(manifest.targetKeys.length, 100);
});

void test('pilot A: seed khác → mẫu khác (không cố định cứng)', () => {
  const a = samplePilotA(population(), { seed: 'seed-a' });
  const b = samplePilotA(population(), { seed: 'seed-b' });
  assert.notDeepEqual(a.targetKeys, b.targetKeys);
});

void test('pilot A: stratum thiếu được bù + ghi note, vẫn đủ size', () => {
  const trimmed: PilotPopulationEntry[] = [
    ...[1, 3, 4, 5].flatMap((level) =>
      [true, false].flatMap((primary) =>
        Array.from({ length: 24 }, (_, index) =>
          entry(level as 1 | 3 | 4 | 5, primary, index),
        ),
      ),
    ),
    ...Array.from({ length: 12 }, (_, index) => entry(2, true, index)),
    ...Array.from({ length: 3 }, (_, index) => entry(2, false, index)),
  ];
  const result = samplePilotA(trimmed, { seed: 'seed-v1' });
  assert.equal(result.targetKeys.length, 100);
  assert.ok(
    result.notes.some((note) => note.includes('JLPT2')),
    `notes: ${result.notes.join('; ')}`,
  );
});
