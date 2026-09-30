import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../db/prisma.service';
import { SrsService } from '../../srs/srs.service';
import { SessionsService } from '../../sessions/sessions.service';
import { AiQuizProvider } from '../providers/ai-quiz.provider';
import { AiUsageService } from '../usage/ai-usage.service';
import { QuizService } from './quiz.service';
import { QuizSourceRepository } from './repositories/quiz-source.repository';

const QUIZ_ID = '01900000-0000-7000-8000-000000000001';

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

function generatedQuestions(count: number) {
  return Array.from({ length: count }, (_value, index) => ({
    questionType: 'multiple_choice' as const,
    prompt: `Câu ${index + 1}`,
    options: [{ index: 0, text: 'a' }],
    correctAnswer: { index: 0, text: 'a' },
    explanation: null,
    languageId: 2,
    conceptId: null,
    itemId: null,
  }));
}

function createSetup(cooldownMs = '15000') {
  const tx = {
    quizQuestion: { createMany: jest.fn() },
    quiz: { update: jest.fn() },
    studySession: { create: jest.fn() },
    studySessionItem: { createMany: jest.fn() },
  };
  const prisma = {
    quiz: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    quizQuestion: { findMany: jest.fn() },
    collection: { findFirst: jest.fn() },
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
    getProfileContext: jest.fn().mockResolvedValue({
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
  quiz_type: 'multiple_choice' as const,
  difficulty: 'medium' as const,
  question_count: 2,
};

describe('QuizService', () => {
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
    prisma.quiz.findFirst.mockResolvedValue(quizRow({ difficulty: 'hard' }));

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
      data: { status: string; generator: { provider: string } };
    }>(prisma.quiz.create);
    expect(createArgs.data.status).toBe('generating');
    expect(createArgs.data.generator.provider).toBe('stub');

    expect(tx.quizQuestion.createMany).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('ready');
    expect(result.reused).toBe(false);
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
    setup.prisma.quiz.update.mockResolvedValue(quizRow({ status: 'failed' }));
    setup.providerGenerate.mockRejectedValue(new Error('boom'));

    await expect(setup.service.create(1n, dto)).rejects.toMatchObject({
      code: 'AI_PROVIDER_UNAVAILABLE',
    });
    const createArgs = firstArg<{ data: { id: string } }>(
      setup.prisma.quiz.create,
    );
    expect(setup.prisma.quiz.update).toHaveBeenCalledWith({
      where: { id: createArgs.data.id },
      data: { status: 'failed' },
    });
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

  it('start quiz ready → tạo phiên kind=quiz với snapshot câu hỏi', async () => {
    const { service, prisma, tx, sessions } = createSetup();
    prisma.quiz.findFirst.mockResolvedValue(quizRow());
    prisma.quizQuestion.findMany.mockResolvedValue([
      {
        id: 1n,
        ordinal: 1,
        questionType: 'multiple_choice',
        prompt: 'Nghĩa của 「語1」 là gì?',
        options: [{ index: 0, text: 'nghĩa 1' }],
        correctAnswer: { index: 0, text: 'nghĩa 1' },
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
        prompt: { kind: string; left?: unknown[]; right?: unknown[] };
        quizQuestionId: bigint;
      }[];
    }>(tx.studySessionItem.createMany);
    expect(itemArgs.data[0].prompt.kind).toBe('multiple_choice');
    expect(itemArgs.data[1].prompt.kind).toBe('matching');
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
