import {
  QuizDifficulty,
  QuizQuestionType,
  QuizType,
} from '../../sessions/quiz-content';
import { Rng } from '../../srs/scheduler/fuzz';
import {
  ContextMode,
  QuestionStyle,
  PublicQuizContext,
  ContextEvidence,
} from '../quiz/quiz-contract';

export interface KanjiPair {
  written: string;
  reading: string;
  eligible: boolean;
}
export interface QuizExample {
  id: string;
  sentence: string;
  attribution: string;
  sourceHash: string;
}
export interface QuizTokenUsage {
  tokensIn: number;
  tokensOut: number;
  calls: number;
  reused: number;
  local: number;
  estimated?: boolean;
}

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
  languageCode?: string;
  kanjiPairs?: KanjiPair[];
  pos?: string | null;
  glossEn?: string[];
  glossViMachine?: boolean;
  examples?: QuizExample[];
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
  questionStyle?: QuestionStyle | 'matching' | 'fill_blank';
  context?: PublicQuizContext | null;
  evidence?: ContextEvidence | null;
  /** Internal target identity; never returned before answering. */
  kanjiTarget?: {
    senseId: string;
    written: string;
    reading: string;
    validWritten?: string[];
    validReadings?: string[];
  };
}

export interface AiQuizGenerateInput {
  quizType: QuizType;
  difficulty: QuizDifficulty;
  questionCount: number;
  languageId: number;
  items: QuizSourceItem[];
  rng: Rng;
  questionStyles?: QuestionStyle[];
  contextMode?: ContextMode;
  /** Already built inside claim transaction; preserves its preflight selection. */
  baseQuestions?: GeneratedQuizQuestion[];
  contextEvidence?: ContextEvidence[];
  usage?: QuizTokenUsage;
}

export interface AiQuizProvider {
  readonly name: string;
  generate(input: AiQuizGenerateInput): Promise<GeneratedQuizQuestion[]>;
  /** Configuration validation only: never calls a model or holds a DB lock. */
  preflight?(input: AiQuizGenerateInput): void;
}
