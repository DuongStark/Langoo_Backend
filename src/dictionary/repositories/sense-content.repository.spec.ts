import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../db/prisma.service';
import { ExampleRow, SenseContentRepository } from './sense-content.repository';

function createRepository(): {
  repository: SenseContentRepository;
  queryRaw: jest.Mock;
} {
  const queryRaw = jest.fn();
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
  return { repository: new SenseContentRepository(prisma), queryRaw };
}

const exampleRow: ExampleRow = {
  id: 4n,
  language_id: 1,
  text: 'My father runs a small company.',
  translation: { ja: '父は小さな会社を経営しています。' },
  translation_vi: 'Bố tôi điều hành một công ty nhỏ.',
  difficulty: null,
};

function mainQuerySql(queryRaw: jest.Mock): Prisma.Sql {
  const calls = queryRaw.mock.calls as [[unknown], [Prisma.Sql]];
  return calls[1][0];
}

describe('SenseContentRepository.getExamples — lọc ví dụ EN rác', () => {
  it('bảng junk tồn tại: ghép NOT EXISTS (md5) vào cả nhánh direct lẫn nhánh link', async () => {
    const { repository, queryRaw } = createRepository();
    queryRaw
      .mockResolvedValueOnce([{ readable: true }])
      .mockResolvedValueOnce([exampleRow]);

    const rows = await repository.getExamples(4n, 5);

    expect(rows).toEqual([exampleRow]);
    expect(queryRaw).toHaveBeenCalledTimes(2);
    const main = mainQuerySql(queryRaw);
    expect(main.sql).toContain('staging.junk_en_example_text');
    expect(main.sql).toContain('j.hash = md5(e.text)');
    // Điều kiện phải có ở cả 2 nhánh của candidates (direct + example_sense).
    expect(main.sql.match(/junk_en_example_text/g)).toHaveLength(2);
    expect(main.values).toEqual([4n, 4n, 4n, 5]);
    // Vẫn giữ heuristic cũ (quote đứt đoạn).
    expect(main.sql).toContain("e.text LIKE '%…%'");
  });

  it('bảng junk chưa tồn tại: không tham chiếu bảng trong query chính (tránh 42P01)', async () => {
    const { repository, queryRaw } = createRepository();
    queryRaw
      .mockResolvedValueOnce([{ readable: null }])
      .mockResolvedValueOnce([exampleRow]);

    const rows = await repository.getExamples(4n, 5);

    expect(rows).toEqual([exampleRow]);
    const main = mainQuerySql(queryRaw);
    expect(main.sql).not.toContain('junk_en_example_text');
    expect(main.sql).toContain('FROM core.example e');
    expect(main.values).toEqual([4n, 4n, 4n, 5]);
  });

  it('bảng tồn tại nhưng thiếu quyền SELECT: bỏ lọc, không làm vỡ API', async () => {
    const { repository, queryRaw } = createRepository();
    queryRaw
      .mockResolvedValueOnce([{ readable: false }])
      .mockResolvedValueOnce([exampleRow]);

    const rows = await repository.getExamples(4n, 5);

    expect(rows).toEqual([exampleRow]);
    expect(mainQuerySql(queryRaw).sql).not.toContain('junk_en_example_text');
  });

  it('kiểm tra sự tồn tại + quyền SELECT trước khi ghép điều kiện', async () => {
    const { repository, queryRaw } = createRepository();
    queryRaw
      .mockResolvedValueOnce([{ readable: null }])
      .mockResolvedValueOnce([]);

    await repository.getExamples(4n, 5);

    const [strings] = queryRaw.mock.calls[0] as [TemplateStringsArray];
    const check = strings.join('');
    expect(check).toContain("to_regclass('staging.junk_en_example_text')");
    expect(check).toContain('has_table_privilege');
  });
});
