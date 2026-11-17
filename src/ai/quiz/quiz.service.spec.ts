import { Prisma } from '../../generated/prisma/client';
import { DomainException } from '../../common/errors/domain.exception';
import { PrivacyService } from '../../privacy/privacy.service';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../db/prisma.service';
import { SrsService } from '../../srs/srs.service';
import { SessionsService } from '../../sessions/sessions.service';
import { AiQuizProvider } from '../providers/ai-quiz.provider';
import { AiUsageService } from '../usage/ai-usage.service';
import { QuizService } from './quiz.service';
import { QuizSourceRepository } from './repositories/quiz-source.repository';
import { QuizQuestionType } from '../../sessions/quiz-content';
import { CONTEXT_POLICY, QUIZ_VERSION } from './quiz-contract';

const QUIZ_ID = '01900000-0000-7000-8000-000000000001';

describe('M11.3 attempts', () => {
  it('does not leak in-progress v3 correctness through quiz list or detail summaries', async () => {
    const { service, prisma } = createSetup();
    const quiz = quizRow({ generator: { version: 'm11.3-v3', questions: [] } });
    const session = {
      id: 'attempt',
      quizId: QUIZ_ID,
      status: 'in_progress',
      itemCount: 20,
      correctCount: 7,
      score: 100,
      settings: { quiz_version: 'm11.3-v3' },
      startedAt: new Date(),
      finishedAt: null,
    };
    prisma.quiz.findMany.mockResolvedValue([quiz]);
    prisma.quiz.findFirst.mockResolvedValue(quiz);
    prisma.quizQuestion.findMany.mockResolvedValue([]);
    prisma.studySession.findMany.mockResolvedValue([session]);
    expect((await service.list(1n, {})).data[0].latest_session).toMatchObject({
      correct_count: 0,
      score: null,
    });
    expect((await service.get(1n, QUIZ_ID)).sessions[0]).toMatchObject({
      correct_count: 0,
      score: null,
    });
  });
  it('resumes an active v3 attempt instead of creating a duplicate on repeated start', async () => {
    const { service, prisma, tx, sessions } = createSetup();
    prisma.quiz.findFirst.mockResolvedValue(
      quizRow({ generator: { version: 'm11.3-v3', questions: [] } }),
    );
    prisma.quizQuestion.findMany.mockResolvedValue([
      { id: 1n, ordinal: 1, questionType: 'multiple_choice' },
    ]);
    tx.studySession.findFirst.mockResolvedValue({ id: 'already-running' });
    await service.start(1n, QUIZ_ID);
    expect(sessions.get).toHaveBeenCalledWith(1n, 'already-running');
    expect(tx.studySession.create).not.toHaveBeenCalled();
  });
  it('replays an explicit new-attempt key before allocating another attempt', async () => {
    const { service, prisma, tx, sessions } = createSetup();
    prisma.quiz.findFirst.mockResolvedValue(
      quizRow({ generator: { version: 'm11.3-v3', questions: [] } }),
    );
    prisma.quizQuestion.findMany.mockResolvedValue([
      { id: 1n, ordinal: 1, questionType: 'multiple_choice' },
    ]);
    tx.studySession.findFirst.mockResolvedValue({ id: 'already-completed' });
    await service.start(
      1n,
      QUIZ_ID,
      'new_attempt',
      '00000000-0000-4000-8000-000000000001',
    );
    expect(sessions.get).toHaveBeenCalledWith(1n, 'already-completed');
    expect(tx.studySession.create).not.toHaveBeenCalled();
  });
});

function quizRow(overrides: Record<string, unknown> = {}) {
  return {
    id: QUIZ_ID,
    userId: 1n,
    profileId: 'profile-1',
    collectionId: null,
    quizType: 'multiple_choice',
    difficulty: 'medium',
    questionCount: 2,
    status: 'ready',
    generator: {
      provider: 'stub',
      version: QUIZ_VERSION,
      questionTypes: ['multiple_choice'],
      questions: [],
    },
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 86_400_000),
    ...overrides,
  };
}

function sourceItems(count: number) {
  return Array.from({ length: count }, (_value, index) => ({
    itemId: `item-${index + 1}`,
    senseId: `${index + 1}`,
    conceptId: `${index + 1}`,
    languageId: 2,
    lemma: `語${index + 1}`,
    reading: `ご${index + 1}`,
    romanization: `go${index + 1}`,
    meaningVi: `nghĩa ${index + 1}`,
  }));
}

function generatedQuestions(
  count: number,
  questionType: 'multiple_choice' | 'fill_blank' = 'multiple_choice',
) {
  return Array.from({ length: count }, (_value, index) => ({
    questionType,
    prompt: `Câu ${index + 1}`,
    options:
      questionType === 'multiple_choice' ? [{ index: 0, text: 'a' }] : [],
    correctAnswer:
      questionType === 'multiple_choice'
        ? { index: 0, text: 'a' }
        : { accepted: ['a'] },
    explanation: null,
    languageId: 2,
    conceptId: null,
    itemId: null,
  }));
}

const EVIDENCE = {
  policy: CONTEXT_POLICY,
  contextKey: 'a'.repeat(64),
  answerKey: 'b'.repeat(64),
  sentence: '毎日、学校へ行きます。',
  origin: 'generated' as const,
  attribution: null,
  exampleId: null,
  sourceHash: null,
  generatorModel: 'generator',
  validatorModel: 'validator',
  accepted: true as const,
};

function createSetup(cooldownMs = '15000') {
  const tx = {
    quizQuestion: {
      createMany: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    quiz: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    collection: { findFirst: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([]),
    studySession: { create: jest.fn(), findFirst: jest.fn() },
    studySessionItem: { createMany: jest.fn() },
  };
  const prisma = {
    quiz: tx.quiz,
    quizQuestion: tx.quizQuestion,
    collection: tx.collection,
    userSettings: { findUnique: jest.fn() },
    studySession: { findMany: jest.fn() },
    $transaction: jest.fn((fn: (client: unknown) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'AI_QUIZ_COOLDOWN_MS') {
        return cooldownMs;
      }
      return undefined;
    }),
  } as unknown as ConfigService;
  const srs = {
    getProfileContextInTransaction: jest.fn().mockResolvedValue({
      id: 'profile-1',
      primaryLanguageId: 2,
      timezone: 'Asia/Ho_Chi_Minh',
    }),
  };
  const sessions = { get: jest.fn() };
  const sourceRepo = { findSourceItems: jest.fn() };
  const usage = { reserveDailyRequest: jest.fn() };
  const providerGenerate = jest.fn();
  const provider: AiQuizProvider = { name: 'stub', generate: providerGenerate };

  const service = new QuizService(
    prisma as unknown as PrismaService,
    config,
    srs as unknown as SrsService,
    sessions as unknown as SessionsService,
    sourceRepo as unknown as QuizSourceRepository,
    usage as unknown as AiUsageService,
    provider,
    {
      assertAiAllowed: jest.fn().mockResolvedValue(undefined),
    } as unknown as PrivacyService,
  );
  return {
    service,
    prisma,
    tx,
    srs,
    sessions,
    sourceRepo,
    usage,
    provider,
    providerGenerate,
  };
}

function firstArg<T>(mock: jest.Mock): T {
  const calls = mock.mock.calls as unknown[][];
  const call = calls[0];
  if (!call) {
    throw new Error('expected mock call');
  }
  return call[0] as T;
}

const dto = {
  question_types: ['multiple_choice'] as QuizQuestionType[],
  question_count: 2,
};

describe('QuizService', () => {
  it('returns controlled 503 for an expired prepare transaction without calling AI or cleanup', async () => {
    const setup = createSetup();
    const expired = new Prisma.PrismaClientKnownRequestError(
      'Transaction expired',
      {
        code: 'P2028',
        clientVersion: '7.10.0',
      },
    );
    setup.prisma.$transaction.mockRejectedValueOnce(expired);
    await expect(setup.service.create(1n, dto)).rejects.toMatchObject({
      code: 'AI_PROVIDER_UNAVAILABLE',
      status: 503,
    });
    expect(setup.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(setup.providerGenerate).not.toHaveBeenCalled();
    expect(setup.tx.quiz.updateMany).not.toHaveBeenCalled();
  });

  it('preserves business errors thrown during prepare', async () => {
    const setup = createSetup();
    const error = new DomainException(
      'PROFILE_NOT_FOUND',
      'Missing profile',
      404,
    );
    setup.prisma.$transaction.mockRejectedValueOnce(error);
    await expect(setup.service.create(1n, dto)).rejects.toBe(error);
    expect(setup.providerGenerate).not.toHaveBeenCalled();
  });

  it('canonicalizes question_types when deduping and rejects another type mix', async () => {
    const setup = createSetup();
    setup.prisma.quiz.findFirst.mockResolvedValue(
      quizRow({
        quizType: 'mixed',
        generator: {
          provider: 'stub',
          version: QUIZ_VERSION,
          questionTypes: ['multiple_choice', 'matching'],
          questions: [],
        },
      }),
    );
    const request = {
      question_types: ['matching', 'multiple_choice'] as (
        'multiple_choice' | 'matching'
      )[],
      question_count: 2,
    };
    await expect(setup.service.create(1n, request)).resolves.toMatchObject({
      reused: true,
    });
    await expect(
      setup.service.create(1n, {
        question_types: ['matching'],
        question_count: 2,
      }),
    ).rejects.toMatchObject({ code: 'QUIZ_GENERATION_COOLDOWN' });
    expect(setup.usage.reserveDailyRequest).not.toHaveBeenCalled();
  });

  it('chỉ multiple_choice mới enrich Kanji và gom context evidence', async () => {
    const fill = createSetup('0');
    fill.sourceRepo.findSourceItems.mockResolvedValue(sourceItems(2));
    fill.prisma.quiz.create.mockResolvedValue(
      quizRow({ status: 'generating' }),
    );
    fill.tx.quiz.update.mockResolvedValue(
      quizRow({ status: 'ready', questionCount: 2 }),
    );
    fill.usage.reserveDailyRequest.mockResolvedValue(1);
    fill.providerGenerate.mockResolvedValue(
      generatedQuestions(2, 'fill_blank'),
    );

    await fill.service.create(1n, {
      question_types: ['fill_blank'],
      question_count: 2,
    });
    expect(fill.sourceRepo.findSourceItems).toHaveBeenCalledWith(
      expect.objectContaining({ enrichKanji: false, withExamples: false }),
      expect.anything(),
    );
    // Chỉ truy vấn recent (select id), không gom context evidence.
    expect(fill.tx.quiz.findMany).toHaveBeenCalledTimes(1);
    expect(
      firstArg<{ select?: Record<string, unknown> }>(fill.tx.quiz.findMany)
        .select,
    ).toEqual({ id: true });

    const mc = createSetup('0');
    mc.sourceRepo.findSourceItems.mockResolvedValue(sourceItems(2));
    mc.prisma.quiz.create.mockResolvedValue(quizRow({ status: 'generating' }));
    mc.tx.quiz.update.mockResolvedValue(
      quizRow({ status: 'ready', questionCount: 2 }),
    );
    mc.usage.reserveDailyRequest.mockResolvedValue(1);
    // Hai lượt findMany: recent (select id) và evidence (select generator).
    mc.tx.quiz.findMany.mockImplementation(
      (args: { select?: Record<string, unknown> }) =>
        Promise.resolve(
          args?.select && 'generator' in args.select
            ? [
                {
                  generator: {
                    provider: 'stub',
                    version: QUIZ_VERSION,
                    questionTypes: ['multiple_choice'],
                    questions: [
                      {
                        ordinal: 1,
                        style: 'meaning',
                        context: null,
                        evidence: EVIDENCE,
                      },
                    ],
                  },
                },
              ]
            : [],
        ),
    );
    mc.providerGenerate.mockResolvedValue(generatedQuestions(2));

    await mc.service.create(1n, dto);
    expect(mc.sourceRepo.findSourceItems).toHaveBeenCalledWith(
      expect.objectContaining({ enrichKanji: true, withExamples: true }),
      expect.anything(),
    );
    expect(mc.tx.quiz.findMany).toHaveBeenCalledTimes(2);
    const providerInput = firstArg<{
      contextEvidence: unknown[];
      questionTypes: string[];
    }>(mc.providerGenerate);
    expect(providerInput.contextEvidence).toEqual([EVIDENCE]);
    expect(providerInput.questionTypes).toEqual(['multiple_choice']);
  });

  it('create: truyền từ của 2 quiz gần nhất vào recentItemIds', async () => {
    const setup = createSetup('0');
    setup.sourceRepo.findSourceItems.mockResolvedValue(sourceItems(3));
    setup.prisma.quiz.create.mockResolvedValue(
      quizRow({ status: 'generating' }),
    );
    setup.tx.quiz.update.mockResolvedValue(
      quizRow({ status: 'ready', questionCount: 2 }),
    );
    setup.usage.reserveDailyRequest.mockResolvedValue(1);
    setup.providerGenerate.mockResolvedValue(generatedQuestions(2));
    setup.tx.quiz.findMany.mockImplementation(
      (args: { select?: Record<string, unknown> }) =>
        Promise.resolve(
          args?.select && 'id' in args.select ? [{ id: 'old-quiz' }] : [],
        ),
    );
    setup.tx.quizQuestion.findMany.mockResolvedValue([
      { itemId: 'item-1' },
      { itemId: 'item-1' },
      { itemId: 'item-2' },
      { itemId: null },
    ]);

    await setup.service.create(1n, dto);

    const providerInput = firstArg<{ recentItemIds?: string[] }>(
      setup.providerGenerate,
    );
    expect(providerInput.recentItemIds).toEqual(['item-1', 'item-2']);
  });

  it('cooldown cùng tham số → trả quiz cũ reused=true, không tiêu quota', async () => {
    const { service, prisma, usage, providerGenerate } = createSetup();
    prisma.quiz.findFirst.mockResolvedValue(quizRow());

    const result = await service.create(1n, dto);

    expect(result.reused).toBe(true);
    expect(result.id).toBe(QUIZ_ID);
    expect(usage.reserveDailyRequest).not.toHaveBeenCalled();
    expect(providerGenerate).not.toHaveBeenCalled();
  });

  it('cooldown khác tham số → 429 QUIZ_GENERATION_COOLDOWN kèm retry_after', async () => {
    const { service, prisma } = createSetup();
    prisma.quiz.findFirst.mockResolvedValue(quizRow({ questionCount: 3 }));

    await expect(service.create(1n, dto)).rejects.toMatchObject({
      code: 'QUIZ_GENERATION_COOLDOWN',
    });
  });

  it('nguồn từ vựng không đủ → 409 trước khi tiêu quota', async () => {
    const { service, sourceRepo, usage } = createSetup('0');
    sourceRepo.findSourceItems.mockResolvedValue(sourceItems(1));

    await expect(service.create(1n, dto)).rejects.toMatchObject({
      code: 'QUIZ_NOT_ENOUGH_ITEMS',
    });
    expect(usage.reserveDailyRequest).not.toHaveBeenCalled();
  });

  it('happy path: reserve feature quiz, provider chạy, quiz chuyển ready', async () => {
    const { service, prisma, tx, sourceRepo, usage, providerGenerate } =
      createSetup('0');
    sourceRepo.findSourceItems.mockResolvedValue(sourceItems(3));
    prisma.userSettings.findUnique.mockResolvedValue({
      timezone: 'Asia/Ho_Chi_Minh',
    });
    usage.reserveDailyRequest.mockResolvedValue(1);
    prisma.quiz.create.mockResolvedValue(quizRow({ status: 'generating' }));
    providerGenerate.mockResolvedValue(generatedQuestions(2));
    tx.quiz.update.mockResolvedValue(
      quizRow({ status: 'ready', questionCount: 2 }),
    );

    const result = await service.create(1n, dto);

    const reserveArgs = usage.reserveDailyRequest.mock.calls[0] as [
      unknown,
      bigint,
      Date,
      string,
      number,
    ];
    expect(reserveArgs[3]).toBe('quiz');
    expect(reserveArgs[4]).toBe(15);

    const createArgs = firstArg<{
      data: {
        status: string;
        quizType: string;
        difficulty: string;
        generator: { provider: string; questionTypes: string[] };
      };
    }>(prisma.quiz.create);
    expect(createArgs.data.status).toBe('generating');
    expect(createArgs.data.quizType).toBe('multiple_choice');
    expect(createArgs.data.difficulty).toBe('medium');
    expect(createArgs.data.generator).toMatchObject({
      provider: 'stub',
      questionTypes: ['multiple_choice'],
    });

    expect(tx.quizQuestion.createMany).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('ready');
    expect(result.reused).toBe(false);
    expect(result).not.toHaveProperty('difficulty');
  });

  it('M6.2 rejects a generated quiz if the profile language changes while waiting for AI', async () => {
    const setup = createSetup('0');
    setup.sourceRepo.findSourceItems.mockResolvedValue(sourceItems(3));
    setup.providerGenerate.mockImplementation(() => {
      setup.srs.getProfileContextInTransaction.mockResolvedValue({
        id: 'profile-1',
        primaryLanguageId: 1,
        timezone: 'Asia/Ho_Chi_Minh',
      });
      return Promise.resolve(generatedQuestions(2));
    });
    await expect(setup.service.create(1n, dto)).rejects.toMatchObject({
      code: 'QUIZ_SCOPE_CHANGED',
    });
    expect(setup.tx.quizQuestion.createMany).not.toHaveBeenCalled();
    expect(setup.tx.quiz.update).not.toHaveBeenCalled();
    const failed = firstArg<{
      where: { id: string; status: string };
      data: { status: string };
    }>(setup.tx.quiz.updateMany);
    expect(failed.where.id).toBeTruthy();
    expect(failed.where.status).toBe('generating');
    expect(failed.data.status).toBe('failed');
  });

  it('provider lỗi → quiz failed + 503', async () => {
    const setup = createSetup('0');
    setup.sourceRepo.findSourceItems.mockResolvedValue(sourceItems(3));
    setup.prisma.userSettings.findUnique.mockResolvedValue({
      timezone: 'Asia/Ho_Chi_Minh',
    });
    setup.usage.reserveDailyRequest.mockResolvedValue(1);
    setup.prisma.quiz.create.mockResolvedValue(
      quizRow({ status: 'generating' }),
    );
    setup.prisma.quiz.updateMany.mockResolvedValue({ count: 1 });
    setup.providerGenerate.mockRejectedValue(new Error('boom'));

    await expect(setup.service.create(1n, dto)).rejects.toMatchObject({
      code: 'AI_PROVIDER_UNAVAILABLE',
    });
    const createArgs = firstArg<{ data: { id: string } }>(
      setup.prisma.quiz.create,
    );
    expect(setup.prisma.quiz.updateMany).toHaveBeenCalledWith({
      where: { id: createArgs.data.id, status: 'generating' },
      data: { status: 'failed' },
    });
  });

  it('persistence failure rolls back questions and marks the claim failed', async () => {
    const setup = createSetup('0');
    setup.sourceRepo.findSourceItems.mockResolvedValue(sourceItems(3));
    setup.providerGenerate.mockResolvedValue(generatedQuestions(2));
    setup.tx.quizQuestion.createMany.mockRejectedValue(
      new Error('insert failed'),
    );
    await expect(setup.service.create(1n, dto)).rejects.toMatchObject({
      code: 'AI_PROVIDER_UNAVAILABLE',
    });
    expect(setup.tx.quiz.update).not.toHaveBeenCalled();
    const claim = firstArg<{ data: { id: string } }>(setup.prisma.quiz.create);
    expect(setup.prisma.quiz.updateMany).toHaveBeenCalledWith({
      where: { id: claim.data.id, status: 'generating' },
      data: { status: 'failed' },
    });
  });

  it('does not reuse a quiz from a different active profile', async () => {
    const setup = createSetup();
    setup.prisma.quiz.findFirst.mockResolvedValue(
      quizRow({ profileId: 'old-profile' }),
    );
    await expect(setup.service.create(1n, dto)).rejects.toMatchObject({
      code: 'QUIZ_GENERATION_COOLDOWN',
    });
    expect(setup.usage.reserveDailyRequest).not.toHaveBeenCalled();
  });

  it('validates archived collection before returning a dedup hit', async () => {
    const setup = createSetup();
    setup.prisma.quiz.findFirst.mockResolvedValue(
      quizRow({ collectionId: QUIZ_ID }),
    );
    setup.tx.collection.findFirst.mockResolvedValue(null);
    await expect(
      setup.service.create(1n, { ...dto, collection_id: QUIZ_ID }),
    ).rejects.toMatchObject({ code: 'COLLECTION_NOT_FOUND' });
    expect(setup.prisma.quiz.findFirst).not.toHaveBeenCalled();
    expect(setup.usage.reserveDailyRequest).not.toHaveBeenCalled();
  });

  it('start quiz hết hạn → 409 QUIZ_EXPIRED + đánh dấu expired', async () => {
    const { service, prisma } = createSetup();
    prisma.quiz.findFirst.mockResolvedValue(
      quizRow({ expiresAt: new Date(Date.now() - 1000) }),
    );

    await expect(service.start(1n, QUIZ_ID)).rejects.toMatchObject({
      code: 'QUIZ_EXPIRED',
    });
    expect(prisma.quiz.update).toHaveBeenCalledWith({
      where: { id: QUIZ_ID },
      data: { status: 'expired' },
    });
  });

  it('start quiz ready → snapshot câu hỏi kèm style/context từ metadata v2', async () => {
    const { service, prisma, tx, sessions } = createSetup();
    prisma.quiz.findFirst.mockResolvedValue(
      quizRow({
        generator: {
          provider: 'stub',
          version: QUIZ_VERSION,
          questionTypes: ['multiple_choice', 'matching'],
          questions: [
            {
              ordinal: 1,
              style: 'kanji_reading',
              context: {
                sentence: '毎日、学校へ行きます。',
                target: { start: 3, end: 5, text: '学校' },
                origin: 'generated',
                attribution: null,
              },
              evidence: null,
            },
            { ordinal: 2, style: 'matching', context: null, evidence: null },
          ],
        },
      }),
    );
    prisma.quizQuestion.findMany.mockResolvedValue([
      {
        id: 1n,
        ordinal: 1,
        questionType: 'multiple_choice',
        prompt: '毎日、学校へ行きます。',
        options: [{ index: 0, text: 'がっこう' }],
        correctAnswer: { index: 0, text: 'がっこう' },
        languageId: 2,
        conceptId: 1n,
        itemId: 'item-1',
      },
      {
        id: 2n,
        ordinal: 2,
        questionType: 'matching',
        prompt: 'Ghép từ với nghĩa tương ứng',
        options: [
          { index: 0, text: '語1', side: 'left' },
          { index: 0, text: 'nghĩa 1', side: 'right' },
        ],
        correctAnswer: { mapping: [{ left_index: 0, right_index: 0 }] },
        languageId: 2,
        conceptId: null,
        itemId: null,
      },
    ]);
    tx.studySession.create.mockResolvedValue({});
    tx.studySessionItem.createMany.mockResolvedValue({ count: 2 });
    sessions.get.mockResolvedValue({ session: { id: 'session-1' }, items: [] });

    const result = await service.start(1n, QUIZ_ID);

    const sessionArgs = firstArg<{
      data: { kind: string; mode: string; quizId: string };
    }>(tx.studySession.create);
    expect(sessionArgs.data).toMatchObject({
      kind: 'quiz',
      mode: 'multiple_choice',
      quizId: QUIZ_ID,
    });
    const itemArgs = firstArg<{
      data: {
        prompt: {
          kind: string;
          question_style: string;
          context: { target: unknown } | null;
          left?: unknown[];
          right?: unknown[];
        };
        quizQuestionId: bigint;
      }[];
    }>(tx.studySessionItem.createMany);
    expect(itemArgs.data[0].prompt.kind).toBe('multiple_choice');
    expect(itemArgs.data[0].prompt.question_style).toBe('kanji_reading');
    expect(itemArgs.data[0].prompt.context?.target).toEqual({
      start: 3,
      end: 5,
      text: '学校',
    });
    expect(itemArgs.data[1].prompt.kind).toBe('matching');
    expect(itemArgs.data[1].prompt.question_style).toBe('matching');
    expect(itemArgs.data[1].prompt.left).toHaveLength(1);
    expect(itemArgs.data[1].prompt.right).toHaveLength(1);
    expect(itemArgs.data[0].quizQuestionId).toBe(1n);
    expect(result).toEqual(
      expect.objectContaining({ session: { id: 'session-1' } }),
    );
  });

  it('quiz của user khác → 404 QUIZ_NOT_FOUND', async () => {
    const { service, prisma } = createSetup();
    prisma.quiz.findFirst.mockResolvedValue(null);

    await expect(service.start(2n, QUIZ_ID)).rejects.toMatchObject({
      code: 'QUIZ_NOT_FOUND',
    });
  });
});
