import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { addDays } from '../src/gamification/rules';
import { PrismaService } from '../src/db/prisma.service';
import { safeTestTimezone } from './safe-timezone';

interface StatsBody {
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

interface ReviewBody {
  review_log: { id: string };
  srs: { state: string };
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
    // Giữ giờ địa phương ~12:00 để mốc "hết ngày" không cắt ngang test.
    await request(server)
      .patch('/v1/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ timezone: safeTestTimezone() })
      .expect(200);
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
        streak_current: 0,
        streak_longest: 0,
        last_study_date: null,
        items_learned: 0,
        reviews_total: 0,
        today: { review_count: 0, met_goal: false, goal: 20 },
      });
      expect(stats).not.toHaveProperty('xp_total');
      expect(stats).not.toHaveProperty('level');
      expect(stats).not.toHaveProperty('level_progress');
      expect(stats.today).not.toHaveProperty('xp');
      expect(await prisma.userStats.count({ where: { userId } })).toBe(0);
    });

    it('lượt ôn đầu tiên: streak 1, không có XP', async () => {
      const cards = await cardsOf(userId);
      const first = await review(token, {
        face_id: cards[0].faceId,
        direction: 'recognize',
        rating: 3,
      });

      expect(first).not.toHaveProperty('xp');
      const stats = await getStats(token);
      expect(stats.streak_current).toBe(1);
      expect(stats.streak_longest).toBe(1);
      expect(stats.reviews_total).toBe(1);
      expect(stats.items_learned).toBe(1);
      expect(stats.today.review_count).toBe(1);
      expect(stats.today.met_goal).toBe(false);
      expect(stats.last_study_date).toBe(stats.today.day);

      const day = await prisma.streakDay.findFirstOrThrow({
        where: { userId },
      });
      expect(day).toMatchObject({ reviewCount: 1, metGoal: false });
    });

    it('lượt thứ hai cùng ngày: giữ streak, không cộng XP', async () => {
      const cards = await cardsOf(userId);
      const second = await review(token, {
        face_id: cards[2].faceId,
        direction: 'recognize',
        rating: 3,
      });

      expect(second).not.toHaveProperty('xp');
      const stats = await getStats(token);
      expect(stats.streak_current).toBe(1);
      expect(stats.today.review_count).toBe(2);
    });

    it('retry cùng client_review_id → không cộng đôi stats', async () => {
      const cards = await cardsOf(userId);
      const key = randomUUID();
      await review(token, {
        face_id: cards[4].faceId,
        direction: 'recognize',
        rating: 3,
        client_review_id: key,
      });
      const before = await getStats(token);

      await review(token, {
        face_id: cards[4].faceId,
        direction: 'recognize',
        rating: 3,
        client_review_id: key,
      });
      const after = await getStats(token);
      expect(after).toEqual(before);
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
        direction: 'recognize',
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
        face_id: cards[2].faceId,
        direction: 'recognize',
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
        face_id: cards[4].faceId,
        direction: 'recognize',
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
        face_id: cards[6].faceId,
        direction: 'recognize',
        rating: 3,
      });
      stats = await getStats(ctx.token);
      expect(stats.today.met_goal).toBe(true);
      expect(stats.today.goal).toBe(1);
    });
  });

  describe('phiên ôn (M7) cập nhật gamification', () => {
    it('hoàn thành phiên 2 câu → stats/streak cập nhật', async () => {
      const ctx = await setupUser('session');
      await addItem(ctx.token, ctx.collectionId, '1', '2', 'chạy');
      await addItem(ctx.token, ctx.collectionId, '5', '6', 'ăn');

      // Practice still enforces bury/eligibility at answer time. Keep the
      // snapshot on two different items so the first answer cannot bury the
      // second fixture card.
      const practiceCards = await cardsOf(ctx.userId);
      await prisma.srsState.updateMany({
        where: {
          id: {
            in: practiceCards
              .filter((_, index) => index % 2 === 1)
              .map((card) => card.id),
          },
        },
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
        session: { id: string };
        items: { ordinal: number }[];
      };

      expect(session.items).toHaveLength(2);
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
        session: { status: string };
      };
      expect(finished.session.status).toBe('completed');

      const stats = await getStats(ctx.token);
      expect(stats.reviews_total).toBe(2);
      expect(stats.streak_current).toBe(1);
      expect(stats.today.review_count).toBe(2);
    });
  });

  describe('bảo mật & biên', () => {
    it('không token → 401 cho stats/achievements/seen', async () => {
      await request(server).get('/v1/me/stats').expect(401);
      await request(server).get('/v1/me/achievements').expect(404);
      await request(server)
        .post('/v1/me/achievements/seen')
        .send({})
        .expect(404);
    });

    it('M6.3: đã xóa endpoint huy hiệu kể cả khi đăng nhập', async () => {
      const { token } = await registerUser('removed-badges');
      await request(server)
        .get('/v1/me/achievements')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
      await request(server)
        .post('/v1/me/achievements/seen')
        .set('Authorization', `Bearer ${token}`)
        .send({ codes: [] })
        .expect(404);
    });
  });
});
