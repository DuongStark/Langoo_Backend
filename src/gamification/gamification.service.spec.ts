import { GamificationController } from './gamification.controller';
import { GamificationService } from './gamification.service';
import { PrismaService } from '../db/prisma.service';

// This service contract must work with the schema after XP columns are removed.
describe('M6.3 learning activity without XP', () => {
  it('returns learning stats and streak without XP or level fields', async () => {
    const prisma = {
      userSettings: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ timezone: 'UTC', dailyGoal: 2 }),
      },
      userStats: {
        findUnique: jest.fn().mockResolvedValue({
          streakCurrent: 3,
          streakLongest: 5,
          lastStudyDate: new Date(),
          itemsLearned: 8,
          reviewsTotal: 12,
        }),
      },
      streakDay: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ reviewCount: 2, metGoal: true }),
      },
    };
    const service = new GamificationService(prisma as unknown as PrismaService);
    const result = await service.getStats(1n);
    expect(Object.keys(result).sort()).toEqual([
      'items_learned',
      'last_study_date',
      'reviews_total',
      'streak_current',
      'streak_longest',
      'today',
    ]);
    expect(result.streak_current).toBe(3);
    expect(result.today).toEqual({
      day: new Date().toISOString().slice(0, 10),
      review_count: 2,
      met_goal: true,
      goal: 2,
    });
  });

  it('does not expose achievement or badge endpoints', () => {
    expect('achievements' in GamificationController.prototype).toBe(false);
    expect('markSeen' in GamificationController.prototype).toBe(false);
  });

  it('records daily activity and learning counters without any XP columns', async () => {
    const tx = {
      userSettings: {
        findUnique: jest.fn().mockResolvedValue({ dailyGoal: 2 }),
      },
      streakDay: {
        findUnique: jest.fn().mockResolvedValue({ reviewCount: 1 }),
        upsert: jest.fn(),
      },
      userStats: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          streakCurrent: 2,
          streakLongest: 2,
          lastStudyDate: new Date('2026-11-17'),
          reviewsTotal: 3,
        }),
        update: jest.fn(),
      },
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn().mockResolvedValue([{ n: 4 }]),
    };
    const service = new GamificationService({} as PrismaService);
    const result = await service.applyActivity(tx as never, {
      userId: 1n,
      timezone: 'Asia/Ho_Chi_Minh',
      now: new Date('2026-11-17T18:00:00Z'),
      countsAsReview: true,
    });
    expect(result).toEqual({ streak_current: 3 });
    expect(tx.streakDay.upsert).toHaveBeenCalledWith({
      where: { userId_day: { userId: 1n, day: new Date('2026-11-18') } },
      create: {
        userId: 1n,
        day: new Date('2026-11-18'),
        reviewCount: 1,
        metGoal: true,
      },
      update: { reviewCount: { increment: 1 }, metGoal: true },
    });
    expect(tx.userStats.update).toHaveBeenCalledWith({
      where: { userId: 1n },
      data: {
        streakCurrent: 3,
        streakLongest: 3,
        lastStudyDate: new Date('2026-11-18'),
        itemsLearned: 4,
        reviewsTotal: 4,
      },
    });
  });
});
