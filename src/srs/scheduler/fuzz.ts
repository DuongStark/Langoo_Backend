import {
  FUZZ_MIN_DAYS,
  FUZZ_RATIO,
  LEARNING_FUZZ_MAX_MINUTES,
} from './anki.constants';

/** Nguồn ngẫu nhiên inject được — prod dùng Math.random, test dùng seed cố định. */
export interface Rng {
  /** Trả về số thực trong [0, 1). */
  next(): number;
}

export const mathRng: Rng = { next: () => Math.random() };

/**
 * Fuzz interval review theo Anki: chỉ áp khi interval >= 2.5 ngày,
 * delta ngẫu nhiên trong ±5% (làm tròn, tối thiểu 1 ngày biên).
 */
export function fuzzReviewInterval(days: number, rng: Rng): number {
  if (days < FUZZ_MIN_DAYS) {
    return days;
  }
  const fuzz = Math.max(1, Math.round(days * FUZZ_RATIO));
  const delta = Math.round((rng.next() * 2 - 1) * fuzz);
  return Math.max(1, days + delta);
}

/** Bước học được cộng thêm 0–5 phút (Anki: "up to 5 minutes of extra delay"). */
export function fuzzLearningDelay(minutes: number, rng: Rng): number {
  const extra = Math.floor(rng.next() * (LEARNING_FUZZ_MAX_MINUTES + 1));
  return minutes + Math.min(extra, LEARNING_FUZZ_MAX_MINUTES);
}
