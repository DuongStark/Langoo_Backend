import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';
import { Prisma } from '../src/generated/prisma/client';
import { QuizJobsService } from '../src/ai/quiz/v3/quiz-jobs.service';
import { QuizBatchEngine } from '../src/ai/quiz/v3/quiz-batch-engine';
import { SrsService } from '../src/srs/srs.service';
import { PrivacyService } from '../src/privacy/privacy.service';
import { AiUsageService } from '../src/ai/usage/ai-usage.service';
import { QuizSourceRepository } from '../src/ai/quiz/repositories/quiz-source.repository';
import { QuizJobMetadata } from '../src/ai/quiz/v3/quiz-jobs.service';
import { QuizJobResponse } from '../src/ai/quiz/v3/quiz-v3.dto';
import { recentQuizContent } from '../src/ai/quiz/v3/quiz-cache.repository';
import { v7 as uuidv7 } from 'uuid';

// test/setup-env.ts refuses non-local/non-_test databases before any writes.
process.env.AI_QUIZ_V3_ENABLED = 'true';
process.env.AI_QUIZ_DAILY_LIMIT = '15';

describe('M11.3 quiz jobs (PostgreSQL local)', () => {
  let app: INestApplication;
  let server: Server;
  let db: PrismaService;
  let jobs: QuizJobsService;
  let engine: QuizBatchEngine;
  let token: string;
  let collection: string;
  let language: number;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(QuizBatchEngine)
      .useValue(new QuizBatchEngine({}))
      .compile();
    module.get(ConfigService).set('AI_QUIZ_V3_ENABLED', true);
    jobs = module.get(QuizJobsService);
    engine = module.get(QuizBatchEngine);
    jest.spyOn(jobs, 'onModuleInit').mockImplementation(() => undefined);
    app = module.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    server = app.getHttpServer() as Server;
    db = app.get(PrismaService);
    const languages = await db.$queryRaw<{ id: number }[]>(
      Prisma.sql`SELECT id FROM public.language WHERE code='en'`,
    );
    language = languages[0].id;
    const senses = await db.$queryRaw<{ id: bigint }[]>(
      Prisma.sql`SELECT DISTINCT ON (lower(l.lemma)) s.id FROM core.sense s JOIN core.lexeme l ON l.id=s.lexeme_id WHERE l.language_id=${language} ORDER BY lower(l.lemma),s.id LIMIT 4`,
    );
    expect(senses).toHaveLength(4);
    const registered = await request(server)
      .post('/v1/auth/register')
      .send({
        email: `m11-v3-${Date.now()}@langoo.test`,
        password: 'matkhau-e2e-123',
      })
      .expect(201);
    token = (registered.body as { access_token: string }).access_token;
    await request(server)
      .post('/v1/profiles')
      .set(auth())
      .send({
        name: 'M11.3 EN',
        primary_language_id: language,
        secondary_language_id: language === 1 ? 2 : 1,
        support_language_id: 3,
      })
      .expect(201);
    const created = await request(server)
      .post('/v1/collections')
      .set(auth())
      .send({ name: 'M11.3 job fixture' })
      .expect(201);
    collection = (created.body as { id: string }).id;
    for (let i = 0; i < senses.length; i++)
      await request(server)
        .post(`/v1/collections/${collection}/items`)
        .set(auth())
        .send({
          sense_id: senses[i].id.toString(),
          meaning_vi: `nghĩa kiểm thử ${i}`,
        })
        .expect(201);
  });
  afterAll(async () => {
    if (app) await app.close();
  });
  const payload = () => ({
    collection_id: collection,
    language_id: language,
    skills: ['meaning'],
    question_count: 2,
  });
  async function createJob(key: string): Promise<QuizJobResponse> {
    const response = await request(server)
      .post('/v1/quizzes/jobs')
      .set(auth())
      .send({ ...payload(), idempotency_key: key })
      .expect(202);
    return response.body as QuizJobResponse;
  }

  it('validates new DTOs and rejects a null collection instead of expanding the scope', async () => {
    await request(server)
      .post('/v1/quizzes/eligibility')
      .set(auth())
      .send({ ...payload(), collection_id: null })
      .expect(400);
  });
  it('publishes typed OpenAPI schemas for the opt-in job and preflight contracts', () => {
    const spec = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('M11.3 test').build(),
    );
    expect(spec.paths['/v1/quizzes/jobs'].post?.responses['202']).toBeDefined();
    expect(spec.components?.schemas?.QuizJobResponse).toMatchObject({
      properties: {
        phase: { type: 'string' },
        validated_count: { type: 'number' },
      },
    });
    expect(
      spec.components?.schemas?.QuizSkillEligibilityResponse,
    ).toHaveProperty(
      'properties.source_policy.enum',
      expect.arrayContaining(['ai_distractors']),
    );
    expect(spec.components?.schemas?.QuizEligibilityResponse).toMatchObject({
      properties: { suggested_count: { type: 'number', nullable: true } },
    });
  });
  it('queues, replays and publishes against actual JSON CAS and source-lock SQL', async () => {
    const eligible = await request(server)
      .post('/v1/quizzes/eligibility')
      .set(auth())
      .send(payload())
      .expect(200);
    expect((eligible.body as { feasible: boolean }).feasible).toBe(true);
    const input = {
      ...payload(),
      idempotency_key: '00000000-0000-4000-8000-000000000011',
    };
    const first = await request(server)
      .post('/v1/quizzes/jobs')
      .set(auth())
      .send(input)
      .expect(202);
    const job = first.body as QuizJobResponse;
    const replay = await request(server)
      .post('/v1/quizzes/jobs')
      .set(auth())
      .send(input)
      .expect(202);
    expect((replay.body as QuizJobResponse).quiz_id).toBe(job.quiz_id);
    for (let attempt = 0; attempt < 20; attempt++) {
      await jobs.tick();
      const state = await db.quiz.findUniqueOrThrow({
        where: { id: job.quiz_id },
      });
      if (state.status !== 'generating') break;
    }
    const done = await request(server)
      .get(`/v1/quizzes/jobs/${job.quiz_id}`)
      .set(auth())
      .expect(200);
    expect(done.body).toMatchObject({ state: 'ready', validated_count: 2 });
    const initial = await request(server)
      .post(`/v1/quizzes/${job.quiz_id}/start`)
      .set(auth())
      .send({})
      .expect(201);
    const repeated = await request(server)
      .post(`/v1/quizzes/${job.quiz_id}/start`)
      .set(auth())
      .send({})
      .expect(201);
    const session = initial.body as {
      session: { id: string };
      items: { ordinal: number }[];
    };
    expect((repeated.body as { session: { id: string } }).session.id).toBe(
      session.session.id,
    );
    const questions = await db.quizQuestion.findMany({
      where: { quizId: job.quiz_id },
      orderBy: { ordinal: 'asc' },
    });
    const correct = questions[0].correctAnswer as { index: number };
    const answer = await request(server)
      .post(`/v1/sessions/${session.session.id}/answers`)
      .set(auth())
      .send({ ordinal: 1, option_index: correct.index })
      .expect(200);
    expect(
      (
        answer.body as {
          item: { is_correct: boolean | null; correct_answer?: unknown };
        }
      ).item,
    ).toMatchObject({ is_correct: null });
    expect((answer.body as { item: object }).item).not.toHaveProperty(
      'correct_answer',
    );
    expect((answer.body as { xp: { amount: number } }).xp.amount).toBe(0);
    const detail = await request(server)
      .get(`/v1/quizzes/${job.quiz_id}`)
      .set(auth())
      .expect(200);
    expect(detail.body).toHaveProperty('quiz.content_version', 'm11.3-v3');
    expect(
      (
        detail.body as {
          sessions: { correct_count: number; score: number | null }[];
        }
      ).sessions[0],
    ).toMatchObject({ correct_count: 0, score: null });
  });

  it('two worker instances publish one result and stale leases are recovered', async () => {
    const job = await createJob('00000000-0000-4000-8000-000000000012');
    const row = await db.quiz.findUniqueOrThrow({ where: { id: job.quiz_id } });
    const metadata = row.generator as unknown as QuizJobMetadata;
    metadata.job.state = 'running';
    metadata.job.lease = 'old-worker';
    metadata.job.leaseUntil = Date.now() - 1000;
    metadata.job.calls.push({ id: 'interrupted-call', state: 'pending' });
    await db.quiz.update({
      where: { id: row.id },
      data: {
        generator: JSON.parse(
          JSON.stringify(metadata),
        ) as Prisma.InputJsonValue,
      },
    });
    const peer = new QuizJobsService(
      db,
      app.get(ConfigService),
      app.get(SrsService),
      app.get(PrivacyService),
      app.get(AiUsageService),
      app.get(QuizSourceRepository),
      engine,
    );
    for (let i = 0; i < 20; i++) {
      await Promise.all([jobs.tick(), peer.tick()]);
      if (
        (await db.quiz.findUniqueOrThrow({ where: { id: row.id } })).status !==
        'generating'
      )
        break;
    }
    const status = await request(server)
      .get(`/v1/quizzes/jobs/${row.id}`)
      .set(auth())
      .expect(200);
    expect(status.body).toMatchObject({
      state: 'ready',
      usage_uncertain: true,
      validated_count: 2,
    });
    expect(await db.quizQuestion.count({ where: { quizId: row.id } })).toBe(2);
  });

  async function interruptGeneration(
    key: string,
    change: (id: string, metadata: QuizJobMetadata) => Promise<void>,
  ) {
    const job = await createJob(key);
    const row = await db.quiz.findUniqueOrThrow({ where: { id: job.quiz_id } });
    const metadata = row.generator as unknown as QuizJobMetadata;
    const own = new Set(metadata.source.map((s) => s.itemId));
    let release!: () => void, reached!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const original = engine.generate.bind(engine);
    const cacheSpy = jest.spyOn(engine, 'reuse').mockReturnValue([]);
    const spy = jest
      .spyOn(engine, 'generate')
      .mockImplementation(async (...args) => {
        if (
          args[0].some((slot) => slot.targets.some((t) => own.has(t.itemId)))
        ) {
          reached();
          await gate;
        }
        return original(...args);
      });
    let observed = false;
    void started.then(() => {
      observed = true;
    });
    const background = (async () => {
      for (let i = 0; i < 20 && !observed; i++) await jobs.tick();
    })();
    try {
      await Promise.race([
        started,
        background.then(() => {
          if (!observed) throw new Error('Own job was not selected');
        }),
      ]);
      await change(row.id, metadata);
    } finally {
      release();
      await background;
      spy.mockRestore();
      cacheSpy.mockRestore();
    }
    return row.id;
  }
  it('cancel during generation cannot be overwritten by the worker publish', async () => {
    const id = await interruptGeneration(
      '00000000-0000-4000-8000-000000000013',
      async (id) => {
        await request(server)
          .post(`/v1/quizzes/jobs/${id}/actions`)
          .set(auth())
          .send({ action: 'cancel' })
          .expect(200);
      },
    );
    const status = await request(server)
      .get(`/v1/quizzes/jobs/${id}`)
      .set(auth())
      .expect(200);
    expect(status.body).toMatchObject({ state: 'cancelled' });
    expect(await db.quizQuestion.count({ where: { quizId: id } })).toBe(0);
  });
  it('source edits while generating invalidate partial content before publication', async () => {
    const id = await interruptGeneration(
      '00000000-0000-4000-8000-000000000014',
      async (_id, metadata) => {
        await db.collectionItem.update({
          where: { id: metadata.source[0].itemId },
          data: { meaningVi: 'nghĩa đã sửa trong lúc tạo' },
        });
      },
    );
    const status = await request(server)
      .get(`/v1/quizzes/jobs/${id}`)
      .set(auth())
      .expect(200);
    expect(status.body).toMatchObject({
      state: 'needs_action',
      reason: 'QUIZ_SOURCE_CHANGED',
      allowed_actions: ['cancel'],
    });
    expect(await db.quizQuestion.count({ where: { quizId: id } })).toBe(0);
    await request(server)
      .post(`/v1/quizzes/jobs/${id}/actions`)
      .set(auth())
      .send({ action: 'cancel' })
      .expect(200);
  });
  it('matching keeps all four target references and grades partial credit after completion', async () => {
    const created = await request(server)
      .post('/v1/quizzes/jobs')
      .set(auth())
      .send({
        ...payload(),
        skills: ['matching'],
        question_count: 1,
        idempotency_key: '00000000-0000-4000-8000-000000000015',
      })
      .expect(202);
    const job = created.body as QuizJobResponse;
    for (let i = 0; i < 20; i++) {
      await jobs.tick();
      if (
        (await db.quiz.findUniqueOrThrow({ where: { id: job.quiz_id } }))
          .status !== 'generating'
      )
        break;
    }
    const row = await db.quiz.findUniqueOrThrow({ where: { id: job.quiz_id } });
    expect(
      (row.generator as unknown as QuizJobMetadata).content[0].targets,
    ).toHaveLength(4);
    const questions = await db.quizQuestion.findMany({
      where: { quizId: job.quiz_id },
    });
    const pairs = (
      questions[0].correctAnswer as {
        mapping: { left_index: number; right_index: number }[];
      }
    ).mapping.map((p) => ({ ...p }));
    [pairs[2].right_index, pairs[3].right_index] = [
      pairs[3].right_index,
      pairs[2].right_index,
    ];
    const attempt = await request(server)
      .post(`/v1/quizzes/${job.quiz_id}/start`)
      .set(auth())
      .send({})
      .expect(201);
    const id = (attempt.body as { session: { id: string } }).session.id;
    const answer = await request(server)
      .post(`/v1/sessions/${id}/answers`)
      .set(auth())
      .send({ ordinal: 1, pairs })
      .expect(200);
    expect(answer.body).toMatchObject({
      item: { is_correct: false, credit: { earned: 2, possible: 4 } },
      session: { status: 'completed', correct_count: 0, score: 50 },
      xp: { amount: 0 },
    });
    const summary = await request(server)
      .get(`/v1/sessions/${id}`)
      .set(auth())
      .expect(200);
    expect(summary.body).toMatchObject({
      session: { unique_target_count: 4 },
      skill_summary: [
        { skill: 'matching', question_count: 1, correct_count: 0, score: 50 },
      ],
    });
  });
  it('report is idempotent, costs no AI quota and blocks the same content in copied caches', async () => {
    const rows = await db.quiz.findMany({
      where: {
        collectionId: collection,
        status: 'ready',
        quizType: 'matching',
      },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    const row = rows[0];
    const copied = structuredClone(row.generator) as unknown as QuizJobMetadata;
    copied.job.key = '00000000-0000-4000-8000-000000000017';
    // A second ready snapshot represents content previously reused by a job.
    const duplicate = await db.quiz.create({
      data: {
        id: uuidv7(),
        userId: row.userId,
        profileId: row.profileId,
        collectionId: row.collectionId,
        quizType: row.quizType,
        difficulty: row.difficulty,
        questionCount: row.questionCount,
        generator: JSON.parse(JSON.stringify(copied)) as Prisma.InputJsonValue,
        status: 'ready',
        expiresAt: row.expiresAt,
      },
    });
    const q = await db.quizQuestion.findFirstOrThrow({
      where: { quizId: row.id },
    });
    await db.quizQuestion.create({
      data: {
        quizId: duplicate.id,
        ordinal: q.ordinal,
        questionType: q.questionType,
        prompt: q.prompt,
        options: q.options as Prisma.InputJsonValue,
        correctAnswer: q.correctAnswer as Prisma.InputJsonValue,
        explanation: q.explanation,
        languageId: q.languageId,
        conceptId: q.conceptId,
        itemId: q.itemId,
      },
    });
    const quota = await db.aiUsage.findFirst({
      where: { userId: row.userId, feature: 'quiz' },
    });
    const body = {
      reason: 'ambiguous',
      note: 'Fixture report',
      idempotency_key: '00000000-0000-4000-8000-000000000018',
    };
    const first = await request(server)
      .post(`/v1/quizzes/${row.id}/questions/1/report`)
      .set(auth())
      .send(body)
      .expect(202);
    const second = await request(server)
      .post(`/v1/quizzes/${row.id}/questions/1/report`)
      .set(auth())
      .send(body)
      .expect(202);
    expect(second.body).toEqual(first.body);
    expect(first.body).toMatchObject({
      status: 'pending',
      cache_excluded: true,
    });
    await request(server)
      .post(`/v1/quizzes/${row.id}/questions/1/report`)
      .set(auth())
      .send({ ...body, reason: 'other' })
      .expect(409);
    const cache = await recentQuizContent(
      db,
      row.userId,
      row.profileId,
      language,
    );
    expect(
      cache
        .flatMap((c) => c.questions)
        .some((c) => c.cacheKey === copied.content[0].cacheKey),
    ).toBe(false);
    expect(
      await db.aiUsage.findFirst({
        where: { userId: row.userId, feature: 'quiz' },
      }),
    ).toEqual(quota);
    const detail = await request(server)
      .get(`/v1/quizzes/${row.id}`)
      .set(auth())
      .expect(200);
    expect(
      (detail.body as { questions: { quality_flags: string[] }[] }).questions[0]
        .quality_flags,
    ).toContain('reported_pending');
  });
  async function withPublishedPrefix(
    key: string,
    inspect: (
      id: string,
      sessionId: string,
      meta: QuizJobMetadata,
    ) => Promise<void>,
    singleMode = false,
  ) {
    const created = await request(server)
      .post('/v1/quizzes/jobs')
      .set(auth())
      .send({ ...payload(), question_count: 4, idempotency_key: key });
    if (created.status !== 202) throw new Error(JSON.stringify(created.body));
    const id = (created.body as QuizJobResponse).quiz_id;
    const seedEngine = new QuizBatchEngine({});
    const original = seedEngine.generate.bind(seedEngine);
    let reached!: () => void, release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reuse = jest.spyOn(engine, 'reuse').mockReturnValue([]);
    let batchCall = 0;
    const generate = jest
      .spyOn(engine, 'generate')
      .mockImplementation(async (...args) => {
        batchCall++;
        if (batchCall === 2) {
          reached();
          await gate;
        }
        const questions = await original(...args);
        // Out-of-order publication deliberately differs from the internal slot order.
        return batchCall === 1 ? questions.slice(0, 2).reverse() : questions;
      });
    const mode = singleMode
      ? jest.spyOn(engine, 'singleQuestionMode').mockReturnValue(true)
      : undefined;
    const progressive = singleMode
      ? jest
          .spyOn(engine, 'generateProgressively')
          .mockImplementation(
            async (slots, items, before, usage, remaining, accept) => {
              const questions = await original(
                slots,
                items,
                before,
                usage,
                remaining,
              );
              for (const q of questions.slice(0, 2).reverse()) await accept(q);
              reached();
              await gate;
              for (const q of questions.slice(2)) await accept(q);
            },
          )
      : undefined;
    const working = jobs.tick();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        blocked,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Prefix worker was not reached')),
            5000,
          );
        }),
      ]);
      const row = await db.quiz.findUniqueOrThrow({ where: { id } });
      const meta = row.generator as unknown as QuizJobMetadata;
      expect(row.status).toBe('generating');
      expect(meta.publication).toEqual([
        { ordinal: 1, slotOrdinal: 2 },
        { ordinal: 2, slotOrdinal: 1 },
      ]);
      const started = await request(server)
        .post(`/v1/quizzes/${id}/start`)
        .set(auth())
        .send({})
        .expect(201);
      const sessionId = (started.body as { session: { id: string } }).session
        .id;
      expect(started.body).toMatchObject({
        session: { item_count: 4, settings: { generation_pending: true } },
      });
      expect((started.body as { items: unknown[] }).items).toHaveLength(2);
      await inspect(id, sessionId, meta);
      return { id, sessionId };
    } finally {
      if (timer) clearTimeout(timer);
      release();
      await working;
      generate.mockRestore();
      progressive?.mockRestore();
      mode?.mockRestore();
      reuse.mockRestore();
    }
  }
  async function answerPublished(id: string, sessionId: string) {
    const questions = await db.quizQuestion.findMany({
      where: { quizId: id },
      orderBy: { ordinal: 'asc' },
    });
    for (const q of questions) {
      const response = await request(server)
        .post(`/v1/sessions/${sessionId}/answers`)
        .set(auth())
        .send({
          ordinal: q.ordinal,
          option_index: (q.correctAnswer as { index: number }).index,
        })
        .expect(200);
      expect(response.body).toMatchObject({
        session: { status: 'in_progress' },
        item: { is_correct: null },
        xp: { amount: 0 },
      });
      expect((response.body as { item: object }).item).not.toHaveProperty(
        'correct_answer',
      );
    }
  }
  it('plays an immutable prefix, returns pending next, appends snapshots, and finalizes the requested total', async () => {
    const { id, sessionId } = await withPublishedPrefix(
      '00000000-0000-4000-8000-000000000021',
      async (id, sessionId) => {
        const status = await request(server)
          .get(`/v1/quizzes/jobs/${id}`)
          .set(auth())
          .expect(200);
        expect(status.body).toMatchObject({
          state: 'running',
          published_count: 2,
          can_start: true,
        });
        await answerPublished(id, sessionId);
        const pending = await request(server)
          .post(`/v1/sessions/${sessionId}/answers`)
          .set(auth())
          .send({ ordinal: 3, option_index: 0 })
          .expect(409);
        expect(pending.body).toHaveProperty('code', 'QUIZ_QUESTION_PENDING');
        const finish = await request(server)
          .post(`/v1/sessions/${sessionId}/finish`)
          .set(auth())
          .send({})
          .expect(409);
        expect(finish.body).toHaveProperty('code', 'QUIZ_GENERATION_PENDING');
        const first = await db.studySessionItem.findFirstOrThrow({
          where: { sessionId, ordinal: 1 },
        });
        expect(first.answeredAt).not.toBeNull();
      },
    );
    const complete = await request(server)
      .get(`/v1/sessions/${sessionId}`)
      .set(auth())
      .expect(200);
    expect(complete.body).toMatchObject({
      session: {
        status: 'in_progress',
        item_count: 4,
        settings: { generation_pending: false, target_count: 4 },
      },
    });
    expect((complete.body as { items: unknown[] }).items).toHaveLength(4);
    const questions = await db.quizQuestion.findMany({
      where: { quizId: id, ordinal: { gt: 2 } },
      orderBy: { ordinal: 'asc' },
    });
    for (const q of questions)
      await request(server)
        .post(`/v1/sessions/${sessionId}/answers`)
        .set(auth())
        .send({
          ordinal: q.ordinal,
          option_index: (q.correctAnswer as { index: number }).index,
        })
        .expect(200);
    const done = await request(server)
      .get(`/v1/sessions/${sessionId}`)
      .set(auth())
      .expect(200);
    expect(done.body).toMatchObject({
      session: {
        status: 'completed',
        score: 100,
        settings: { generation_pending: false },
      },
    });
  });
  it('single-mode worker publishes an immutable prefix and appends into a live HTTP session', async () => {
    const { id, sessionId } = await withPublishedPrefix(
      uuidv7(),
      async (id, sessionId) => {
        await answerPublished(id, sessionId);
        const state = await request(server)
          .get(`/v1/quizzes/jobs/${id}`)
          .set(auth())
          .expect(200);
        expect(state.body).toMatchObject({
          state: 'running',
          published_count: 2,
          can_start: true,
        });
        const missing = await request(server)
          .post(`/v1/sessions/${sessionId}/answers`)
          .set(auth())
          .send({ ordinal: 3, option_index: 0 })
          .expect(409);
        expect(missing.body).toHaveProperty('code', 'QUIZ_QUESTION_PENDING');
      },
      true,
    );
    const detail = await request(server)
      .get(`/v1/sessions/${sessionId}`)
      .set(auth())
      .expect(200);
    expect(detail.body).toMatchObject({
      session: { item_count: 4, settings: { generation_pending: false } },
    });
    expect((detail.body as { items: unknown[] }).items).toHaveLength(4);
    expect(await db.quizQuestion.count({ where: { quizId: id } })).toBe(4);
    await request(server)
      .post(`/v1/sessions/${sessionId}/finish`)
      .set(auth())
      .send({})
      .expect(200);
  });

  it('single-mode worker cannot append late results after cancellation', async () => {
    const { id, sessionId } = await withPublishedPrefix(
      uuidv7(),
      async (id) => {
        await request(server)
          .post(`/v1/quizzes/jobs/${id}/actions`)
          .set(auth())
          .send({ action: 'cancel' })
          .expect(200);
      },
      true,
    );
    expect(await db.quizQuestion.count({ where: { quizId: id } })).toBe(2);
    expect(await db.studySessionItem.count({ where: { sessionId } })).toBe(2);
    expect(
      (await db.studySession.findUniqueOrThrow({ where: { id: sessionId } }))
        .status,
    ).toBe('abandoned');
  });

  it('accepts the published prefix while running and finalizes answered rows without awarding XP', async () => {
    const { id, sessionId } = await withPublishedPrefix(
      '00000000-0000-4000-8000-000000000022',
      async (id, sessionId) => {
        await answerPublished(id, sessionId);
        const before = await db.studySessionItem.findMany({
          where: { sessionId },
          orderBy: { ordinal: 'asc' },
        });
        const accepted = await request(server)
          .post(`/v1/quizzes/jobs/${id}/actions`)
          .set(auth())
          .send({ action: 'accept_shorter' })
          .expect(200);
        expect(accepted.body).toMatchObject({
          state: 'ready',
          published_count: 2,
        });
        const session = await db.studySession.findUniqueOrThrow({
          where: { id: sessionId },
        });
        expect(session).toMatchObject({
          status: 'completed',
          itemCount: 2,
          score: 100,
          xpAwarded: 0,
        });
        expect(session.settings).toMatchObject({
          generation_pending: false,
          target_count: 2,
          skill_summary: [{ skill: 'meaning', score: 100 }],
        });
        expect(
          await db.studySessionItem.findMany({
            where: { sessionId },
            orderBy: { ordinal: 'asc' },
          }),
        ).toEqual(before);
      },
    );
    expect(await db.quizQuestion.count({ where: { quizId: id } })).toBe(2);
    expect(await db.studySessionItem.count({ where: { sessionId } })).toBe(2);
  });
  it('cancel abandons the active prefix and a late worker cannot append or resurrect it', async () => {
    const { id, sessionId } = await withPublishedPrefix(
      '00000000-0000-4000-8000-000000000023',
      async (id, sessionId) => {
        await answerPublished(id, sessionId);
        await request(server)
          .post(`/v1/quizzes/jobs/${id}/actions`)
          .set(auth())
          .send({ action: 'cancel' })
          .expect(200);
      },
    );
    expect(await db.quizQuestion.count({ where: { quizId: id } })).toBe(2);
    const session = await db.studySession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(session.status).toBe('abandoned');
    expect(
      await db.studySessionItem.count({
        where: { sessionId, answeredAt: { not: null } },
      }),
    ).toBe(2);
    await request(server)
      .post(`/v1/quizzes/${id}/start`)
      .set(auth())
      .send({})
      .expect(409);
  });
  it('source edits after a playable prefix halt new publication and allow an explicit verified finish', async () => {
    const { id, sessionId } = await withPublishedPrefix(
      '00000000-0000-4000-8000-000000000024',
      async (_id, _sessionId, meta) => {
        await db.collectionItem.update({
          where: { id: meta.source[0].itemId },
          data: { meaningVi: 'nghĩa mới sau phần đã phát hành' },
        });
      },
    );
    const status = await request(server)
      .get(`/v1/quizzes/jobs/${id}`)
      .set(auth())
      .expect(200);
    expect(status.body).toMatchObject({
      state: 'needs_action',
      reason: 'QUIZ_SOURCE_CHANGED',
      published_count: 2,
      can_start: true,
    });
    expect((status.body as QuizJobResponse).allowed_actions).toEqual([
      'accept_shorter',
      'cancel',
    ]);
    await request(server)
      .post(`/v1/quizzes/jobs/${id}/actions`)
      .set(auth())
      .send({ action: 'accept_shorter' })
      .expect(200);
    expect(await db.quizQuestion.count({ where: { quizId: id } })).toBe(2);
    expect(
      await db.studySession.findUniqueOrThrow({ where: { id: sessionId } }),
    ).toMatchObject({ itemCount: 2, settings: { generation_pending: false } });
  });
  it('allows verified shorter completion after recovery exhaustion with a pending attempt', async () => {
    const { id, sessionId } = await withPublishedPrefix(
      '00000000-0000-4000-8000-000000000027',
      async (id, sessionId) => {
        await answerPublished(id, sessionId);
        const row = await db.quiz.findUniqueOrThrow({ where: { id } });
        const m = row.generator as unknown as QuizJobMetadata;
        m.job.round = 3;
        m.job.leaseUntil = Date.now() - 1;
        await db.quiz.update({
          where: { id },
          data: {
            generator: JSON.parse(JSON.stringify(m)) as Prisma.InputJsonValue,
          },
        });
        const peer = new QuizJobsService(
          db,
          app.get(ConfigService),
          app.get(SrsService),
          app.get(PrivacyService),
          app.get(AiUsageService),
          app.get(QuizSourceRepository),
          engine,
        );
        await peer.tick();
        const status = await request(server)
          .get(`/v1/quizzes/jobs/${id}`)
          .set(auth())
          .expect(200);
        expect(status.body).toMatchObject({
          state: 'needs_action',
          reason: 'QUIZ_RECOVERY_EXHAUSTED',
          published_count: 2,
        });
        expect((status.body as QuizJobResponse).allowed_actions).toEqual([
          'accept_shorter',
          'cancel',
        ]);
        const stopped = await db.quiz.findUniqueOrThrow({ where: { id } });
        expect(
          (stopped.generator as unknown as QuizJobMetadata).job.lease,
        ).toBeNull();
        await request(server)
          .post(`/v1/quizzes/jobs/${id}/actions`)
          .set(auth())
          .send({ action: 'retry' })
          .expect(409);
        await request(server)
          .post(`/v1/quizzes/jobs/${id}/actions`)
          .set(auth())
          .send({ action: 'accept_shorter' })
          .expect(200);
      },
    );
    expect(await db.quizQuestion.count({ where: { quizId: id } })).toBe(2);
    expect(
      await db.studySession.findUniqueOrThrow({ where: { id: sessionId } }),
    ).toMatchObject({
      status: 'completed',
      itemCount: 2,
      score: 100,
      settings: { generation_pending: false },
    });
  });
  it('keeps an expired playable prefix available for explicit finish', async () => {
    const { id, sessionId } = await withPublishedPrefix(
      '00000000-0000-4000-8000-000000000026',
      async (id) => {
        await db.quiz.update({
          where: { id },
          data: { expiresAt: new Date(Date.now() - 1000) },
        });
        const status = await request(server)
          .get(`/v1/quizzes/jobs/${id}`)
          .set(auth())
          .expect(200);
        expect(status.body).toMatchObject({
          state: 'needs_action',
          reason: 'QUIZ_EXPIRED',
          published_count: 2,
          can_start: false,
        });
        expect((status.body as QuizJobResponse).allowed_actions).toEqual([
          'accept_shorter',
          'cancel',
        ]);
        await request(server)
          .post(`/v1/quizzes/jobs/${id}/actions`)
          .set(auth())
          .send({ action: 'accept_shorter' })
          .expect(200);
      },
    );
    expect(await db.quizQuestion.count({ where: { quizId: id } })).toBe(2);
    expect(
      await db.studySession.findUniqueOrThrow({ where: { id: sessionId } }),
    ).toMatchObject({ itemCount: 2, settings: { generation_pending: false } });
  });
  it('reports public ordinals against the correct internal slot before generation finishes', async () => {
    await withPublishedPrefix(
      '00000000-0000-4000-8000-000000000025',
      async (id, _sessionId, meta) => {
        const question = meta.content.find((q) => q.ordinal === 2)!;
        const report = await request(server)
          .post(`/v1/quizzes/${id}/questions/1/report`)
          .set(auth())
          .send({
            reason: 'wrong_meaning',
            idempotency_key: '00000000-0000-4000-8000-000000000125',
          })
          .expect(202);
        expect(report.body).toMatchObject({
          status: 'pending',
          cache_excluded: true,
        });
        const row = await db.quiz.findUniqueOrThrow({ where: { id } });
        const metadata = row.generator as unknown as QuizJobMetadata;
        expect(metadata.reports![0]).toMatchObject({
          ordinal: 1,
          cacheKey: question.cacheKey,
        });
      },
    );
  });
});
