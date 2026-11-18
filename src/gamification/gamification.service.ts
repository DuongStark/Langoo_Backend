import { Injectable } from '@nestjs/common';
import { localDateString } from '../common/time/timezone';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../db/prisma.service';
import type { TxClient } from '../srs/review-engine.service';
import {
  DEFAULT_DAILY_GOAL,
  DEFAULT_TIMEZONE,
} from '../users/settings.constants';
import { diffDays, nextStreak } from './rules';
import {
  ActivityCalendar,
  ActivityResult,
  GamificationStats,
} from './types/gamification.types';

export interface ApplyActivityParams {
  userId: bigint;
  timezone: string;
  now: Date;
  /** Only SRS reviews increment reviews_total; quiz activity does not. */
  countsAsReview: boolean;
}

/**
 * Streak and learning counters update in the caller's transaction.
 */
@Injectable()
export class GamificationService {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------- activity
  /** Call only after the caller has locked the user and claimed its receipt. */
  async applyActivity(
    tx: TxClient,
    params: ApplyActivityParams,
  ): Promise<ActivityResult> {
    const { userId, timezone, now } = params;
    const day = localDateString(now, timezone);
    const dayDate = new Date(`${day}T00:00:00.000Z`);

    const settings = await tx.userSettings.findUnique({ where: { userId } });
    const dailyGoal = settings?.dailyGoal ?? DEFAULT_DAILY_GOAL;

    // Callers claim SRS/session receipts and lock the user before this update.
    const before = await tx.streakDay.findUnique({
      where: { userId_day: { userId, day: dayDate } },
    });
    const reviewCount = (before?.reviewCount ?? 0) + 1;
    const metGoal = reviewCount >= dailyGoal;
    await tx.streakDay.upsert({
      where: { userId_day: { userId, day: dayDate } },
      create: {
        userId,
        day: dayDate,
        reviewCount: 1,
        metGoal,
      },
      update: {
        reviewCount: { increment: 1 },
        metGoal,
      },
    });

    // 4) user_stats: khóa dòng để tuần tự hóa theo user.
    await tx.$executeRaw`INSERT INTO app.user_stats (user_id) VALUES (${userId}) ON CONFLICT (user_id) DO NOTHING`;
    await tx.$queryRaw`SELECT user_id FROM app.user_stats WHERE user_id = ${userId} FOR UPDATE`;
    const stats = await tx.userStats.findUniqueOrThrow({ where: { userId } });
    const lastDay = stats.lastStudyDate
      ? toDayString(stats.lastStudyDate)
      : null;
    const streakCurrent = nextStreak(stats.streakCurrent, lastDay, day);
    const streakLongest = Math.max(stats.streakLongest, streakCurrent);
    const itemsLearned = await this.countItemsLearned(tx, userId);
    const reviewsTotal = stats.reviewsTotal + (params.countsAsReview ? 1 : 0);

    await tx.userStats.update({
      where: { userId },
      data: {
        streakCurrent,
        streakLongest,
        lastStudyDate: dayDate,
        itemsLearned,
        reviewsTotal,
      },
    });
    return {
      streak_current: streakCurrent,
    };
  }

  // ---------------------------------------------------------------- reads
  async getActivity(
    userId: bigint,
    requestedYear?: number,
  ): Promise<ActivityCalendar> {
    return this.prisma.$transaction(
      async (tx) => {
        const [settings, stats] = await Promise.all([
          tx.userSettings.findUnique({ where: { userId } }),
          tx.userStats.findUnique({ where: { userId } }),
        ]);
        const timezone = settings?.timezone ?? DEFAULT_TIMEZONE;
        const today = localDateString(new Date(), timezone);
        const year = requestedYear ?? Number(today.slice(0, 4));
        const start = new Date(Date.UTC(year, 0, 1));
        const end = new Date(Date.UTC(year + 1, 0, 1));
        const [activityDays, reviews] = await Promise.all([
          tx.streakDay.findMany({
            where: { userId, day: { gte: start, lt: end } },
            select: { day: true, reviewCount: true },
          }),
          tx.$queryRaw<
            {
              day: string;
              review_count: number;
              distinct_words: number;
              unresolved_review_count: number;
            }[]
          >`
        SELECT to_char(r.reviewed_at AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS day,
          count(*)::int AS review_count,
          count(DISTINCT s.lexeme_id)::int AS distinct_words,
          count(*) FILTER (WHERE s.lexeme_id IS NULL)::int AS unresolved_review_count
        FROM app.review_log r
        LEFT JOIN app.collection_item_face f ON f.id = r.face_id
        LEFT JOIN core.sense s ON s.id = f.sense_id
        WHERE r.user_id = ${userId}
          AND r.reviewed_at >= (make_date(${year}::int, 1, 1)::timestamp AT TIME ZONE ${timezone})
          AND r.reviewed_at < (make_date(${year + 1}::int, 1, 1)::timestamp AT TIME ZONE ${timezone})
        GROUP BY 1`,
        ]);
        const byDay = new Map(
          activityDays.map((row) => [toDayString(row.day), row.reviewCount]),
        );
        const reviewsByDay = new Map(reviews.map((row) => [row.day, row]));
        const days: ActivityCalendar['days'] = [];
        for (
          let time = start.getTime();
          time < end.getTime();
          time += 86_400_000
        ) {
          const date = new Date(time).toISOString().slice(0, 10);
          const row = reviewsByDay.get(date);
          days.push({
            date,
            activity_count: byDay.get(date) ?? 0,
            review_count: row?.review_count ?? 0,
            distinct_words: row?.distinct_words ?? 0,
            unresolved_review_count: row?.unresolved_review_count ?? 0,
          });
        }
        return {
          year,
          timezone,
          today,
          streak_current: currentStreak(
            stats?.streakCurrent ?? 0,
            stats?.lastStudyDate ?? null,
            today,
          ),
          streak_longest: stats?.streakLongest ?? 0,
          days,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async getStats(userId: bigint): Promise<GamificationStats> {
    const settings = await this.prisma.userSettings.findUnique({
      where: { userId },
    });
    const timezone = settings?.timezone ?? DEFAULT_TIMEZONE;
    const goal = settings?.dailyGoal ?? DEFAULT_DAILY_GOAL;
    const day = localDateString(new Date(), timezone);
    const dayDate = new Date(`${day}T00:00:00.000Z`);

    const [stats, today] = await Promise.all([
      this.prisma.userStats.findUnique({ where: { userId } }),
      this.prisma.streakDay.findUnique({
        where: { userId_day: { userId, day: dayDate } },
      }),
    ]);
    return {
      streak_current: currentStreak(
        stats?.streakCurrent ?? 0,
        stats?.lastStudyDate ?? null,
        day,
      ),
      streak_longest: stats?.streakLongest ?? 0,
      last_study_date: stats?.lastStudyDate
        ? toDayString(stats.lastStudyDate)
        : null,
      items_learned: stats?.itemsLearned ?? 0,
      reviews_total: stats?.reviewsTotal ?? 0,
      today: {
        day,
        review_count: today?.reviewCount ?? 0,
        met_goal: today?.metGoal ?? false,
        goal,
      },
    };
  }

  // ---------------------------------------------------------------- utils
  private async countItemsLearned(
    tx: TxClient,
    userId: bigint,
  ): Promise<number> {
    const rows = await tx.$queryRaw<{ n: number }[]>`
      SELECT count(DISTINCT f.item_id)::int AS n
      FROM app.srs_state s
      JOIN app.collection_item_face f ON f.id = s.face_id
      WHERE s.user_id = ${userId}
        AND s.introduced_at IS NOT NULL`;
    return rows[0]?.n ?? 0;
  }
}

function toDayString(day: Date): string {
  return day.toISOString().slice(0, 10);
}

function currentStreak(
  current: number,
  lastDay: Date | null,
  today: string,
): number {
  if (lastDay === null) return 0;
  const difference = diffDays(today, toDayString(lastDay));
  return difference === 0 || difference === 1 ? current : 0;
}
