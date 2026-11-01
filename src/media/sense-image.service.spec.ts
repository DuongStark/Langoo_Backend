import { SenseImageService } from './sense-image.service';
import { SenseImageRepository } from './sense-image.repository';
import { PrismaService } from '../db/prisma.service';
import { ConfigService } from '@nestjs/config';

type TxFn = (tx: unknown) => Promise<unknown>;

describe('SenseImageService', () => {
  let service: SenseImageService;
  let mockPrisma: PrismaService;
  let transactionMock: jest.Mock;
  let mockRepo: jest.Mocked<SenseImageRepository>;
  let mockConfig: jest.Mocked<ConfigService>;

  beforeEach(() => {
    transactionMock = jest.fn((callback: TxFn) => callback({}));
    mockPrisma = {
      $transaction: transactionMock,
    } as unknown as PrismaService;

    mockRepo = {
      findSourcesWithDirectImages: jest.fn(),
      findDirectImages: jest.fn(),
      findRootCandidates: jest.fn(),
    } as unknown as jest.Mocked<SenseImageRepository>;

    mockConfig = {
      get: jest.fn().mockReturnValue('https://media.langoo.org'),
    } as unknown as jest.Mocked<ConfigService>;

    service = new SenseImageService(mockPrisma, mockRepo, mockConfig);
  });

  it('trả map rỗng khi truyền mảng rỗng (không mở transaction)', async () => {
    const res = await service.resolveMany([]);
    expect(res.size).toBe(0);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('deduplicate IDs và trả kết quả cho từng ID', async () => {
    mockRepo.findSourcesWithDirectImages.mockResolvedValueOnce([
      {
        sense_id: 10n,
        lemma: 'coffee',
        pos: 'noun',
        language_id: 1,
        definition: 'a beverage',
        directCandidate: {
          asset_id: 101n,
          object_key: 'illustrations/coffee.png',
          mime: 'image/png',
          metadata: { width: 512, height: 512 },
        },
      },
    ]);

    const res = await service.resolveMany([10n, 10n]);
    const findSources = jest.spyOn(mockRepo, 'findSourcesWithDirectImages');
    expect(findSources).toHaveBeenCalledWith(expect.anything(), [10n]);
    expect(res.get('10')).toEqual({
      url: 'https://media.langoo.org/illustrations/coffee.png',
      mime: 'image/png',
      width: 512,
      height: 512,
    });
  });

  it('nhóm 3 (inflection) tự động fallback sang ảnh của root sense khi có bằng chứng duy nhất', async () => {
    mockRepo.findSourcesWithDirectImages.mockResolvedValueOnce([
      {
        sense_id: 20n,
        lemma: 'cooked',
        pos: 'verb',
        language_id: 1,
        definition: 'simple past of cook',
        directCandidate: null,
      },
    ]);

    mockRepo.findRootCandidates.mockResolvedValueOnce({
      relations: [
        {
          source_sense_id: 20n,
          target_sense_id: 30n,
          method: 'inflection_root_verified_v1',
          confidence: 0.95,
          target_language_id: 1,
          target_pos: 'verb',
          target_lemma: 'cook',
          target_definition: 'prepare food',
        },
      ],
      lexicalRoots: [],
    });

    mockRepo.findDirectImages.mockResolvedValueOnce(
      new Map([
        [
          '30',
          {
            asset_id: 500n,
            object_key: 'illustrations/cook.png',
            mime: 'image/png',
            metadata: { width: 512, height: 512 },
          },
        ],
      ]),
    );

    const res = await service.resolveMany([20n]);
    expect(res.get('20')).toEqual({
      url: 'https://media.langoo.org/illustrations/cook.png',
      mime: 'image/png',
      width: 512,
      height: 512,
    });
  });

  it('nhóm 3 có nhiều nghĩa root và không có relation verified -> trả null (không đoán mò)', async () => {
    mockRepo.findSourcesWithDirectImages.mockResolvedValueOnce([
      {
        sense_id: 20n,
        lemma: 'cooked',
        pos: 'verb',
        language_id: 1,
        definition: 'simple past of cook',
        directCandidate: null,
      },
    ]);

    mockRepo.findRootCandidates.mockResolvedValueOnce({
      relations: [],
      lexicalRoots: [
        {
          sense_id: 30n,
          lemma: 'cook',
          pos: 'verb',
          language_id: 1,
          definition: 'prepare food',
        },
        {
          sense_id: 31n,
          lemma: 'cook',
          pos: 'verb',
          language_id: 1,
          definition: 'alter or falsify a record',
        },
      ],
    });

    const res = await service.resolveMany([20n]);
    expect(res.get('20')).toBeNull();
    const findDirectImages = jest.spyOn(mockRepo, 'findDirectImages');
    expect(findDirectImages).not.toHaveBeenCalled();
  });

  it('nhóm 4 (auxiliary / abstract) luôn trả null', async () => {
    mockRepo.findSourcesWithDirectImages.mockResolvedValueOnce([
      {
        sense_id: 40n,
        lemma: 'been',
        pos: 'verb',
        language_id: 1,
        definition: 'past participle of be',
        directCandidate: {
          asset_id: 999n,
          object_key: 'illustrations/bad-been.png',
          mime: 'image/png',
        },
      },
    ]);

    const res = await service.resolveMany([40n]);
    expect(res.get('40')).toBeNull();
  });
});
