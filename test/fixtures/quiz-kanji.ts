import {
  QuizSourceItem,
  AiQuizGenerateInput,
} from '../../src/ai/providers/ai-quiz.provider';

export function kanjiItems(): QuizSourceItem[] {
  return [
    ['学校', 'がっこう', 'trường học', 'school'],
    ['銀行', 'ぎんこう', 'ngân hàng', 'bank (financial institution)'],
    ['電話', 'でんわ', 'điện thoại', 'telephone'],
    ['新聞', 'しんぶん', 'báo', 'newspaper'],
  ].map(([written, reading, meaning, gloss], index) => ({
    itemId: `item-${index + 1}`,
    senseId: `${index + 1}`,
    conceptId: null,
    languageId: 22,
    languageCode: 'ja',
    lemma: written,
    reading,
    romanization: null,
    meaningVi: meaning,
    glossEn: [gloss],
    pos: 'noun',
    glossViMachine: false,
    kanjiPairs: [{ written, reading, eligible: true }],
    examples: [],
  }));
}

export function kanjiInput(
  overrides: Partial<AiQuizGenerateInput> = {},
): AiQuizGenerateInput {
  return {
    quizType: 'multiple_choice',
    difficulty: 'medium',
    questionCount: 1,
    languageId: 22,
    items: kanjiItems(),
    rng: { next: () => 0.5 },
    questionStyles: ['kanji_reading'],
    contextMode: 'none',
    ...overrides,
  };
}
