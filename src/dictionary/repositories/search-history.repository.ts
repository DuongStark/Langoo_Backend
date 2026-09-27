import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';

export interface CreateSearchHistoryEntry {
  userId: bigint;
  rawQuery: string;
  normalized: string;
  languageId: number | null;
  resultCount: number;
}

/**
 * Lịch sử tra từ của người học — `app.search_history` (schema app, ghi qua Prisma).
 * Việc dọn còn 50 dòng/user là job định kỳ (chưa làm ở M4 — xem backlog).
 */
@Injectable()
export class SearchHistoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(entry: CreateSearchHistoryEntry): Promise<{ id: bigint }> {
    return this.prisma.searchHistory.create({
      data: {
        userId: entry.userId,
        rawQuery: entry.rawQuery,
        normalized: entry.normalized,
        languageId: entry.languageId,
        matchedSenseId: null,
        resultCount: entry.resultCount,
      },
      select: { id: true },
    });
  }

  listRecent(userId: bigint, take: number) {
    return this.prisma.searchHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }
}
