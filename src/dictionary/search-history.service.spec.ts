import { SearchHistoryRepository } from './repositories/search-history.repository';
import { SearchHistoryService } from './search-history.service';

describe('SearchHistoryService', () => {
  it('trả 50 dòng gần nhất, map id/bigint → chuỗi', async () => {
    const listRecent = jest.fn();
    listRecent.mockResolvedValue([
      {
        id: 3n,
        userId: 1n,
        rawQuery: 'run',
        normalized: 'run',
        languageId: 1,
        matchedSenseId: null,
        resultCount: 4,
        createdAt: new Date('2026-09-27T00:00:00.000Z'),
      },
    ]);
    const repo = {
      listRecent,
      create: jest.fn(),
    } as unknown as SearchHistoryRepository;
    const service = new SearchHistoryService(repo);

    const result = await service.list(7n);

    expect(listRecent).toHaveBeenCalledWith(7n, 50);
    expect(result.data[0]).toEqual({
      id: '3',
      raw_query: 'run',
      normalized: 'run',
      language_id: 1,
      matched_sense_id: null,
      result_count: 4,
      created_at: '2026-09-27T00:00:00.000Z',
    });
    expect(result.next_cursor).toBeNull();
  });
});
