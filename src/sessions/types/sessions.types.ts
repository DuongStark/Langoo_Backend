export interface SessionResponse {
  unique_target_count?: number;
  id: string;
  kind: string;
  mode: string;
  collection_id: string | null;
  status: string;
  item_count: number;
  answered_count: number;
  correct_count: number;
  score: number | null;
  settings: Record<string, unknown>;
  started_at: string;
  finished_at: string | null;
}

export interface SessionItemResponse {
  credit?: { earned: number; possible: number };
  id: string;
  ordinal: number;
  srs_id: string | null;
  face_id: string | null;
  prompt: unknown;
  correct_answer?: unknown;
  user_answer?: unknown;
  is_correct: boolean | null;
  rating: number | null;
  elapsed_ms: number | null;
  answered_at: string | null;
}

export interface SessionDetailResponse {
  skill_summary?: {
    skill: string;
    question_count: number;
    correct_count: number;
    score: number;
  }[];
  session: SessionResponse;
  items: SessionItemResponse[];
}

export interface AnswerResultResponse {
  item: SessionItemResponse;
  /** null với phiên quiz (không gắn thẻ SRS). */
  srs: {
    state: string;
    due_at: string;
    interval_days: number;
    ease_factor: number;
    learning_step: number | null;
  } | null;
  session: SessionResponse;
}

export interface RemoveSessionWordResponse {
  item_id: string;
  collection_id: string;
  removed_ordinals: number[];
  session: SessionResponse;
}
