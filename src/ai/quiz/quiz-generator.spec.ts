import { DomainException } from '../../common/errors/domain.exception';
import { QuizQuestionType } from '../../sessions/quiz-content';
import { Rng } from '../../srs/scheduler/fuzz';
import { QuizSourceItem } from '../providers/ai-quiz.provider';
import {
  assertQuizCanGenerate,
  buildQuizQuestions,
  questionTypeSlots,
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

const READINGS = [
  'いち',
  'に',
  'さん',
  'し',
  'ご',
  'ろく',
  'なな',
  'はち',
  'きゅう',
  'じゅう',
  'じゅういち',
  'じゅうに',
];

/** Từ tiếng Nhật có đủ cặp Kanji–kana hợp lệ để MC xoay dạng Kanji. */
function jaItem(index: number): QuizSourceItem {
  const written = `語${index}`;
  const reading = READINGS[index - 1];
  return {
    itemId: `item-${index}`,
    senseId: `${index}`,
    conceptId: `${index}`,
    languageId: 2,
    languageCode: 'ja',
    lemma: written,
    reading,
    romanization: null,
    meaningVi: `nghĩa ${index}`,
    kanjiPairs: [{ written, reading, eligible: true }],
  };
}

const items = [item(1), item(2), item(3), item(4), item(5)];

function catchDomainError(run: () => unknown): DomainException {
  try {
    run();
  } catch (error) {
    if (error instanceof DomainException) {
      return error;
    }
    throw error;
  }
  throw new Error('Mong đợi DomainException nhưng không lỗi nào được ném');
}

describe('quiz-generator', () => {
  it('questionTypeSlots: luân phiên các dạng đã chọn theo thứ tự canonical', () => {
    expect(questionTypeSlots(['multiple_choice', 'fill_blank'], 5)).toEqual([
      'multiple_choice',
      'fill_blank',
      'multiple_choice',
      'fill_blank',
      'multiple_choice',
    ]);
    // Đầu vào đảo thứ tự vẫn chuẩn hoá MC → fill_blank → matching.
    expect(questionTypeSlots(['matching', 'multiple_choice'], 3)).toEqual([
      'multiple_choice',
      'matching',
      'multiple_choice',
    ]);
    expect(questionTypeSlots(['fill_blank'], 2)).toEqual([
      'fill_blank',
      'fill_blank',
    ]);
  });

  it('questionTypeSlots: rỗng/không hợp lệ → 400 VALIDATION_FAILED', () => {
    const empty = catchDomainError(() =>
      questionTypeSlots([] as QuizQuestionType[], 3),
    );
    expect(empty).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(() =>
      questionTypeSlots(['unknown'] as unknown as QuizQuestionType[], 1),
    ).toThrow('Cần ít nhất một dạng câu hỏi');
  });

  it('MC: 4 phương án xáo, đáp án đúng nằm trong options', () => {
    const result = buildQuizQuestions({
      questionTypes: ['multiple_choice'],
      questionCount: 1,
      languageId: 2,
      items,
      rng: seededRng(1),
    });

    const q = result[0];
    expect(q.questionType).toBe('multiple_choice');
    expect(q.questionStyle).toBe('meaning');
    expect(q.itemId).toBe('item-1');
    const options = q.options as { index: number; text: string }[];
    const correct = q.correctAnswer as { index: number; text: string };
    expect(options).toHaveLength(4);
    expect(new Set(options.map((option) => option.text)).size).toBe(4);
    expect(options[correct.index].text).toBe(correct.text);
    expect(q.prompt).toContain('語1');
  });

  it('MC: bộ 2 từ vẫn tạo được câu với tối thiểu 2 phương án', () => {
    const result = buildQuizQuestions({
      questionTypes: ['multiple_choice'],
      questionCount: 1,
      languageId: 2,
      items: [item(1), item(2)],
      rng: seededRng(1),
    });
    const options = result[0].options as { index: number; text: string }[];
    expect(options).toHaveLength(2);
    const correct = result[0].correctAnswer as { index: number; text: string };
    expect(options[correct.index].text).toBe(correct.text);
  });

  it('FB: nhận lemma + reading + romaji, không còn difficulty', () => {
    const result = buildQuizQuestions({
      questionTypes: ['fill_blank'],
      questionCount: 1,
      languageId: 2,
      items,
      rng: seededRng(1),
    });

    expect(result[0].questionType).toBe('fill_blank');
    expect(result[0].questionStyle).toBe('fill_blank');
    expect(result[0].options).toEqual([]);
    expect(
      (result[0].correctAnswer as { accepted: string[] }).accepted,
    ).toEqual(['語1', 'ご1', 'go1']);
    expect(result[0].prompt).toContain('nghĩa 1');
  });

  it('recentItemIds: đủ từ mới → xáo để quiz liền kề khác nhau', () => {
    const result = buildQuizQuestions({
      questionTypes: ['fill_blank'],
      questionCount: 2,
      languageId: 2,
      items,
      rng: seededRng(7),
      recentItemIds: ['item-1', 'item-2', 'item-3'],
    });
    expect(result.map((question) => question.itemId).sort()).toEqual([
      'item-4',
      'item-5',
    ]);
  });

  it('recentItemIds: không đủ từ mới → giữ thứ tự cũ để tái dùng evidence', () => {
    // Chỉ còn 1 từ "mới" cho 2 câu → giữ nguyên nguồn (evidence cũ còn dùng).
    const kept = buildQuizQuestions({
      questionTypes: ['fill_blank'],
      questionCount: 2,
      languageId: 2,
      items,
      rng: seededRng(7),
      recentItemIds: ['item-1', 'item-2', 'item-3', 'item-4'],
    });
    expect(kept.map((question) => question.itemId)).toEqual([
      'item-1',
      'item-2',
    ]);

    // Toàn bộ pool là recent → vẫn dùng lại theo thứ tự gốc.
    const fallback = buildQuizQuestions({
      questionTypes: ['fill_blank'],
      questionCount: 4,
      languageId: 2,
      items,
      rng: seededRng(7),
      recentItemIds: items.map((entry) => entry.itemId),
    });
    expect(fallback.map((question) => question.itemId)).toEqual([
      'item-1',
      'item-2',
      'item-3',
      'item-4',
    ]);
  });

  it('matching: 4 cặp, mapping khớp left/right, itemId null', () => {
    const result = buildQuizQuestions({
      questionTypes: ['matching'],
      questionCount: 1,
      languageId: 2,
      items,
      rng: seededRng(7),
    });

    const q = result[0];
    expect(q.questionType).toBe('matching');
    expect(q.questionStyle).toBe('matching');
    expect(q.itemId).toBeNull();
    expect(q.conceptId).toBeNull();
    const options = q.options as {
      index: number;
      text: string;
      side: string;
    }[];
    const left = options.filter((option) => option.side === 'left');
    const right = options.filter((option) => option.side === 'right');
    const mapping = (
      q.correctAnswer as {
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

  it('mỗi từ chỉ dùng tối đa một câu (MC + fill_blank dùng từ khác nhau)', () => {
    const result = buildQuizQuestions({
      questionTypes: ['multiple_choice', 'fill_blank'],
      questionCount: 4,
      languageId: 2,
      items,
      rng: seededRng(3),
    });

    expect(result.map((q) => q.questionType)).toEqual([
      'multiple_choice',
      'fill_blank',
      'multiple_choice',
      'fill_blank',
    ]);
    expect(result.map((q) => q.itemId)).toEqual([
      'item-1',
      'item-2',
      'item-3',
      'item-4',
    ]);
  });

  it('matching tiêu thụ 4 từ mỗi câu; thiếu từ → 409 kèm available/required', () => {
    const twoMatchings = catchDomainError(() =>
      buildQuizQuestions({
        questionTypes: ['matching'],
        questionCount: 2,
        languageId: 2,
        items, // 5 từ, cần 5 + 3 = 8
        rng: seededRng(1),
      }),
    );
    expect(twoMatchings).toMatchObject({
      code: 'QUIZ_NOT_ENOUGH_ITEMS',
      details: { available: 5, required: 8 },
    });

    const oneMatching = catchDomainError(() =>
      buildQuizQuestions({
        questionTypes: ['matching'],
        questionCount: 1,
        languageId: 2,
        items: [item(1), item(2), item(3)], // 3 từ, cần 4
        rng: seededRng(1),
      }),
    );
    expect(oneMatching).toMatchObject({
      code: 'QUIZ_NOT_ENOUGH_ITEMS',
      details: { available: 3, required: 4 },
    });
  });

  it('fill_blank cạn từ trước → 409 kèm required theo số câu fill', () => {
    const error = catchDomainError(() =>
      buildQuizQuestions({
        questionTypes: ['fill_blank'],
        questionCount: 3,
        languageId: 2,
        items: [item(1), item(2)],
        rng: seededRng(1),
      }),
    );
    expect(error).toMatchObject({
      code: 'QUIZ_NOT_ENOUGH_ITEMS',
      details: { available: 2, required: 3 },
    });
  });

  it('phân bổ slot 3 dạng: MC xoay Kanji, mỗi từ xuất hiện đúng một lần', () => {
    const jaItems = Array.from({ length: 12 }, (_value, index) =>
      jaItem(index + 1),
    );
    const result = buildQuizQuestions({
      questionTypes: ['multiple_choice', 'fill_blank', 'matching'],
      questionCount: 6,
      languageId: 2,
      items: jaItems,
      rng: seededRng(5),
    });

    expect(result.map((q) => q.questionType)).toEqual([
      'multiple_choice',
      'fill_blank',
      'matching',
      'multiple_choice',
      'fill_blank',
      'matching',
    ]);
    expect(result.map((q) => q.questionStyle)).toEqual([
      'meaning',
      'fill_blank',
      'matching',
      'kanji_reading',
      'fill_blank',
      'matching',
    ]);

    const consumed = result.flatMap((q) =>
      q.questionType === 'matching'
        ? (q.options as { side?: string; text: string }[])
            .filter((option) => option.side === 'left')
            .map((option) => option.text)
        : [jaItems.find((entry) => entry.itemId === q.itemId)!.lemma],
    );
    expect([...consumed].sort()).toEqual(
      [...jaItems.map((entry) => entry.lemma)].sort(),
    );
    for (const q of result.filter(
      (question) => question.questionType === 'multiple_choice',
    )) {
      expect(q.options as unknown[]).toHaveLength(4);
    }
    for (const q of result.filter(
      (question) => question.questionType === 'matching',
    )) {
      const options = q.options as { side: string }[];
      expect(options.filter((option) => option.side === 'left')).toHaveLength(
        4,
      );
      expect(options.filter((option) => option.side === 'right')).toHaveLength(
        4,
      );
    }
  });

  it('deterministic theo RNG: cùng seed → kết quả giống nhau', () => {
    const build = (seed: number) =>
      buildQuizQuestions({
        questionTypes: ['multiple_choice', 'fill_blank'],
        questionCount: 2,
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

  it('bộ lọc đa nghĩa: MC/matching chỉ lấy từ một nghĩa, fill dùng mọi từ', () => {
    const source = [
      item(1, { lemma: 'run', meaningVi: 'chạy' }),
      item(2, { lemma: ' RUN ', meaningVi: 'điều hành' }),
      item(3, { lemma: 'eat', meaningVi: 'ăn' }),
      item(4, { lemma: 'book', meaningVi: 'sách' }),
      item(5, { lemma: 'go', meaningVi: 'đi' }),
      item(6, { lemma: 'water', meaningVi: 'nước' }),
    ];

    // MC chỉ hỏi các lemma một nghĩa (eat/book/go/water), không lấy 'run'.
    const mc = buildQuizQuestions({
      questionTypes: ['multiple_choice'],
      questionCount: 2,
      languageId: 1,
      items: source,
      rng: seededRng(),
    });
    for (const q of mc) {
      expect(q.prompt.toLowerCase()).not.toContain('run');
    }

    // matching chỉ ghép các từ một nghĩa.
    const matching = buildQuizQuestions({
      questionTypes: ['matching'],
      questionCount: 1,
      languageId: 1,
      items: source,
      rng: seededRng(),
    });
    const leftTexts = (matching[0].options as { side?: string; text: string }[])
      .filter((option) => option.side === 'left')
      .map((option) => option.text.toLowerCase());
    expect(leftTexts).not.toContain('run');
    expect(JSON.stringify(matching[0].options)).not.toMatch(/chạy|điều hành/);

    // fill_blank vẫn dùng được sense đa nghĩa.
    const fill = buildQuizQuestions({
      questionTypes: ['fill_blank'],
      questionCount: 1,
      languageId: 1,
      items: source,
      rng: seededRng(),
    });
    expect(fill[0].prompt).toContain('chạy');
  });

  it('polysemy-only source bị chặn khỏi MC/matching nhưng fill_blank vẫn hợp lệ', () => {
    const source = [
      item(1, { lemma: 'run', meaningVi: 'chạy' }),
      item(2, { lemma: 'run', meaningVi: 'điều hành' }),
    ];
    const mc = catchDomainError(() =>
      buildQuizQuestions({
        questionTypes: ['multiple_choice'],
        questionCount: 1,
        languageId: 1,
        items: source,
        rng: seededRng(),
      }),
    );
    expect(mc).toMatchObject({
      code: 'QUIZ_NOT_ENOUGH_ITEMS',
      details: { available: 0, required: 1 },
    });
    const matching = catchDomainError(() =>
      buildQuizQuestions({
        questionTypes: ['matching'],
        questionCount: 1,
        languageId: 1,
        items: source,
        rng: seededRng(),
      }),
    );
    expect(matching).toMatchObject({
      code: 'QUIZ_NOT_ENOUGH_ITEMS',
      details: { available: 0, required: 4 },
    });
    const fill = buildQuizQuestions({
      questionTypes: ['fill_blank'],
      questionCount: 1,
      languageId: 1,
      items: source,
      rng: seededRng(),
    });
    expect(fill[0].questionStyle).toBe('fill_blank');
    expect(
      (fill[0].correctAnswer as { accepted: string[] }).accepted,
    ).toContain('run');
  });
});
