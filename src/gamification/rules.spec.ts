import { localDateString } from '../common/time/timezone';
import { addDays, diffDays, nextStreak } from './rules';

describe('gamification rules (thuần)', () => {
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
});
