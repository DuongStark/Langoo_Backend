import {
  QuizBankRepository,
  computeReporterHash,
} from './quiz-bank.repository';
import { PrismaService } from '../../../db/prisma.service';

describe('QuizBankRepository', () => {
  it('hides reported bank item for 1st reporter without quarantining, then quarantines and replenishes on 2nd distinct reporter', async () => {
    const reportsByHash = new Map<string, { id: string; userId: bigint }>();
    let bankState = {
      id: 99n,
      senseId: 500n,
      languageId: 2,
      status: 'active',
      reportCount: 0,
    };
    const jobState = {
      replenishCycles: 0,
      enqueued: 0,
    };

    const txMock = {
      quizQuestionBankReport: {
        findFirst: jest.fn().mockImplementation(
          ({
            where,
          }: {
            where: {
              userId?: bigint;
              idempotencyKey?: string;
              bankQuestionId?: bigint;
              reporterHash?: string;
            };
          }) => {
            if (where.userId && where.idempotencyKey) {
              return null;
            }
            if (where.bankQuestionId && where.reporterHash) {
              return reportsByHash.get(where.reporterHash) ?? null;
            }
            return null;
          },
        ),
        create: jest
          .fn()
          .mockImplementation(
            ({
              data,
            }: {
              data: { id: string; userId: bigint; reporterHash: string };
            }) => {
              const rec = { id: data.id, userId: data.userId };
              reportsByHash.set(data.reporterHash, rec);
              return rec;
            },
          ),
        count: jest.fn().mockImplementation(() => reportsByHash.size),
      },
      quizQuestionBank: {
        findUnique: jest.fn().mockImplementation(() => bankState),
        update: jest
          .fn()
          .mockImplementation(
            ({ data }: { data: Partial<typeof bankState> }) => {
              bankState = { ...bankState, ...data };
              return bankState;
            },
          ),
      },
      $executeRaw: jest.fn().mockImplementation(() => {
        if (jobState.replenishCycles < 1) {
          jobState.replenishCycles += 1;
          jobState.enqueued += 1;
        }
        return 1;
      }),
    };

    const prisma = {
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(txMock)),
    } as unknown as PrismaService;

    const repo = new QuizBankRepository(prisma);

    // User 1 reports first time
    const r1 = await repo.reportBankQuestion({
      bankQuestionId: 99n,
      userId: 10n,
      quizId: '018f0000-0000-7000-8000-000000000001',
      ordinal: 1,
      reason: 'ambiguous',
      idempotencyKey: '018f0000-0000-7000-8000-000000000011',
    });
    expect(r1.quarantined).toBe(false);
    expect(bankState.reportCount).toBe(1);
    expect(bankState.status).toBe('active');
    expect(jobState.enqueued).toBe(0);

    // User 1 reports SAME bank question again in another quiz -> must stay reportCount = 1
    const r1Dup = await repo.reportBankQuestion({
      bankQuestionId: 99n,
      userId: 10n,
      quizId: '018f0000-0000-7000-8000-000000000002',
      ordinal: 2,
      reason: 'ambiguous',
      idempotencyKey: '018f0000-0000-7000-8000-000000000012',
    });
    expect(r1Dup.quarantined).toBe(false);
    expect(bankState.reportCount).toBe(1);
    expect(bankState.status).toBe('active');

    // User 2 (distinct reporterHash) reports -> reportCount = 2 -> quarantined + replenish once!
    expect(computeReporterHash(10n)).not.toBe(computeReporterHash(20n));
    const r2 = await repo.reportBankQuestion({
      bankQuestionId: 99n,
      userId: 20n,
      quizId: '018f0000-0000-7000-8000-000000000003',
      ordinal: 1,
      reason: 'wrong_meaning',
      idempotencyKey: '018f0000-0000-7000-8000-000000000021',
    });
    expect(r2.quarantined).toBe(true);
    expect(bankState.reportCount).toBe(2);
    expect(bankState.status).toBe('quarantined');
    expect(jobState.enqueued).toBe(1);
  });

  it('caps high-priority (10) user-saved pre-warm jobs at 30 per user per UTC day and downgrades overflow to priority 50', async () => {
    const prisma = {
      quizQuestionBank: { count: jest.fn().mockResolvedValue(0) },
      $executeRaw: jest.fn().mockResolvedValue(1),
    } as unknown as PrismaService;
    const repo = new QuizBankRepository(prisma);
    const spy = jest.spyOn(repo, 'enqueueSenseGeneration');
    const fixedNow = new Date('2026-11-18T05:00:00.000Z');

    for (let i = 1; i <= 31; i++) {
      await repo.enqueueUserSavedSenses(
        99n,
        [{ senseId: BigInt(1000 + i), languageId: 1 }],
        fixedNow,
      );
    }

    expect(spy).toHaveBeenCalledTimes(31);
    expect(spy.mock.calls[0][0]).toEqual({
      senseId: 1001n,
      languageId: 1,
      priority: 10,
    });
    expect(spy.mock.calls[29][0]).toEqual({
      senseId: 1030n,
      languageId: 1,
      priority: 10,
    });
    expect(spy.mock.calls[30][0]).toEqual({
      senseId: 1031n,
      languageId: 1,
      priority: 50,
    });
  });
});
