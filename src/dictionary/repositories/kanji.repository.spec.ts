import { PrismaService } from '../../db/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { KanjiRepository } from './kanji.repository';

function createRepository(): {
  repository: KanjiRepository;
  queryRaw: jest.Mock;
} {
  const queryRaw = jest.fn().mockResolvedValue([]);
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
  return { repository: new KanjiRepository(prisma), queryRaw };
}

describe('KanjiRepository', () => {
  it('kanji card gom parts từ core.kanji_radical + tên/nghĩa bộ thủ (kể cả biến thể)', async () => {
    const { repository, queryRaw } = createRepository();

    await repository.getByLiteral('学');

    const call = queryRaw.mock.calls[0] as unknown[];
    const first = call[0];
    const text = Array.isArray(first)
      ? (first as string[]).join('$')
      : (first as Prisma.Sql).sql;
    expect(text).toContain('FROM core.kanji_radical kr');
    expect(text).toContain('jsonb_build_object');
    expect(text).toContain('ANY (r.variants)');
    expect(text).toContain('AS parts');
    expect(text).toContain('ORDER BY kr.position NULLS LAST, kr.part');
  });

  it('components lấy từ core.kanji_component + join public.radical (biến thể)', async () => {
    const { repository, queryRaw } = createRepository();

    await repository.getComponents('猫');

    const call = queryRaw.mock.calls[0] as unknown[];
    const first = call[0];
    const text = Array.isArray(first)
      ? (first as string[]).join('$')
      : (first as Prisma.Sql).sql;
    expect(text).toContain('FROM core.kanji_component c');
    expect(text).toContain('ANY (r.variants)');
    expect(text).toContain('ORDER BY c.ord ASC');
  });
});
