/**
 * Luật gamification thuần (không phụ thuộc DB/thời gian thực):
 * Chuỗi streak và phép tính ngày địa phương.
 */

const DAY_MS = 86_400_000;

/**
 * Chuỗi streak mới theo ngày địa phương:
 * hôm nay đã học → giữ; hôm qua → +1; xa hơn/chưa từng học → 1.
 */
export function nextStreak(
  current: number,
  lastDay: string | null,
  today: string,
): number {
  if (lastDay === null) {
    return 1;
  }
  if (lastDay === today) {
    return Math.max(1, current);
  }
  if (diffDays(today, lastDay) === 1) {
    return current + 1;
  }
  return 1;
}

export function addDays(day: string, delta: number): string {
  return new Date(parseDay(day) + delta * DAY_MS).toISOString().slice(0, 10);
}

/** Số ngày lệch (later − earlier), âm nếu later sớm hơn. */
export function diffDays(later: string, earlier: string): number {
  return Math.round((parseDay(later) - parseDay(earlier)) / DAY_MS);
}

function parseDay(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}
