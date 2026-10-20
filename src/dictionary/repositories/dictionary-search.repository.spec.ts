import { DomainException } from '../../common/errors/domain.exception';
import { PrismaService } from '../../db/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { DictionarySearchRepository } from './dictionary-search.repository';

function createRepository(): {
  repository: DictionarySearchRepository;
  queryRaw: jest.Mock;
  executeRawUnsafe: jest.Mock;
} {
  const queryRaw = jest.fn().mockResolvedValue([]);
  const executeRawUnsafe = jest.fn().mockResolvedValue(0);
  const transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({ $queryRaw: queryRaw, $executeRawUnsafe: executeRawUnsafe }),
  );
  const prisma = {
    $queryRaw: queryRaw,
    $transaction: transaction,
  } as unknown as PrismaService;
  return {
    repository: new DictionarySearchRepository(prisma),
    queryRaw,
    executeRawUnsafe,
  };
}

function firstArg<T>(mock: jest.Mock): T {
  const call = mock.mock.calls[0] as unknown[];
  return call[0] as T;
}

const params = {
  queries: ['book'],
  patterns: ['book'],
  lang: 'en',
  limit: 5,
  cursor: null,
};

describe('DictionarySearchRepository', () => {
  it('gộp suggestion theo ngôn ngữ + mặt chữ + cách đọc và xếp theo tần suất', async () => {
    const { repository, queryRaw } = createRepository();

    await repository.search({ ...params, deduplicateSurface: true });

    const query = firstArg<Prisma.Sql>(queryRaw);
    expect(query.sql).toContain(
      "PARTITION BY lang_code, lower(surface), coalesce(lower(reading), '')",
    );
    expect(query.sql).toContain(
      'ORDER BY exact_rank, prefix_rank, ja_source_rank, vi_translation_rank, frequency_null_rank, frequency_sort',
    );
  });

  it('giữ phân vùng theo lexeme cho endpoint search đầy đủ', async () => {
    const { repository, queryRaw } = createRepository();

    await repository.search(params);

    const query = firstArg<Prisma.Sql>(queryRaw);
    expect(query.sql).toContain('PARTITION BY lexeme_id');
  });

  it('ẩn bản sao: JA theo JMdict, EN theo entry curated (M10.5)', async () => {
    const { repository, queryRaw } = createRepository();

    await repository.search(params);

    const query = firstArg<Prisma.Sql>(queryRaw);
    expect(query.sql).toContain("src.code='jmdict'");
    expect(query.sql).toContain("cr.policy='en-m10.5-v1'");
    expect(query.sql).toContain('FROM canonical c');
    expect(query.sql).toContain('c.pos IS NOT DISTINCT FROM r.pos');
    expect(query.sql).toContain('FROM visible');
  });

  it('guard statement_timeout (SET LOCAL) + custom plan without arbitrary candidate cap', async () => {
    const { repository, queryRaw, executeRawUnsafe } = createRepository();

    await repository.search(params);

    expect(executeRawUnsafe).toHaveBeenCalledWith(
      "SET LOCAL statement_timeout = '20000'",
    );
    expect(executeRawUnsafe).toHaveBeenCalledWith(
      "SET LOCAL plan_cache_mode = 'force_custom_plan'",
    );
    const query = firstArg<Prisma.Sql>(queryRaw);
    expect(query.sql).not.toContain('LIMIT 5000');
  });

  it('EN tạm thời VI-only: chỉ hiện lexeme EN có ít nhất 1 gloss VI', async () => {
    const { repository, queryRaw } = createRepository();

    await repository.search(params);

    const query = firstArg<Prisma.Sql>(queryRaw);
    expect(query.sql).toContain("r.lang_code <> 'en' OR r.vi_rank = 0");
    expect(query.sql).toContain("vi_l.code='vi'");
  });
});

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
