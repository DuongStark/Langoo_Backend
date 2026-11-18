import { PublicQuizContext, PublicQuizSegments } from '../quiz-contract';

export interface QuizResponse {
  content_version?: 'm11.5-v1';
  id: string;
  collection_id: string | null;
  quiz_type: string;
  question_count: number;
  status: string;
  created_at: string;
  expires_at: string | null;
}

export interface CreateQuizResponse extends QuizResponse {
  /** true khi trả lại quiz vừa tạo trong thời gian cooldown hoặc cùng idempotency_key. */
  reused: boolean;
}

export interface QuizQuestionResponse {
  skill?: string;
  quality_flags?: string[];
  ordinal: number;
  question_type: string;
  prompt: string;
  options: unknown;
  language_id: number | null;
  question_style: string;
  context: PublicQuizContext | null;
  segments?: PublicQuizSegments | null;
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
