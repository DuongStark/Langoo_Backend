import { PublicQuizContext } from '../quiz-contract';

export interface QuizResponse {
  id: string;
  collection_id: string | null;
  quiz_type: string;
  difficulty: string;
  question_count: number;
  status: string;
  created_at: string;
  expires_at: string | null;
}

export interface CreateQuizResponse extends QuizResponse {
  /** true khi trả lại quiz vừa tạo trong thời gian cooldown (bấm đúp). */
  reused: boolean;
}

export interface QuizQuestionResponse {
  ordinal: number;
  question_type: string;
  prompt: string;
  options: unknown;
  language_id: number | null;
  question_style: string;
  context: PublicQuizContext | null;
}

export interface QuizSessionSummary {
  id: string;
  status: string;
  item_count: number;
  correct_count: number;
  score: number | null;
  started_at: string;
  finished_at: string | null;
}

export interface QuizListItem extends QuizResponse {
  latest_session: QuizSessionSummary | null;
}

export interface QuizListResponse {
  data: QuizListItem[];
  next_cursor: string | null;
}

export interface QuizDetailResponse {
  quiz: QuizResponse;
  questions: QuizQuestionResponse[];
  sessions: QuizSessionSummary[];
}
