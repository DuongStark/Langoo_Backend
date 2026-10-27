import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';

// Cooldown ngắn + quota nhỏ để test nhanh, không phụ thuộc mặc định production.
process.env.AI_QUIZ_COOLDOWN_MS = '800';
process.env.AI_QUIZ_DAILY_LIMIT = '3';

interface QuizBody {
  id: string;
  quiz_type: string;
  question_count: number;
  status: string;
  reused?: boolean;
}

interface SessionBody {
  session: {
    id: string;
    kind: string;
    mode: string;
    status: string;
    item_count: number;
    correct_count: number;
    score: number | null;
    xp_awarded: number;
  };
  items: {
    id: string;
    ordinal: number;
    prompt: Record<string, unknown>;
    is_correct: boolean | null;
    correct_answer?: unknown;
  }[];
}

interface AnswerBody {
  item: { ordinal: number; is_correct: boolean | null };
  srs: unknown;
  xp: { amount: number };
  session: { status: string; correct_count: number };
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe('AI Quiz (e2e — langoo_test)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;

  const runId = Date.now();
  const password = 'matkhau-e2e-123';
  const mcParams = {
    question_types: ['multiple_choice'],
    question_count: 3,
  } as const;

  let mainToken = '';
  let mainCollectionId = '';
  let otherToken = '';
  let otherCollectionId = '';
  let mcQuizId = '';

  async function register(email: string): Promise<string> {
    const res = await request(server)
      .post('/v1/auth/register')
      .send({ email, password })
      .expect(201);
    return (res.body as { access_token: string }).access_token;
  }

  function auth(token: string): { Authorization: string } {
    return { Authorization: `Bearer ${token}` };
  }

  async function setupCollection(
    token: string,
    senses: string[],
    meanings: string[],
  ): Promise<string> {
    await request(server)
      .post('/v1/profiles')
      .set(auth(token))
      .send({
        name: 'Nhật–Việt',
        primary_language_id: 2,
        secondary_language_id: 1,
        support_language_id: 3,
      })
      .expect(201);

    const created = await request(server)
      .post('/v1/collections')
      .set(auth(token))
      .send({ name: `Quiz e2e ${runId}` })
      .expect(201);
    const collectionId = (created.body as { id: string }).id;

    for (let index = 0; index < senses.length; index += 1) {
      await request(server)
        .post(`/v1/collections/${collectionId}/items`)
        .set(auth(token))
        .send({ sense_id: senses[index], meaning_vi: meanings[index] })
        .expect(201);
    }
    return collectionId;
  }

  function aiUsageRow(userId: bigint) {
    return prisma.aiUsage.findFirst({
      where: { userId, feature: 'quiz' },
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

    mainToken = await register(`e2e-quiz-main-${runId}@langoo.test`);
    mainCollectionId = await setupCollection(
      mainToken,
      ['1', '5', '7', '9', '11', '13'],
      ['chạy', 'ăn', 'đi', 'nước', 'ngày', 'sách'],
    );

    otherToken = await register(`e2e-quiz-other-${runId}@langoo.test`);
    otherCollectionId = await setupCollection(
      otherToken,
      ['1', '5', '7', '9'],
      ['chạy', 'ăn', 'đi', 'nước'],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('sinh quiz MC: ready, ẩn đáp án, dedup bấm đúp, cooldown khác tham số', async () => {
    const first = await request(server)
      .post('/v1/quizzes')
      .set(auth(mainToken))
      .send({ ...mcParams, collection_id: mainCollectionId })
      .expect(201);
    const quiz = first.body as QuizBody;
    mcQuizId = quiz.id;

    expect(quiz).toMatchObject({
      quiz_type: 'multiple_choice',
      question_count: 3,
      status: 'ready',
      reused: false,
    });
    expect(quiz).not.toHaveProperty('difficulty');

    // bấm đúp cùng tham số trong cooldown → trả lại quiz cũ, không tiêu thêm quota
    const duplicate = await request(server)
      .post('/v1/quizzes')
      .set(auth(mainToken))
      .send({ ...mcParams, collection_id: mainCollectionId })
      .expect(201);
    expect(duplicate.body).toMatchObject({ id: mcQuizId, reused: true });

    // khác tham số trong cooldown → 429
    const cooldown = await request(server)
      .post('/v1/quizzes')
      .set(auth(mainToken))
      .send({
        question_types: ['multiple_choice'],
        question_count: 2,
        collection_id: mainCollectionId,
      })
      .expect(429);
    expect(cooldown.body).toMatchObject({ code: 'QUIZ_GENERATION_COOLDOWN' });

    // chi tiết: 3 câu, không lộ đáp án
    const detail = await request(server)
      .get(`/v1/quizzes/${mcQuizId}`)
      .set(auth(mainToken))
      .expect(200);
    const detailBody = detail.body as {
      quiz: QuizBody;
      questions: Record<string, unknown>[];
      sessions: unknown[];
    };
    expect(detailBody.questions).toHaveLength(3);
    for (const question of detailBody.questions) {
      expect(question).toMatchObject({ question_type: 'multiple_choice' });
      expect(['meaning', 'kanji_reading', 'kanji_orthography']).toContain(
        question.question_style,
      );
      expect(question).not.toHaveProperty('correct_answer');
      expect(Array.isArray(question.options)).toBe(true);
    }
    expect(detailBody.sessions).toHaveLength(0);

    // lịch sử
    const list = await request(server)
      .get('/v1/quizzes')
      .set(auth(mainToken))
      .expect(200);
    const listBody = list.body as {
      data: (QuizBody & { latest_session: unknown })[];
    };
    expect(listBody.data.map((entry) => entry.id)).toContain(mcQuizId);
    expect(
      listBody.data.find((entry) => entry.id === mcQuizId)?.latest_session,
    ).toBeNull();

    // quota: 1 lần sinh (dedup không tính thêm)
    const userId = (
      await prisma.user.findFirstOrThrow({
        where: { email: `e2e-quiz-main-${runId}@langoo.test` },
        select: { id: true },
      })
    ).id;
    const usage = await aiUsageRow(userId);
    expect(usage?.requestCount).toBe(1);
  });

  it('start + trả lời: 2 đúng 1 sai → correct_count 2, score 67, XP chỉ khi đúng', async () => {
    await sleep(900);

    const started = await request(server)
      .post(`/v1/quizzes/${mcQuizId}/start`)
      .set(auth(mainToken))
      .expect(201);
    const session = started.body as SessionBody;
    expect(session.session).toMatchObject({
      kind: 'quiz',
      mode: 'multiple_choice',
      item_count: 3,
      status: 'in_progress',
    });
    expect(session.items).toHaveLength(3);
    for (const item of session.items) {
      expect(item.prompt).toMatchObject({ kind: 'multiple_choice' });
      expect(item.correct_answer).toBeUndefined();
    }
    const sessionId = session.session.id;

    const questions = await prisma.quizQuestion.findMany({
      where: { quizId: mcQuizId },
      orderBy: { ordinal: 'asc' },
    });
    const correctIndexes = questions.map(
      (question) => (question.correctAnswer as { index: number }).index,
    );
    const wrongIndexes = correctIndexes.map((index) => (index === 0 ? 1 : 0));

    const first = await request(server)
      .post(`/v1/sessions/${sessionId}/answers`)
      .set(auth(mainToken))
      .send({ ordinal: 1, option_index: correctIndexes[0] })
      .expect(200);
    expect(first.body as AnswerBody).toMatchObject({
      srs: null,
      xp: { amount: 0 },
    });
    expect((first.body as AnswerBody).item.is_correct).toBe(true);

    const second = await request(server)
      .post(`/v1/sessions/${sessionId}/answers`)
      .set(auth(mainToken))
      .send({ ordinal: 2, option_index: wrongIndexes[1] })
      .expect(200);
    expect(second.body as AnswerBody).toMatchObject({
      srs: null,
      xp: { amount: 0 },
    });
    expect((second.body as AnswerBody).item.is_correct).toBe(false);

    const third = await request(server)
      .post(`/v1/sessions/${sessionId}/answers`)
      .set(auth(mainToken))
      .send({ ordinal: 3, option_index: correctIndexes[2] })
      .expect(200);
    expect((third.body as AnswerBody).xp.amount).toBe(0);

    const detail = await request(server)
      .get(`/v1/sessions/${sessionId}`)
      .set(auth(mainToken))
      .expect(200);
    const detailBody = detail.body as SessionBody;
    expect(detailBody.session).toMatchObject({
      status: 'completed',
      correct_count: 2,
      score: 67,
    });

    const wrongItems = await request(server)
      .get(`/v1/sessions/${sessionId}/items?is_correct=false`)
      .set(auth(mainToken))
      .expect(200);
    expect(wrongItems.body as unknown[]).toHaveLength(1);

    // replay không cộng XP lần hai
    const replay = await request(server)
      .post(`/v1/sessions/${sessionId}/answers`)
      .set(auth(mainToken))
      .send({ ordinal: 2, option_index: wrongIndexes[1] })
      .expect(200);
    expect((replay.body as AnswerBody).item.is_correct).toBe(false);
    expect((replay.body as AnswerBody).xp.amount).toBe(0);

    const userId = (
      await prisma.user.findFirstOrThrow({
        where: { email: `e2e-quiz-main-${runId}@langoo.test` },
        select: { id: true },
      })
    ).id;
    const xpSum = await prisma.xpEvent.aggregate({
      _sum: { amount: true },
      where: { userId, source: 'quiz' },
    });
    expect(xpSum._sum.amount).toBeNull();
  });

  it('mixed: đủ 3 loại câu hỏi + chấm fill_blank và matching', async () => {
    await sleep(900);

    const created = await request(server)
      .post('/v1/quizzes')
      .set(auth(mainToken))
      .send({
        question_types: ['multiple_choice', 'fill_blank', 'matching'],
        question_count: 3,
        collection_id: mainCollectionId,
      })
      .expect(201);
    const mixedBody = created.body as QuizBody;
    expect(mixedBody.quiz_type).toBe('mixed');
    const mixedQuizId = mixedBody.id;

    const started = await request(server)
      .post(`/v1/quizzes/${mixedQuizId}/start`)
      .set(auth(mainToken))
      .expect(201);
    const session = started.body as SessionBody;
    expect(session.items.map((item) => item.prompt.kind)).toEqual([
      'multiple_choice',
      'typing',
      'matching',
    ]);

    const questions = await prisma.quizQuestion.findMany({
      where: { quizId: mixedQuizId },
      orderBy: { ordinal: 'asc' },
    });

    const fillBlank = questions[1].correctAnswer as { accepted: string[] };
    const fbAnswer = await request(server)
      .post(`/v1/sessions/${session.session.id}/answers`)
      .set(auth(mainToken))
      .send({ ordinal: 2, answer_text: fillBlank.accepted[0] })
      .expect(200);
    expect((fbAnswer.body as AnswerBody).item.is_correct).toBe(true);

    const matching = questions[2].correctAnswer as {
      mapping: { left_index: number; right_index: number }[];
    };
    const matchAnswer = await request(server)
      .post(`/v1/sessions/${session.session.id}/answers`)
      .set(auth(mainToken))
      .send({ ordinal: 3, pairs: matching.mapping })
      .expect(200);
    expect((matchAnswer.body as AnswerBody).item.is_correct).toBe(true);
    expect((matchAnswer.body as AnswerBody).xp.amount).toBe(0);

    // câu MC sai → is_correct false, không XP
    const mcCorrect = (questions[0].correctAnswer as { index: number }).index;
    const wrong = await request(server)
      .post(`/v1/sessions/${session.session.id}/answers`)
      .set(auth(mainToken))
      .send({ ordinal: 1, option_index: mcCorrect === 0 ? 1 : 0 })
      .expect(200);
    expect((wrong.body as AnswerBody).item.is_correct).toBe(false);
    expect((wrong.body as AnswerBody).xp.amount).toBe(0);
  });

  it('từ chối option_index ngoài snapshot và không tạo activity', async () => {
    const token = await register(`e2e-quiz-invalid-index-${runId}@langoo.test`);
    const collectionId = await setupCollection(
      token,
      ['1', '5'],
      ['chạy', 'ăn'],
    );
    const userId = (
      await prisma.user.findFirstOrThrow({
        where: { email: `e2e-quiz-invalid-index-${runId}@langoo.test` },
        select: { id: true },
      })
    ).id;
    const quiz = await request(server)
      .post('/v1/quizzes')
      .set(auth(token))
      .send({
        question_types: ['multiple_choice'],
        question_count: 2,
        collection_id: collectionId,
      })
      .expect(201);
    const quizId = (quiz.body as QuizBody).id;
    const started = await request(server)
      .post(`/v1/quizzes/${quizId}/start`)
      .set(auth(token))
      .expect(201);
    const sessionId = (started.body as SessionBody).session.id;

    const invalid = await request(server)
      .post(`/v1/sessions/${sessionId}/answers`)
      .set(auth(token))
      .send({ ordinal: 1, option_index: 999 })
      .expect(400);
    expect(invalid.body).toMatchObject({ code: 'SESSION_ANSWER_INVALID' });

    const item = await prisma.studySessionItem.findFirstOrThrow({
      where: { sessionId, ordinal: 1 },
    });
    expect(item.answeredAt).toBeNull();
    expect(item.isCorrect).toBeNull();
    expect(await prisma.userStats.findUnique({ where: { userId } })).toBeNull();
    expect(await prisma.streakDay.count({ where: { userId } })).toBe(0);
    expect(await prisma.xpEvent.count({ where: { userId } })).toBe(0);
  });

  it('achievement quiz_correct mở khoá ngay ở câu đúng đầu tiên', async () => {
    const email = `e2e-quiz-achievement-${runId}@langoo.test`;
    const token = await register(email);
    const collectionId = await setupCollection(
      token,
      ['1', '5'],
      ['chạy', 'ăn'],
    );
    const userId = (
      await prisma.user.findFirstOrThrow({
        where: { email },
        select: { id: true },
      })
    ).id;
    const achievementCode = `verify_quiz_correct_${runId}`;
    await prisma.achievement.create({
      data: {
        code: achievementCode,
        nameVi: 'Đúng câu quiz đầu tiên',
        category: 'quiz',
        rule: { metric: 'quiz_correct', gte: 1 },
        xpReward: 7,
      },
    });

    try {
      const quiz = await request(server)
        .post('/v1/quizzes')
        .set(auth(token))
        .send({
          question_types: ['multiple_choice'],
          question_count: 2,
          collection_id: collectionId,
        })
        .expect(201);
      const quizId = (quiz.body as QuizBody).id;
      const started = await request(server)
        .post(`/v1/quizzes/${quizId}/start`)
        .set(auth(token))
        .expect(201);
      const sessionId = (started.body as SessionBody).session.id;
      const question = await prisma.quizQuestion.findFirstOrThrow({
        where: { quizId, ordinal: 1 },
      });
      const correctIndex = (question.correctAnswer as { index: number }).index;

      const answer = await request(server)
        .post(`/v1/sessions/${sessionId}/answers`)
        .set(auth(token))
        .send({ ordinal: 1, option_index: correctIndex })
        .expect(200);
      expect((answer.body as AnswerBody).item.is_correct).toBe(true);

      const achievement = await prisma.userAchievement.findUniqueOrThrow({
        where: { userId_achievementCode: { userId, achievementCode } },
      });
      expect(Number(achievement.progress)).toBe(1);
      expect(achievement.unlockedAt).not.toBeNull();
      expect(
        await prisma.xpEvent.count({
          where: { userId, source: 'achievement', refId: achievementCode },
        }),
      ).toBe(0);

      const replay = await request(server)
        .post(`/v1/sessions/${sessionId}/answers`)
        .set(auth(token))
        .send({ ordinal: 1, option_index: correctIndex })
        .expect(200);
      expect(replay.body).toEqual(answer.body);
      expect(
        await prisma.xpEvent.count({
          where: { userId, source: 'achievement', refId: achievementCode },
        }),
      ).toBe(0);
    } finally {
      await prisma.achievement.deleteMany({ where: { code: achievementCode } });
    }
  });

  it('lỗi ghi achievement rollback cả answer, XP, streak và session', async () => {
    const email = `e2e-quiz-rollback-${runId}@langoo.test`;
    const token = await register(email);
    const collectionId = await setupCollection(
      token,
      ['1', '5'],
      ['chạy', 'ăn'],
    );
    const userId = (
      await prisma.user.findFirstOrThrow({
        where: { email },
        select: { id: true },
      })
    ).id;
    const achievementCode = `verify_quiz_rollback_${runId}`;
    const triggerName = 'test_reject_session_answer_receipt';
    const functionName = 'test_reject_session_answer_receipt';
    await prisma.achievement.create({
      data: {
        code: achievementCode,
        nameVi: 'Rollback kiểm thử',
        category: 'quiz',
        rule: { metric: 'quiz_correct', gte: 1 },
        xpReward: 7,
      },
    });

    try {
      const quiz = await request(server)
        .post('/v1/quizzes')
        .set(auth(token))
        .send({
          question_types: ['multiple_choice'],
          question_count: 2,
          collection_id: collectionId,
        })
        .expect(201);
      const quizId = (quiz.body as QuizBody).id;
      const started = await request(server)
        .post(`/v1/quizzes/${quizId}/start`)
        .set(auth(token))
        .expect(201);
      const sessionId = (started.body as SessionBody).session.id;
      const question = await prisma.quizQuestion.findFirstOrThrow({
        where: { quizId, ordinal: 1 },
      });
      const correctIndex = (question.correctAnswer as { index: number }).index;

      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS ${triggerName} ON app.study_session_item`,
      );
      await prisma.$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION app.${functionName}() RETURNS trigger
        LANGUAGE plpgsql AS $body$
        BEGIN
          IF NEW.answer_receipt IS NOT NULL
             AND NEW.session_id = '${sessionId}'::uuid THEN
            RAISE EXCEPTION 'forced answer receipt write failure';
          END IF;
          RETURN NEW;
        END
        $body$
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER ${triggerName}
        BEFORE UPDATE OF answer_receipt ON app.study_session_item
        FOR EACH ROW EXECUTE FUNCTION app.${functionName}()
      `);

      await request(server)
        .post(`/v1/sessions/${sessionId}/answers`)
        .set(auth(token))
        .send({ ordinal: 1, option_index: correctIndex })
        .expect(500);

      const item = await prisma.studySessionItem.findFirstOrThrow({
        where: { sessionId, ordinal: 1 },
      });
      const sessionRow = await prisma.studySession.findUniqueOrThrow({
        where: { id: sessionId },
      });
      expect(item).toMatchObject({
        answeredAt: null,
        isCorrect: null,
        userAnswer: null,
        answerReceipt: null,
      });
      expect(sessionRow).toMatchObject({
        status: 'in_progress',
        correctCount: 0,
        xpAwarded: 0,
      });
      expect(await prisma.xpEvent.count({ where: { userId } })).toBe(0);
      expect(await prisma.streakDay.count({ where: { userId } })).toBe(0);
      expect(
        await prisma.userStats.findUnique({ where: { userId } }),
      ).toBeNull();
      expect(await prisma.userAchievement.count({ where: { userId } })).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS ${triggerName} ON app.study_session_item`,
      );
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS app.${functionName}()`,
      );
      await prisma.achievement.deleteMany({ where: { code: achievementCode } });
    }
  });

  it('cách ly user: quiz của người khác → 404', async () => {
    await request(server)
      .get(`/v1/quizzes/${mcQuizId}`)
      .set(auth(otherToken))
      .expect(404);

    await request(server)
      .post(`/v1/quizzes/${mcQuizId}/start`)
      .set(auth(otherToken))
      .expect(404);
  });

  it('quota riêng 3/ngày: lần sinh thứ 4 → 429 AI_QUOTA_EXCEEDED', async () => {
    const params = [
      { question_types: ['multiple_choice'], question_count: 2 },
      { question_types: ['fill_blank'], question_count: 2 },
      { question_types: ['matching'], question_count: 1 },
    ];
    for (const item of params) {
      await request(server)
        .post('/v1/quizzes')
        .set(auth(otherToken))
        .send({ ...item, collection_id: otherCollectionId })
        .expect(201);
      await sleep(900);
    }

    const blocked = await request(server)
      .post('/v1/quizzes')
      .set(auth(otherToken))
      .send({
        question_types: ['multiple_choice'],
        question_count: 3,
        collection_id: otherCollectionId,
      })
      .expect(429);
    expect(blocked.body).toMatchObject({ code: 'AI_QUOTA_EXCEEDED' });
  });

  it('quiz hết hạn → 409 QUIZ_EXPIRED', async () => {
    await prisma.quiz.update({
      where: { id: mcQuizId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(server)
      .post(`/v1/quizzes/${mcQuizId}/start`)
      .set(auth(mainToken))
      .expect(409);
    expect(res.body).toMatchObject({ code: 'QUIZ_EXPIRED' });
  });

  it('validation biên: field cũ/dạng sai/count sai → 400; collection người khác → 404', async () => {
    // field cũ không còn được nhận (forbidNonWhitelisted)
    await request(server)
      .post('/v1/quizzes')
      .set(auth(mainToken))
      .send({
        quiz_type: 'multiple_choice',
        question_types: ['multiple_choice'],
        question_count: 2,
      })
      .expect(400);

    await request(server)
      .post('/v1/quizzes')
      .set(auth(mainToken))
      .send({
        question_types: ['multiple_choice'],
        difficulty: 'easy',
        question_count: 2,
      })
      .expect(400);

    // mảng dạng rỗng/trùng/không hợp lệ
    for (const question_types of [
      [],
      ['multiple_choice', 'multiple_choice'],
      ['khong-co'],
    ]) {
      await request(server)
        .post('/v1/quizzes')
        .set(auth(mainToken))
        .send({ question_types, question_count: 2 })
        .expect(400);
    }

    await request(server)
      .post('/v1/quizzes')
      .set(auth(mainToken))
      .send({ question_types: ['multiple_choice'], question_count: 0 })
      .expect(400);

    const res = await request(server)
      .post('/v1/quizzes')
      .set(auth(mainToken))
      .send({
        question_types: ['multiple_choice'],
        question_count: 2,
        collection_id: otherCollectionId,
      })
      .expect(404);
    expect(res.body).toMatchObject({ code: 'COLLECTION_NOT_FOUND' });
  });

  it('quiz tính activity (streak) nhưng KHÔNG cộng reviews_total (M8.2)', async () => {
    const token = await register(`e2e-quiz-count-${runId}@langoo.test`);
    const collectionId = await setupCollection(
      token,
      ['1', '5'],
      ['chạy', 'ăn'],
    );

    const created = await request(server)
      .post('/v1/quizzes')
      .set(auth(token))
      .send({
        question_types: ['multiple_choice'],
        question_count: 2,
        collection_id: collectionId,
      })
      .expect(201);
    const quizId = (created.body as QuizBody).id;

    const started = await request(server)
      .post(`/v1/quizzes/${quizId}/start`)
      .set(auth(token))
      .expect(201);
    const sessionId = (started.body as SessionBody).session.id;

    const questions = await prisma.quizQuestion.findMany({
      where: { quizId },
      orderBy: { ordinal: 'asc' },
    });
    const correct = questions.map(
      (question) => (question.correctAnswer as { index: number }).index,
    );
    const wrong = correct.map((index) => (index === 0 ? 1 : 0));

    // Câu 1 sai (không nhận XP) vẫn phải tính activity; câu 2 đúng.
    await request(server)
      .post(`/v1/sessions/${sessionId}/answers`)
      .set(auth(token))
      .send({ ordinal: 1, option_index: wrong[0] })
      .expect(200);
    await request(server)
      .post(`/v1/sessions/${sessionId}/answers`)
      .set(auth(token))
      .send({ ordinal: 2, option_index: correct[1] })
      .expect(200);

    const user = await prisma.user.findFirstOrThrow({
      where: { email: `e2e-quiz-count-${runId}@langoo.test` },
      select: { id: true },
    });
    const stats = await prisma.userStats.findUnique({
      where: { userId: user.id },
    });
    expect(stats?.reviewsTotal ?? 0).toBe(0);

    const dayRows = await prisma.streakDay.findMany({
      where: { userId: user.id },
    });
    expect(dayRows.reduce((sum, row) => sum + row.reviewCount, 0)).toBe(2);
  });
});
