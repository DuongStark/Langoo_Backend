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
 * View đã materialize cả hai chiều nên chỉ đọc nhánh sense_a để tránh nhân đôi.
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
      ORDER BY confidence DESC, sense_id ASC
    `;
  }
}
