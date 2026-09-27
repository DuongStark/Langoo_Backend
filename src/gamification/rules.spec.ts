import { localDateString } from '../common/time/timezone';
import {
  addDays,
  applyDailyCap,
  diffDays,
  evaluateAchievement,
  levelFromXp,
  levelProgress,
  nextStreak,
} from './rules';

describe('gamification rules (thuần)', () => {
  describe('levelFromXp / levelProgress', () => {
    it('ngưỡng: 100 XP = L2, 400 = L3, 900 = L4, 1600 = L5', () => {
      expect(levelFromXp(0)).toBe(1);
      expect(levelFromXp(99)).toBe(1);
      expect(levelFromXp(100)).toBe(2);
      expect(levelFromXp(399)).toBe(2);
      expect(levelFromXp(400)).toBe(3);
      expect(levelFromXp(900)).toBe(4);
      expect(levelFromXp(1600)).toBe(5);
    });

    it('levelProgress trả tiến độ trong cấp hiện tại', () => {
      expect(levelProgress(100)).toEqual({
        level: 2,
        xp_in_level: 0,
        xp_for_next: 300,
        percent: 0,
      });
      expect(levelProgress(450)).toEqual({
        level: 3,
        xp_in_level: 50,
        xp_for_next: 500,
        percent: 10,
      });
      expect(levelProgress(0)).toEqual({
        level: 1,
        xp_in_level: 0,
        xp_for_next: 100,
        percent: 0,
      });
    });
  });

  describe('applyDailyCap', () => {
    it('cắt theo phần còn lại của cap', () => {
      expect(applyDailyCap(1, 200, 0)).toBe(1);
      expect(applyDailyCap(1, 200, 199)).toBe(1);
      expect(applyDailyCap(1, 200, 200)).toBe(0);
      expect(applyDailyCap(5, 2, 0)).toBe(2);
      expect(applyDailyCap(5, 2, 1)).toBe(1);
      expect(applyDailyCap(5, 2, 2)).toBe(0);
    });

    it('cap null = không giới hạn', () => {
      expect(applyDailyCap(7, null, 999)).toBe(7);
    });
  });

  describe('nextStreak', () => {
    it('chưa học bao giờ → 1', () => {
      expect(nextStreak(0, null, '2026-09-27')).toBe(1);
    });

    it('hôm nay đã học → giữ nguyên', () => {
      expect(nextStreak(5, '2026-09-27', '2026-09-27')).toBe(5);
    });

    it('hôm qua đã học → +1; cũ hơn → reset 1', () => {
      expect(nextStreak(5, '2026-09-26', '2026-09-27')).toBe(6);
      expect(nextStreak(5, '2026-09-24', '2026-09-27')).toBe(1);
    });
  });

  describe('addDays / diffDays', () => {
    it('cộng trừ ngày qua tháng/năm', () => {
      expect(addDays('2026-09-27', 1)).toBe('2026-09-28');
      expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
      expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
      expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    });

    it('diffDays trả số ngày lệch (later - earlier)', () => {
      expect(diffDays('2026-09-28', '2026-09-27')).toBe(1);
      expect(diffDays('2026-09-27', '2026-09-30')).toBe(-3);
      expect(diffDays('2026-09-27', '2026-09-27')).toBe(0);
    });
  });

  describe('localDateString', () => {
    it('tính ngày theo timezone người dùng', () => {
      const lateUtc = new Date('2026-09-27T16:30:00.000Z');
      expect(localDateString(lateUtc, 'Asia/Ho_Chi_Minh')).toBe('2026-09-27');
      const crossing = new Date('2026-09-27T18:00:00.000Z');
      expect(localDateString(crossing, 'Asia/Ho_Chi_Minh')).toBe('2026-09-28');
      expect(localDateString(crossing, 'UTC')).toBe('2026-09-27');
    });
  });

  describe('evaluateAchievement', () => {
    const metrics = {
      items_learned: 12,
      reviews_total: 5,
      streak_current: 3,
      quiz_correct: 0,
    };

    it('đủ ngưỡng → unlocked, progress = giá trị metric', () => {
      expect(
        evaluateAchievement({ metric: 'reviews_total', gte: 3 }, metrics),
      ).toEqual({ value: 5, unlocked: true });
    });

    it('chưa đủ ngưỡng → unlocked false', () => {
      expect(
        evaluateAchievement({ metric: 'items_learned', gte: 100 }, metrics),
      ).toEqual({ value: 12, unlocked: false });
    });

    it('metric lạ → 0, không unlock', () => {
      expect(
        evaluateAchievement({ metric: 'unknown_metric', gte: 1 }, metrics),
      ).toEqual({ value: 0, unlocked: false });
    });
  });
});
