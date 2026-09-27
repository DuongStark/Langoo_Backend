import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../db/prisma.service';

export interface DistractorRow {
  word: string;
  meaning_vi: string;
  collection_id: string;
  sense_id: bigint;
}

/**
 * Nguồn dữ liệu cho phiên ôn: câu nhiễu (distractor) lấy từ sổ tay của chính user
 * (cùng ngôn ngữ), ưu tiên cùng collection với thẻ đang học.
 */
@Injectable()
export class SessionSourceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findDistractors(params: {
    userId: bigint;
    languageId: number;
    excludeSenseIds: bigint[];
    limit: number;
  }): Promise<DistractorRow[]> {
    const exclude =
      params.excludeSenseIds.length > 0
        ? Prisma.sql`AND f.sense_id NOT IN (${Prisma.join(params.excludeSenseIds)})`
        : Prisma.sql``;

    return this.prisma.$queryRaw<DistractorRow[]>`
      SELECT lx.lemma AS word, i.meaning_vi, c.id AS collection_id, f.sense_id
      FROM app.collection_item i
      JOIN app.collection c ON c.id = i.collection_id
      JOIN app.collection_item_face f ON f.item_id = i.id
      JOIN core.sense se ON se.id = f.sense_id
      JOIN core.lexeme lx ON lx.id = se.lexeme_id
      WHERE c.owner_id = ${params.userId}
        AND c.archived_at IS NULL
        AND i.status <> 'paused'
        AND lx.language_id = ${params.languageId}
        ${exclude}
      LIMIT ${params.limit}
    `;
  }

  /** Dựng pool câu nhiễu cho 1 ngôn ngữ, ưu tiên collection đang học. */
  async buildPool(params: {
    userId: bigint;
    languageId: number;
    excludeSenseIds: bigint[];
    preferredCollectionIds: string[];
    limit?: number;
  }): Promise<{ words: string[]; meanings: string[] }> {
    const rows = await this.findDistractors({
      userId: params.userId,
      languageId: params.languageId,
      excludeSenseIds: params.excludeSenseIds,
      limit: (params.limit ?? 20) * 3,
    });

    const preferred = new Set(params.preferredCollectionIds);
    const sorted = [
      ...rows.filter((row) => preferred.has(row.collection_id)),
      ...rows.filter((row) => !preferred.has(row.collection_id)),
    ];

    return {
      words: sorted.map((row) => row.word),
      meanings: sorted.map((row) => row.meaning_vi),
    };
  }
}
