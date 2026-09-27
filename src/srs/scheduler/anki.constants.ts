/**
 * Hằng số scheduler theo mặc định Anki — xem docs/srs.md §2.1.
 */
export const LEARNING_STEPS_MINUTES: readonly number[] = [1, 10];
export const RELEARNING_STEPS_MINUTES: readonly number[] = [10];

export const GRADUATING_DAYS = 1;
export const EASY_DAYS = 4;

export const MIN_INTERVAL_DAYS = 1;
export const MAX_INTERVAL_DAYS = 36_500;

export const START_EASE = 2.5;
export const MIN_EASE = 1.3;

export const EASE_DELTA_AGAIN = -0.2;
export const EASE_DELTA_HARD = -0.15;
export const EASE_DELTA_EASY = 0.15;

export const HARD_INTERVAL_MULT = 1.2;
export const EASY_BONUS = 1.3;

/** Anki chỉ fuzz interval từ 2.5 ngày trở lên. */
export const FUZZ_MIN_DAYS = 2.5;
export const FUZZ_RATIO = 0.05;
/** Bước học được cộng thêm ngẫu nhiên 0–5 phút (Anki). */
export const LEARNING_FUZZ_MAX_MINUTES = 5;

export const LEARN_AHEAD_MINUTES = 20;
