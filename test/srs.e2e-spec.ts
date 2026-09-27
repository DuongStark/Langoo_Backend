import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';

interface DueCardBody {
  srs_id: string;
  face_id: string;
  direction: string;
  state: string;
  language: { id: number; code: string; name_vi: string };
  instruction: string;
  prompt: {
    kind: string;
    text: string;
    reading?: string | null;
    meaning_source?: string;
    is_machine_generated?: boolean;
  };
  answer: {
    kind: string;
    text: string;
    meaning_source?: string;
    is_machine_generated?: boolean;
  };
}

interface DueBody {
  data: DueCardBody[];
  next_cursor: string | null;
  counts: { learning: number; review: number; new: number };
}

interface ReviewBody {
  review_log: { id: string; rating: number; prev_state: string | null };
  srs: {
    state: string;
    due_at: string;
    interval_days: number;
    ease_factor: number;
    learning_step: number | null;
  };
  xp: { amount: number };
}

interface StatsBody {
  due_now: number;
  due_today: number;
  learning: number;
  new_introduced_today: number;
  reviews_today: number;
  accuracy_7d: number | null;
}

describe('SRS (e2e — langoo_test)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;

  const runId = Date.now();
  const password = 'matkhau-e2e-123';

  let tokenA = '';
  let tokenB = '';
  let userIdA = 0n;
  let faceJa = '';
  let faceEn = '';

  async function registerUser(
    email: string,
  ): Promise<{ token: string; userId: bigint }> {
    const res = await request(server)
      .post('/v1/auth/register')
      .send({ email, password })
      .expect(201);
    const body = res.body as { user: { id: string }; access_token: string };
    return { token: body.access_token, userId: BigInt(body.user.id) };
  }

  async function createProfile(token: string): Promise<void> {
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
  }

  async function createCollectionWithItem(
    token: string,
  ): Promise<{ collectionId: string; faceJa: string; faceEn: string }> {
    const collection = await request(server)
      .post('/v1/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bộ SRS' })
      .expect(201);
    const collectionId = (collection.body as { id: string }).id;
    const item = await request(server)
      .post(`/v1/collections/${collectionId}/items`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sense_id: '1', secondary_sense_id: '2', meaning_vi: 'chạy' })
      .expect(201);
    const faces = (
      item.body as {
        faces: { id: string; language_id: number; role: string }[];
      }
    ).faces;
    return {
      collectionId,
      faceJa: faces.find((face) => face.language_id === 2)!.id,
      faceEn: faces.find((face) => face.language_id === 1)!.id,
    };
  }

  async function getDue(token: string, query = ''): Promise<DueBody> {
    const res = await request(server)
      .get(`/v1/srs/due${query}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body as DueBody;
  }

  async function forceDue(srsId: string): Promise<void> {
    await prisma.srsState.update({
      where: { id: BigInt(srsId) },
      data: { dueAt: new Date(Date.now() - 1000) },
    });
  }

  async function clearBury(userId: bigint): Promise<void> {
    await prisma.srsState.updateMany({
      where: { userId },
      data: { buriedUntil: null },
    });
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

    const a = await registerUser(`e2e-m6-a-${runId}@langoo.test`);
    const b = await registerUser(`e2e-m6-b-${runId}@langoo.test`);
    tokenA = a.token;
    tokenB = b.token;
    userIdA = a.userId;

    await createProfile(tokenA);
    const created = await createCollectionWithItem(tokenA);
    faceJa = created.faceJa;
    faceEn = created.faceEn;

    await createProfile(tokenB);
    await createCollectionWithItem(tokenB);
    await createCollectionWithItem(tokenB);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('hàng đợi & nội dung thẻ', () => {
    it('settings mặc định có daily limit SRS 20/200', async () => {
      const res = await request(server)
        .get('/v1/me/settings')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(res.body).toMatchObject({
        srs_new_per_day: 20,
        srs_review_per_day: 200,
      });
    });

    it('4 thẻ mới vào queue; thẻ recall có nhãn ngôn ngữ đích', async () => {
      const body = await getDue(tokenA);

      expect(body.data).toHaveLength(4);
      expect(body.counts).toEqual({ learning: 0, review: 0, new: 4 });

      const jaRecall = body.data.find(
        (card) => card.face_id === faceJa && card.direction === 'recall',
      )!;
      expect(jaRecall.language).toMatchObject({ id: 2, code: 'ja' });
      expect(jaRecall.instruction).toContain('Nhật');
      expect(jaRecall.prompt).toMatchObject({ kind: 'meaning', text: 'chạy' });
      expect(typeof jaRecall.prompt.meaning_source).toBe('string');
      expect(typeof jaRecall.prompt.is_machine_generated).toBe('boolean');
      expect(jaRecall.answer).toMatchObject({ kind: 'word', text: '走る' });

      const jaRecognize = body.data.find(
        (card) => card.face_id === faceJa && card.direction === 'recognize',
      )!;
      expect(jaRecognize.prompt).toMatchObject({ kind: 'word', text: '走る' });
      expect(jaRecognize.answer).toMatchObject({
        kind: 'meaning',
        text: 'chạy',
      });
    });

    it('phân trang cursor: 2 + 2, không trùng thẻ', async () => {
      const page1 = await getDue(tokenA, '?limit=2');
      expect(page1.data).toHaveLength(2);
      expect(page1.next_cursor).not.toBeNull();

      const page2 = await getDue(
        tokenA,
        `?limit=2&cursor=${encodeURIComponent(page1.next_cursor!)}`,
      );
      expect(page2.data).toHaveLength(2);

      const ids = [...page1.data, ...page2.data].map((card) => card.srs_id);
      expect(new Set(ids).size).toBe(4);
    });
  });

  describe('ôn thẻ', () => {
    let reviewedSrsId = '';
    const clientReviewId = uuidv7();
    let firstResult: ReviewBody;

    it('Good lần đầu → learning bước 1 (+10..15 phút), log + XP +1', async () => {
      const res = await request(server)
        .post('/v1/srs/reviews')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          face_id: faceJa,
          direction: 'recognize',
          rating: 3,
          elapsed_ms: 3200,
          client_review_id: clientReviewId,
        })
        .expect(200);
      firstResult = res.body as ReviewBody;

      expect(firstResult.srs.state).toBe('learning');
      expect(firstResult.srs.learning_step).toBe(1);
      expect(firstResult.srs.ease_factor).toBe(2.5);
      expect(firstResult.xp.amount).toBe(1);

      const dueInMinutes =
        (new Date(firstResult.srs.due_at).getTime() - Date.now()) / 60_000;
      expect(dueInMinutes).toBeGreaterThanOrEqual(9.5);
      expect(dueInMinutes).toBeLessThanOrEqual(15);

      const logCount = await prisma.reviewLog.count({
        where: { userId: userIdA },
      });
      expect(logCount).toBe(1);
      const xpCount = await prisma.xpEvent.count({
        where: { userId: userIdA, source: 'review' },
      });
      expect(xpCount).toBe(1);

      reviewedSrsId = (await getDue(tokenA)).data[0].srs_id; // thẻ đang học được trả lại nhờ learn-ahead
      expect((await getDue(tokenA)).data).toHaveLength(1);
    });

    it('burying nội bộ: sibling new/review bị ẩn tới hết ngày', async () => {
      const buried = await prisma.srsState.findMany({
        where: { userId: userIdA, buriedUntil: { not: null } },
      });
      expect(buried).toHaveLength(3);
      const buriedUntil = buried[0].buriedUntil!;
      expect(buriedUntil.getTime()).toBeGreaterThan(Date.now());
    });

    it('retry mạng cùng client_review_id → không cộng đôi', async () => {
      const res = await request(server)
        .post('/v1/srs/reviews')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          face_id: faceJa,
          direction: 'recognize',
          rating: 3,
          client_review_id: clientReviewId,
          elapsed_ms: 3200,
        })
        .expect(200);
      const repeated = res.body as ReviewBody;

      expect(repeated.review_log.id).toBe(firstResult.review_log.id);
      expect(await prisma.reviewLog.count({ where: { userId: userIdA } })).toBe(
        1,
      );
      expect(
        await prisma.xpEvent.count({
          where: { userId: userIdA, source: 'review' },
        }),
      ).toBe(1);
    });

    it('payload khác cùng client_review_id → 409 SRS_IDEMPOTENCY_CONFLICT', async () => {
      const res = await request(server)
        .post('/v1/srs/reviews')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          face_id: faceJa,
          direction: 'recognize',
          rating: 4,
          client_review_id: clientReviewId,
        })
        .expect(409);
      expect(res.body).toMatchObject({ code: 'SRS_IDEMPOTENCY_CONFLICT' });
    });

    it('ôn sớm trong 20 phút khi queue thường cạn → learn-ahead được nhận', async () => {
      const res = await request(server)
        .post('/v1/srs/reviews')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          face_id: faceJa,
          direction: 'recognize',
          rating: 3,
          client_review_id: uuidv7(),
        })
        .expect(200);
      expect((res.body as ReviewBody).srs.state).toBe('review');
    });

    it('Good sau bước cuối → tốt nghiệp review với interval tăng dần', async () => {
      await forceDue(reviewedSrsId);
      const res = await request(server)
        .post('/v1/srs/reviews')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          face_id: faceJa,
          direction: 'recognize',
          rating: 3,
          client_review_id: uuidv7(),
        })
        .expect(200);
      const body = res.body as ReviewBody;

      expect(body.srs.state).toBe('review');
      expect(body.srs.interval_days).toBeGreaterThan(1);
      expect(body.srs.learning_step).toBeNull();
    });

    it('Again trên thẻ review → lapse: relearning, EF −0.20, lapses +1', async () => {
      const row = await prisma.srsState.findFirstOrThrow({
        where: { userId: userIdA, faceId: faceJa, direction: 'recognize' },
      });
      await prisma.srsState.update({
        where: { id: row.id },
        data: {
          state: 'review',
          scheduledDays: 10,
          easeFactor: 2.5,
          dueAt: new Date(Date.now() - 1000),
        },
      });

      const res = await request(server)
        .post('/v1/srs/reviews')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          face_id: faceJa,
          direction: 'recognize',
          rating: 1,
          client_review_id: uuidv7(),
        })
        .expect(200);
      const body = res.body as ReviewBody;

      expect(body.review_log.prev_state).toBe('review');
      expect(body.srs.state).toBe('relearning');
      expect(body.srs.ease_factor).toBe(2.3);

      const after = await prisma.srsState.findUniqueOrThrow({
        where: { id: row.id },
      });
      expect(after.lapses).toBe(1);

      // Good sau relearning → về review interval 1 ngày
      await forceDue(row.id.toString());
      const grad = await request(server)
        .post('/v1/srs/reviews')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          face_id: faceJa,
          direction: 'recognize',
          rating: 3,
          client_review_id: uuidv7(),
        })
        .expect(200);
      expect((grad.body as ReviewBody).srs).toMatchObject({
        state: 'review',
        interval_days: 1,
      });
    });

    it('Again trên thẻ mới → learning bước 0 (+1..6 phút)', async () => {
      await clearBury(userIdA);
      const res = await request(server)
        .post('/v1/srs/reviews')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          face_id: faceEn,
          direction: 'recall',
          rating: 1,
          client_review_id: uuidv7(),
        })
        .expect(200);
      const body = res.body as ReviewBody;

      expect(body.srs).toMatchObject({ state: 'learning', learning_step: 0 });
      const dueInMinutes =
        (new Date(body.srs.due_at).getTime() - Date.now()) / 60_000;
      expect(dueInMinutes).toBeGreaterThanOrEqual(0.5);
      expect(dueInMinutes).toBeLessThanOrEqual(6);
    });
  });

  describe('daily limit', () => {
    it('giới hạn thẻ mới/ngày áp đúng và giữ sau khi giới thiệu', async () => {
      await request(server)
        .patch('/v1/me/settings')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ srs_new_per_day: 1 })
        .expect(200);

      const first = await getDue(tokenB);
      expect(first.counts.new).toBe(1);
      expect(first.data).toHaveLength(1);

      const card = first.data[0];
      await request(server)
        .post('/v1/srs/reviews')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          face_id: card.face_id,
          direction: card.direction,
          rating: 3,
          client_review_id: uuidv7(),
        })
        .expect(200);

      const after = await getDue(tokenB);
      expect(after.counts.new).toBe(0); // đã giới thiệu 1/1 hôm nay
    });
  });

  describe('stats & bảo mật', () => {
    it('stats khớp số liệu cơ bản', async () => {
      const res = await request(server)
        .get('/v1/srs/stats')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const body = res.body as StatsBody;

      expect(body.new_introduced_today).toBeGreaterThanOrEqual(2);
      expect(body.reviews_today).toBeGreaterThanOrEqual(2);
      expect(typeof body.accuracy_7d).toBe('number');
    });

    it('thẻ của user khác → 404', async () => {
      const res = await request(server)
        .post('/v1/srs/reviews')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          face_id: faceJa,
          direction: 'recognize',
          rating: 3,
          client_review_id: uuidv7(),
        })
        .expect(404);
      expect(res.body).toMatchObject({ code: 'SRS_ITEM_NOT_FOUND' });
    });

    it('checklist biên: cursor rác / rating sai / face_id rác → 400', async () => {
      const cursor = await request(server)
        .get('/v1/srs/due?cursor=rac!!!')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(400);
      expect(cursor.body).toMatchObject({ code: 'VALIDATION_FAILED' });

      const rating = await request(server)
        .post('/v1/srs/reviews')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          face_id: faceJa,
          direction: 'recognize',
          rating: 5,
        })
        .expect(400);
      expect(rating.body).toMatchObject({ code: 'VALIDATION_FAILED' });

      const face = await request(server)
        .post('/v1/srs/reviews')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ face_id: 'khong-phai-uuid', direction: 'recognize', rating: 3 })
        .expect(400);
      expect(face.body).toMatchObject({ code: 'VALIDATION_FAILED' });

      const nullKey = await request(server)
        .post('/v1/srs/reviews')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          face_id: faceJa,
          direction: 'recognize',
          rating: 3,
          client_review_id: null,
        })
        .expect(400);
      expect(nullKey.body).toMatchObject({ code: 'VALIDATION_FAILED' });

      const clientTime = await request(server)
        .post('/v1/srs/reviews')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          face_id: faceJa,
          direction: 'recognize',
          rating: 3,
          reviewed_at: '2026-09-27T00:00:00.000Z',
        })
        .expect(400);
      expect(clientTime.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('user chưa có hồ sơ → 409 PROFILE_REQUIRED; không token → 401', async () => {
      const c = await registerUser(`e2e-m6-c-${runId}@langoo.test`);

      const noProfile = await request(server)
        .get('/v1/srs/due')
        .set('Authorization', `Bearer ${c.token}`)
        .expect(409);
      expect(noProfile.body).toMatchObject({ code: 'PROFILE_REQUIRED' });

      const noToken = await request(server).get('/v1/srs/due').expect(401);
      expect(noToken.body).toMatchObject({ code: 'AUTH_TOKEN_MISSING' });
    });
  });
});
