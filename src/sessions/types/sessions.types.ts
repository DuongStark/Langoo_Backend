export interface SessionResponse {
  id: string;
  kind: string;
  mode: string;
  collection_id: string | null;
  status: string;
  item_count: number;
  answered_count: number;
  correct_count: number;
  score: number | null;
  xp_awarded: number;
  settings: Record<string, unknown>;
  started_at: string;
  finished_at: string | null;
}

export interface SessionItemResponse {
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
  session: SessionResponse;
  items: SessionItemResponse[];
}

export interface AnswerResultResponse {
  item: SessionItemResponse;
  srs: {
    state: string;
    due_at: string;
    interval_days: number;
    ease_factor: number;
    learning_step: number | null;
  };
  xp: { amount: number };
  session: SessionResponse;
}
