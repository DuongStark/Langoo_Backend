import { Rng } from '../../srs/scheduler/fuzz';
import { QuizSourceItem } from '../providers/ai-quiz.provider';
import {
  assertQuizCanGenerate,
  buildQuizQuestions,
  questionTypeSequence,
} from './quiz-generator';

function seededRng(seed = 42): Rng {
  let state = seed >>> 0;
  return {
    next: () => {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return state / 4294967296;
    },
  };
}

function item(
  index: number,
  overrides: Partial<QuizSourceItem> = {},
): QuizSourceItem {
  return {
    itemId: `item-${index}`,
    senseId: `${index}`,
    conceptId: `${index}`,
    languageId: 2,
    lemma: `語${index}`,
    reading: `ご${index}`,
    romanization: `go${index}`,
    meaningVi: `nghĩa ${index}`,
    ...overrides,
  };
}

const items = [item(1), item(2), item(3), item(4), item(5)];

describe('quiz-generator', () => {
  it('questionTypeSequence: mixed luân phiên MC → FB → matching', () => {
    expect(questionTypeSequence('mixed', 5)).toEqual([
      'multiple_choice',
      'fill_blank',
      'matching',
      'multiple_choice',
      'fill_blank',
    ]);
    expect(questionTypeSequence('fill_blank', 2)).toEqual([
      'fill_blank',
      'fill_blank',
    ]);
  });

  it('MC: số phương án theo difficulty, đáp án nằm trong options', () => {
    const easy = buildQuizQuestions({
      quizType: 'multiple_choice',
      difficulty: 'easy',
      questionCount: 1,
      languageId: 2,
      items,
      rng: seededRng(1),
    });
    const hard = buildQuizQuestions({
      quizType: 'multiple_choice',
      difficulty: 'hard',
      questionCount: 1,
      languageId: 2,
      items,
      rng: seededRng(1),
    });

    expect((easy[0].options as unknown[]).length).toBe(3);
    expect((hard[0].options as unknown[]).length).toBe(4);
    const options = easy[0].options as { index: number; text: string }[];
    const correct = easy[0].correctAnswer as { index: number; text: string };
    expect(options[correct.index].text).toBe(correct.text);
    expect(easy[0].prompt).toContain('語1');
    expect(easy[0].itemId).toBe('item-1');
  });

  it('FB: accepted gồm lemma + reading; hard bỏ romaji', () => {
    const medium = buildQuizQuestions({
      quizType: 'fill_blank',
      difficulty: 'medium',
      questionCount: 1,
      languageId: 2,
      items,
      rng: seededRng(1),
    });
    const hard = buildQuizQuestions({
      quizType: 'fill_blank',
      difficulty: 'hard',
      questionCount: 1,
      languageId: 2,
      items,
      rng: seededRng(1),
    });

    const mediumAccepted = (medium[0].correctAnswer as { accepted: string[] })
      .accepted;
    const hardAccepted = (hard[0].correctAnswer as { accepted: string[] })
      .accepted;
    expect(mediumAccepted).toEqual(['語1', 'ご1', 'go1']);
    expect(hardAccepted).toEqual(['語1', 'ご1']);
    expect(medium[0].prompt).toContain('nghĩa 1');
  });

  it('matching: K theo difficulty và mapping khớp left/right', () => {
    const result = buildQuizQuestions({
      quizType: 'matching',
      difficulty: 'medium',
      questionCount: 1,
      languageId: 2,
      items,
      rng: seededRng(7),
    });
    const options = result[0].options as {
      index: number;
      text: string;
      side: string;
    }[];
    const left = options.filter((option) => option.side === 'left');
    const right = options.filter((option) => option.side === 'right');
    const mapping = (
      result[0].correctAnswer as {
        mapping: { left_index: number; right_index: number }[];
      }
    ).mapping;

    expect(left).toHaveLength(4);
    expect(right).toHaveLength(4);
    expect(mapping).toHaveLength(4);
    for (const pair of mapping) {
      const leftText = left[pair.left_index].text;
      const rightText = right[pair.right_index].text;
      const expectedItem = items.find((entry) => entry.lemma === leftText)!;
      expect(rightText).toBe(expectedItem.meaningVi);
    }
  });

  it('deterministic theo RNG: cùng seed → kết quả giống nhau', () => {
    const build = (seed: number) =>
      buildQuizQuestions({
        quizType: 'mixed',
        difficulty: 'medium',
        questionCount: 3,
        languageId: 2,
        items,
        rng: seededRng(seed),
      });

    expect(JSON.stringify(build(9))).toBe(JSON.stringify(build(9)));
  });

  it('thiếu từ nguồn / trùng nghĩa → 409 QUIZ_NOT_ENOUGH_ITEMS', () => {
    expect(() => assertQuizCanGenerate([item(1)])).toThrow('Cần ít nhất 2 từ');
    expect(() =>
      assertQuizCanGenerate([item(1), item(2, { meaningVi: 'nghĩa 1' })]),
    ).toThrow('Cần ít nhất 2 từ');
    expect(() => assertQuizCanGenerate(items)).not.toThrow();
  });
});
