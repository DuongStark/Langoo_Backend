import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { Client } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';
import { localDateString } from '../src/common/time/timezone';
import { addDays } from '../src/gamification/rules';

interface ActivityBody {
  year: number;
  timezone: string;
  today: string;
  streak_current: number;
  streak_longest: number;
  days: {
    date: string;
    activity_count: number;
    review_count: number;
    distinct_words: number;
    unresolved_review_count: number;
  }[];
}

describe('M8.3 daily activity (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;

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

  async function learner() {
    const registration = await request(server)
      .post('/v1/auth/register')
      .send({
        email: `m83-${randomUUID()}@langoo.test`,
        password: 'matkhau-e2e-123',
      })
      .expect(201);
    const body = registration.body as {
      access_token: string;
      user: { id: string };
    };
    const token = body.access_token;
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
    await request(server)
      .patch('/v1/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ timezone: 'Asia/Ho_Chi_Minh' })
      .expect(200);
    const collection = await request(server)
      .post('/v1/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'M8.3 test' })
      .expect(201);
    const collectionId = (collection.body as { id: string }).id;
    const item = await request(server)
      .post(`/v1/collections/${collectionId}/items`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sense_id: '1', secondary_sense_id: '2', meaning_vi: 'chạy' })
      .expect(201);
    const faces = (item.body as { faces: { id: string; sense_id: string }[] })
      .faces;
    return {
      token,
      userId: BigInt(body.user.id),
      face: faces[0].id,
      englishFace: faces.find((f) => f.sense_id === '2')!.id,
      collectionId,
    };
  }

  it('M6.3: bỏ XP, giữ streak và receipt khi ôn', async () => {
    const u = await learner();
    const localToday = localDateString(new Date(), 'Asia/Ho_Chi_Minh');
    await prisma.streakDay.create({
      data: {
        userId: u.userId,
        day: new Date(`${localToday}T00:00:00.000Z`),
      },
    });
    const payload = {
      face_id: u.face,
      direction: 'recognize',
      rating: 3,
      client_review_id: randomUUID(),
    };
    const first = await request(server)
      .post('/v1/srs/reviews')
      .set('Authorization', `Bearer ${u.token}`)
      .send(payload)
      .expect(200);
    const again = await request(server)
      .post('/v1/srs/reviews')
      .set('Authorization', `Bearer ${u.token}`)
      .send(payload)
      .expect(200);
    expect(first.body).not.toHaveProperty('xp');
    expect(again.body).toEqual(first.body);
    const stats = await prisma.userStats.findUniqueOrThrow({
      where: { userId: u.userId },
    });
    expect(stats.streakCurrent).toBe(1);
    expect(stats.reviewsTotal).toBe(1);
    expect(
      await prisma.streakDay.findFirstOrThrow({ where: { userId: u.userId } }),
    ).toMatchObject({ reviewCount: 1 });
  });

  it('lịch theo timezone, giữ lượt không nối được từ và cách ly user', async () => {
    const u = await learner();
    const other = await learner();
    const anotherSense = await request(server)
      .post(`/v1/collections/${u.collectionId}/items`)
      .set('Authorization', `Bearer ${u.token}`)
      .send({ sense_id: '4', meaning_vi: 'nghĩa khác' })
      .expect(201);
    const secondFace = (anotherSense.body as { faces: { id: string }[] })
      .faces[0].id;
    const reviewedAt = new Date('2026-10-10T18:00:00.000Z');
    await prisma.reviewLog.createMany({
      data: [
        { userId: u.userId, faceId: u.englishFace, rating: 3, reviewedAt },
        { userId: u.userId, faceId: secondFace, rating: 2, reviewedAt },
        { userId: u.userId, faceId: randomUUID(), rating: 3, reviewedAt },
        { userId: other.userId, faceId: other.face, rating: 3, reviewedAt },
      ],
    });
    await prisma.streakDay.create({
      data: {
        userId: u.userId,
        day: new Date('2026-10-11T00:00:00.000Z'),
        reviewCount: 4,
      },
    });
    const response = await request(server)
      .get('/v1/me/activity?year=2026')
      .set('Authorization', `Bearer ${u.token}`)
      .expect(200);
    const body = response.body as ActivityBody;
    expect(body.year).toBe(2026);
    expect(body.timezone).toBe('Asia/Ho_Chi_Minh');
    expect(body.days).toHaveLength(365);
    expect(body.days.find((d) => d.date === '2026-10-11')).toMatchObject({
      activity_count: 4,
      review_count: 3,
      distinct_words: 1,
      unresolved_review_count: 1,
    });
    expect(body.days.find((d) => d.date === '2026-10-10')).toMatchObject({
      activity_count: 0,
      review_count: 0,
      distinct_words: 0,
    });
  });

  it('trả đủ ngày năm nhuận và từ chối year sai', async () => {
    const u = await learner();
    const leap = await request(server)
      .get('/v1/me/activity?year=2024')
      .set('Authorization', `Bearer ${u.token}`)
      .expect(200);
    expect((leap.body as ActivityBody).days).toHaveLength(366);
    await request(server)
      .get('/v1/me/activity?year=not-a-year')
      .set('Authorization', `Bearer ${u.token}`)
      .expect(400);
    await request(server)
      .get('/v1/me/activity?year=0')
      .set('Authorization', `Bearer ${u.token}`)
      .expect(400);
    await request(server).get('/v1/me/activity').expect(401);
  });

  it('nhóm lượt ôn sát giao thừa theo timezone của người học', async () => {
    const u = await learner();
    await request(server)
      .patch('/v1/me/settings')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ timezone: 'America/New_York' })
      .expect(200);
    await prisma.$queryRaw`SELECT app.ensure_month_partition('2026-01-01'::date)`;
    await prisma.reviewLog.create({
      data: {
        userId: u.userId,
        faceId: u.face,
        rating: 3,
        reviewedAt: new Date('2026-01-01T04:30:00.000Z'),
      },
    });
    const response = await request(server)
      .get('/v1/me/activity?year=2025')
      .set('Authorization', `Bearer ${u.token}`)
      .expect(200);
    const body = response.body as ActivityBody;
    expect(body.timezone).toBe('America/New_York');
    expect(body.days.find((d) => d.date === '2025-12-31')).toMatchObject({
      review_count: 1,
      distinct_words: 1,
      unresolved_review_count: 0,
    });
  });

  it('streak hết hạn khi đã nghỉ hơn một ngày, giữ chuỗi khi học hôm qua', async () => {
    const u = await learner();
    const today = localDateString(new Date(), 'Asia/Ho_Chi_Minh');
    await prisma.userStats.upsert({
      where: { userId: u.userId },
      create: {
        userId: u.userId,
        streakCurrent: 5,
        streakLongest: 8,
        lastStudyDate: new Date(`${addDays(today, -3)}T00:00:00.000Z`),
      },
      update: {
        streakCurrent: 5,
        streakLongest: 8,
        lastStudyDate: new Date(`${addDays(today, -3)}T00:00:00.000Z`),
      },
    });
    const expired = await request(server)
      .get('/v1/me/activity')
      .set('Authorization', `Bearer ${u.token}`)
      .expect(200);
    expect(expired.body).toMatchObject({
      streak_current: 0,
      streak_longest: 8,
      today,
    });
    const stats = await request(server)
      .get('/v1/me/stats')
      .set('Authorization', `Bearer ${u.token}`)
      .expect(200);
    expect(stats.body).toMatchObject({ streak_current: 0, streak_longest: 8 });
    await prisma.userStats.update({
      where: { userId: u.userId },
      data: { lastStudyDate: new Date(`${addDays(today, -1)}T00:00:00.000Z`) },
    });
    const active = await request(server)
      .get('/v1/me/activity')
      .set('Authorization', `Bearer ${u.token}`)
      .expect(200);
    expect(active.body).toMatchObject({ streak_current: 5, streak_longest: 8 });
  });

  it('một response lịch không trộn dữ liệu trước và sau lượt ôn đồng thời', async () => {
    const u = await learner();
    const lock = new Client({ connectionString: process.env.DATABASE_URL });
    await lock.connect();
    try {
      await lock.query('BEGIN');
      await lock.query(
        'LOCK TABLE app.collection_item_face IN ACCESS EXCLUSIVE MODE',
      );
      const pending = request(server)
        .get('/v1/me/activity')
        .set('Authorization', `Bearer ${u.token}`)
        .then((response) => response);
      let waiting = false;
      for (let attempt = 0; attempt < 60 && !waiting; attempt++) {
        await lock.query('SELECT pg_stat_clear_snapshot()');
        const result = await lock.query<{ waiting: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FROM app.review_log r%') AS waiting",
        );
        waiting = result.rows[0].waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(waiting).toBe(true);
      // Allow the independent streak query to complete while the review query waits.
      await new Promise((resolve) => setTimeout(resolve, 100));
      const day = localDateString(new Date(), 'Asia/Ho_Chi_Minh');
      const dayDate = new Date(`${day}T00:00:00.000Z`);
      await prisma.$transaction(async (tx) => {
        await tx.reviewLog.create({
          data: { userId: u.userId, faceId: u.face, rating: 3 },
        });
        await tx.streakDay.create({
          data: { userId: u.userId, day: dayDate, reviewCount: 1 },
        });
        await tx.userStats.create({
          data: {
            userId: u.userId,
            streakCurrent: 1,
            streakLongest: 1,
            lastStudyDate: dayDate,
          },
        });
      });
      await lock.query('COMMIT');
      const response = await pending;
      expect(response.status).toBe(200);
      const body = response.body as ActivityBody;
      const today = body.days.find((d) => d.date === day)!;
      expect(today.activity_count).toBe(today.review_count);
      expect(body.streak_current).toBe(today.activity_count);
    } finally {
      await lock.query('ROLLBACK').catch(() => undefined);
      await lock.end();
    }
  });
});
