import { PrismaService } from '../../db/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { DictionarySearchRepository } from './dictionary-search.repository';

function createRepository(): {
  repository: DictionarySearchRepository;
  queryRaw: jest.Mock;
} {
  const queryRaw = jest.fn().mockResolvedValue([]);
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
  return { repository: new DictionarySearchRepository(prisma), queryRaw };
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
      'ORDER BY exact_rank, prefix_rank, frequency_null_rank, frequency_sort',
    );
  });

  it('giữ phân vùng theo lexeme cho endpoint search đầy đủ', async () => {
    const { repository, queryRaw } = createRepository();

    await repository.search(params);

    const query = firstArg<Prisma.Sql>(queryRaw);
    expect(query.sql).toContain('PARTITION BY lexeme_id');
  });
});
