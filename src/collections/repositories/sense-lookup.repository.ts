import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import { Prisma } from '../../generated/prisma/client';

export interface SenseLanguageRow {
  sense_id: bigint;
  language_id: number;
  lemma: string;
  concept_id: bigint | null;
}

export interface SensePairRow {
  concept_id: bigint;
  confidence: number;
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
            AND c.status = 'curated'
            AND sc.confidence >= 0.7
          ORDER BY sc.confidence DESC, sc.concept_id ASC
          LIMIT 1
        ) AS concept_id
      FROM core.sense s
      JOIN core.lexeme x ON x.id = s.lexeme_id
      WHERE s.id IN (${Prisma.join(ids)})
    `;
  }

  async hasCuratedConceptMapping(
    senseId: bigint,
    conceptId: bigint,
  ): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ ok: number }[]>`
      SELECT 1 AS ok
      FROM core.sense_concept sc
      JOIN core.concept c ON c.id = sc.concept_id
      WHERE sc.sense_id = ${senseId}
        AND sc.concept_id = ${conceptId}
        AND c.status = 'curated'
        AND sc.confidence >= 0.7
      LIMIT 1
    `;
    return rows.length > 0;
  }

  /**
   * The materialized view is the serving gate. Re-checking the base mappings
   * prevents a stale view from accepting a pair that was later downgraded.
   */
  async findCuratedPair(
    firstSenseId: bigint,
    secondSenseId: bigint,
  ): Promise<SensePairRow | null> {
    const served = await this.prisma.$queryRaw<SensePairRow[]>`
      SELECT concept_id, confidence
      FROM serve.sense_pair
      WHERE (sense_a = ${firstSenseId} AND sense_b = ${secondSenseId})
         OR (sense_a = ${secondSenseId} AND sense_b = ${firstSenseId})
      ORDER BY confidence DESC, concept_id ASC
      LIMIT 1
    `;
    const pair = served[0];
    if (!pair) {
      return null;
    }

    const verified = await this.prisma.$queryRaw<SensePairRow[]>`
      SELECT
        ca.concept_id,
        LEAST(ca.confidence, cb.confidence) AS confidence
      FROM core.sense_concept ca
      JOIN core.sense_concept cb
        ON cb.concept_id = ca.concept_id
       AND cb.sense_id = ${secondSenseId}
      JOIN core.concept c ON c.id = ca.concept_id
      WHERE ca.sense_id = ${firstSenseId}
        AND ca.concept_id = ${pair.concept_id}
        AND c.status = 'curated'
        AND ca.confidence >= 0.7
        AND cb.confidence >= 0.7
      LIMIT 1
    `;
    return verified[0] ?? null;
  }
}
