import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import { Prisma } from '../../generated/prisma/client';

export interface SenseLanguageRow {
  sense_id: bigint;
  language_id: number;
  lemma: string;
  concept_id: bigint | null;
}

/**
 * Tra sense trong `core` để lấy ngôn ngữ (bất biến §5.9: service tự kiểm
 * face.language_id khớp ngôn ngữ của sense — client không gửi language_id).
 */
@Injectable()
export class SenseLookupRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findManyByIds(ids: bigint[]): Promise<SenseLanguageRow[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.prisma.$queryRaw<SenseLanguageRow[]>`
      SELECT
        s.id AS sense_id,
        x.language_id,
        x.lemma,
        (
          SELECT sc.concept_id
          FROM core.sense_concept sc
          JOIN core.concept c ON c.id = sc.concept_id
          WHERE sc.sense_id = s.id
          ORDER BY (c.status = 'curated') DESC, sc.confidence DESC
          LIMIT 1
        ) AS concept_id
      FROM core.sense s
      JOIN core.lexeme x ON x.id = s.lexeme_id
      WHERE s.id IN (${Prisma.join(ids)})
    `;
  }

  async conceptExists(id: bigint): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ ok: number }[]>`
      SELECT 1 AS ok FROM core.concept WHERE id = ${id}
    `;
    return rows.length > 0;
  }
}
