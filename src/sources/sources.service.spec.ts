import { SourcesRepository } from './sources.repository';
import { SourcesService } from './sources.service';

function createService(): {
  service: SourcesService;
  listSources: jest.Mock;
} {
  const listSources = jest.fn().mockResolvedValue([
    {
      id: 1,
      code: 'jmdict',
      name: 'JMdict',
      license: 'CC BY-SA 4.0',
      attribution: 'EDRDG',
      url: 'https://example.com/jmdict',
      version: '3.6.2',
    },
    {
      id: 5,
      code: 'oewn',
      name: 'Open English WordNet',
      license: 'CC BY 4.0',
      attribution: 'OEWN',
      url: 'https://en-word.net/',
      version: '2024',
    },
  ]);
  const repo = {
    listSources,
    countLexemes: jest
      .fn()
      .mockResolvedValue([{ source_id: 1, count: 218794 }]),
    countSenses: jest.fn().mockResolvedValue([{ source_id: 1, count: 253630 }]),
    countGlosses: jest
      .fn()
      .mockResolvedValue([{ source_id: 1, count: 443328 }]),
    countConcepts: jest.fn().mockResolvedValue([{ source_id: null, count: 3 }]),
    countConceptGlosses: jest
      .fn()
      .mockResolvedValue([{ source_id: 5, count: 120635 }]),
    countKanji: jest.fn().mockResolvedValue([]),
    countExamples: jest.fn().mockResolvedValue([]),
  };
  return {
    service: new SourcesService(repo as unknown as SourcesRepository),
    listSources,
  };
}

describe('SourcesService', () => {
  it('ghép credit_line và số liệu usage theo từng nguồn', async () => {
    const { service } = createService();

    const data = await service.list();

    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({
      code: 'jmdict',
      credit_line: 'JMdict — EDRDG · CC BY-SA 4.0',
      usage: {
        lexemes: 218794,
        senses: 253630,
        glosses: 443328,
        concepts: 0,
        concept_glosses: 0,
        kanji: 0,
        examples: 0,
      },
    });
    expect(data[1]).toMatchObject({
      code: 'oewn',
      credit_line: 'Open English WordNet — OEWN · CC BY 4.0',
      usage: { lexemes: 0, concept_glosses: 120635 },
    });
  });

  it('cache trong TTL — không truy vấn lại', async () => {
    const { service, listSources } = createService();

    await service.list();
    await service.list();

    expect(listSources).toHaveBeenCalledTimes(1);
  });

  it('gộp các source db3b-ai-* vào llm-vi (child_count + cộng gloss)', async () => {
    const empty = jest.fn().mockResolvedValue([]);
    const repo = {
      listSources: jest.fn().mockResolvedValue([
        {
          id: 14,
          code: 'llm-vi',
          name: 'Gloss tiếng Việt do LLM sinh',
          license: 'nội bộ',
          attribution: 'Sinh bởi mô hình, chưa kiểm duyệt',
          url: null,
          version: null,
        },
        {
          id: 90,
          code: 'db3b-ai-aaa',
          name: 'DB3-B machine gloss',
          license: 'nội bộ',
          attribution: 'Machine translation',
          url: null,
          version: null,
        },
        {
          id: 91,
          code: 'db3b-ai-bbb',
          name: 'DB3-B machine gloss',
          license: 'nội bộ',
          attribution: 'Machine translation',
          url: null,
          version: null,
        },
      ]),
      countLexemes: empty,
      countSenses: empty,
      countGlosses: jest.fn().mockResolvedValue([
        { source_id: 14, count: 1000 },
        { source_id: 90, count: 100 },
        { source_id: 91, count: 100 },
      ]),
      countConcepts: empty,
      countConceptGlosses: empty,
      countKanji: empty,
      countExamples: empty,
    };
    const service = new SourcesService(repo as unknown as SourcesRepository);

    const data = await service.list();

    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      code: 'llm-vi',
      child_count: 3,
      usage: { glosses: 1200 },
    });
  });
});
