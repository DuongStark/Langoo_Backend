import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { kanjiInput, kanjiItems } from '../../../test/fixtures/quiz-kanji';
import { gradeQuizAnswer } from '../../sessions/quiz-content';
import { buildQuizQuestions } from './quiz-generator';
import { CreateQuizDto } from './dto/quiz.dto';
import {
  metadataSchema,
  QUIZ_VERSION,
  readQuestionMetadata,
  readingKey,
  QuestionStyle,
} from './quiz-contract';
import {
  assertKanjiPool,
  buildKanjiQuestion,
  createKanjiPool,
} from './kanji-generator';

const RNG = { next: () => 0.5 };

describe('Kanji quiz data generation', () => {
  it('normalizes equivalent kana scripts without erasing dakuten, sokuon or long vowels', () => {
    expect(readingKey('ｶﾞｯｺｳ')).toBe(readingKey('がっこう'));
    expect(readingKey('がっこう')).not.toBe(readingKey('かっこう'));
    expect(readingKey('がっこう')).not.toBe(readingKey('がこう'));
    expect(readingKey('コー')).not.toBe(readingKey('コ'));
    const items = kanjiItems();
    items[0].kanjiPairs!.push({
      written: '学校',
      reading: 'ガッコウ',
      eligible: false,
    });
    expect(buildQuizQuestions(kanjiInput({ items }))[0].itemId).toBe(
      items[0].itemId,
    );
  });

  it('createKanjiPool loại target nếu nghĩa gợi ý lộ chính tả Kanji', () => {
    const items = kanjiItems();
    items[0].meaningVi = '学校 nghĩa là trường học';
    const pool = createKanjiPool(items, 'kanji_orthography');
    expect(pool).not.toHaveLength(0);
    expect(
      pool.some((target) => target.item.senseId === items[0].senseId),
    ).toBe(false);
  });

  it.each(['kanji_reading', 'kanji_orthography'] as const)(
    '%s: 4 options duy nhất và chỉ một đáp án đúng khi chấm',
    (style) => {
      const pool = createKanjiPool(kanjiItems(), style);
      const q = buildKanjiQuestion(pool, style, 0, RNG);
      const options = q.options as { index: number; text: string }[];
      expect(options).toHaveLength(4);
      expect(new Set(options.map((option) => option.text)).size).toBe(4);
      expect(q.questionStyle).toBe(style);
      expect(q.languageId).toBe(22); // language code, not a hardcoded Japanese ID
      for (const option of options) {
        expect(
          gradeQuizAnswer('multiple_choice', q.correctAnswer, {
            optionIndex: option.index,
          })?.isCorrect,
        ).toBe(option.index === q.correctAnswer.index);
      }
      if (style === 'kanji_reading') {
        expect(q.prompt).not.toContain('がっこう');
      } else {
        expect(q.prompt).not.toContain('学校');
      }
    },
  );

  it('createKanjiPool dựng nhiễu từ raw items kể cả từ bị gộp theo nghĩa', () => {
    const items = kanjiItems();
    // items[2] trùng nghĩa items[1] → bị prepareItems gộp khỏi pool câu,
    // nhưng vẫn phải đóng góp nhiễu Kanji.
    items[2].meaningVi = items[1].meaningVi;
    const result = buildQuizQuestions(kanjiInput({ items, questionCount: 3 }));
    expect(result.map((q) => q.questionStyle)).toEqual([
      'meaning',
      'kanji_reading',
      'kanji_orthography',
    ]);
    // Câu nghĩa chỉ còn 2 từ nhiễu trong pool đã gộp nghĩa (3 options)…
    expect(result[0].options as unknown[]).toHaveLength(3);
    // …nhưng câu Kanji vẫn đủ 4 options nhờ nhiễu lấy từ raw items.
    expect(result[1].options as unknown[]).toHaveLength(4);
    expect(result[2].options as unknown[]).toHaveLength(4);
  });

  it('requires four options and respects form eligibility', () => {
    const pool = createKanjiPool(kanjiItems().slice(0, 3), 'kanji_reading');
    expect(pool).toHaveLength(0);
    try {
      assertKanjiPool(pool, 'kanji_reading');
      throw new Error('Mong đợi assertKanjiPool ném lỗi');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'QUIZ_NOT_ENOUGH_ITEMS',
        details: { style: 'kanji_reading', available: 0, required: 4 },
      });
    }
    const ineligible = kanjiItems();
    ineligible.forEach((item) => {
      item.kanjiPairs![0].eligible = false;
    });
    expect(createKanjiPool(ineligible, 'kanji_orthography')).toHaveLength(0);
  });

  it('excludes a target with alternate valid readings, not just its preferred reading', () => {
    const items = kanjiItems();
    items[0].kanjiPairs!.push({
      written: '学校',
      reading: 'がくこう',
      eligible: false,
    });
    const pool = createKanjiPool(items, 'kanji_reading');
    expect(
      pool.some((target) => target.item.senseId === items[0].senseId),
    ).toBe(false);
  });

  it('does not use alternate valid spellings or homophones as wrong orthography options', () => {
    const items = kanjiItems();
    items[0].kanjiPairs!.push({
      written: '學校',
      reading: 'がっこう',
      eligible: false,
    });
    items.push({
      ...items[0],
      itemId: 'alias',
      senseId: '9',
      lemma: '學校',
      kanjiPairs: [{ written: '學校', reading: 'がっこう', eligible: true }],
    });
    const pool = createKanjiPool(items, 'kanji_orthography');
    const target = pool.find(
      (entry) => entry.item.senseId === items[0].senseId,
    )!;
    expect(target).toBeDefined();
    const q = buildKanjiQuestion([target], 'kanji_orthography', 0, RNG);
    expect(JSON.stringify(q.options)).not.toContain('學校');
  });

  it('MC xoay meaning → kanji_reading → kanji_orthography, fallback meaning khi thiếu dữ liệu', () => {
    const rotated = buildQuizQuestions(kanjiInput({ questionCount: 4 }));
    expect(rotated.map((q) => q.questionStyle)).toEqual([
      'meaning',
      'kanji_reading',
      'kanji_orthography',
      'meaning',
    ]);

    const noKanji = kanjiItems().map((item) => ({
      ...item,
      kanjiPairs: [],
    }));
    const fallback = buildQuizQuestions(
      kanjiInput({ items: noKanji, questionCount: 3 }),
    );
    expect(fallback.map((q) => q.questionStyle)).toEqual([
      'meaning',
      'meaning',
      'meaning',
    ]);
    for (const q of fallback) {
      expect(q.questionType).toBe('multiple_choice');
      expect(q.context ?? null).toBeNull();
    }
  });

  it.each([
    undefined,
    null,
    [],
    ['multiple_choice', 'multiple_choice'],
    ['unknown'],
    'multiple_choice',
  ])('rejects malformed question_types %j', async (questionTypes) => {
    const dto = plainToInstance(CreateQuizDto, {
      question_count: 1,
      question_types: questionTypes,
    });
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });

  it('accepts canonical question_types và từ chối field cũ qua whitelist', async () => {
    const dto = plainToInstance(CreateQuizDto, {
      question_count: 5,
      question_types: ['multiple_choice', 'matching'],
    });
    expect(await validate(dto)).toHaveLength(0);

    const legacy = plainToInstance(CreateQuizDto, {
      quiz_type: 'multiple_choice',
      difficulty: 'easy',
      question_styles: ['meaning'],
      context_mode: 'none',
      question_count: 5,
      question_types: ['multiple_choice'],
    });
    expect(
      await validate(legacy, { whitelist: true, forbidNonWhitelisted: true }),
    ).not.toHaveLength(0);
  });

  it('legacy metadata falls back but malformed new metadata is rejected', () => {
    expect(
      readQuestionMetadata({ version: 'm11-v2' }, 1, 'multiple_choice').style,
    ).toBe('meaning');
    expect(() =>
      readQuestionMetadata({ version: QUIZ_VERSION }, 1, 'multiple_choice'),
    ).toThrow();
    expect(metadataSchema.safeParse({ version: QUIZ_VERSION }).success).toBe(
      false,
    );
  });

  it('metadata v2 đọc style theo ordinal và từ chối style sai loại câu', () => {
    const generator = {
      version: QUIZ_VERSION,
      provider: 'stub',
      questionTypes: ['multiple_choice'],
      questions: [
        { ordinal: 1, style: 'kanji_reading', context: null, evidence: null },
      ],
    };
    expect(metadataSchema.safeParse(generator).success).toBe(true);
    expect(readQuestionMetadata(generator, 1, 'multiple_choice').style).toBe(
      'kanji_reading',
    );
    expect(() => readQuestionMetadata(generator, 1, 'matching')).toThrow();
    expect(
      metadataSchema.safeParse({
        version: QUIZ_VERSION,
        provider: 'stub',
        styles: ['meaning'] as QuestionStyle[],
        contextMode: 'none',
        questions: [],
      }).success,
    ).toBe(false);
  });
});
