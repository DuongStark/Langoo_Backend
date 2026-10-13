import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { QuizQuestionType } from '../../sessions/quiz-content';
import { Rng } from '../../srs/scheduler/fuzz';
import {
  GeneratedQuizQuestion,
  QuizSourceItem,
} from '../providers/ai-quiz.provider';
import { canonicalQuestionTypes, QuestionStyle } from './quiz-contract';
import {
  buildKanjiQuestion,
  createKanjiPool,
  KanjiTarget,
} from './kanji-generator';

export interface QuizGeneratorInput {
  /** Checkbox dạng câu hỏi người dùng chọn (subset của 3 dạng). */
  questionTypes: QuizQuestionType[];
  questionCount: number;
  languageId: number;
  items: QuizSourceItem[];
  rng: Rng;
}

/** Trắc nghiệm tự luân phiên nghĩa → đọc Kanji → chọn chữ Kanji. */
const MCQ_STYLE_ROTATION: QuestionStyle[] = [
  'meaning',
  'kanji_reading',
  'kanji_orthography',
];
const MATCHING_SIZE = 4;

/** Slot dạng câu hỏi: luân phiên các dạng được chọn để có tỉ lệ xuất hiện đều. */
export function questionTypeSlots(
  questionTypes: QuizQuestionType[],
  questionCount: number,
): QuizQuestionType[] {
  const types = canonicalQuestionTypes(questionTypes);
  if (types.length === 0) {
    throw new DomainException(
      'VALIDATION_FAILED',
      'Cần ít nhất một dạng câu hỏi',
      HttpStatus.BAD_REQUEST,
    );
  }
  return Array.from(
    { length: questionCount },
    (_value, index) => types[index % types.length],
  );
}

/**
 * Sinh câu hỏi quiz (thuần, RNG injectable — stub provider dùng hàm này).
 *
 * Không còn độ khó: MC 4 phương án (nếu đủ nhiễu), matching 4 cặp, fill nhận
 * cả lemma/reading/romaji. Mỗi từ chỉ dùng cho tối đa một câu; dạng Kanji nằm
 * trong trắc nghiệm như mặc định và tự fallback về câu nghĩa khi từ không có
 * cặp Kanji–kana hợp lệ.
 */
export function buildQuizQuestions(
  input: QuizGeneratorInput,
): GeneratedQuizQuestion[] {
  const items = prepareItems(input.items);
  const questionTypes = canonicalQuestionTypes(input.questionTypes);
  if (questionTypes.length === 0) {
    throw new DomainException(
      'VALIDATION_FAILED',
      'Cần ít nhất một dạng câu hỏi',
      HttpStatus.BAD_REQUEST,
    );
  }
  assertQuizCanGenerate(items);

  // Luân phiên các dạng được chọn để có tỉ lệ xuất hiện đều; mỗi câu matching
  // tiêu thụ 4 từ nguồn.
  const slots = questionTypeSlots(questionTypes, input.questionCount);
  const matchingSlots = slots.filter((type) => type === 'matching').length;
  const required = slots.length + matchingSlots * (MATCHING_SIZE - 1);
  if (items.length < required) {
    throw new DomainException(
      'QUIZ_NOT_ENOUGH_ITEMS',
      'Bộ sưu tập không đủ từ cho số câu hỏi yêu cầu',
      HttpStatus.CONFLICT,
      { available: items.length, required },
    );
  }

  const kanjiPools: Partial<Record<QuestionStyle, KanjiTarget[]>> = {};
  for (const style of ['kanji_reading', 'kanji_orthography'] as const) {
    const pool = createKanjiPool(items, style);
    if (pool.length > 0) kanjiPools[style] = pool;
  }

  let cursor = 0;
  let mcOrdinal = 0;
  const questions: GeneratedQuizQuestion[] = [];
  for (const type of slots) {
    if (type === 'matching') {
      const chosen = items.slice(cursor, cursor + MATCHING_SIZE);
      cursor += chosen.length;
      questions.push(buildMatchingQuestion(chosen, input.rng));
      continue;
    }
    const item = items[cursor];
    cursor += 1;
    if (type === 'fill_blank') {
      questions.push(buildFillBlank(item, input.languageId));
      continue;
    }
    const style = MCQ_STYLE_ROTATION[mcOrdinal % MCQ_STYLE_ROTATION.length];
    mcOrdinal += 1;
    const kanji =
      style === 'meaning'
        ? null
        : buildKanjiQuestionForItem(
            item,
            kanjiPools[style] ?? [],
            style,
            input.rng,
          );
    questions.push(kanji ?? buildMultipleChoice(item, items, input.rng));
  }
  return questions;
}

/** Câu Kanji dựng riêng cho đúng một từ; null khi từ thiếu dữ liệu cho dạng đó. */
function buildKanjiQuestionForItem(
  item: QuizSourceItem,
  pool: KanjiTarget[],
  style: QuestionStyle,
  rng: Rng,
): GeneratedQuizQuestion | null {
  const targets = pool.filter((target) => target.item.senseId === item.senseId);
  if (targets.length === 0) return null;
  return buildKanjiQuestion(targets, style, 0, rng);
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

function buildMultipleChoice(
  item: QuizSourceItem,
  items: QuizSourceItem[],
  rng: Rng,
): GeneratedQuizQuestion {
  const optionCount = 4;
  const distractors: string[] = [];
  for (const candidate of shuffle(items, rng)) {
    if (distractors.length >= optionCount - 1) break;
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
  languageId: number,
): GeneratedQuizQuestion {
  const accepted = uniqueNormalized([
    item.lemma,
    item.reading ?? '',
    item.romanization ?? '',
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
  chosen: QuizSourceItem[],
  rng: Rng,
): GeneratedQuizQuestion {
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
