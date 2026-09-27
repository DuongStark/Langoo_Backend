import { AnkiScheduler } from './anki-scheduler';
import { Rating, SchedulerState } from './anki.types';
import { fuzzReviewInterval, Rng } from './fuzz';

const NOW = new Date('2026-09-27T09:00:00.000Z');

/** RNG trung tính cho fuzz review: (0.5*2-1)=0 → delta 0. */
const neutralRng: Rng = { next: () => 0.5 };
/** RNG không thêm phút cho bước học: floor(0*6)=0. */
const noExtraRng: Rng = { next: () => 0 };

const neutral = new AnkiScheduler(neutralRng);
const noExtra = new AnkiScheduler(noExtraRng);

function state(overrides: Partial<SchedulerState> = {}): SchedulerState {
  return {
    state: 'new',
    easeFactor: 2.5,
    learningStep: null,
    intervalDays: 0,
    ...overrides,
  };
}

const AGAIN: Rating = 1;
const HARD: Rating = 2;
const GOOD: Rating = 3;
const EASY: Rating = 4;

function minutes(result: { dueAt: Date }): number {
  return Math.round((result.dueAt.getTime() - NOW.getTime()) / 60_000);
}
function days(result: { dueAt: Date }): number {
  return Math.round((result.dueAt.getTime() - NOW.getTime()) / 86_400_000);
}

describe('AnkiScheduler', () => {
  describe('new', () => {
    it('Good → learning bước 1, +10 phút, đánh dấu introduced', () => {
      const result = noExtra.schedule(state(), GOOD, NOW);
      expect(result).toMatchObject({
        state: 'learning',
        learningStep: 1,
        intervalDays: 0,
        introduced: true,
      });
      expect(minutes(result)).toBe(10);
    });

    it('Again → learning bước 0, +1 phút', () => {
      const result = noExtra.schedule(state(), AGAIN, NOW);
      expect(result).toMatchObject({ state: 'learning', learningStep: 0 });
      expect(minutes(result)).toBe(1);
    });

    it('Hard → learning bước 0, +6 phút (TB 1m và 10m)', () => {
      const result = noExtra.schedule(state(), HARD, NOW);
      expect(result).toMatchObject({ state: 'learning', learningStep: 0 });
      expect(minutes(result)).toBe(6);
    });

    it('Easy → tốt nghiệp luôn, +4 ngày, EF giữ 2.5', () => {
      const result = neutral.schedule(state(), EASY, NOW);
      expect(result).toMatchObject({
        state: 'review',
        learningStep: null,
        intervalDays: 4,
        easeFactor: 2.5,
        introduced: true,
      });
      expect(days(result)).toBe(4);
    });
  });

  describe('learning', () => {
    const atStep0 = state({ state: 'learning', learningStep: 0 });
    const atStep1 = state({ state: 'learning', learningStep: 1 });

    it('Good ở bước cuối → tốt nghiệp +1 ngày', () => {
      const result = neutral.schedule(atStep1, GOOD, NOW);
      expect(result).toMatchObject({
        state: 'review',
        learningStep: null,
        intervalDays: 1,
        introduced: false,
      });
      expect(days(result)).toBe(1);
    });

    it('Hard ở bước 0 → +6 phút; Hard ở bước 1 → lặp +10 phút', () => {
      expect(minutes(noExtra.schedule(atStep0, HARD, NOW))).toBe(6);
      expect(minutes(noExtra.schedule(atStep1, HARD, NOW))).toBe(10);
    });

    it('Again từ bước 1 → về bước 0, +1 phút', () => {
      const result = noExtra.schedule(atStep1, AGAIN, NOW);
      expect(result).toMatchObject({ state: 'learning', learningStep: 0 });
      expect(minutes(result)).toBe(1);
    });

    it('Easy → tốt nghiệp +4 ngày', () => {
      expect(neutral.schedule(atStep0, EASY, NOW)).toMatchObject({
        state: 'review',
        intervalDays: 4,
      });
    });
  });

  describe('review', () => {
    const card = state({
      state: 'review',
      learningStep: null,
      intervalDays: 10,
      easeFactor: 2.5,
    });

    it('Good → I×EF = 25 ngày, EF không đổi', () => {
      const result = neutral.schedule(card, GOOD, NOW);
      expect(result.intervalDays).toBe(25);
      expect(result.easeFactor).toBe(2.5);
      expect(days(result)).toBe(25);
    });

    it('Hard → I×1.2 = 12 ngày, EF −0.15', () => {
      const result = neutral.schedule(card, HARD, NOW);
      expect(result.intervalDays).toBe(12);
      expect(result.easeFactor).toBe(2.35);
    });

    it('Easy → I×EF×1.3 = 33 ngày, EF +0.15', () => {
      const result = neutral.schedule(card, EASY, NOW);
      expect(result.intervalDays).toBe(33);
      expect(result.easeFactor).toBe(2.65);
    });

    it('interval mới luôn ≥ interval cũ + 1 (I=1: Hard → 2, Good → 3)', () => {
      const small = state({ state: 'review', intervalDays: 1 });
      expect(neutral.schedule(small, HARD, NOW).intervalDays).toBe(2);
      expect(neutral.schedule(small, GOOD, NOW).intervalDays).toBe(3);
    });

    it('Again → relearning +10 phút, EF −0.20, giữ interval cũ', () => {
      const result = noExtra.schedule(card, AGAIN, NOW);
      expect(result).toMatchObject({
        state: 'relearning',
        learningStep: 0,
        intervalDays: 10,
        easeFactor: 2.3,
        introduced: false,
      });
      expect(minutes(result)).toBe(10);
    });

    it('EF kẹp sàn 1.3', () => {
      const low = state({
        state: 'review',
        intervalDays: 10,
        easeFactor: 1.35,
      });
      expect(neutral.schedule(low, AGAIN, NOW).easeFactor).toBe(1.3);
      const floor = state({
        state: 'review',
        intervalDays: 10,
        easeFactor: 1.3,
      });
      expect(neutral.schedule(floor, HARD, NOW).easeFactor).toBe(1.3);
    });

    it('interval kẹp trần 36.500 ngày', () => {
      const maxed = state({
        state: 'review',
        intervalDays: 36_500,
        easeFactor: 2.5,
      });
      expect(neutral.schedule(maxed, GOOD, NOW).intervalDays).toBe(36_500);
    });
  });

  describe('relearning', () => {
    const lapse = state({
      state: 'relearning',
      learningStep: 0,
      intervalDays: 10,
      easeFactor: 2.3,
    });

    it('Again → lặp +10 phút', () => {
      const result = noExtra.schedule(lapse, AGAIN, NOW);
      expect(result).toMatchObject({ state: 'relearning', learningStep: 0 });
      expect(minutes(result)).toBe(10);
    });

    it('Hard với 1 bước → 1.5× bước = +15 phút', () => {
      const result = noExtra.schedule(lapse, HARD, NOW);
      expect(result).toMatchObject({ state: 'relearning', learningStep: 0 });
      expect(minutes(result)).toBe(15);
    });

    it('Good → về review với interval 1 ngày (New interval 0 + min 1d)', () => {
      expect(neutral.schedule(lapse, GOOD, NOW)).toMatchObject({
        state: 'review',
        learningStep: null,
        intervalDays: 1,
      });
    });

    it('Easy → về review 1 ngày (mirror Anki — ghi chú docs/srs.md)', () => {
      expect(neutral.schedule(lapse, EASY, NOW)).toMatchObject({
        state: 'review',
        intervalDays: 1,
      });
    });
  });

  describe('fuzz', () => {
    const card = state({ state: 'review', intervalDays: 100 });

    it('review fuzz ±5% khi interval ≥ 2.5 ngày (Good 100d, EF 2.5 → 250d)', () => {
      expect(neutral.schedule(card, GOOD, NOW).intervalDays).toBe(250);
      expect(
        new AnkiScheduler({ next: () => 0 }).schedule(card, GOOD, NOW)
          .intervalDays,
      ).toBe(237);
      expect(
        new AnkiScheduler({ next: () => 0.999 }).schedule(card, GOOD, NOW)
          .intervalDays,
      ).toBe(263);
    });

    it('không fuzz interval < 2.5 ngày', () => {
      expect(fuzzReviewInterval(2, { next: () => 0 })).toBe(2);
      expect(fuzzReviewInterval(1, { next: () => 0.999 })).toBe(1);
      // từ 2.5 ngày trở lên mới fuzz (4d, fuzz = max(1, round(0.2)) = 1)
      expect(fuzzReviewInterval(4, { next: () => 0 })).toBe(3);
    });

    it('learning cộng thêm 0–5 phút (rng cao → +5)', () => {
      expect(minutes(noExtra.schedule(state(), GOOD, NOW))).toBe(10);
      const high = new AnkiScheduler({ next: () => 0.999 });
      expect(minutes(high.schedule(state(), GOOD, NOW))).toBe(15);
    });
  });
});
