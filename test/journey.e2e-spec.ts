import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';

/**
 * M12 — hành trình tổng: đăng ký → hồ sơ → bộ sưu tập → tra từ (lịch sử) →
 * phiên ôn (due) → quiz → thống kê. Bảo vệ luồng chính khỏi regression chéo module.
 */
describe('Journey (e2e — langoo_test)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;

  const runId = Date.now();
  const email = `e2e-journey-${runId}@langoo.test`;
  const password = 'matkhau-e2e-123';
  let token = '';
  let collectionId = '';

  function auth(): { Authorization: string } {
    return { Authorization: `Bearer ${token}` };
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

  it('đi hết luồng chính với dữ liệu thật', async () => {
    // 1) Đăng ký + hồ sơ
    const registered = await request(server)
      .post('/v1/auth/register')
      .send({ email, password, display_name: 'Journey' })
      .expect(201);
    token = (registered.body as { access_token: string }).access_token;

    await request(server)
      .post('/v1/profiles')
      .set(auth())
      .send({
        name: 'Nhật–Việt',
        primary_language_id: 2,
        secondary_language_id: 1,
        support_language_id: 3,
      })
      .expect(201);

    // 2) Bộ sưu tập + 2 từ
    const collection = await request(server)
      .post('/v1/collections')
      .set(auth())
      .send({ name: `Journey ${runId}` })
      .expect(201);
    collectionId = (collection.body as { id: string }).id;

    await request(server)
      .post(`/v1/collections/${collectionId}/items`)
      .set(auth())
      .send({ sense_id: '1', meaning_vi: 'chạy' })
      .expect(201);
    await request(server)
      .post(`/v1/collections/${collectionId}/items`)
      .set(auth())
      .send({ sense_id: '5', meaning_vi: 'ăn' })
      .expect(201);

    // 3) Tra từ (ghi lịch sử vì có token)
    const search = await request(server)
      .get('/v1/dictionary/search')
      .query({ q: '走る', lang: 'ja' })
      .set(auth())
      .expect(200);
    expect((search.body as { data: unknown[] }).data.length).toBeGreaterThan(0);

    const history = await request(server)
      .get('/v1/me/search-history')
      .set(auth())
      .expect(200);
    const rawQueries = (
      history.body as { data: { raw_query: string }[] }
    ).data.map((row) => row.raw_query);
    expect(rawQueries).toContain('走る');

    // 4) Phiên ôn (thẻ mới đang đến hạn) — chấm server-side.
    // Dùng 1 thẻ: phiên có cả 2 direction của cùng face sẽ bị burying ẩn sibling
    // (hành vi Anki M6.1) nên journey cố tình chọn 1 để tất định.
    const session = await request(server)
      .post('/v1/sessions')
      .set(auth())
      .send({
        kind: 'review',
        mode: 'multiple_choice',
        collection_id: collectionId,
        limit: 1,
      })
      .expect(201);
    const sessionBody = session.body as {
      session: { id: string; item_count: number };
      items: { ordinal: number }[];
    };
    expect(sessionBody.session.item_count).toBe(1);

    const sessionItems = await prisma.studySessionItem.findMany({
      where: { sessionId: sessionBody.session.id },
      orderBy: { ordinal: 'asc' },
    });
    for (const item of sessionItems) {
      const correct = item.correctAnswer as { index: number };
      await request(server)
        .post(`/v1/sessions/${sessionBody.session.id}/answers`)
        .set(auth())
        .send({ ordinal: item.ordinal, option_index: correct.index })
        .expect(200);
    }

    const finished = await request(server)
      .get(`/v1/sessions/${sessionBody.session.id}`)
      .set(auth())
      .expect(200);
    const finishedBody = finished.body as {
      session: { status: string; score: number | null; xp_awarded: number };
    };
    expect(finishedBody.session).toMatchObject({
      status: 'completed',
      score: 100,
    });
    expect(finishedBody.session.xp_awarded).toBe(0);

    // 5) Quiz từ chính bộ sưu tập
    const quiz = await request(server)
      .post('/v1/quizzes')
      .set(auth())
      .send({
        question_types: ['multiple_choice'],
        question_count: 2,
        collection_id: collectionId,
      })
      .expect(201);
    const quizId = (quiz.body as { id: string }).id;

    const quizStart = await request(server)
      .post(`/v1/quizzes/${quizId}/start`)
      .set(auth())
      .expect(201);
    const quizSession = quizStart.body as {
      session: { id: string; kind: string };
      items: { ordinal: number }[];
    };
    expect(quizSession.session.kind).toBe('quiz');

    const quizQuestions = await prisma.quizQuestion.findMany({
      where: { quizId },
      orderBy: { ordinal: 'asc' },
    });
    for (const question of quizQuestions) {
      const correct = question.correctAnswer as { index: number };
      await request(server)
        .post(`/v1/sessions/${quizSession.session.id}/answers`)
        .set(auth())
        .send({ ordinal: question.ordinal, option_index: correct.index })
        .expect(200);
    }

    const quizDone = await request(server)
      .get(`/v1/sessions/${quizSession.session.id}`)
      .set(auth())
      .expect(200);
    expect(
      (quizDone.body as { session: { status: string; score: number | null } })
        .session,
    ).toMatchObject({ status: 'completed', score: 100 });

    // 6) Gamification phản ánh cả hai hoạt động
    const stats = await request(server)
      .get('/v1/me/stats')
      .set(auth())
      .expect(200);
    const statsBody = stats.body as {
      xp_total: number;
      streak_current: number;
      reviews_total: number;
      today: { review_count: number };
    };
    // XP đang tạm dừng; hoạt động vẫn ghi streak và bộ đếm ngày.
    expect(statsBody.xp_total).toBe(0);
    expect(statsBody.streak_current).toBeGreaterThanOrEqual(1);
    // reviews_total chỉ đếm lượt ôn SRS (1); quiz chỉ tính activity trong ngày.
    expect(statsBody.reviews_total).toBe(1);
    expect(statsBody.today.review_count).toBeGreaterThanOrEqual(3);

    const calendar = await request(server)
      .get('/v1/me/activity')
      .set(auth())
      .expect(200);
    const activity = calendar.body as {
      today: string;
      days: {
        date: string;
        activity_count: number;
        review_count: number;
        distinct_words: number;
        unresolved_review_count: number;
      }[];
    };
    expect(
      activity.days.find((day) => day.date === activity.today),
    ).toMatchObject({
      activity_count: 3,
      review_count: 1,
      distinct_words: 1,
      unresolved_review_count: 0,
    });

    const achievements = await request(server)
      .get('/v1/me/achievements')
      .set(auth())
      .expect(200);
    expect(Array.isArray((achievements.body as { data: unknown[] }).data)).toBe(
      true,
    );
  });
});
