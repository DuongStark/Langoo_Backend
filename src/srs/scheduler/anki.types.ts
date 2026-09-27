/** Bốn nút trả lời theo Anki: 1=Again, 2=Hard, 3=Good, 4=Easy. */
export type Rating = 1 | 2 | 3 | 4;

export const RATING = {
  Again: 1,
  Hard: 2,
  Good: 3,
  Easy: 4,
} as const satisfies Record<string, Rating>;

export type CardState = 'new' | 'learning' | 'review' | 'relearning';

/** Trạng thái scheduler cần đọc từ srs_state. */
export interface SchedulerState {
  state: CardState;
  /** Hệ số dễ Anki (>= 1.3). */
  easeFactor: number;
  /** Đang ở bước thứ mấy (learning/relearning); null khi review. */
  learningStep: number | null;
  /** Interval hiện tại tính bằng ngày (scheduled_days; 0 nếu còn ở bước học). */
  intervalDays: number;
}

/** Kết quả xếp lịch — service map vào srs_state. */
export interface ScheduleResult {
  state: CardState;
  easeFactor: number;
  learningStep: number | null;
  /** Interval mới (ngày) khi ở review; 0 khi còn bước học. */
  intervalDays: number;
  /** Trễ bước học (phút) khi state learning/relearning; null khi review. */
  delayMinutes: number | null;
  dueAt: Date;
  /** true khi thẻ rời khỏi state 'new' (phục vụ đếm new/ngày). */
  introduced: boolean;
}
