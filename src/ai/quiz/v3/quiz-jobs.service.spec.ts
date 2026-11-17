import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../db/prisma.service';
import { SrsService } from '../../../srs/srs.service';
import { PrivacyService } from '../../../privacy/privacy.service';
import { AiUsageService } from '../../usage/ai-usage.service';
import { QuizSourceRepository } from '../repositories/quiz-source.repository';
import { QuizBatchEngine } from './quiz-batch-engine';
import { QuizJobsService, QuizJobMetadata } from './quiz-jobs.service';
import { CreateQuizJobDto } from './quiz-v3.dto';

type Row = {
  id: string;
  userId: bigint;
  profileId: string;
  status: string;
  expiresAt: Date;
  generator: QuizJobMetadata;
};
function setup(enabled = true) {
  let row: Row | null = null;
  const copy = <T>(v: T): T => structuredClone(v);
  const items = Array.from({ length: 10 }, (_, i) => ({
    itemId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    senseId: String(i + 1),
    conceptId: null,
    languageId: 1,
    languageCode: 'en',
    lemma: `word${i}`,
    meaningVi: `nghĩa ${i}`,
    reading: null,
    romanization: null,
    pos: 'noun',
  }));
  const quiz = {
    findFirst: jest.fn(async (args: { where: Record<string, unknown> }) => {
      await Promise.resolve();
      if (!row) return null;
      const w = args.where;
      if (
        w.id !== undefined &&
        (w.id !== row.id ||
          w.userId !== row.userId ||
          w.profileId !== row.profileId)
      )
        return null;
      if (w.status !== undefined && row.status !== w.status) return null;
      const generator = w.generator as
        { path?: string[]; equals?: unknown } | undefined;
      if (
        generator?.path?.includes('key') &&
        row.generator.job.key !== generator.equals
      )
        return null;
      return copy(row);
    }),
    findUnique: jest.fn(() => Promise.resolve(row ? copy(row) : null)),
    findUniqueOrThrow: jest.fn(async () => {
      await Promise.resolve();
      if (!row) throw new Error('missing');
      return copy(row);
    }),
    findMany: jest.fn(() =>
      Promise.resolve(
        row &&
          row.status === 'generating' &&
          ['queued', 'running'].includes(row.generator.job.state)
          ? [copy(row)]
          : [],
      ),
    ),
    create: jest.fn(async ({ data }: { data: Row }) => {
      await Promise.resolve();
      row = copy(data);
      return copy(row);
    }),
    updateMany: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { generator: { equals: number } };
        data: Partial<Row>;
      }) => {
        await Promise.resolve();
        if (!row || row.generator.job.revision !== where.generator.equals)
          return { count: 0 };
        row = copy({ ...row, ...data });
        return { count: 1 };
      },
    ),
  };
  const db = {
    quiz,
    quizQuestion: { createMany: jest.fn(() => Promise.resolve({ count: 1 })) },
    collection: { findFirst: jest.fn(() => Promise.resolve({ id: 'c' })) },
    $queryRaw: jest.fn(() => Promise.resolve([])),
    $transaction: jest.fn(),
  };
  db.$transaction.mockImplementation(
    (callback: (tx: typeof db) => Promise<unknown>) => callback(db),
  );
  const profile = {
    id: '00000000-0000-4000-8000-000000000099',
    primaryLanguageId: 1,
    secondaryLanguageId: 2,
    timezone: 'Asia/Ho_Chi_Minh',
  };
  const srs = {
    getProfileContext: jest.fn(() => Promise.resolve(profile)),
    getProfileContextInTransaction: jest.fn(() => Promise.resolve(profile)),
  };
  const sources = { findSourceItems: jest.fn(() => Promise.resolve(items)) };
  const privacy = {
    assertAiAllowed: jest.fn(() => Promise.resolve(undefined)),
  };
  const usage = {
    reserveDailyRequest: jest.fn(() => Promise.resolve(1)),
    addUsage: jest.fn(() => Promise.resolve(undefined)),
  };
  const engine = new QuizBatchEngine({});
  jest.spyOn(engine, 'available').mockReturnValue(true);
  const service = new QuizJobsService(
    db as unknown as PrismaService,
    new ConfigService({ AI_QUIZ_V3_ENABLED: enabled }),
    srs as unknown as SrsService,
    privacy as unknown as PrivacyService,
    usage as unknown as AiUsageService,
    sources as unknown as QuizSourceRepository,
    engine,
  );
  const dto: CreateQuizJobDto = {
    language_id: 1,
    question_count: 1,
    skills: ['meaning'],
    idempotency_key: '00000000-0000-4000-8000-000000000001',
  };
  return {
    service,
    db,
    sources,
    usage,
    privacy,
    engine,
    dto,
    profile,
    row: () => row,
  };
}

describe('M11.3 durable quiz lifecycle', () => {
  it('checks AI consent before reserving quota', async () => {
    const x = setup();
    x.privacy.assertAiAllowed.mockRejectedValueOnce(
      new Error('privacy disabled'),
    );
    await expect(
      x.service.create(1n, { ...x.dto, skills: ['usage'] }),
    ).rejects.toThrow('privacy disabled');
    expect(x.usage.reserveDailyRequest).not.toHaveBeenCalled();
    expect(x.db.quiz.create).not.toHaveBeenCalled();
  });
  it('is opt-in and disabled calls never read source or spend quota', async () => {
    const x = setup(false);
    await expect(x.service.eligibility(1n, x.dto)).rejects.toMatchObject({
      code: 'QUIZ_V3_DISABLED',
    });
    expect(x.sources.findSourceItems).not.toHaveBeenCalled();
  });
  it('preflight does not reserve quota and checks target language before reading source', async () => {
    const x = setup();
    expect(
      (
        await x.service.eligibility(1n, {
          ...x.dto,
          question_count: 20,
          skills: ['meaning', 'context_cloze'],
        })
      ).feasible,
    ).toBe(true);
    expect(x.usage.reserveDailyRequest).not.toHaveBeenCalled();
    await expect(
      x.service.eligibility(1n, { ...x.dto, language_id: 9 }),
    ).rejects.toMatchObject({ code: 'QUIZ_LANGUAGE_NOT_IN_PROFILE' });
    expect(x.sources.findSourceItems).toHaveBeenCalledTimes(1);
  });
  it('same key replays without charging again, changed payload conflicts', async () => {
    const x = setup();
    const first = await x.service.create(1n, x.dto);
    expect((await x.service.create(1n, x.dto)).quiz_id).toBe(first.quiz_id);
    expect(x.usage.reserveDailyRequest).toHaveBeenCalledTimes(1);
    x.sources.findSourceItems.mockRejectedValueOnce(
      new Error('collection removed'),
    );
    expect((await x.service.create(1n, x.dto)).quiz_id).toBe(first.quiz_id);
    await expect(
      x.service.create(1n, { ...x.dto, question_count: 2 }),
    ).rejects.toMatchObject({ code: 'QUIZ_IDEMPOTENCY_CONFLICT' });
  });
  it('does not publish before final audit or leak source/content through progress', async () => {
    const x = setup();
    const created = await x.service.create(1n, x.dto);
    const m = x.row()!.generator;
    m.job.state = 'needs_action';
    m.content = await x.engine.generate(m.slots, m.source, () =>
      Promise.resolve(undefined),
    );
    m.audited = false;
    const status = await x.service.get(1n, created.quiz_id);
    expect(status.allowed_actions).not.toContain('accept_shorter');
    expect(JSON.stringify(status)).not.toContain('word0');
    await expect(
      x.service.action(1n, created.quiz_id, 'accept_shorter'),
    ).rejects.toMatchObject({ code: 'QUIZ_ACTION_NOT_ALLOWED' });
  });
  it('cancel is idempotent and a cancelled job is not picked by the worker', async () => {
    const x = setup();
    const created = await x.service.create(1n, x.dto);
    await x.service.action(1n, created.quiz_id, 'cancel');
    expect((await x.service.action(1n, created.quiz_id, 'cancel')).state).toBe(
      'cancelled',
    );
    await x.service.tick();
    expect(x.db.quizQuestion.createMany).not.toHaveBeenCalled();
  });
  it('publishes local content in one short transaction and preserves the source metadata', async () => {
    const x = setup();
    jest.spyOn(x.engine, 'audit').mockResolvedValue([]);
    const created = await x.service.create(1n, x.dto);
    await x.service.tick();
    expect((await x.service.get(1n, created.quiz_id)).state).toBe('ready');
    expect(x.db.quizQuestion.createMany).toHaveBeenCalledTimes(1);
    expect(x.row()!.generator.content[0].targets).toHaveLength(1);
    expect(x.sources.findSourceItems.mock.calls.length).toBe(3);
    await expect(
      x.service.action(1n, created.quiz_id, 'cancel'),
    ).rejects.toMatchObject({ code: 'QUIZ_ACTION_NOT_ALLOWED' });
  });
  it('source deletion before publish invalidates content instead of creating an obsolete quiz', async () => {
    const x = setup();
    jest.spyOn(x.engine, 'audit').mockResolvedValue([]);
    const created = await x.service.create(1n, x.dto);
    x.sources.findSourceItems.mockResolvedValueOnce([]);
    await x.service.tick();
    const state = await x.service.get(1n, created.quiz_id);
    expect(state.reason).toBe('QUIZ_SOURCE_CHANGED');
    expect(state.allowed_actions).toEqual(['cancel']);
    expect(x.db.quizQuestion.createMany).not.toHaveBeenCalled();
  });
});
