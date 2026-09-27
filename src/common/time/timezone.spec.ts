import { nextDayStartUtc, startOfDayUtc } from './timezone';

describe('timezone util', () => {
  it('UTC: mốc ngày 00:00Z', () => {
    const now = new Date('2026-09-27T10:00:00.000Z');
    expect(startOfDayUtc(now, 'UTC').toISOString()).toBe(
      '2026-09-27T00:00:00.000Z',
    );
    expect(nextDayStartUtc(now, 'UTC').toISOString()).toBe(
      '2026-09-28T00:00:00.000Z',
    );
  });

  it('Asia/Ho_Chi_Minh (UTC+7): 00:30 sáng 28/09 VN → mốc ngày là 27/09 17:00Z', () => {
    const now = new Date('2026-09-27T17:30:00.000Z'); // 00:30 28/09 giờ VN
    expect(startOfDayUtc(now, 'Asia/Ho_Chi_Minh').toISOString()).toBe(
      '2026-09-27T17:00:00.000Z',
    );
    expect(nextDayStartUtc(now, 'Asia/Ho_Chi_Minh').toISOString()).toBe(
      '2026-09-28T17:00:00.000Z',
    );
  });

  it('giữa ngày VN vẫn đúng (09:00Z = 16:00 VN ngày 27/09)', () => {
    const now = new Date('2026-09-27T09:00:00.000Z');
    expect(startOfDayUtc(now, 'Asia/Ho_Chi_Minh').toISOString()).toBe(
      '2026-09-26T17:00:00.000Z',
    );
  });
});
