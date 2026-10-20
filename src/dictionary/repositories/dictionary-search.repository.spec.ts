import { DomainException } from '../../common/errors/domain.exception';
import { PrismaService } from '../../db/prisma.service';
import { DictionarySearchRepository } from './dictionary-search.repository';

describe('M4.2 dictionary search failures', () => {
  const params = {
    queries: ['a'],
    patterns: ['a'],
    lang: 'en',
    limit: 5,
    cursor: null,
  };
  function failingRepository(error: Error) {
    const tx = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn().mockRejectedValue(error),
    };
    return new DictionarySearchRepository({
      ...tx,
      $transaction: async (work: (client: typeof tx) => Promise<unknown>) =>
        work(tx),
    } as unknown as PrismaService);
  }

  it('reports a statement timeout as a retryable search failure, not empty results', async () => {
    const repo = failingRepository(
      new Error('canceling statement due to statement timeout'),
    );
    await expect(repo.search(params)).rejects.toMatchObject({
      code: 'DICTIONARY_SEARCH_TIMEOUT',
      status: 504,
    });
  });

  it('recognizes structured PostgreSQL query cancellation', async () => {
    const error = Object.assign(new Error('Raw query failed'), {
      meta: { code: '57014' },
    });
    const repo = failingRepository(error);
    await expect(repo.search(params)).rejects.toBeInstanceOf(DomainException);
  });

  it('does not disguise unrelated database failures as a timeout', async () => {
    const error = new Error('database connection refused');
    await expect(failingRepository(error).search(params)).rejects.toBe(error);
  });

  it('recognizes PostgreSQL cancellation in Prisma 7 driver-adapter metadata', async () => {
    const error = Object.assign(new Error('Raw query failed'), {
      code: 'P2010',
      meta: {
        driverAdapterError: {
          cause: {
            originalCode: '57014',
            originalMessage: 'canceling statement due to user request',
          },
        },
      },
    });
    await expect(failingRepository(error).search(params)).rejects.toMatchObject(
      {
        code: 'DICTIONARY_SEARCH_TIMEOUT',
        status: 504,
      },
    );
  });
});
