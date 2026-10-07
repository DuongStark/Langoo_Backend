import { PrismaService } from '../../db/prisma.service';
import { SenseCardRepository } from './sense-card.repository';

function createRepository(): {
  repository: SenseCardRepository;
  queryRaw: jest.Mock;
} {
  const queryRaw = jest.fn();
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
  return { repository: new SenseCardRepository(prisma), queryRaw };
}

const row = {
  sense_id: 1n,
  lexeme_id: 1n,
  language_id: 2,
  lemma: '走る',
  reading: 'はしる',
  romanization: null,
  pos: 'verb',
  frequency_rank: 100,
  homograph_no: 1,
  sense_no: 1,
  definition: 'to run',
  definition_language_id: 1,
  register: null,
  domain: null,
  is_primary: true,
  gloss_vi: 'chạy',
  gloss_vi_machine: false,
  gloss_vi_reviewed: false,
  gloss_en: 'to run',
  concept_id: 1n,
};

describe('SenseCardRepository', () => {
  it('trả về null khi sense không tồn tại', async () => {
    const { repository, queryRaw } = createRepository();
    queryRaw.mockResolvedValue([]);

    await expect(repository.getBySenseId(999999n)).resolves.toBeNull();
  });

  it('map dòng snake_case của view sang SenseCard camelCase', async () => {
    const { repository, queryRaw } = createRepository();
    queryRaw.mockResolvedValue([row]);

    const card = await repository.getBySenseId(1n);

    expect(card).toEqual({
      senseId: 1n,
      lexemeId: 1n,
      languageId: 2,
      lemma: '走る',
      reading: 'はしる',
      romanization: null,
      pos: 'verb',
      frequencyRank: 100,
      homographNo: 1,
      senseNo: 1,
      definition: 'to run',
      definitionLanguageId: 1,
      register: null,
      domain: null,
      isPrimary: true,
      glossVi: 'chạy',
      glossViMachine: false,
      glossViReviewed: false,
      glossEn: 'to run',
      glossEnContext: [],
      glossEnIsHierarchy: false,
      conceptId: 1n,
    });
  });

  it('truyền senseId vào tham số truy vấn', async () => {
    const { repository, queryRaw } = createRepository();
    queryRaw.mockResolvedValue([]);

    await repository.getBySenseId(42n);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(queryRaw).toHaveBeenCalledWith(expect.anything(), 42n);
  });
});
