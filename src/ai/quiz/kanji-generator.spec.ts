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
} from './quiz-contract';

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
  it('rejects an orthography target if its meaning clue exposes the correct spelling', () => {
    const items = kanjiItems();
    items[0].meaningVi = '学校 nghĩa là trường học';
    const result = buildQuizQuestions(
      kanjiInput({
        items,
        questionStyles: ['kanji_orthography'],
        questionCount: 3,
      }),
    );
    expect(result.every((q) => q.itemId !== items[0].itemId)).toBe(true);
  });
  it.each(['kanji_reading', 'kanji_orthography'] as const)(
    '%s has four unique options and grades only one answer',
    (style) => {
      const q = buildQuizQuestions(
        kanjiInput({ questionStyles: [style], difficulty: 'easy' }),
      )[0];
      const options = q.options as { index: number; text: string }[];
      expect(options).toHaveLength(4);
      expect(new Set(options.map((o) => o.text)).size).toBe(4);
      expect(q.languageId).toBe(22); // language code, not a hardcoded Japanese ID
      for (const o of options)
        expect(
          gradeQuizAnswer('multiple_choice', q.correctAnswer, {
            optionIndex: o.index,
          })?.isCorrect,
        ).toBe(o.index === q.correctAnswer.index);
      if (style === 'kanji_reading') expect(q.prompt).not.toContain('がっこう');
      else expect(q.prompt).not.toContain('学校');
    },
  );

  it('meaning dedup does not remove Kanji items with identical meanings', () => {
    const items = kanjiItems().map((i) => ({ ...i, meaningVi: 'cùng nghĩa' }));
    expect(
      buildQuizQuestions(kanjiInput({ items, questionCount: 4 })),
    ).toHaveLength(4);
  });
  it('requires four options and respects form eligibility', () => {
    expect(() =>
      buildQuizQuestions(kanjiInput({ items: kanjiItems().slice(0, 3) })),
    ).toThrow();
    const items = kanjiItems();
    items.forEach((i) => {
      i.kanjiPairs![0].eligible = false;
    });
    expect(() => buildQuizQuestions(kanjiInput({ items }))).toThrow();
  });
  it('excludes a target with alternate valid readings, not just its preferred reading', () => {
    const items = kanjiItems();
    items[0].kanjiPairs!.push({
      written: '学校',
      reading: 'がくこう',
      eligible: false,
    });
    const result = buildQuizQuestions(kanjiInput({ items, questionCount: 6 }));
    expect(result.every((q) => q.itemId !== items[0].itemId)).toBe(true);
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
    const q = buildQuizQuestions(
      kanjiInput({ items, questionStyles: ['kanji_orthography'] }),
    )[0];
    expect(JSON.stringify(q.options)).not.toContain('學校');
  });
  it('cycles MC styles in mixed without changing matching or fill_blank', () => {
    const result = buildQuizQuestions(
      kanjiInput({
        quizType: 'mixed',
        questionCount: 9,
        questionStyles: ['kanji_orthography', 'meaning', 'kanji_reading'],
      }),
    );
    expect(result.map((q) => q.questionStyle)).toEqual([
      'meaning',
      'fill_blank',
      'matching',
      'kanji_reading',
      'fill_blank',
      'matching',
      'kanji_orthography',
      'fill_blank',
      'matching',
    ]);
  });
  it.each([null, [], ['meaning', 'meaning'], ['unknown'], 'kanji_reading'])(
    'rejects malformed styles %j',
    async (styles) => {
      const dto = plainToInstance(CreateQuizDto, {
        quiz_type: 'multiple_choice',
        difficulty: 'easy',
        question_count: 1,
        question_styles: styles,
      });
      expect((await validate(dto)).length).toBeGreaterThan(0);
    },
  );
  it('rejects style config for incompatible types and context without Kanji', () => {
    expect(() =>
      buildQuizQuestions(kanjiInput({ quizType: 'matching' })),
    ).toThrow();
    expect(() =>
      buildQuizQuestions(
        kanjiInput({ questionStyles: ['meaning'], contextMode: 'source' }),
      ),
    ).toThrow();
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
});
