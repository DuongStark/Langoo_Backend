import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';
import { AI_QUIZ_PROVIDER } from '../src/ai/providers/ai-quiz.provider';
import { ContextQuizProvider } from '../src/ai/providers/context-quiz.provider';
import { AiChatRequest } from '../src/ai/providers/ai-chat.provider';
import {
  QuizDetailResponse,
  CreateQuizResponse,
} from '../src/ai/quiz/types/quiz.types';
import { SessionDetailResponse } from '../src/sessions/types/sessions.types';
import { metadataSchema } from '../src/ai/quiz/quiz-contract';

process.env.AI_QUIZ_COOLDOWN_MS = '0';

describe('Kanji quiz integration (local *_test, mock models)', () => {
  let app: INestApplication, server: Server, prisma: PrismaService;
  const emails: string[] = [];
  const added: { form_id: bigint; target_form_id: bigint }[] = [];
  const chat = jest.fn((req: AiChatRequest) => {
    const data = JSON.parse(req.messages[1].content) as {
      target: { written: string; reading: string };
      style?: string;
      options?: { index: number; text: string }[];
    };
    const sentence = (
      {
        学校: '毎日、学校へ行きます。',
        本: 'これは本です。',
        学生: '私は学生です。',
        水: '水を飲みます。',
      } as Record<string, string>
    )[data.target.written];
    const content =
      req.model === 'generator'
        ? {
            sentence,
            target: {
              text: data.target.written,
              start: Array.from(
                sentence.slice(0, sentence.indexOf(data.target.written)),
              ).length,
              end:
                Array.from(
                  sentence.slice(0, sentence.indexOf(data.target.written)),
                ).length + Array.from(data.target.written).length,
            },
          }
        : {
            natural: true,
            correctSense: true,
            correctTarget: true,
            noAnswerLeak: true,
            correctOptionIndices: [
              data.options!.find(
                (o) =>
                  o.text ===
                  (data.style === 'kanji_reading'
                    ? data.target.reading
                    : data.target.written),
              )!.index,
            ],
          };
    return Promise.resolve({
      content: JSON.stringify(content),
      model: req.model,
      tokensIn: 8,
      tokensOut: 4,
      costUsd: 0,
    });
  });
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_QUIZ_PROVIDER)
      .useValue(
        new ContextQuizProvider({
          transport: { name: 'mock', chat },
          generatorModel: 'generator',
          validatorModel: 'validator',
          timeoutMs: 3000,
        }),
      )
      .compile();
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
    prisma = app.get(PrismaService);
    // Minimal dump omits reading links. Test setup fills only these fixture
    // links; API repositories remain read-only and cleanup removes added rows.
    added.push(
      ...(await prisma.$queryRaw<{ form_id: bigint; target_form_id: bigint }[]>`
      INSERT INTO core.lexeme_form_applies_to(form_id,target_form_id)
      VALUES (9,8),(13,12),(15,14),(17,16) ON CONFLICT DO NOTHING RETURNING form_id,target_form_id`),
    );
  });
  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
      for (const link of added)
        await prisma.$executeRaw`DELETE FROM core.lexeme_form_applies_to WHERE form_id=${link.form_id} AND target_form_id=${link.target_form_id}`;
    }
    await app?.close();
  });
  beforeEach(() => chat.mockClear());

  async function fixture(label: string) {
    const email = `kanji-${Date.now()}-${label}@langoo.test`;
    emails.push(email);
    const register = await request(server)
      .post('/v1/auth/register')
      .send({ email, password: 'kanji-fixture-password' })
      .expect(201);
    const token = (register.body as { access_token: string }).access_token;
    await request(server)
      .post('/v1/profiles')
      .set(auth(token))
      .send({ name: label, primary_language_id: 2, support_language_id: 3 })
      .expect(201);
    const collection = await request(server)
      .post('/v1/collections')
      .set(auth(token))
      .send({ name: label })
      .expect(201);
    const id = (collection.body as { id: string }).id;
    for (const [sense_id, meaning_vi] of [
      ['17', 'trường học'],
      ['13', 'sách'],
      ['15', 'học sinh'],
      ['9', 'nước'],
    ])
      await request(server)
        .post(`/v1/collections/${id}/items`)
        .set(auth(token))
        .send({ sense_id, meaning_vi })
        .expect(201);
    const user = await prisma.user.findFirstOrThrow({
      where: { email },
      select: { id: true },
    });
    return { token, id, userId: user.id };
  }

  const params = {
    question_types: ['multiple_choice'],
    question_count: 4,
  };

  it('xoay style Kanji, GET/start/snapshots và chấm điểm (mock models)', async () => {
    const f = await fixture('local');
    const create = await request(server)
      .post('/v1/quizzes')
      .set(auth(f.token))
      .send({ ...params, collection_id: f.id })
      .expect(201);
    const id = (create.body as CreateQuizResponse).id;
    const detail = (
      await request(server)
        .get(`/v1/quizzes/${id}`)
        .set(auth(f.token))
        .expect(200)
    ).body as QuizDetailResponse;
    // MC slot xoay meaning → kanji_reading → kanji_orthography → meaning.
    expect(detail.questions.map((q) => q.question_style)).toEqual([
      'meaning',
      'kanji_reading',
      'kanji_orthography',
      'meaning',
    ]);
    for (const q of detail.questions) expect(q.options).toHaveLength(4);
    expect(detail.questions[1].context?.origin).toBe('generated');
    expect(detail.questions[2].context?.origin).toBe('generated');
    // Chỉ 2 slot Kanji gọi model: mỗi câu 1 lượt sinh + 1 lượt kiểm.
    expect(chat).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(detail)).not.toMatch(
      /correctAnswer|correct_answer|kanjiTarget|evidence/,
    );
    const started = (
      await request(server)
        .post(`/v1/quizzes/${id}/start`)
        .set(auth(f.token))
        .expect(201)
    ).body as SessionDetailResponse;
    expect(JSON.stringify(started.items)).toContain('kanji_reading');
    expect(JSON.stringify(started.items)).toContain('generated');
    const stored = await prisma.quizQuestion.findMany({
      where: { quizId: id },
      orderBy: { ordinal: 'asc' },
    });
    const correct = stored[0].correctAnswer as { index: number };
    await request(server)
      .post(`/v1/sessions/${started.session.id}/answers`)
      .set(auth(f.token))
      .send({ ordinal: 1, option_index: correct.index })
      .expect(200);
    const quiz = await prisma.quiz.findUniqueOrThrow({ where: { id } });
    expect(metadataSchema.parse(quiz.generator).usage).toMatchObject({
      calls: 4,
      tokensIn: 32,
      tokensOut: 16,
      local: 2,
    });
  });

  it('generates context once, records usage, reuses it and survives source item deletion', async () => {
    const f = await fixture('context');
    const body = {
      ...params,
      collection_id: f.id,
      question_count: 3,
    };
    const create = async () =>
      (
        await request(server)
          .post('/v1/quizzes')
          .set(auth(f.token))
          .send(body)
          .expect(201)
      ).body as CreateQuizResponse;
    const first = await create();
    expect(chat).toHaveBeenCalledTimes(4); // 2 slot Kanji × (sinh + kiểm)
    chat.mockClear();
    const second = await create();
    // Slot Kanji thứ hai tái dùng evidence đã kiểm, không gọi model.
    expect(chat).not.toHaveBeenCalled();
    const detail = (
      await request(server)
        .get(`/v1/quizzes/${second.id}`)
        .set(auth(f.token))
        .expect(200)
    ).body as QuizDetailResponse;
    const ko = detail.questions.find(
      (q) => q.question_style === 'kanji_orthography',
    )!;
    expect(ko).toBeDefined();
    expect(ko.context?.origin).toBe('generated');
    for (const written of ['学校', '本', '学生', '水']) {
      expect(ko.prompt).not.toContain(written);
    }
    expect(JSON.stringify(detail)).not.toMatch(
      /sourceSentence|sourceHash|generatorModel|contextKey/,
    );
    const usage = await prisma.aiUsage.findFirstOrThrow({
      where: { userId: f.userId, feature: 'quiz' },
    });
    expect(usage.tokensIn).toBe(32n);
    expect(usage.tokensOut).toBe(16n);
    expect(usage.requestCount).toBe(2);
    await prisma.collectionItem.deleteMany({ where: { collectionId: f.id } });
    const started = (
      await request(server)
        .post(`/v1/quizzes/${second.id}/start`)
        .set(auth(f.token))
        .expect(201)
    ).body as SessionDetailResponse;
    expect(JSON.stringify(started.items)).toContain('generated');
    expect(
      (
        await prisma.quizQuestion.findFirstOrThrow({
          where: { quizId: first.id },
        })
      ).itemId,
    ).toBeNull();
  });

  it('validates config and insufficient scoped pool before quota, without AI calls', async () => {
    const f = await fixture('invalid');
    for (const changes of [
      { question_types: null },
      { question_types: [] },
      { question_types: ['multiple_choice', 'multiple_choice'] },
      { question_types: ['khong-co'] },
      { quiz_type: 'multiple_choice' }, // field cũ → 400
      { question_styles: ['meaning'] },
      { context_mode: 'source' },
      { difficulty: 'easy' },
    ])
      await request(server)
        .post('/v1/quizzes')
        .set(auth(f.token))
        .send({ ...params, collection_id: f.id, ...changes })
        .expect(400);
    await prisma.collectionItem.deleteMany({
      where: { collectionId: f.id, anchorSenseId: { not: 17n } },
    });
    await request(server)
      .post('/v1/quizzes')
      .set(auth(f.token))
      .send({ ...params, collection_id: f.id })
      .expect(409);
    expect(
      await prisma.aiUsage.count({
        where: { userId: f.userId, feature: 'quiz' },
      }),
    ).toBe(0);
    expect(chat).not.toHaveBeenCalled();
  });
});
