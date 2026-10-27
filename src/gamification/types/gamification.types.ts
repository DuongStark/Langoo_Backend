import { LevelProgress } from '../rules';

export interface ActivityDay {
  date: string;
  activity_count: number;
  review_count: number;
  distinct_words: number;
  unresolved_review_count: number;
}

export interface ActivityCalendar {
  year: number;
  timezone: string;
  today: string;
  streak_current: number;
  streak_longest: number;
  days: ActivityDay[];
}

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
  /** XP mới đang tạm dừng; giữ field để tương thích. */
  xp_amount: number;
  /** XP streak mới luôn bằng 0. */
  streak_xp: number;
  /** XP thưởng thành tích mới luôn bằng 0. */
  achievement_xp: number;
  unlocked: UnlockedAchievement[];
  streak_current: number;
  xp_total: number;
  level: number;
}
