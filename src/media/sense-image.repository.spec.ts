import { SenseImageRepository } from './sense-image.repository';
import { PrismaService } from '../db/prisma.service';

describe('SenseImageRepository', () => {
  let repo: SenseImageRepository;
  let mockPrisma: jest.Mocked<PrismaService>;

  beforeEach(() => {
    mockPrisma = {
      $queryRaw: jest.fn(),
    } as unknown as jest.Mocked<PrismaService>;
    repo = new SenseImageRepository(mockPrisma);
  });

  it('trả mảng rỗng ngay lập tức khi mảng ids rỗng (không query DB)', async () => {
    const queryRaw = jest.spyOn(mockPrisma, '$queryRaw');
    const res = await repo.findSourcesWithDirectImages(mockPrisma, []);
    expect(res).toEqual([]);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('có tier 0 đọc ảnh sense-level trước ảnh concept', async () => {
    const queryRaw = mockPrisma.$queryRaw as jest.Mock;
    queryRaw.mockResolvedValueOnce([]);

    await repo.findSourcesWithDirectImages(mockPrisma, [100n]);

    const sql = queryRaw.mock.calls[0][0] as { strings: string[] };
    const text = sql.strings.join('?');
    expect(text).toContain('serve.sense_image');
    expect(text).toContain('0 AS tier');
  });

  it('map đúng cấu trúc SenseImageSource và directCandidate từ SQL rows', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      {
        sense_id: 100n,
        lemma: 'coffee',
        pos: 'noun',
        language_id: 1,
        definition: 'a hot beverage',
        asset_id: 501n,
        concept_id: 201n,
        anchor_sense_id: 100n,
        object_key: 'illustrations/coffee.png',
        mime: 'image/png',
        bytes: 12345,
        sha256: 'a'.repeat(64),
        provider: 'r2',
        metadata: { width: 512, height: 512 },
      },
      {
        sense_id: 101n,
        lemma: 'tea',
        pos: 'noun',
        language_id: 1,
        definition: 'another beverage',
        asset_id: null,
        concept_id: null,
        anchor_sense_id: null,
        object_key: null,
        mime: null,
        bytes: null,
        sha256: null,
        provider: null,
        metadata: null,
      },
    ]);

    const res = await repo.findSourcesWithDirectImages(mockPrisma, [
      100n,
      101n,
    ]);
    expect(res).toHaveLength(2);

    expect(res[0]).toEqual({
      sense_id: 100n,
      lemma: 'coffee',
      pos: 'noun',
      language_id: 1,
      definition: 'a hot beverage',
      directCandidate: {
        asset_id: 501n,
        concept_id: 201n,
        anchor_sense_id: 100n,
        object_key: 'illustrations/coffee.png',
        mime: 'image/png',
        bytes: 12345,
        sha256: 'a'.repeat(64),
        provider: 'r2',
        metadata: { width: 512, height: 512 },
      },
    });

    expect(res[1]).toEqual({
      sense_id: 101n,
      lemma: 'tea',
      pos: 'noun',
      language_id: 1,
      definition: 'another beverage',
      directCandidate: null,
    });
  });

  it('findDirectImages trả Map<string, ImageCandidate | null>', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      {
        sense_id: 100n,
        asset_id: 501n,
        concept_id: 201n,
        anchor_sense_id: 100n,
        object_key: 'illustrations/coffee.png',
        mime: 'image/png',
        bytes: 12345,
        sha256: 'a'.repeat(64),
        provider: 'r2',
        metadata: { width: 512, height: 512 },
      },
    ]);

    const res = await repo.findDirectImages(mockPrisma, [100n]);
    expect(res.get('100')).toMatchObject({
      asset_id: 501n,
      object_key: 'illustrations/coffee.png',
    });
  });
});
