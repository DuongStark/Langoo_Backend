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
 * trong **đúng profile** đang học (cùng ngôn ngữ), ưu tiên cùng collection với thẻ
 * đang học. Ưu tiên collection được đẩy vào SQL trước LIMIT để không bị cắt mất
 * khi có nhiều collection khác profile/thứ tự.
 */
@Injectable()
export class SessionSourceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findDistractors(params: {
    userId: bigint;
    profileId: string;
    languageId: number;
    excludeSenseIds: bigint[];
    preferredCollectionIds: string[];
    limit: number;
  }): Promise<DistractorRow[]> {
    const exclude =
      params.excludeSenseIds.length > 0
        ? Prisma.sql`AND f.sense_id NOT IN (${Prisma.join(params.excludeSenseIds)})`
        : Prisma.sql``;
    const orderBy =
      params.preferredCollectionIds.length === 0
        ? Prisma.sql`i.id`
        : Prisma.sql`CASE WHEN c.id::text IN (${Prisma.join(
            params.preferredCollectionIds,
          )}) THEN 0 ELSE 1 END, i.id`;

    return this.prisma.$queryRaw<DistractorRow[]>`
      SELECT lx.lemma AS word, i.meaning_vi, c.id AS collection_id, f.sense_id
      FROM app.collection_item i
      JOIN app.collection c ON c.id = i.collection_id
      JOIN app.collection_item_face f ON f.item_id = i.id
      JOIN core.sense se ON se.id = f.sense_id
      JOIN core.lexeme lx ON lx.id = se.lexeme_id
      WHERE c.owner_id = ${params.userId}
        AND c.profile_id = ${params.profileId}::uuid
        AND c.archived_at IS NULL
        AND i.status <> 'paused'
        AND lx.language_id = ${params.languageId}
        ${exclude}
      ORDER BY ${orderBy}
      LIMIT ${params.limit}
    `;
  }

  /** Dựng pool câu nhiễu cho 1 ngôn ngữ trong 1 profile, ưu tiên collection đang học. */
  async buildPool(params: {
    userId: bigint;
    profileId: string;
    languageId: number;
    excludeSenseIds: bigint[];
    preferredCollectionIds: string[];
    limit?: number;
  }): Promise<{ words: string[]; meanings: string[] }> {
    const rows = await this.findDistractors({
      userId: params.userId,
      profileId: params.profileId,
      languageId: params.languageId,
      excludeSenseIds: params.excludeSenseIds,
      preferredCollectionIds: params.preferredCollectionIds,
      limit: (params.limit ?? 20) * 3,
    });

    return {
      words: rows.map((row) => row.word),
      meanings: rows.map((row) => row.meaning_vi),
    };
  }
}
