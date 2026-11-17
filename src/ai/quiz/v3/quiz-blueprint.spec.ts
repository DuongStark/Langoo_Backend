import { planQuiz, readingDistractors } from './quiz-blueprint';
import { QuizSourceItem } from '../../providers/ai-quiz.provider';

const words = (count: number): QuizSourceItem[] =>
  Array.from({ length: count }, (_, i) => ({
    itemId: `item-${i}`,
    senseId: `${i + 1}`,
    conceptId: null,
    languageId: 1,
    languageCode: 'en',
    lemma: `word${i}`,
    reading: null,
    romanization: null,
    meaningVi: `nghĩa ${i}`,
    pos: 'noun',
  }));

describe('M11.3 blueprint', () => {
  it('uses ten targets for twenty questions across two skills, never repeats target+skill', () => {
    const plan = planQuiz(words(10), 1, ['meaning', 'context_cloze'], 20);
    expect(plan.feasible).toBe(true);
    expect(plan.slots).toHaveLength(20);
    const identities = plan.slots.flatMap((s) =>
      s.targets.map((t) => `${t.senseId}:${s.skill}`),
    );
    expect(new Set(identities).size).toBe(20);
  });
  it('does not multiply capacity for a single skill or duplicate senses', () => {
    expect(planQuiz(words(10), 1, ['meaning'], 20).feasible).toBe(false);
    expect(
      planQuiz([...words(3), ...words(3)], 1, ['meaning'], 4).feasible,
    ).toBe(false);
  });
  it('does not use words from the other profile language', () => {
    const mixed = words(8).map((w, i) => ({ ...w, languageId: i < 3 ? 1 : 2 }));
    expect(planQuiz(mixed, 1, ['meaning'], 4).feasible).toBe(false);
  });
  it('does not invent cloze POS or use samples to complete in-set choices', () => {
    const missing = words(4).map((w) => ({ ...w, pos: null }));
    expect(planQuiz(missing, 1, ['context_cloze'], 1).feasible).toBe(false);
  });
  it('tracks all four targets in a matching question and prevents ambiguous pairs', () => {
    const plan = planQuiz(words(8), 1, ['matching'], 2);
    expect(plan.feasible).toBe(true);
    expect(plan.slots.map((s) => s.targets.length)).toEqual([4, 4]);
    expect(planQuiz(words(3), 1, ['matching'], 1).feasible).toBe(false);
  });
  it('supports one target for usage and does not claim JLPT level metadata', () => {
    const plan = planQuiz(words(1), 1, ['usage'], 1);
    expect(plan.feasible).toBe(true);
    expect(plan.slots[0].targets[0].senseId).toBe('1');
  });
  it('generates reading mistakes instead of unrelated vocabulary', () => {
    const choices = readingDistractors('がっこう', ['がっこう', 'ガッコウ']);
    expect(choices.length).toBeGreaterThanOrEqual(3);
    expect(choices).not.toContain('がっこう');
    expect(new Set(choices).size).toBe(choices.length);
  });
});
