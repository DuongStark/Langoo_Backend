import { Prisma } from '../../generated/prisma/client';
import { SenseLookupRepository } from './sense-lookup.repository';
import { PrismaService } from '../../db/prisma.service';

describe('M12-A19 page display projection', () => {
  it('uses two queries for 100 repeated words and filters/deduplicates Vietnamese Kanji data', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce(
        Array.from({ length: 100 }, (_, i) => ({
          sense_id: BigInt(i + 1),
          lemma: '学生学',
          reading: 'がくせい',
          romanization: null,
          pos: 'noun',
          gloss_en: 'student',
          gloss_vi: 'học sinh',
          gloss_vi_machine: true,
          gloss_vi_reviewed: false,
        })),
      )
      .mockResolvedValueOnce([
        {
          literal: '学',
          readings: {
            groups: [
              [
                { type: 'vietnam', value: 'học' },
                { type: 'ja_on', value: 'ガク' },
                { type: 'vietnam', value: 'học' },
              ],
            ],
          },
          meanings: {
            groups: [
              [
                { lang: 'en', value: 'study' },
                {
                  lang: 'vi',
                  value: 'học',
                  is_machine: true,
                  review_status: 'unreviewed',
                },
              ],
            ],
          },
        },
      ]);
    const repo = new SenseLookupRepository({
      $queryRaw: query,
    } as unknown as PrismaService);
    const result = await repo.findDisplays(
      Array.from({ length: 100 }, (_, i) => BigInt(i + 1)),
      [2],
    );
    expect(query).toHaveBeenCalledTimes(2);
    expect(result.size).toBe(100);
    expect(result.get('1')).toMatchObject({
      gloss_en: 'student',
      gloss_vi: 'học sinh',
      gloss_vi_machine: true,
      gloss_vi_reviewed: false,
    });
    expect(result.get('1')?.kanji).toEqual([
      {
        literal: '学',
        readings_vi: ['học'],
        meanings_vi: ['học'],
        meanings_vi_machine: true,
        meanings_vi_reviewed: false,
      },
      {
        literal: '生',
        readings_vi: [],
        meanings_vi: [],
        meanings_vi_machine: false,
        meanings_vi_reviewed: false,
      },
    ]);
    const calls = query.mock.calls as unknown[][];
    const sql = Prisma.sql(
      calls[0][0] as TemplateStringsArray,
      ...calls[0].slice(1),
    );
    expect(sql.values.at(-1)).toBe(2);
  });

  it('keeps absent dictionary glosses null and flags false without falling back to user text', async () => {
    const query = jest.fn().mockResolvedValueOnce([
      {
        sense_id: 1n,
        lemma: 'word',
        reading: null,
        romanization: null,
        pos: 'noun',
        gloss_en: null,
        gloss_vi: null,
        gloss_vi_machine: null,
        gloss_vi_reviewed: null,
      },
    ]);
    const repo = new SenseLookupRepository({
      $queryRaw: query,
    } as unknown as PrismaService);
    expect((await repo.findDisplays([1n], [1])).get('1')).toMatchObject({
      gloss_en: null,
      gloss_vi: null,
      gloss_vi_machine: false,
      gloss_vi_reviewed: false,
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('does not query empty or invisible pages', async () => {
    const query = jest.fn();
    const repo = new SenseLookupRepository({
      $queryRaw: query,
    } as unknown as PrismaService);
    expect((await repo.findDisplays([], [2])).size).toBe(0);
    expect((await repo.findDisplays([1n], [])).size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});
