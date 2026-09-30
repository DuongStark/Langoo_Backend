import { Prisma } from '../../generated/prisma/client';

export type JobSchedule =
  | { kind: 'daily'; hourUtc: number; minuteUtc?: number }
  | { kind: 'weekly'; weekdayUtc: number; hourUtc: number; minuteUtc?: number };

export interface JobRunResult {
  deleted?: number;
  note?: string;
}

/** Job định kỳ chạy trong transaction giữ advisory lock của scheduler. */
export interface ScheduledJob {
  readonly name: string;
  readonly schedule: JobSchedule;
  run(tx: Prisma.TransactionClient, now: Date): Promise<JobRunResult>;
}

const DAY_MS = 86_400_000;

/**
 * Mốc chạy gần nhất (UTC) của lịch <= `now`.
 * Dùng để so với `lastRunAt`: job đến hạn khi mốc gần nhất mới hơn lần chạy trước.
 */
export function lastOccurrence(schedule: JobSchedule, now: Date): Date {
  const minute = schedule.minuteUtc ?? 0;
  if (schedule.kind === 'daily') {
    const candidate = utcDate(now, schedule.hourUtc, minute);
    return candidate <= now
      ? candidate
      : new Date(candidate.getTime() - DAY_MS);
  }

  // weekly: lùi tối đa 7 ngày từ hôm nay để tìm đúng thứ trong tuần.
  for (let back = 0; back <= 7; back += 1) {
    const candidate = utcDate(now, schedule.hourUtc, minute);
    candidate.setUTCDate(candidate.getUTCDate() - back);
    if (candidate.getUTCDay() === schedule.weekdayUtc && candidate <= now) {
      return candidate;
    }
  }
  // Không thể xảy ra (0..7 ngày luôn phủ đủ một tuần) — giữ nhánh an toàn.
  const fallback = utcDate(now, schedule.hourUtc, minute);
  fallback.setUTCDate(fallback.getUTCDate() - 7);
  return fallback;
}

export function isJobDue(
  schedule: JobSchedule,
  lastRunAt: Date | null,
  now: Date,
): boolean {
  if (lastRunAt === null) {
    return false;
  }
  return lastOccurrence(schedule, now) > lastRunAt;
}

function utcDate(now: Date, hourUtc: number, minuteUtc: number): Date {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      hourUtc,
      minuteUtc,
      0,
      0,
    ),
  );
}
