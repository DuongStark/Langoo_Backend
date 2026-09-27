import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { addDays } from '../src/gamification/rules';
import { PrismaService } from '../src/db/prisma.service';

interface StatsBody {
  xp_total: number;
  level: number;
  level_progress: {
    level: number;
    xp_in_level: number;
    xp_for_next: number;
    percent: number;
  };
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

interface AchievementItemBody {
  code: string;
  progress: number;
  unlocked_at: string | null;
  seen_at: string | null;
}

interface AchievementsBody {
  data: AchievementItemBody[];
  unseen_count: number;
}

interface ReviewBody {
  review_log: { id: string };
  srs: { state: string };
  xp: { amount: number };
}

describe('Gamification (e2e — langoo_test)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;

  const runId = Date.now();
  const password = 'matkhau-e2e-123';

  async function registerUser(
    label: string,
  ): Promise<{ token: string; userId: bigint }> {
    const res = await request(server)
      .post('/v1/auth/register')
      .send({ email: `e2e-m8-${label}-${runId}@langoo.test`, password })
      .expect(201);
    const body = res.body as { user: { id: string }; access_token: string };
    return { token: body.access_token, userId: BigInt(body.user.id) };
  }

  async function setupUser(
    label: string,
  ): Promise<{ token: string; userId: bigint; collectionId: string }> {
    const { token, userId } = await registerUser(label);
    await request(server)
      .post('/v1/profiles')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Nhật–Việt',
        primary_language_id: 2,
        secondary_language_id: 1,
        support_language_id: 3,
      })
      .expect(201);
    const collection = await request(server)
      .post('/v1/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Bộ ${label}` })
      .expect(201);
    return {
      token,
      userId,
      collectionId: (collection.body as { id: string }).id,
    };
  }

  async function addItem(
    token: string,
    collectionId: string,
    senseId: string,
    secondarySenseId: string,
    meaning: string,
  ): Promise<{ faceIds: string[] }> {
    const res = await request(server)
      .post(`/v1/collections/${collectionId}/items`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        sense_id: senseId,
        secondary_sense_id: secondarySenseId,
        meaning_vi: meaning,
      })
      .expect(201);
    const body = res.body as { faces: { id: string }[] };
    return { faceIds: body.faces.map((face) => face.id) };
  }

  async function cardsOf(userId: bigint) {
    return prisma.srsState.findMany({
      where: { userId },
      orderBy: { id: 'asc' },
    });
  }

  async function review(
    token: string,
    body: Record<string, unknown>,
  ): Promise<ReviewBody> {
    const res = await request(server)
      .post('/v1/srs/reviews')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(200);
    return res.body as ReviewBody;
  }

  async function getStats(token: string): Promise<StatsBody> {
    const res = await request(server)
      .get('/v1/me/stats')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body as StatsBody;
  }

  async function getAchievements(token: string): Promise<AchievementsBody> {
    const res = await request(server)
      .get('/v1/me/achievements')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body as AchievementsBody;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('mặc định & lượt ôn đầu tiên', () => {
    let token = '';
    let userId = 0n;
    let collectionId = '';

    beforeAll(async () => {
      const ctx = await setupUser('basic');
      token = ctx.token;
      userId = ctx.userId;
      collectionId = ctx.collectionId;
      await addItem(token, collectionId, '1', '2', 'chạy');
      await addItem(token, collectionId, '5', '6', 'ăn');
      await addItem(token, collectionId, '7', '8', 'đi');
    });

    it('user chưa hoạt động → defaults, không tạo rác', async () => {
      const stats = await getStats(token);
      expect(stats).toMatchObject({
        xp_total: 0,
        level: 1,
        streak_current: 0,
        streak_longest: 0,
        last_study_date: null,
        items_learned: 0,
        reviews_total: 0,
        today: { review_count: 0, xp: 0, met_goal: false, goal: 20 },
      });
      expect(stats.level_progress).toEqual({
        level: 1,
        xp_in_level: 0,
        xp_for_next: 100,
        percent: 0,
      });
      expect(await prisma.userStats.count({ where: { userId } })).toBe(0);

      const achievements = await getAchievements(token);
      expect(achievements.data.length).toBeGreaterThanOrEqual(5);
      expect(achievements.unseen_count).toBe(0);
      expect(
        achievements.data.find((item) => item.code === 'reviews_1000'),
      ).toMatchObject({ progress: 0, unlocked_at: null });
    });

    it('lượt ôn đầu tiên: +1 XP review +2 XP ngày học + streak 1', async () => {
      const cards = await cardsOf(userId);
      const first = await review(token, {
        face_id: cards[0].faceId,
        direction: cards[0].direction,
        rating: 3,
      });
      expect(first.xp.amount).toBe(1);

      const stats = await getStats(token);
      expect(stats.xp_total).toBe(3);
      expect(stats.streak_current).toBe(1);
      expect(stats.streak_longest).toBe(1);
      expect(stats.reviews_total).toBe(1);
      expect(stats.items_learned).toBe(1);
      expect(stats.today.review_count).toBe(1);
      expect(stats.today.xp).toBe(3);
      expect(stats.today.met_goal).toBe(false);
      expect(stats.last_study_date).toBe(stats.today.day);

      const day = await prisma.streakDay.findFirstOrThrow({
        where: { userId },
      });
      expect(day).toMatchObject({ reviewCount: 1, xp: 3, metGoal: false });
      expect(
        await prisma.xpEvent.count({
          where: { userId, source: 'streak' },
        }),
      ).toBe(1);
    });

    it('lượt thứ hai cùng ngày: chỉ +1 XP review, bonus ngày không lặp', async () => {
      const cards = await cardsOf(userId);
      const second = await review(token, {
        face_id: cards[4].faceId,
        direction: cards[4].direction,
        rating: 3,
      });
      expect(second.xp.amount).toBe(1);

      const stats = await getStats(token);
      expect(stats.xp_total).toBe(4);
      expect(stats.streak_current).toBe(1);
      expect(stats.today.review_count).toBe(2);
      expect(stats.today.xp).toBe(4);
      expect(
        await prisma.xpEvent.count({ where: { userId, source: 'streak' } }),
      ).toBe(1);
    });

    it('retry cùng client_review_id → không cộng đôi stats', async () => {
      const cards = await cardsOf(userId);
      const key = randomUUID();
      await review(token, {
        face_id: cards[8].faceId,
        direction: cards[8].direction,
        rating: 3,
        client_review_id: key,
      });
      const before = await getStats(token);

      await review(token, {
        face_id: cards[8].faceId,
        direction: cards[8].direction,
        rating: 3,
        client_review_id: key,
      });
      const after = await getStats(token);
      expect(after).toEqual(before);
      expect(
        await prisma.xpEvent.count({ where: { userId, source: 'review' } }),
      ).toBe(3);
    });
  });

  describe('daily cap', () => {
    it('cap review = 2 → lượt thứ 3 nhận 0 XP nhưng vẫn ghi streak_day', async () => {
      const ctx = await setupUser('cap');
      await addItem(ctx.token, ctx.collectionId, '1', '2', 'chạy');
      await addItem(ctx.token, ctx.collectionId, '5', '6', 'ăn');
      await addItem(ctx.token, ctx.collectionId, '7', '8', 'đi');
      const cards = await cardsOf(ctx.userId);

      await prisma.xpRule.update({
        where: { code: 'review' },
        data: { dailyCap: 2 },
      });
      try {
        const first = await review(ctx.token, {
          face_id: cards[0].faceId,
          direction: cards[0].direction,
          rating: 3,
        });
        const second = await review(ctx.token, {
          face_id: cards[4].faceId,
          direction: cards[4].direction,
          rating: 3,
        });
        const third = await review(ctx.token, {
          face_id: cards[8].faceId,
          direction: cards[8].direction,
          rating: 3,
        });
        expect([first.xp.amount, second.xp.amount, third.xp.amount]).toEqual([
          1, 1, 0,
        ]);

        const stats = await getStats(ctx.token);
        expect(stats.xp_total).toBe(4); // 2 review + 2 streak
        expect(stats.reviews_total).toBe(3);
        const day = await prisma.streakDay.findFirstOrThrow({
          where: { userId: ctx.userId },
        });
        expect(day.reviewCount).toBe(3);
        expect(day.xp).toBe(4);
      } finally {
        await prisma.xpRule.update({
          where: { code: 'review' },
          data: { dailyCap: 200 },
        });
      }
    });
  });

  describe('streak & met_goal', () => {
    it('hôm qua đã học → +1; cũ hơn → reset 1; daily_goal=1 → met_goal', async () => {
      const ctx = await setupUser('streak');
      await addItem(ctx.token, ctx.collectionId, '1', '2', 'chạy');
      await addItem(ctx.token, ctx.collectionId, '5', '6', 'ăn');
      await addItem(ctx.token, ctx.collectionId, '7', '8', 'đi');
      await addItem(ctx.token, ctx.collectionId, '9', '10', 'nước');
      const cards = await cardsOf(ctx.userId);

      await review(ctx.token, {
        face_id: cards[0].faceId,
        direction: cards[0].direction,
        rating: 3,
      });
      let stats = await getStats(ctx.token);
      expect(stats.streak_current).toBe(1);
      const today = stats.today.day;

      await prisma.userStats.update({
        where: { userId: ctx.userId },
        data: {
          lastStudyDate: new Date(`${addDays(today, -1)}T00:00:00.000Z`),
        },
      });
      await review(ctx.token, {
        face_id: cards[4].faceId,
        direction: cards[4].direction,
        rating: 3,
      });
      stats = await getStats(ctx.token);
      expect(stats.streak_current).toBe(2);

      await prisma.userStats.update({
        where: { userId: ctx.userId },
        data: {
          lastStudyDate: new Date(`${addDays(today, -3)}T00:00:00.000Z`),
        },
      });
      await review(ctx.token, {
        face_id: cards[8].faceId,
        direction: cards[8].direction,
        rating: 3,
      });
      stats = await getStats(ctx.token);
      expect(stats.streak_current).toBe(1);
      expect(stats.streak_longest).toBe(2);

      await request(server)
        .patch('/v1/me/settings')
        .set('Authorization', `Bearer ${ctx.token}`)
        .send({ daily_goal: 1 })
        .expect(200);
      await review(ctx.token, {
        face_id: cards[12].faceId,
        direction: cards[12].direction,
        rating: 3,
      });
      stats = await getStats(ctx.token);
      expect(stats.today.met_goal).toBe(true);
      expect(stats.today.goal).toBe(1);
    });
  });

  describe('thành tích', () => {
    const code = `verify_reviews_3_${runId}`;
    let token = '';
    let userId = 0n;

    beforeAll(async () => {
      const ctx = await setupUser('ach');
      token = ctx.token;
      userId = ctx.userId;
      await addItem(token, ctx.collectionId, '1', '2', 'chạy');
      await addItem(token, ctx.collectionId, '5', '6', 'ăn');
      await addItem(token, ctx.collectionId, '7', '8', 'đi');
      await addItem(token, ctx.collectionId, '9', '10', 'nước');
      await prisma.achievement.create({
        data: {
          code,
          nameVi: 'Thử 3 lượt',
          category: 'milestone',
          rule: { metric: 'reviews_total', gte: 3 },
          xpReward: 7,
        },
      });
    });

    afterAll(async () => {
      await prisma.achievement.deleteMany({ where: { code } });
    });

    it('đủ ngưỡng → mở khoá 1 lần + thưởng XP; tiến độ seeded tăng', async () => {
      const cards = await cardsOf(userId);
      for (const card of [cards[0], cards[4], cards[8]]) {
        await review(token, {
          face_id: card.faceId,
          direction: card.direction,
          rating: 3,
        });
      }

      const row = await prisma.userAchievement.findFirstOrThrow({
        where: { userId, achievementCode: code },
      });
      expect(row.unlockedAt).not.toBeNull();
      expect(Number(row.progress)).toBe(3);
      expect(
        await prisma.xpEvent.count({
          where: { userId, source: 'achievement' },
        }),
      ).toBe(1);

      const stats = await getStats(token);
      expect(stats.xp_total).toBe(12); // 3 review + 2 streak + 7 thưởng
      expect(stats.level).toBe(1);
      expect(stats.level_progress.percent).toBe(12);

      const achievements = await getAchievements(token);
      expect(
        achievements.data.find((item) => item.code === 'reviews_1000'),
      ).toMatchObject({ progress: 3, unlocked_at: null });
      expect(
        achievements.data.find((item) => item.code === code),
      ).toMatchObject({ progress: 3, xp_reward: 7 });
      expect(achievements.unseen_count).toBe(1);
    });

    it('lượt tiếp theo không thưởng lại; seen đánh dấu đã xem', async () => {
      const cards = await cardsOf(userId);
      await review(token, {
        face_id: cards[12].faceId,
        direction: cards[12].direction,
        rating: 3,
      });
      expect(
        await prisma.xpEvent.count({
          where: { userId, source: 'achievement' },
        }),
      ).toBe(1);
      expect((await getStats(token)).xp_total).toBe(13);

      const seen = await request(server)
        .post('/v1/me/achievements/seen')
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(200);
      expect(seen.body).toMatchObject({ updated: 1, unseen_count: 0 });
      const achievements = await getAchievements(token);
      expect(
        achievements.data.find((item) => item.code === code)?.seen_at,
      ).not.toBeNull();
    });
  });

  describe('phiên ôn (M7) cập nhật gamification', () => {
    it('hoàn thành phiên 2 câu → stats/streak cập nhật, session.xp_awarded khớp', async () => {
      const ctx = await setupUser('session');
      await addItem(ctx.token, ctx.collectionId, '1', '2', 'chạy');
      await addItem(ctx.token, ctx.collectionId, '5', '6', 'ăn');

      // Practice still enforces bury/eligibility at answer time. Keep the
      // snapshot on two different items so the first answer cannot bury the
      // second fixture card.
      const practiceCards = await cardsOf(ctx.userId);
      await prisma.srsState.updateMany({
        where: { id: { in: practiceCards.slice(1, 4).map((card) => card.id) } },
        data: { suspended: true },
      });

      const created = await request(server)
        .post('/v1/sessions')
        .set('Authorization', `Bearer ${ctx.token}`)
        .send({
          kind: 'practice',
          mode: 'typing',
          collection_id: ctx.collectionId,
          limit: 2,
        })
        .expect(201);
      const session = created.body as {
        session: { id: string; xp_awarded: number };
        items: { ordinal: number }[];
      };

      for (const item of session.items) {
        const row = await prisma.studySessionItem.findFirstOrThrow({
          where: { sessionId: session.session.id, ordinal: item.ordinal },
          select: { correctAnswer: true },
        });
        const accepted = (row.correctAnswer as { accepted: string[] }).accepted;
        await request(server)
          .post(`/v1/sessions/${session.session.id}/answers`)
          .set('Authorization', `Bearer ${ctx.token}`)
          .send({ ordinal: item.ordinal, answer_text: accepted[0] })
          .expect(200);
      }

      const detail = await request(server)
        .get(`/v1/sessions/${session.session.id}`)
        .set('Authorization', `Bearer ${ctx.token}`)
        .expect(200);
      const finished = detail.body as {
        session: { status: string; xp_awarded: number };
      };
      expect(finished.session.status).toBe('completed');
      expect(finished.session.xp_awarded).toBe(2);

      const stats = await getStats(ctx.token);
      expect(stats.reviews_total).toBe(2);
      expect(stats.xp_total).toBe(4); // 2 review + 2 streak
      expect(stats.streak_current).toBe(1);
      expect(stats.today.review_count).toBe(2);
      expect(
        await prisma.xpEvent.count({
          where: { userId: ctx.userId, source: 'streak' },
        }),
      ).toBe(1);
    });
  });

  describe('bảo mật & biên', () => {
    it('không token → 401 cho stats/achievements/seen', async () => {
      await request(server).get('/v1/me/stats').expect(401);
      await request(server).get('/v1/me/achievements').expect(401);
      await request(server)
        .post('/v1/me/achievements/seen')
        .send({})
        .expect(401);
    });

    it('seen với code lạ → updated 0, không lỗi', async () => {
      const { token } = await registerUser('seen-empty');
      const res = await request(server)
        .post('/v1/me/achievements/seen')
        .set('Authorization', `Bearer ${token}`)
        .send({ codes: ['khong_ton_tai'] })
        .expect(200);
      expect(res.body).toMatchObject({ updated: 0, unseen_count: 0 });
    });
  });
});
