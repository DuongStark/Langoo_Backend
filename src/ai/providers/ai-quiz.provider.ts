import {
  QuizDifficulty,
  QuizQuestionType,
  QuizType,
} from '../../sessions/quiz-content';
import { Rng } from '../../srs/scheduler/fuzz';

/** Token DI cho provider sinh quiz. */
export const AI_QUIZ_PROVIDER = 'AI_QUIZ_PROVIDER';

/** Một từ nguồn để sinh câu hỏi (đã join sẵn lemma/nghĩa từ serve.sense_card). */
export interface QuizSourceItem {
  itemId: string;
  senseId: string;
  conceptId: string | null;
  languageId: number;
  lemma: string;
  reading: string | null;
  romanization: string | null;
  meaningVi: string;
}

export interface GeneratedQuizQuestion {
  questionType: QuizQuestionType;
  /** Câu hỏi dạng text hiển thị cho người học. */
  prompt: string;
  /** Mảng options (MC) hoặc {left,right} (matching) hoặc [] (fill_blank). */
  options: unknown;
  correctAnswer: Record<string, unknown>;
  explanation: string | null;
  languageId: number;
  conceptId: string | null;
  itemId: string | null;
}

export interface AiQuizGenerateInput {
  quizType: QuizType;
  difficulty: QuizDifficulty;
  questionCount: number;
  languageId: number;
  items: QuizSourceItem[];
  rng: Rng;
}

export interface AiQuizProvider {
  readonly name: string;
  generate(input: AiQuizGenerateInput): Promise<GeneratedQuizQuestion[]>;
}
