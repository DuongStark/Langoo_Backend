import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException } from '../common/errors/domain.exception';
import { localDateString } from '../common/time/timezone';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../db/prisma.service';
import type { TxClient } from '../srs/review-engine.service';
import {
  DEFAULT_DAILY_GOAL,
  DEFAULT_TIMEZONE,
} from '../users/settings.constants';
import {
  evaluateAchievement,
  diffDays,
  levelFromXp,
  levelProgress,
  nextStreak,
} from './rules';
import {
  AchievementList,
  ActivityCalendar,
  ActivityResult,
  GamificationStats,
  UnlockedAchievement,
} from './types/gamification.types';

export interface ApplyActivityParams {
  userId: bigint;
  timezone: string;
  now: Date;
  /** Legacy XP metadata; awards are paused while callers retain the contract. */
  ruleCode: string;
  source: string;
  refKind: string | null;
  refId: string | null;
  idempotencyKey: string;
  xpEligible?: boolean;
  /**
   * true = lượt ôn SRS: cộng `user_stats.reviews_total` (metric của achievement
   * `reviews_1000`). Quiz (M11) vẫn tính streak/mục tiêu ngày nhưng KHÔNG cộng
   * bộ đếm này — tên "review" chỉ mô tả lượt ôn (chốt 2026-10-03).
   */
  countsAsReview: boolean;
}

/**
 * Streak and achievements update in the caller's transaction. XP awards are
 * paused; existing XP history is preserved.
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
    // XP is paused; historical XP records and totals remain unchanged.
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
        xp: 0,
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

    // Thành tích theo số liệu mới (progress + mở khoá, không thưởng XP).
    const metrics = {
      items_learned: itemsLearned,
      reviews_total: reviewsTotal,
      streak_current: streakCurrent,
      quiz_correct: await this.countQuizCorrect(tx, userId),
    };
    const achievements = await tx.achievement.findMany({
      where: { isActive: true },
    });
    const owned = new Map(
      (await tx.userAchievement.findMany({ where: { userId } })).map((row) => [
        row.achievementCode,
        row,
      ]),
    );
    const unlocked: UnlockedAchievement[] = [];
    for (const achievement of achievements) {
      const ruleJson = achievement.rule as {
        metric?: unknown;
        gte?: unknown;
      };
      if (
        typeof ruleJson.metric !== 'string' ||
        typeof ruleJson.gte !== 'number'
      ) {
        continue;
      }
      const evaluation = evaluateAchievement(
        { metric: ruleJson.metric, gte: ruleJson.gte },
        metrics,
      );
      const prev = owned.get(achievement.code);
      if (prev?.unlockedAt != null) {
        continue;
      }
      const progressAdvance =
        prev === undefined || Number(prev.progress) < evaluation.value;
      if (evaluation.unlocked) {
        await tx.userAchievement.upsert({
          where: {
            userId_achievementCode: {
              userId,
              achievementCode: achievement.code,
            },
          },
          create: {
            userId,
            achievementCode: achievement.code,
            progress: evaluation.value,
            unlockedAt: now,
          },
          update: { progress: evaluation.value, unlockedAt: now },
        });
        unlocked.push({
          code: achievement.code,
          name_vi: achievement.nameVi,
          xp_reward: 0,
        });
      } else if (progressAdvance) {
        await tx.userAchievement.upsert({
          where: {
            userId_achievementCode: {
              userId,
              achievementCode: achievement.code,
            },
          },
          create: {
            userId,
            achievementCode: achievement.code,
            progress: evaluation.value,
          },
          update: { progress: evaluation.value },
        });
      }
    }

    // Keep historical XP and level unchanged while XP awards are paused.
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
      xp_amount: 0,
      streak_xp: 0,
      achievement_xp: 0,
      unlocked,
      streak_current: streakCurrent,
      xp_total: Number(stats.xpTotal),
      level: stats.level,
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
    const xpTotal = Number(stats?.xpTotal ?? 0n);
    return {
      xp_total: xpTotal,
      level: stats?.level ?? levelFromXp(xpTotal),
      level_progress: levelProgress(xpTotal),
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
        xp: today?.xp ?? 0,
        met_goal: today?.metGoal ?? false,
        goal,
      },
    };
  }

  async getAchievements(userId: bigint): Promise<AchievementList> {
    const [achievements, rows] = await Promise.all([
      this.prisma.achievement.findMany({
        where: { isActive: true },
        orderBy: [{ category: 'asc' }, { code: 'asc' }],
      }),
      this.prisma.userAchievement.findMany({ where: { userId } }),
    ]);
    const mine = new Map(rows.map((row) => [row.achievementCode, row]));
    const data = achievements.map((achievement) => {
      const row = mine.get(achievement.code);
      return {
        code: achievement.code,
        name_vi: achievement.nameVi,
        description: achievement.description,
        icon: achievement.icon,
        category: achievement.category,
        xp_reward: 0,
        progress: row ? Number(row.progress) : 0,
        unlocked_at: row?.unlockedAt?.toISOString() ?? null,
        seen_at: row?.seenAt?.toISOString() ?? null,
      };
    });
    return {
      data,
      unseen_count: rows.filter(
        (row) => row.unlockedAt !== null && row.seenAt === null,
      ).length,
    };
  }

  async markSeen(
    userId: bigint,
    codes?: string[],
  ): Promise<{ updated: number; unseen_count: number }> {
    if (
      codes !== undefined &&
      (!Array.isArray(codes) || codes.some((code) => typeof code !== 'string'))
    ) {
      throw new DomainException(
        'VALIDATION_FAILED',
        'codes phải là mảng chuỗi',
        HttpStatus.BAD_REQUEST,
      );
    }
    const where: Prisma.UserAchievementWhereInput = {
      userId,
      unlockedAt: { not: null },
      seenAt: null,
    };
    if (codes !== undefined && codes.length > 0) {
      where.achievementCode = { in: codes };
    }
    const result = await this.prisma.userAchievement.updateMany({
      where,
      data: { seenAt: new Date() },
    });
    const unseen = await this.prisma.userAchievement.count({
      where: { userId, unlockedAt: { not: null }, seenAt: null },
    });
    return { updated: result.count, unseen_count: unseen };
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

  private async countQuizCorrect(
    tx: TxClient,
    userId: bigint,
  ): Promise<number> {
    const rows = await tx.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n
      FROM app.study_session_item si
      JOIN app.study_session ss ON ss.id = si.session_id
      WHERE ss.user_id = ${userId}
        AND ss.kind = 'quiz'
        AND si.is_correct = true`;
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
