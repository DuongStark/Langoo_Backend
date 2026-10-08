import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../db/prisma.service';
import { SenseCard, SenseCardRow } from '../types/sense-card';

/**
 * Đọc `serve.sense_card` (view read-model — schema serve KHÔNG map trong Prisma).
 * Liệt kê cột rõ ràng, không SELECT *.
 */
@Injectable()
export class SenseCardRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getBySenseId(senseId: bigint): Promise<SenseCard | null> {
    const rows = await this.prisma.$queryRaw<SenseCardRow[]>`
      SELECT
        sc.sense_id,
        sc.lexeme_id,
        sc.language_id,
        sc.lemma,
        sc.reading,
        sc.romanization,
        sc.pos,
        sc.frequency_rank,
        sc.homograph_no,
        sc.sense_no,
        sc.definition,
        sc.definition_language_id,
        sc.register,
        sc.domain,
        sc.is_primary,
        sc.gloss_vi,
        sc.gloss_vi_machine,
        sc.gloss_vi_reviewed,
        sc.gloss_en,
        sc.gloss_en_context,
        sc.gloss_en_is_hierarchy,
        sc.concept_id
      FROM serve.sense_card sc
      WHERE sc.sense_id = ${senseId}
    `;

    const [row] = rows;
    return row ? toSenseCard(row) : null;
  }

  async getBySenseIds(ids: bigint[]): Promise<SenseCard[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.$queryRaw<SenseCardRow[]>(Prisma.sql`
      SELECT
        sc.sense_id,
        sc.lexeme_id,
        sc.language_id,
        sc.lemma,
        sc.reading,
        sc.romanization,
        sc.pos,
        sc.frequency_rank,
        sc.homograph_no,
        sc.sense_no,
        sc.definition,
        sc.definition_language_id,
        sc.register,
        sc.domain,
        sc.is_primary,
        sc.gloss_vi,
        sc.gloss_vi_machine,
        sc.gloss_vi_reviewed,
        sc.gloss_en,
        sc.gloss_en_context,
        sc.gloss_en_is_hierarchy,
        sc.concept_id
      FROM serve.sense_card sc
      WHERE sc.sense_id IN (${Prisma.join(ids)})
    `);
    return rows.map(toSenseCard);
  }

  async hasLexeme(lexemeId: bigint): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
      SELECT id
      FROM core.lexeme
      WHERE id = ${lexemeId}
      LIMIT 1
    `;
    return rows.length > 0;
  }

  async getByLexemeId(lexemeId: bigint): Promise<SenseCard[]> {
    const rows = await this.prisma.$queryRaw<SenseCardRow[]>`
      SELECT
        sc.sense_id,
        sc.lexeme_id,
        sc.language_id,
        sc.lemma,
        sc.reading,
        sc.romanization,
        sc.pos,
        sc.frequency_rank,
        sc.homograph_no,
        sc.sense_no,
        sc.definition,
        sc.definition_language_id,
        sc.register,
        sc.domain,
        sc.is_primary,
        sc.gloss_vi,
        sc.gloss_vi_machine,
        sc.gloss_vi_reviewed,
        sc.gloss_en,
        sc.gloss_en_context,
        sc.gloss_en_is_hierarchy,
        sc.concept_id
      FROM serve.sense_card sc
      WHERE sc.lexeme_id = ${lexemeId}
      ORDER BY sc.sense_no ASC, sc.sense_id ASC
    `;

    return rows.map(toSenseCard);
  }
}

function toSenseCard(row: SenseCardRow): SenseCard {
  return {
    senseId: row.sense_id,
    lexemeId: row.lexeme_id,
    languageId: row.language_id,
    lemma: row.lemma,
    reading: row.reading,
    romanization: row.romanization,
    pos: row.pos,
    frequencyRank: row.frequency_rank,
    homographNo: row.homograph_no,
    senseNo: row.sense_no,
    definition: row.definition,
    definitionLanguageId: row.definition_language_id,
    register: row.register,
    domain: row.domain,
    isPrimary: row.is_primary,
    glossVi: row.gloss_vi,
    glossViMachine: row.gloss_vi_machine,
    glossViReviewed: row.gloss_vi_reviewed,
    glossEn: row.gloss_en,
    glossEnContext: row.gloss_en_context ?? [],
    glossEnIsHierarchy: row.gloss_en_is_hierarchy === true,
    conceptId: row.concept_id,
  };
}
