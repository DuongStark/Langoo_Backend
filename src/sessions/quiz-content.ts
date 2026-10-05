import { GradedAnswer, gradeAnswer } from './session-content';

/**
 * Nội dung câu hỏi quiz + chấm điểm phía server.
 *
 * - MC (`multiple_choice`) và fill-blank (`fill_blank`) tái dùng `gradeAnswer`
 *   của M7 (mode `multiple_choice` / `typing`) để giữ một chuẩn chấm.
 * - Matching chấm all-or-nothing: mọi cặp phải khớp mới tính đúng.
 */

export const QUIZ_TYPES = [
  'multiple_choice',
  'fill_blank',
  'matching',
  'mixed',
] as const;
export type QuizType = (typeof QUIZ_TYPES)[number];

export const QUIZ_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type QuizDifficulty = (typeof QUIZ_DIFFICULTIES)[number];

export type QuizQuestionType = 'multiple_choice' | 'fill_blank' | 'matching';

export interface QuizPairSubmission {
  left_index: number;
  right_index: number;
}

export interface QuizAnswerSubmission {
  optionIndex?: number;
  answerText?: string;
  pairs?: QuizPairSubmission[];
}

export interface QuizGradedAnswer {
  isCorrect: boolean;
  rating: 1 | 3;
  userAnswer: Record<string, unknown>;
}

/** Chấm 1 câu quiz; null khi thiếu/sai kiểu dữ liệu cần thiết. */
export function gradeQuizAnswer(
  questionType: QuizQuestionType,
  correctAnswer: Record<string, unknown>,
  submission: QuizAnswerSubmission,
): QuizGradedAnswer | null {
  if (questionType === 'multiple_choice') {
    const graded = gradeAnswer('multiple_choice', correctAnswer, {
      optionIndex: submission.optionIndex,
    });
    return graded ? toQuizGraded(graded) : null;
  }

  if (questionType === 'fill_blank') {
    const graded = gradeAnswer('typing', correctAnswer, {
      answerText: submission.answerText,
    });
    return graded ? toQuizGraded(graded) : null;
  }

  return gradeMatching(correctAnswer, submission);
}

function gradeMatching(
  correctAnswer: Record<string, unknown>,
  submission: QuizAnswerSubmission,
): QuizGradedAnswer | null {
  const pairs = submission.pairs;
  if (!Array.isArray(pairs) || pairs.length === 0) {
    return null;
  }
  const mapping = Array.isArray(correctAnswer.mapping)
    ? correctAnswer.mapping
    : [];
  const expected = new Map<number, number>();
  for (const item of mapping) {
    if (
      typeof item === 'object' &&
      item !== null &&
      typeof (item as { left_index?: unknown }).left_index === 'number' &&
      typeof (item as { right_index?: unknown }).right_index === 'number'
    ) {
      expected.set(
        (item as { left_index: number }).left_index,
        (item as { right_index: number }).right_index,
      );
    }
  }
  if (expected.size === 0 || pairs.length !== expected.size) {
    return null;
  }

  const seenLeft = new Set<number>();
  const seenRight = new Set<number>();
  const rightIndices = new Set(expected.values());
  let isCorrect = true;
  for (const pair of pairs) {
    if (
      typeof pair !== 'object' ||
      pair === null ||
      !Number.isInteger(pair.left_index) ||
      !Number.isInteger(pair.right_index) ||
      pair.left_index < 0 ||
      pair.right_index < 0 ||
      seenLeft.has(pair.left_index) ||
      seenRight.has(pair.right_index) ||
      !expected.has(pair.left_index) ||
      !rightIndices.has(pair.right_index)
    ) {
      return null;
    }
    seenLeft.add(pair.left_index);
    seenRight.add(pair.right_index);
    if (expected.get(pair.left_index) !== pair.right_index) {
      isCorrect = false;
    }
  }

  return {
    isCorrect,
    rating: isCorrect ? 3 : 1,
    userAnswer: { pairs },
  };
}

function toQuizGraded(graded: GradedAnswer): QuizGradedAnswer {
  return {
    isCorrect: graded.isCorrect,
    rating: graded.isCorrect ? 3 : 1,
    userAnswer: graded.userAnswer,
  };
}
