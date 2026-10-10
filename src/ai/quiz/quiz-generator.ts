import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import {
  QuizDifficulty,
  QuizQuestionType,
  QuizType,
} from '../../sessions/quiz-content';
import { Rng } from '../../srs/scheduler/fuzz';
import {
  GeneratedQuizQuestion,
  QuizSourceItem,
} from '../providers/ai-quiz.provider';
import {
  assertQuizConfig,
  canonicalStyles,
  ContextMode,
  QuestionStyle,
} from './quiz-contract';
import {
  assertKanjiPool,
  buildKanjiQuestion,
  createKanjiPool,
  KanjiTarget,
} from './kanji-generator';

export interface QuizGeneratorInput {
  quizType: QuizType;
  difficulty: QuizDifficulty;
  questionCount: number;
  languageId: number;
  items: QuizSourceItem[];
  rng: Rng;
  questionStyles?: QuestionStyle[];
  contextMode?: ContextMode;
}

/**
 * Sinh câu hỏi quiz (thuần, RNG injectable — stub provider dùng hàm này).
 *
 * Ngữ nghĩa difficulty của stub:
 * - MC: easy 3 phương án, medium/hard 4 (nếu đủ nhiễu).
 * - Fill-blank: easy/medium chấp nhận cả romaji, hard chỉ lemma + reading.
 * - Matching: K = 3 (easy) hoặc 4, tối đa bằng số từ nguồn.
 */
export function buildQuizQuestions(
  input: QuizGeneratorInput,
): GeneratedQuizQuestion[] {
  const items = prepareItems(input.items);
  assertQuizConfig(input.quizType, input.questionStyles, input.contextMode);
  const styles = canonicalStyles(input.questionStyles);
  const kanjiPools = new Map<QuestionStyle, KanjiTarget[]>();
  for (const style of styles) {
    if (style !== 'meaning') {
      const pool = createKanjiPool(input.items, style);
      assertKanjiPool(pool, style);
      kanjiPools.set(style, pool);
    }
  }

  const sequence = questionTypeSequence(input.quizType, input.questionCount);
  // A lemma with distinct meanings cannot be disambiguated by our stub prompts.
  // Inspect the raw source before meaning dedup so a discarded synonym cannot
  // hide another sense of the same word.
  const meaningsByLemma = new Map<string, Set<string>>();
  for (const item of input.items) {
    if (item.lemma.trim() === '' || item.meaningVi.trim() === '') continue;
    const key = normalizeText(item.lemma);
    const meanings = meaningsByLemma.get(key) ?? new Set<string>();
    meanings.add(normalizeText(item.meaningVi));
    meaningsByLemma.set(key, meanings);
  }
  const unambiguous = items.filter(
    (item) => meaningsByLemma.get(normalizeText(item.lemma))?.size === 1,
  );
  let mcOrdinal = 0;
  return sequence.map((type, index) => {
    const style =
      type === 'multiple_choice'
        ? styles[mcOrdinal++ % styles.length]
        : undefined;
    if (style !== undefined && style !== 'meaning')
      return buildKanjiQuestion(
        kanjiPools.get(style)!,
        style,
        Math.floor((mcOrdinal - 1) / styles.length),
        input.rng,
        input.difficulty,
      );
    const source = type === 'fill_blank' ? items : unambiguous;
    assertQuizCanGenerate(source);
    return {
      ...buildQuestion(
        type,
        index,
        input.difficulty,
        input.languageId,
        source,
        input.rng,
      ),
      questionStyle: type === 'multiple_choice' ? ('meaning' as const) : type,
      context: null,
      evidence: null,
    };
  });
}

/** Kiểm tra nguồn từ vựng trước khi tiêu quota — ném 409 khi không đủ. */
export function assertQuizCanGenerate(rawItems: QuizSourceItem[]): void {
  const items = prepareItems(rawItems);
  if (items.length < 2) {
    throw new DomainException(
      'QUIZ_NOT_ENOUGH_ITEMS',
      'Cần ít nhất 2 từ trong bộ sưu tập để tạo câu hỏi',
      HttpStatus.CONFLICT,
      { available: items.length, required: 2 },
    );
  }
}

/** Loại từ trùng nghĩa/rỗng, giữ thứ tự ưu tiên từ repository. */
export function prepareItems(rawItems: QuizSourceItem[]): QuizSourceItem[] {
  const seen = new Set<string>();
  const result: QuizSourceItem[] = [];
  for (const item of rawItems) {
    const meaning = item.meaningVi.trim();
    const lemma = item.lemma.trim();
    if (meaning === '' || lemma === '') {
      continue;
    }
    const key = normalizeText(meaning);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({ ...item, meaningVi: meaning, lemma });
  }
  return result;
}

export function questionTypeSequence(
  quizType: QuizType,
  questionCount: number,
): QuizQuestionType[] {
  const cycle: QuizQuestionType[] =
    quizType === 'mixed'
      ? ['multiple_choice', 'fill_blank', 'matching']
      : [quizType];
  return Array.from(
    { length: questionCount },
    (_value, index) => cycle[index % cycle.length],
  );
}

function buildQuestion(
  type: QuizQuestionType,
  questionIndex: number,
  difficulty: QuizDifficulty,
  languageId: number,
  items: QuizSourceItem[],
  rng: Rng,
): GeneratedQuizQuestion {
  if (type === 'matching') {
    return buildMatchingQuestion(questionIndex, difficulty, items, rng);
  }
  const item = items[questionIndex % items.length];
  return type === 'multiple_choice'
    ? buildMultipleChoice(item, questionIndex, difficulty, items, rng)
    : buildFillBlank(item, difficulty, languageId);
}

function buildMultipleChoice(
  item: QuizSourceItem,
  questionIndex: number,
  difficulty: QuizDifficulty,
  items: QuizSourceItem[],
  rng: Rng,
): GeneratedQuizQuestion {
  const optionCount = difficulty === 'easy' ? 3 : 4;
  const distractors: string[] = [];
  for (
    let step = 1;
    step < items.length && distractors.length < optionCount - 1;
    step += 1
  ) {
    const candidate = items[(questionIndex + step) % items.length];
    if (normalizeText(candidate.meaningVi) === normalizeText(item.meaningVi)) {
      continue;
    }
    if (
      distractors.some(
        (text) => normalizeText(text) === normalizeText(candidate.meaningVi),
      )
    ) {
      continue;
    }
    distractors.push(candidate.meaningVi);
  }

  if (distractors.length === 0) {
    throw new DomainException(
      'QUIZ_NOT_ENOUGH_ITEMS',
      'Cần thêm từ khác nghĩa để làm phương án nhiễu',
      HttpStatus.CONFLICT,
      { available: items.length, required: 2 },
    );
  }

  const options = shuffle([item.meaningVi, ...distractors], rng).map(
    (text, index) => ({ index, text }),
  );
  const index = options.findIndex((option) => option.text === item.meaningVi);
  const reading = item.reading ? ` (${item.reading})` : '';

  return {
    questionType: 'multiple_choice',
    prompt: `Nghĩa của 「${item.lemma}」${reading} là gì?`,
    options,
    correctAnswer: { index, text: item.meaningVi },
    explanation: null,
    languageId: item.languageId,
    conceptId: item.conceptId,
    itemId: item.itemId,
  };
}

function buildFillBlank(
  item: QuizSourceItem,
  difficulty: QuizDifficulty,
  languageId: number,
): GeneratedQuizQuestion {
  const accepted = uniqueNormalized([
    item.lemma,
    item.reading ?? '',
    difficulty === 'hard' ? '' : (item.romanization ?? ''),
  ]);

  return {
    questionType: 'fill_blank',
    prompt: `Điền từ còn thiếu (nghĩa: "${item.meaningVi}")`,
    options: [],
    correctAnswer: { accepted },
    explanation: null,
    languageId: item.languageId ?? languageId,
    conceptId: item.conceptId,
    itemId: item.itemId,
  };
}

function buildMatchingQuestion(
  questionIndex: number,
  difficulty: QuizDifficulty,
  items: QuizSourceItem[],
  rng: Rng,
): GeneratedQuizQuestion {
  const want = difficulty === 'easy' ? 3 : 4;
  const size = Math.min(want, items.length);
  const chosen: QuizSourceItem[] = [];
  for (let step = 0; step < items.length && chosen.length < size; step += 1) {
    const candidate = items[(questionIndex * size + step) % items.length];
    if (!chosen.some((entry) => entry.itemId === candidate.itemId)) {
      chosen.push(candidate);
    }
  }
  if (chosen.length < 2) {
    throw new DomainException(
      'QUIZ_NOT_ENOUGH_ITEMS',
      'Cần ít nhất 2 từ để tạo câu ghép cặp',
      HttpStatus.CONFLICT,
      { available: chosen.length, required: 2 },
    );
  }

  const left = shuffle(chosen, rng);
  const right = shuffle(chosen, rng);
  const leftOptions = left.map((entry, index) => ({
    index,
    text: entry.lemma,
  }));
  const rightOptions = right.map((entry, index) => ({
    index,
    text: entry.meaningVi,
  }));
  const mapping = left.map((entry, leftIndex) => ({
    left_index: leftIndex,
    right_index: right.findIndex(
      (candidate) => candidate.meaningVi === entry.meaningVi,
    ),
  }));

  return {
    questionType: 'matching',
    prompt: 'Ghép từ với nghĩa tương ứng',
    // Cột options buộc jsonb array (CHECK 023) → gắn nhãn side rồi tách khi start.
    options: [
      ...leftOptions.map((option) => ({ ...option, side: 'left' })),
      ...rightOptions.map((option) => ({ ...option, side: 'right' })),
    ],
    correctAnswer: { mapping },
    explanation: null,
    languageId: left[0].languageId,
    conceptId: null,
    itemId: null,
  };
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function uniqueNormalized(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed === '') {
      continue;
    }
    const key = normalizeText(trimmed);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function shuffle<T>(values: T[], rng: Rng): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng.next() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
