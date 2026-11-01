import { ImageContract } from '../../media/types/image.types';

export interface LocalizedWord {
  kind: 'word';
  text: string;
  reading: string | null;
  romanization: string | null;
  pos: string | null;
}

export interface LocalizedMeaning {
  kind: 'meaning';
  text: string;
  meaning_source: string;
  is_machine_generated: boolean;
}

export interface DueCard {
  srs_id: string;
  face_id: string;
  item_id: string;
  collection_id: string;
  direction: string;
  state: string;
  language: { id: number; code: string; name_vi: string };
  instruction: string;
  prompt: LocalizedWord | LocalizedMeaning;
  answer: LocalizedWord | LocalizedMeaning;
  due_at: string;
  meaning_source: string;
  is_machine_generated: boolean;
  image: ImageContract | null;
}

export interface DueResult {
  data: DueCard[];
  next_cursor: string | null;
  counts: { learning: number; review: number; new: number };
}

export interface ReviewResult {
  review_log: {
    id: string;
    rating: number;
    mode: string;
    prev_state: string | null;
    reviewed_at: string;
  };
  srs: {
    state: string;
    due_at: string;
    interval_days: number;
    ease_factor: number;
    learning_step: number | null;
  };
  xp: { amount: number };
}

export interface StatsResult {
  due_now: number;
  due_today: number;
  learning: number;
  new_introduced_today: number;
  reviews_today: number;
  accuracy_7d: number | null;
}
