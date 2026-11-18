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
  streak_current: number;
  streak_longest: number;
  last_study_date: string | null;
  items_learned: number;
  reviews_total: number;
  today: {
    day: string;
    review_count: number;
    met_goal: boolean;
    goal: number;
  };
}

export interface ActivityResult {
  streak_current: number;
}
