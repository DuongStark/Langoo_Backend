import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';

export interface SenseLinkRow {
  sense_id: bigint;
  language_id: number;
  lemma: string;
  reading: string | null;
  romanization: string | null;
  confidence: number;
  concept_id: bigint;
}

/**
 * Cặp sense khác ngôn ngữ cùng concept — `serve.sense_pair` (matview đã cổng curated).
 * Truy vấn 2 chiều (sense đang xem có thể nằm ở cột a hoặc b).
 */
@Injectable()
export class SensePairRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findLinks(senseId: bigint): Promise<SenseLinkRow[]> {
    return this.prisma.$queryRaw<SenseLinkRow[]>`
      SELECT
        sb.id AS sense_id,
        lb.language_id,
        lb.lemma,
        lb.reading,
        lb.romanization,
        sp.confidence,
        sp.concept_id
      FROM serve.sense_pair sp
      JOIN core.sense sb ON sb.id = sp.sense_b
      JOIN core.lexeme lb ON lb.id = sb.lexeme_id
      WHERE sp.sense_a = ${senseId}

      UNION ALL

      SELECT
        sa.id AS sense_id,
        la.language_id,
        la.lemma,
        la.reading,
        la.romanization,
        sp.confidence,
        sp.concept_id
      FROM serve.sense_pair sp
      JOIN core.sense sa ON sa.id = sp.sense_a
      JOIN core.lexeme la ON la.id = sa.lexeme_id
      WHERE sp.sense_b = ${senseId}

      ORDER BY confidence DESC
    `;
  }
}
