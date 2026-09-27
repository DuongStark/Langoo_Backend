/**
 * Luật gamification thuần (không phụ thuộc DB/thời gian thực):
 * level, daily cap XP, chuỗi streak, đánh giá thành tích.
 */

export interface AchievementRule {
  metric: string;
  gte: number;
}

export interface AchievementMetrics {
  items_learned: number;
  reviews_total: number;
  streak_current: number;
  quiz_correct: number;
}

export interface LevelProgress {
  level: number;
  xp_in_level: number;
  xp_for_next: number;
  percent: number;
}

const XP_PER_LEVEL = 100;
const DAY_MS = 86_400_000;

/** Ngưỡng lên cấp: level L bắt đầu tại 100×(L−1)² XP (L2=100, L3=400, L4=900…). */
export function levelFromXp(xpTotal: number): number {
  const xp = Math.max(0, Math.floor(xpTotal));
  return Math.floor(Math.sqrt(xp / XP_PER_LEVEL)) + 1;
}

export function levelProgress(xpTotal: number): LevelProgress {
  const xp = Math.max(0, Math.floor(xpTotal));
  const level = levelFromXp(xp);
  const start = XP_PER_LEVEL * (level - 1) ** 2;
  const next = XP_PER_LEVEL * level ** 2;
  const xpInLevel = xp - start;
  const xpForNext = next - start;
  const percent =
    xpForNext === 0
      ? 100
      : Math.min(100, Math.floor((xpInLevel / xpForNext) * 100));
  return { level, xp_in_level: xpInLevel, xp_for_next: xpForNext, percent };
}

/** Cắt XP theo cap còn lại trong ngày; cap null = không giới hạn. */
export function applyDailyCap(
  amount: number,
  dailyCap: number | null | undefined,
  earnedToday: number,
): number {
  if (amount <= 0) {
    return 0;
  }
  if (dailyCap === null || dailyCap === undefined) {
    return amount;
  }
  const remaining = dailyCap - Math.max(0, earnedToday);
  return Math.max(0, Math.min(amount, remaining));
}

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

export function evaluateAchievement(
  rule: AchievementRule,
  metrics: AchievementMetrics,
): { value: number; unlocked: boolean } {
  const value = metricValue(rule.metric, metrics);
  return { value, unlocked: value >= rule.gte };
}

function metricValue(metric: string, metrics: AchievementMetrics): number {
  switch (metric) {
    case 'items_learned':
      return metrics.items_learned;
    case 'reviews_total':
      return metrics.reviews_total;
    case 'streak_current':
      return metrics.streak_current;
    case 'quiz_correct':
      return metrics.quiz_correct;
    default:
      return 0;
  }
}

function parseDay(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}
