import {
  FUZZ_MIN_DAYS,
  LEARNING_FUZZ_MAX_MINUTES,
  MAX_INTERVAL_DAYS,
  MIN_INTERVAL_DAYS,
} from './anki.constants';

/** Nguồn ngẫu nhiên inject được — prod dùng Math.random, test dùng seed cố định. */
export interface Rng {
  /** Trả về số thực trong [0, 1). */
  next(): number;
}

export const mathRng: Rng = { next: () => Math.random() };

/**
 * Fuzz interval review theo Anki 25.09.
 *
 * Anki dùng ba khoảng (2.5–7, 7–20, >20 ngày), không phải một tỷ lệ ±5%
 * duy nhất. `minimum`/`maximum` được truyền vào để việc fuzz vẫn tôn trọng
 * ràng buộc thứ tự Hard < Good < Easy sau khi làm tròn.
 */
export function fuzzReviewInterval(
  days: number,
  rng: Rng,
  minimum = MIN_INTERVAL_DAYS,
  maximum = MAX_INTERVAL_DAYS,
): number {
  const max = Math.max(MIN_INTERVAL_DAYS, Math.round(maximum));
  const min = Math.min(max, Math.max(MIN_INTERVAL_DAYS, Math.round(minimum)));
  const interval = Math.min(max, Math.max(min, days));
  if (interval < FUZZ_MIN_DAYS) {
    return Math.round(interval);
  }

  const delta =
    1 +
    0.15 * Math.max(0, Math.min(interval, 7) - 2.5) +
    0.1 * Math.max(0, Math.min(interval, 20) - 7) +
    0.05 * Math.max(0, interval - 20);
  let lower = Math.round(interval - delta);
  let upper = Math.round(interval + delta);
  lower = Math.max(min, Math.min(max, lower));
  upper = Math.max(min, Math.min(max, upper));
  if (upper === lower && upper > 2 && upper < max) {
    upper += 1;
  }

  return Math.floor(lower + rng.next() * (upper - lower + 1));
}

/** Bước học được cộng thêm 0–5 phút (Anki: "up to 5 minutes of extra delay"). */
export function fuzzLearningDelay(minutes: number, rng: Rng): number {
  const extra = Math.floor(rng.next() * (LEARNING_FUZZ_MAX_MINUTES + 1));
  return minutes + Math.min(extra, LEARNING_FUZZ_MAX_MINUTES);
}
