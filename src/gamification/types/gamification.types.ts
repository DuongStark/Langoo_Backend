import { LevelProgress } from '../rules';

export interface GamificationStats {
  xp_total: number;
  level: number;
  level_progress: LevelProgress;
  streak_current: number;
  streak_longest: number;
  last_study_date: string | null;
  items_learned: number;
  reviews_total: number;
  today: {
    day: string;
    review_count: number;
    xp: number;
    met_goal: boolean;
    goal: number;
  };
}

export interface AchievementItem {
  code: string;
  name_vi: string;
  description: string | null;
  icon: string | null;
  category: string;
  xp_reward: number;
  progress: number;
  unlocked_at: string | null;
  seen_at: string | null;
}

export interface AchievementList {
  data: AchievementItem[];
  unseen_count: number;
}

export interface UnlockedAchievement {
  code: string;
  name_vi: string;
  xp_reward: number;
}

export interface ActivityResult {
  /** XP của chính lượt này (đã áp daily cap). */
  xp_amount: number;
  /** Bonus "ngày học" (chỉ lượt đầu trong ngày). */
  streak_xp: number;
  /** Tổng thưởng thành tích vừa mở khoá. */
  achievement_xp: number;
  unlocked: UnlockedAchievement[];
  streak_current: number;
  xp_total: number;
  level: number;
}
