import { Rating } from '../srs/scheduler/anki.types';
import { Rng } from '../srs/scheduler/fuzz';

export type SessionMode =
  'flashcard' | 'multiple_choice' | 'matching' | 'typing';

export type SessionDirection = 'recognize' | 'recall';

export interface CardContent {
  direction: SessionDirection;
  language: { id: number; code: string; nameVi: string };
  lemma: string;
  reading: string | null;
  romanization: string | null;
  meaningVi: string;
  /** Các form_text của lexeme (kanji/kana) — dùng cho typing. */
  forms: string[];
}

export interface DistractorPool {
  words: string[];
  meanings: string[];
}

export interface BuiltSessionItem {
  prompt: Record<string, unknown>;
  correctAnswer: Record<string, unknown>;
}

export interface AnswerSubmission {
  rating?: number;
  optionIndex?: number;
  answerText?: string;
}

export interface GradedAnswer {
  isCorrect: boolean;
  rating: Rating;
  userAnswer: Record<string, unknown>;
}

const DEFAULT_OPTION_COUNT = 4;
const PASS_RATING: Rating = 3;
const FAIL_RATING: Rating = 1;

/** Dựng prompt + đáp án cho 1 item của phiên (thuần, RNG injectable). */
export function buildSessionItem(
  card: CardContent,
  mode: SessionMode,
  pool: DistractorPool,
  rng: Rng,
  optionCount = DEFAULT_OPTION_COUNT,
): BuiltSessionItem {
  const language = {
    id: card.language.id,
    code: card.language.code,
    name_vi: card.language.nameVi,
  };
  const word = {
    kind: 'word',
    text: card.lemma,
    reading: card.reading,
    romanization: card.romanization,
  };
  const meaning = { kind: 'meaning', text: card.meaningVi };
  const question = card.direction === 'recognize' ? word : meaning;
  const answer = card.direction === 'recognize' ? meaning : word;

  switch (mode) {
    case 'flashcard':
      return {
        prompt: {
          kind: 'flashcard',
          direction: card.direction,
          language,
          question,
        },
        correctAnswer: answer,
      };
    case 'typing': {
      // Gõ đáp án theo đúng chiều thẻ: recognize hỏi từ → gõ nghĩa;
      // recall hỏi nghĩa → gõ từ (chấp nhận lemma/reading/romaji/kanji-kana).
      const accepted =
        card.direction === 'recognize'
          ? uniqueNormalized([card.meaningVi])
          : uniqueNormalized([
              card.lemma,
              card.reading ?? '',
              card.romanization ?? '',
              ...card.forms,
            ]);
      return {
        prompt: {
          kind: 'typing',
          direction: card.direction,
          language,
          question,
        },
        correctAnswer: { accepted },
      };
    }
    case 'multiple_choice':
    case 'matching': {
      const answerText =
        card.direction === 'recognize' ? card.meaningVi : card.lemma;
      const source =
        card.direction === 'recognize' ? pool.meanings : pool.words;
      const distractors = uniqueTexts(
        source.filter(
          (text) => normalizeAnswer(text) !== normalizeAnswer(answerText),
        ),
      ).slice(0, Math.max(0, optionCount - 1));
      const options = shuffle([answerText, ...distractors], rng).map(
        (text, index) => ({ index, text }),
      );
      const index = options.findIndex((option) => option.text === answerText);
      return {
        prompt: {
          kind: mode,
          direction: card.direction,
          language,
          question,
          options,
        },
        correctAnswer: { index, text: answerText },
      };
    }
  }
}

/** Chấm đáp án ở server; trả null khi thiếu/sai kiểu dữ liệu cần thiết. */
export function gradeAnswer(
  mode: SessionMode,
  correctAnswer: Record<string, unknown>,
  submission: AnswerSubmission,
): GradedAnswer | null {
  switch (mode) {
    case 'flashcard': {
      const rating = submission.rating;
      if (
        typeof rating !== 'number' ||
        !Number.isInteger(rating) ||
        rating < 1 ||
        rating > 4
      ) {
        return null;
      }
      return {
        isCorrect: rating >= PASS_RATING,
        rating: rating as Rating,
        userAnswer: { rating },
      };
    }
    case 'multiple_choice':
    case 'matching': {
      const optionIndex = submission.optionIndex;
      const correctIndex = correctAnswer.index;
      if (
        typeof optionIndex !== 'number' ||
        !Number.isInteger(optionIndex) ||
        optionIndex < 0 ||
        typeof correctIndex !== 'number'
      ) {
        return null;
      }
      const isCorrect = optionIndex === correctIndex;
      return {
        isCorrect,
        rating: isCorrect ? PASS_RATING : FAIL_RATING,
        userAnswer: { option_index: optionIndex },
      };
    }
    case 'typing': {
      const raw = submission.answerText;
      if (typeof raw !== 'string' || raw.trim() === '') {
        return null;
      }
      const accepted = Array.isArray(correctAnswer.accepted)
        ? (correctAnswer.accepted as unknown[]).filter(
            (value): value is string => typeof value === 'string',
          )
        : [];
      const normalized = normalizeAnswer(raw);
      const isCorrect = accepted.some(
        (value) => normalizeAnswer(value) === normalized,
      );
      return {
        isCorrect,
        rating: isCorrect ? PASS_RATING : FAIL_RATING,
        userAnswer: { text: raw },
      };
    }
  }
}

export function normalizeAnswer(value: string): string {
  return value.trim().toLowerCase();
}

function uniqueTexts(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = value.trim();
    if (text === '' || seen.has(normalizeAnswer(text))) {
      continue;
    }
    seen.add(normalizeAnswer(text));
    result.push(text);
  }
  return result;
}

function uniqueNormalized(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string' || value.trim() === '') {
      continue;
    }
    const normalized = normalizeAnswer(value);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(value);
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
