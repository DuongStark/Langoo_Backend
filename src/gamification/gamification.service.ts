import { Injectable } from '@nestjs/common';
import { isUniqueViolation } from '../common/errors/prisma-errors';
import {
  localDateString,
  nextDayStartUtc,
  startOfDayUtc,
} from '../common/time/timezone';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../db/prisma.service';
import type { TxClient } from '../srs/review-engine.service';
import {
  DEFAULT_DAILY_GOAL,
  DEFAULT_TIMEZONE,
} from '../users/settings.constants';
import {
  applyDailyCap,
  evaluateAchievement,
  levelFromXp,
  levelProgress,
  nextStreak,
} from './rules';
import {
  AchievementList,
  ActivityResult,
  GamificationStats,
  UnlockedAchievement,
} from './types/gamification.types';

export interface ApplyActivityParams {
  userId: bigint;
  timezone: string;
  now: Date;
  /** Mã `app.xp_rule` (M8: 'review'; M11: 'quiz_correct'…). */
  ruleCode: string;
  /** `xp_event.source` tương ứng. */
  source: string;
  refKind: string | null;
  refId: string | null;
  idempotencyKey: string;
  /** false = câu sai: vẫn tính streak/activity nhưng không cộng XP theo rule (M11 quiz). */
  xpEligible?: boolean;
}

/**
 * Gamification (M8): XP theo `xp_rule` + daily cap, streak_day, user_stats cache,
 * thành tích. Chạy TRONG transaction của ReviewEngine để mọi lượt ôn (M6/M7)
 * cập nhật đồng bộ — xem CONTEXT §7.2 và docs/api/gamification.md.
 */
@Injectable()
export class GamificationService {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------- activity
  /** Áp một lượt hoạt động (ôn 1 thẻ) vào FX; idempotent theo `idempotencyKey`. */
  async applyActivity(
    tx: TxClient,
    params: ApplyActivityParams,
  ): Promise<ActivityResult> {
    const { userId, timezone, now, source } = params;
    const day = localDateString(now, timezone);
    const dayDate = new Date(`${day}T00:00:00.000Z`);
    const dayStart = startOfDayUtc(now, timezone);
    const dayEnd = nextDayStartUtc(now, timezone);

    const settings = await tx.userSettings.findUnique({ where: { userId } });
    const dailyGoal = settings?.dailyGoal ?? DEFAULT_DAILY_GOAL;

    // 1) XP lượt này theo rule + daily cap (theo ngày địa phương).
    const rule = await tx.xpRule.findUnique({
      where: { code: params.ruleCode },
    });
    let xpAmount = 0;
    if (rule?.isActive && params.xpEligible !== false) {
      const earned = await tx.xpEvent.aggregate({
        _sum: { amount: true },
        where: { userId, source, createdAt: { gte: dayStart, lt: dayEnd } },
      });
      xpAmount = applyDailyCap(
        rule.amount,
        rule.dailyCap,
        earned._sum.amount ?? 0,
      );
      if (xpAmount > 0) {
        try {
          await tx.xpEvent.create({
            data: {
              userId,
              amount: xpAmount,
              source,
              refKind: params.refKind,
              refId: params.refId,
              idempotencyKey: params.idempotencyKey,
            },
          });
        } catch (error) {
          if (isUniqueViolation(error)) {
            // Đã được áp trước đó (retry/đua) — không cộng lại streak/stats.
            return this.readCurrentResult(tx, userId);
          }
          throw error;
        }
      }
    }

    // 2) streak_day: đếm lượt + XP + met_goal theo daily_goal.
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
        xp: xpAmount,
        metGoal,
      },
      update: {
        reviewCount: { increment: 1 },
        xp: { increment: xpAmount },
        metGoal,
      },
    });

    // 3) Bonus "ngày học" cho lượt đầu tiên trong ngày (idempotent theo ngày).
    let streakXp = 0;
    if (before === null) {
      const streakRule = await tx.xpRule.findUnique({
        where: { code: 'streak_day' },
      });
      if (streakRule?.isActive) {
        const earned = await tx.xpEvent.aggregate({
          _sum: { amount: true },
          where: {
            userId,
            source: 'streak',
            createdAt: { gte: dayStart, lt: dayEnd },
          },
        });
        const bonus = applyDailyCap(
          streakRule.amount,
          streakRule.dailyCap,
          earned._sum.amount ?? 0,
        );
        if (bonus > 0) {
          try {
            await tx.xpEvent.create({
              data: {
                userId,
                amount: bonus,
                source: 'streak',
                refKind: 'streak_day',
                refId: day,
                idempotencyKey: `streak:${userId.toString()}:${day}`,
              },
            });
            streakXp = bonus;
          } catch (error) {
            if (!isUniqueViolation(error)) {
              throw error;
            }
          }
        }
      }
    }

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
    const reviewsTotal = stats.reviewsTotal + 1;

    // 5) Thành tích theo số liệu mới (progress + mở khoá + thưởng XP).
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
    let achievementXp = 0;
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
        if (achievement.xpReward > 0) {
          try {
            await tx.xpEvent.create({
              data: {
                userId,
                amount: achievement.xpReward,
                source: 'achievement',
                refKind: 'achievement',
                refId: achievement.code,
                idempotencyKey: `ach:${achievement.code}`,
              },
            });
            achievementXp += achievement.xpReward;
          } catch (error) {
            if (!isUniqueViolation(error)) {
              throw error;
            }
          }
        }
        unlocked.push({
          code: achievement.code,
          name_vi: achievement.nameVi,
          xp_reward: achievement.xpReward,
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

    // 6) Chốt cache user_stats + phần XP thưởng vào streak_day.
    const totalGain = xpAmount + streakXp + achievementXp;
    const xpTotal = stats.xpTotal + BigInt(totalGain);
    const level = levelFromXp(Number(xpTotal));
    await tx.userStats.update({
      where: { userId },
      data: {
        xpTotal,
        level,
        streakCurrent,
        streakLongest,
        lastStudyDate: dayDate,
        itemsLearned,
        reviewsTotal,
      },
    });
    if (streakXp + achievementXp > 0) {
      await tx.streakDay.update({
        where: { userId_day: { userId, day: dayDate } },
        data: { xp: { increment: streakXp + achievementXp } },
      });
    }

    return {
      xp_amount: xpAmount,
      streak_xp: streakXp,
      achievement_xp: achievementXp,
      unlocked,
      streak_current: streakCurrent,
      xp_total: Number(xpTotal),
      level,
    };
  }

  // ---------------------------------------------------------------- reads
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
      streak_current: stats?.streakCurrent ?? 0,
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
        xp_reward: achievement.xpReward,
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
  private async readCurrentResult(
    tx: TxClient,
    userId: bigint,
  ): Promise<ActivityResult> {
    const stats = await tx.userStats.findUnique({ where: { userId } });
    const xpTotal = Number(stats?.xpTotal ?? 0n);
    return {
      xp_amount: 0,
      streak_xp: 0,
      achievement_xp: 0,
      unlocked: [],
      streak_current: stats?.streakCurrent ?? 0,
      xp_total: xpTotal,
      level: stats?.level ?? levelFromXp(xpTotal),
    };
  }

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
