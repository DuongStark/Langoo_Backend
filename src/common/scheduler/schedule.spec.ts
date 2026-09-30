import { isJobDue, lastOccurrence } from './schedule';

const daily = { kind: 'daily', hourUtc: 3, minuteUtc: 0 } as const;
const weekly = {
  kind: 'weekly',
  weekdayUtc: 1,
  hourUtc: 4,
  minuteUtc: 0,
} as const;

describe('scheduler schedule', () => {
  it('daily: trước giờ chạy → mốc hôm qua; sau giờ chạy → mốc hôm nay', () => {
    const before = lastOccurrence(daily, new Date('2026-09-30T02:30:00.000Z'));
    expect(before.toISOString()).toBe('2026-09-29T03:00:00.000Z');

    const after = lastOccurrence(daily, new Date('2026-09-30T03:00:01.000Z'));
    expect(after.toISOString()).toBe('2026-09-30T03:00:00.000Z');
  });

  it('weekly: tìm đúng thứ Hai gần nhất, kể cả khi vừa qua giờ chạy', () => {
    // 2026-09-30 là thứ Tư → thứ Hai gần nhất là 28/09 lúc 04:00.
    const occurrence = lastOccurrence(
      weekly,
      new Date('2026-09-30T10:00:00.000Z'),
    );
    expect(occurrence.toISOString()).toBe('2026-09-28T04:00:00.000Z');

    // Ngay sau giờ chạy thứ Hai → chính thứ Hai này.
    const justAfter = lastOccurrence(
      weekly,
      new Date('2026-09-28T04:00:30.000Z'),
    );
    expect(justAfter.toISOString()).toBe('2026-09-28T04:00:00.000Z');
  });

  it('isJobDue: null (chưa chạy bao giờ) → false; chạy trước mốc → true', () => {
    const now = new Date('2026-09-30T03:30:00.000Z');
    expect(isJobDue(daily, null, now)).toBe(false);

    const before = new Date('2026-09-29T12:00:00.000Z');
    expect(isJobDue(daily, before, now)).toBe(true);

    const after = new Date('2026-09-30T03:10:00.000Z');
    expect(isJobDue(daily, after, now)).toBe(false);
  });
});
