import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';
import {
  AI_QUIZ_PROVIDER,
  AiQuizGenerateInput,
  AiQuizProvider,
} from '../src/ai/providers/ai-quiz.provider';
import { buildQuizQuestions } from '../src/ai/quiz/quiz-generator';
import { QuizSourceRepository } from '../src/ai/quiz/repositories/quiz-source.repository';
import { CreateQuizResponse } from '../src/ai/quiz/types/quiz.types';
import { SessionDetailResponse } from '../src/sessions/types/sessions.types';

process.env.AI_QUIZ_COOLDOWN_MS = '15000';
process.env.AI_QUIZ_DAILY_LIMIT = '15';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('M11 regressions (e2e — local *_test only)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const runId = Date.now();
  const emails: string[] = [];
  let generate: AiQuizProvider['generate'] = (input) =>
    Promise.resolve(buildQuizQuestions(input));
  const params = {
    quiz_type: 'multiple_choice',
    difficulty: 'medium',
    question_count: 1,
  };
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function fixture(
    label: string,
    senses = ['1', '5', '7'],
    meanings = ['chạy', 'ăn', 'đi'],
  ) {
    const email = `e2e-m11-fix-${runId}-${label}@langoo.test`;
    emails.push(email);
    const registered = await request(server)
      .post('/v1/auth/register')
      .send({ email, password: 'matkhau-regression-123' })
      .expect(201);
    const token = (registered.body as { access_token: string }).access_token;
    const profile = await request(server)
      .post('/v1/profiles')
      .set(auth(token))
      .send({
        name: label,
        primary_language_id: 2,
        secondary_language_id: 1,
        support_language_id: 3,
      })
      .expect(201);
    const collection = await request(server)
      .post('/v1/collections')
      .set(auth(token))
      .send({ name: label })
      .expect(201);
    const collectionId = (collection.body as { id: string }).id;
    for (let i = 0; i < senses.length; i++) {
      await request(server)
        .post(`/v1/collections/${collectionId}/items`)
        .set(auth(token))
        .send({ sense_id: senses[i], meaning_vi: meanings[i] })
        .expect(201);
    }
    const user = await prisma.user.findFirstOrThrow({
      where: { email },
      select: { id: true },
    });
    return {
      token,
      userId: user.id,
      collectionId,
      profileId: (profile.body as { id: string }).id,
    };
  }
  const create = (token: string, body: Record<string, unknown> = params) =>
    request(server).post('/v1/quizzes').set(auth(token)).send(body);
  async function ageQuiz(id: string) {
    await prisma.quiz.update({
      where: { id },
      data: { createdAt: new Date(Date.now() - 60000) },
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_QUIZ_PROVIDER)
      .useValue({
        name: 'stub',
        generate: (input: AiQuizGenerateInput) => generate(input),
      } satisfies AiQuizProvider)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
  });
  afterEach(() => {
    generate = (input) => Promise.resolve(buildQuizQuestions(input));
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await app.close();
  });

  it('serializes simultaneous creates: one quiz/provider call/quota reservation', async () => {
    const f = await fixture('race');
    const providerEntered = deferred(),
      release = deferred();
    let calls = 0;
    generate = async (input) => {
      calls++;
      providerEntered.resolve();
      await release.promise;
      return buildQuizQuestions(input);
    };
    // Widen the original race window between cooldown read and claim insert.
    const repo = app.get(QuizSourceRepository),
      original = repo.findSourceItems.bind(repo);
    jest.spyOn(repo, 'findSourceItems').mockImplementation(async (...args) => {
      const result = await original(...args);
      await new Promise((r) => setTimeout(r, 100));
      return result;
    });
    const first = create(f.token).then((r) => r);
    const second = create(f.token).then((r) => r);
    let responses;
    try {
      await providerEntered.promise;
      // Only the rejected request can finish while generation is held open.
      const early = await Promise.race([
        first,
        second,
        new Promise<never>((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error('Both creates entered the provider')),
            3000,
          );
          timer.unref();
        }),
      ]);
      expect(early.status).toBe(429);
      expect(early.body).toMatchObject({ code: 'QUIZ_GENERATION_COOLDOWN' });
    } finally {
      release.resolve();
      responses = await Promise.all([first, second]);
    }
    expect(responses.map((r) => r.status).sort()).toEqual([201, 429]);
    expect(calls).toBe(1);
    expect(await prisma.quiz.count({ where: { userId: f.userId } })).toBe(1);
    expect(
      await prisma.aiUsage.findFirst({
        where: { userId: f.userId, feature: 'quiz' },
      }),
    ).toMatchObject({ requestCount: 1 });
    const ready = responses.find((r) => r.status === 201)!
      .body as CreateQuizResponse;
    expect((await create(f.token).expect(201)).body).toMatchObject({
      id: ready.id,
      reused: true,
    });
  });

  it('never reuses the old profile quiz after changing active profile', async () => {
    const f = await fixture('profile');
    const old = (await create(f.token).expect(201)).body as CreateQuizResponse;
    const profile = await request(server)
      .post('/v1/profiles')
      .set(auth(f.token))
      .send({
        name: 'Empty English',
        primary_language_id: 1,
        secondary_language_id: 2,
        support_language_id: 3,
      })
      .expect(201);
    await request(server)
      .patch('/v1/me/settings')
      .set(auth(f.token))
      .send({ active_profile_id: (profile.body as { id: string }).id })
      .expect(200);
    expect((await create(f.token).expect(429)).body).toMatchObject({
      code: 'QUIZ_GENERATION_COOLDOWN',
    });
    await ageQuiz(old.id);
    expect((await create(f.token).expect(409)).body).toMatchObject({
      code: 'QUIZ_NOT_ENOUGH_ITEMS',
    });
    expect(
      await prisma.aiUsage.findFirst({
        where: { userId: f.userId, feature: 'quiz' },
      }),
    ).toMatchObject({ requestCount: 1 });
  });

  it('rejects an archived collection even on a potential dedup hit', async () => {
    const f = await fixture('archive');
    const body = { ...params, collection_id: f.collectionId };
    await create(f.token, body).expect(201);
    await request(server)
      .delete(`/v1/collections/${f.collectionId}`)
      .set(auth(f.token))
      .expect(200);
    expect((await create(f.token, body).expect(404)).body).toMatchObject({
      code: 'COLLECTION_NOT_FOUND',
    });
  });

  it('rejects null collection_id before quota or quiz mutations', async () => {
    const f = await fixture('null');
    expect(
      (await create(f.token, { ...params, collection_id: null }).expect(400))
        .body,
    ).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await prisma.aiUsage.count({ where: { userId: f.userId } })).toBe(0);
    expect(await prisma.quiz.count({ where: { userId: f.userId } })).toBe(0);
  });

  it('invalid matching indices/duplicate right do not lock the answer or record activity', async () => {
    const f = await fixture('matching');
    const quiz = (
      await create(f.token, { ...params, quiz_type: 'matching' }).expect(201)
    ).body as CreateQuizResponse;
    const started = (
      await request(server)
        .post(`/v1/quizzes/${quiz.id}/start`)
        .set(auth(f.token))
        .expect(201)
    ).body as SessionDetailResponse;
    const question = await prisma.quizQuestion.findFirstOrThrow({
      where: { quizId: quiz.id },
    });
    const { mapping } = question.correctAnswer as {
      mapping: { left_index: number; right_index: number }[];
    };
    const wrongRight = mapping.map((p) => ({ ...p }));
    wrongRight[0].right_index = 999;
    const wrongLeft = mapping.map((p) => ({ ...p }));
    wrongLeft[0].left_index = 999;
    const duplicate = mapping.map((p) => ({ ...p }));
    duplicate[0].right_index = duplicate[1].right_index;
    for (const pairs of [wrongRight, wrongLeft, duplicate]) {
      expect(
        (
          await request(server)
            .post(`/v1/sessions/${started.session.id}/answers`)
            .set(auth(f.token))
            .send({ ordinal: 1, pairs })
            .expect(400)
        ).body,
      ).toMatchObject({ code: 'SESSION_ANSWER_INVALID' });
    }
    expect(
      await prisma.studySessionItem.findFirst({
        where: { sessionId: started.session.id },
      }),
    ).toMatchObject({ answeredAt: null, isCorrect: null, answerReceipt: null });
    expect(await prisma.streakDay.count({ where: { userId: f.userId } })).toBe(
      0,
    );
    expect(await prisma.xpEvent.count({ where: { userId: f.userId } })).toBe(0);
    const answered = await request(server)
      .post(`/v1/sessions/${started.session.id}/answers`)
      .set(auth(f.token))
      .send({ ordinal: 1, pairs: mapping })
      .expect(200);
    expect(answered.body).toMatchObject({
      item: { is_correct: true },
      xp: { amount: 5 },
      session: { status: 'completed' },
    });
  });

  it('polysemy-only MC/matching/mixed source is rejected without quota use', async () => {
    const f = await fixture('polysemy', ['2', '4'], ['chạy', 'điều hành']);
    for (const quiz_type of ['multiple_choice', 'matching', 'mixed']) {
      expect(
        (await create(f.token, { ...params, quiz_type }).expect(409)).body,
      ).toMatchObject({ code: 'QUIZ_NOT_ENOUGH_ITEMS' });
    }
    expect(await prisma.aiUsage.count({ where: { userId: f.userId } })).toBe(0);
    await create(f.token, { ...params, quiz_type: 'fill_blank' }).expect(201);
  });

  it('requires SRS for the same user/profile; a new-state item is still eligible', async () => {
    const f = await fixture('srs');
    const states = await prisma.srsState.findMany({
      where: { userId: f.userId },
      select: { id: true, state: true },
    });
    expect(states.every((s) => s.state === 'new')).toBe(true);
    await prisma.srsState.deleteMany({ where: { userId: f.userId } });
    expect((await create(f.token).expect(409)).body).toMatchObject({
      code: 'QUIZ_NOT_ENOUGH_ITEMS',
    });
    const other = await request(server)
      .post('/v1/profiles')
      .set(auth(f.token))
      .send({
        name: 'Other',
        primary_language_id: 1,
        secondary_language_id: 2,
        support_language_id: 3,
      })
      .expect(201);
    const faces = await prisma.collectionItemFace.findMany({
      where: { item: { collectionId: f.collectionId } },
      select: { id: true },
    });
    await prisma.srsState.createMany({
      data: faces.map((face) => ({
        faceId: face.id,
        userId: f.userId,
        profileId: (other.body as { id: string }).id,
        direction: 'recognize',
        state: 'new',
        dueAt: new Date(),
      })),
    });
    expect((await create(f.token).expect(409)).body).toMatchObject({
      code: 'QUIZ_NOT_ENOUGH_ITEMS',
    });
    await prisma.srsState.updateMany({
      where: { userId: f.userId },
      data: { profileId: f.profileId },
    });
    await create(f.token).expect(201);
  });

  it('source deletion during generation preserves the snapshot with a null item reference', async () => {
    const f = await fixture('delete');
    const entered = deferred(),
      release = deferred();
    let victim = '';
    generate = async (input) => {
      const q = buildQuizQuestions(input);
      victim = q[0].itemId!;
      entered.resolve();
      await release.promise;
      return q;
    };
    const pending = create(f.token).then((r) => r);
    try {
      await entered.promise;
      await request(server)
        .delete(`/v1/collections/${f.collectionId}/items/${victim}`)
        .set(auth(f.token))
        .expect(200);
    } finally {
      release.resolve();
    }
    const ready = (await pending).body as CreateQuizResponse;
    expect(ready.status).toBe('ready');
    expect(
      await prisma.quizQuestion.findFirst({ where: { quizId: ready.id } }),
    ).toMatchObject({ itemId: null });
    await request(server)
      .post(`/v1/quizzes/${ready.id}/start`)
      .set(auth(f.token))
      .expect(201);
  });

  it('claim insert failure rolls back reserved quota and never calls the provider', async () => {
    const f = await fixture('claim-fail');
    const functionName = `m11_fail_claim_${runId}`;
    const triggerName = `m11_fail_claim_insert_${runId}`;
    const provider = jest.fn<
      ReturnType<AiQuizProvider['generate']>,
      Parameters<AiQuizProvider['generate']>
    >((input) => Promise.resolve(buildQuizQuestions(input)));
    generate = provider;
    try {
      await prisma.$executeRawUnsafe(
        `CREATE FUNCTION app.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id=${f.userId} THEN RAISE EXCEPTION 'forced quiz claim failure'; END IF; RETURN NEW; END $$`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER ${triggerName} BEFORE INSERT ON app.quiz FOR EACH ROW EXECUTE FUNCTION app.${functionName}()`,
      );
      await create(f.token).expect(500);
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS ${triggerName} ON app.quiz`,
      );
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS app.${functionName}()`,
      );
    }
    expect(provider).not.toHaveBeenCalled();
    expect(await prisma.quiz.count({ where: { userId: f.userId } })).toBe(0);
    expect(await prisma.aiUsage.count({ where: { userId: f.userId } })).toBe(0);
    await create(f.token).expect(201);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('DB insert failure marks failed, rolls back all questions and returns 503', async () => {
    const f = await fixture('persist-fail');
    const functionName = `m11_fail_quiz_${runId}`;
    const triggerName = `m11_fail_quiz_insert_${runId}`;
    const rows = await prisma.$queryRaw<
      { exists: boolean }[]
    >`SELECT EXISTS(SELECT 1 FROM app.quiz WHERE user_id=${f.userId}) AS exists`;
    expect(rows[0].exists).toBe(false);
    try {
      await prisma.$executeRawUnsafe(
        `CREATE FUNCTION app.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS (SELECT 1 FROM app.quiz WHERE id=NEW.quiz_id AND user_id=${f.userId}) THEN RAISE EXCEPTION 'forced quiz persistence failure'; END IF; RETURN NEW; END $$`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER ${triggerName} BEFORE INSERT ON app.quiz_question FOR EACH ROW EXECUTE FUNCTION app.${functionName}()`,
      );
      expect((await create(f.token).expect(503)).body).toMatchObject({
        code: 'AI_PROVIDER_UNAVAILABLE',
      });
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS ${triggerName} ON app.quiz_question`,
      );
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS app.${functionName}()`,
      );
    }
    const quiz = await prisma.quiz.findFirstOrThrow({
      where: { userId: f.userId },
    });
    expect(quiz.status).toBe('failed');
    expect(
      await prisma.quizQuestion.count({ where: { quizId: quiz.id } }),
    ).toBe(0);
    expect(
      await prisma.aiUsage.findFirst({
        where: { userId: f.userId, feature: 'quiz' },
      }),
    ).toMatchObject({ requestCount: 1 });
    expect(
      (
        await request(server)
          .post(`/v1/quizzes/${quiz.id}/start`)
          .set(auth(f.token))
          .expect(409)
      ).body,
    ).toMatchObject({ code: 'QUIZ_NOT_READY' });
  });
});
