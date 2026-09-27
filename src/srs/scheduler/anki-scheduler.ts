import {
  EASE_DELTA_AGAIN,
  EASE_DELTA_EASY,
  EASE_DELTA_HARD,
  EASY_BONUS,
  EASY_DAYS,
  GRADUATING_DAYS,
  HARD_INTERVAL_MULT,
  LEARNING_STEPS_MINUTES,
  MAX_INTERVAL_DAYS,
  MIN_EASE,
  MIN_INTERVAL_DAYS,
  RELEARNING_STEPS_MINUTES,
} from './anki.constants';
import {
  CardState,
  RATING,
  Rating,
  ScheduleResult,
  SchedulerState,
} from './anki.types';
import { fuzzLearningDelay, fuzzReviewInterval, Rng, mathRng } from './fuzz';

/**
 * Scheduler theo mô hình Anki (docs/srs.md §2): learning steps + SM-2 biến thể Anki.
 * Module thuần — không phụ thuộc DB; RNG inject để test tất định.
 */
export class AnkiScheduler {
  constructor(private readonly rng: Rng = mathRng) {}

  schedule(current: SchedulerState, rating: Rating, now: Date): ScheduleResult {
    switch (current.state) {
      case 'new':
        return this.fromNew(current, rating, now);
      case 'learning':
        return this.fromLearning(current, rating, now);
      case 'review':
        return this.fromReview(current, rating, now);
      case 'relearning':
        return this.fromRelearning(current, rating, now);
    }
  }

  // ------------------------------------------------------------------ new
  private fromNew(
    current: SchedulerState,
    rating: Rating,
    now: Date,
  ): ScheduleResult {
    switch (rating) {
      case RATING.Again:
        return this.step(
          current,
          'learning',
          0,
          LEARNING_STEPS_MINUTES[0],
          now,
        );
      case RATING.Hard:
        return this.step(
          current,
          'learning',
          0,
          this.hardFirstStepDelay(),
          now,
        );
      case RATING.Good:
        if (LEARNING_STEPS_MINUTES.length > 1) {
          return this.step(
            current,
            'learning',
            1,
            LEARNING_STEPS_MINUTES[1],
            now,
          );
        }
        return this.graduate(current, GRADUATING_DAYS, now);
      case RATING.Easy:
        return this.graduate(current, EASY_DAYS, now);
    }
  }

  // -------------------------------------------------------------- learning
  private fromLearning(
    current: SchedulerState,
    rating: Rating,
    now: Date,
  ): ScheduleResult {
    const step = current.learningStep ?? 0;
    switch (rating) {
      case RATING.Again:
        return this.step(
          current,
          'learning',
          0,
          LEARNING_STEPS_MINUTES[0],
          now,
        );
      case RATING.Hard: {
        const delay =
          step === 0
            ? this.hardFirstStepDelay()
            : this.repeatStepDelay(step, LEARNING_STEPS_MINUTES);
        return this.step(current, 'learning', step, delay, now);
      }
      case RATING.Good: {
        const nextStep = step + 1;
        if (nextStep < LEARNING_STEPS_MINUTES.length) {
          return this.step(
            current,
            'learning',
            nextStep,
            LEARNING_STEPS_MINUTES[nextStep],
            now,
          );
        }
        return this.graduate(current, GRADUATING_DAYS, now);
      }
      case RATING.Easy:
        return this.graduate(current, EASY_DAYS, now);
    }
  }

  // ---------------------------------------------------------------- review
  private fromReview(
    current: SchedulerState,
    rating: Rating,
    now: Date,
  ): ScheduleResult {
    const interval = Math.max(current.intervalDays, MIN_INTERVAL_DAYS);
    switch (rating) {
      case RATING.Again: {
        const delay = this.learningDelay(RELEARNING_STEPS_MINUTES[0]);
        return {
          state: 'relearning',
          easeFactor: this.clampEase(current.easeFactor + EASE_DELTA_AGAIN),
          learningStep: 0,
          intervalDays: interval, // giữ lại để tham chiếu; tốt nghiệp sẽ về min 1d
          delayMinutes: delay,
          dueAt: this.minutesFromNow(now, delay),
          introduced: false,
        };
      }
      case RATING.Hard:
        return this.reviewResult(
          current,
          this.nextReviewInterval(interval * HARD_INTERVAL_MULT, interval),
          this.clampEase(current.easeFactor + EASE_DELTA_HARD),
          now,
        );
      case RATING.Good:
        return this.reviewResult(
          current,
          this.nextReviewInterval(interval * current.easeFactor, interval),
          current.easeFactor,
          now,
        );
      case RATING.Easy:
        return this.reviewResult(
          current,
          this.nextReviewInterval(
            interval * current.easeFactor * EASY_BONUS,
            interval,
          ),
          this.clampEase(current.easeFactor + EASE_DELTA_EASY),
          now,
        );
    }
  }

  // ------------------------------------------------------------ relearning
  private fromRelearning(
    current: SchedulerState,
    rating: Rating,
    now: Date,
  ): ScheduleResult {
    const step = current.learningStep ?? 0;
    switch (rating) {
      case RATING.Again:
        return this.step(
          current,
          'relearning',
          0,
          RELEARNING_STEPS_MINUTES[0],
          now,
        );
      case RATING.Hard:
        return this.step(
          current,
          'relearning',
          step,
          this.repeatStepDelay(step, RELEARNING_STEPS_MINUTES),
          now,
        );
      // New interval của Anki mặc định 0.00 → tốt nghiệp về min 1 ngày.
      case RATING.Good:
      case RATING.Easy:
        return {
          state: 'review',
          easeFactor: current.easeFactor,
          learningStep: null,
          intervalDays: MIN_INTERVAL_DAYS,
          delayMinutes: null,
          dueAt: this.daysFromNow(now, MIN_INTERVAL_DAYS),
          introduced: false,
        };
    }
  }

  // ------------------------------------------------------------------ util
  private step(
    current: SchedulerState,
    state: CardState,
    step: number,
    delayMinutes: number,
    now: Date,
  ): ScheduleResult {
    const delay = this.learningDelay(delayMinutes);
    return {
      state,
      easeFactor: current.easeFactor,
      learningStep: step,
      intervalDays: 0,
      delayMinutes: delay,
      dueAt: this.minutesFromNow(now, delay),
      introduced: current.state === 'new',
    };
  }

  private graduate(
    current: SchedulerState,
    intervalDays: number,
    now: Date,
  ): ScheduleResult {
    const interval = fuzzReviewInterval(intervalDays, this.rng);
    return {
      state: 'review',
      easeFactor: current.easeFactor,
      learningStep: null,
      intervalDays: interval,
      delayMinutes: null,
      dueAt: this.daysFromNow(now, interval),
      introduced: current.state === 'new',
    };
  }

  private reviewResult(
    current: SchedulerState,
    intervalDays: number,
    easeFactor: number,
    now: Date,
  ): ScheduleResult {
    return {
      state: 'review',
      easeFactor,
      learningStep: null,
      intervalDays,
      delayMinutes: null,
      dueAt: this.daysFromNow(now, intervalDays),
      introduced: false,
    };
  }

  /** Anki: interval mới tối thiểu = interval cũ + 1; kẹp [1, 36.500]; rồi fuzz. */
  private nextReviewInterval(computed: number, previous: number): number {
    const base = Math.max(
      MIN_INTERVAL_DAYS,
      Math.round(computed),
      previous + 1,
    );
    return Math.min(MAX_INTERVAL_DAYS, fuzzReviewInterval(base, this.rng));
  }

  /** Hard ở bước > 0: lặp đúng bước hiện tại; nếu chuỗi chỉ 1 bước thì 1.5× (Anki). */
  private repeatStepDelay(step: number, steps: readonly number[]): number {
    const current = steps[step] ?? steps[0];
    return steps.length === 1 ? this.hardDelayForStep(current) : current;
  }

  private hardFirstStepDelay(): number {
    if (LEARNING_STEPS_MINUTES.length === 1) {
      return this.hardDelayForStep(LEARNING_STEPS_MINUTES[0]);
    }
    const [first, second] = LEARNING_STEPS_MINUTES;
    return Math.round((first + second) / 2);
  }

  /** Hard với 1 bước = 1.5× bước đó, tối đa +1 ngày (Anki). */
  private hardDelayForStep(stepMinutes: number): number {
    return Math.min(Math.round(stepMinutes * 1.5), stepMinutes + 24 * 60);
  }

  private clampEase(ease: number): number {
    return Math.max(MIN_EASE, Math.round(ease * 100) / 100);
  }

  private learningDelay(minutes: number): number {
    return fuzzLearningDelay(minutes, this.rng);
  }

  private minutesFromNow(now: Date, minutes: number): Date {
    return new Date(now.getTime() + minutes * 60_000);
  }

  private daysFromNow(now: Date, days: number): Date {
    return new Date(now.getTime() + days * 86_400_000);
  }
}
