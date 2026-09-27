import { Injectable } from '@nestjs/common';
import { SearchHistoryRepository } from './repositories/search-history.repository';
import {
  SearchHistoryItem,
  SearchHistoryResult,
} from './types/dictionary.types';

const HISTORY_LIMIT = 50;

@Injectable()
export class SearchHistoryService {
  constructor(private readonly historyRepo: SearchHistoryRepository) {}

  async list(userId: bigint): Promise<SearchHistoryResult> {
    const rows = await this.historyRepo.listRecent(userId, HISTORY_LIMIT);
    return {
      data: rows.map((row): SearchHistoryItem => ({
        id: row.id.toString(),
        raw_query: row.rawQuery,
        normalized: row.normalized,
        language_id: row.languageId,
        matched_sense_id: row.matchedSenseId?.toString() ?? null,
        result_count: row.resultCount,
        created_at: row.createdAt.toISOString(),
      })),
      next_cursor: null,
    };
  }
}
