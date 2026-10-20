import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import { Prisma } from '../../generated/prisma/client';

export interface SenseLinkRow {
  sense_id: bigint;
  lexeme_id: bigint;
  language_id: number;
  lang_code: string;
  lemma: string;
  reading: string | null;
  romanization: string | null;
  confidence: number;
  concept_id: bigint;
}

/**
 * Published links with live exact/curated gates and Vietnamese on the target
 * sense. Ordered candidates, not the public capped list: the service checks
 * shared search visibility and distinct words before taking three.
 */
@Injectable()
export class SensePairRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findLinks(
    senseId: bigint,
    allowedLanguageIds?: number[],
  ): Promise<SenseLinkRow[]> {
    if (allowedLanguageIds?.length === 0) return [];
    return this.prisma.$queryRaw<SenseLinkRow[]>(Prisma.sql`
      SELECT
        sb.id AS sense_id,
        lb.id AS lexeme_id,
        lb.language_id,
        lang.code AS lang_code,
        lb.lemma,
        lb.reading,
        lb.romanization,
        least(ca.confidence,cb.confidence) AS confidence,
        sp.concept_id
      FROM serve.sense_pair sp
      JOIN core.sense sa ON sa.id=sp.sense_a
      JOIN core.lexeme la ON la.id=sa.lexeme_id
      JOIN core.sense sb ON sb.id = sp.sense_b
      JOIN core.lexeme lb ON lb.id = sb.lexeme_id
      JOIN public.language lang ON lang.id=lb.language_id
      LEFT JOIN public.source src ON src.id=lb.source_id
      JOIN core.concept c ON c.id=sp.concept_id AND c.status='curated'
      JOIN core.sense_concept ca
        ON ca.sense_id=sp.sense_a AND ca.concept_id=sp.concept_id
          AND ca.relation='exact' AND ca.confidence>=0.7::real
      JOIN core.sense_concept cb
        ON cb.sense_id=sp.sense_b AND cb.concept_id=sp.concept_id
          AND cb.relation='exact' AND cb.confidence>=0.7::real
      LEFT JOIN LATERAL (
        SELECT p.corpus_rank FROM serve.japanese_lexeme_priority p
        WHERE p.lexeme_id=lb.id AND lang.code='ja'
        LIMIT 1
      ) jp ON true
      WHERE sp.sense_a = ${senseId}
        AND la.language_id<>lb.language_id
        AND lang.code IN ('en','ja')
        AND (lang.code<>'ja' OR (src.code='jmdict' AND nullif(btrim(lb.reading),'') IS NOT NULL))
        AND EXISTS (
          SELECT 1 FROM core.sense_gloss g
          JOIN public.language gl ON gl.id=g.language_id AND gl.code='vi'
          WHERE g.sense_id=sb.id AND nullif(btrim(g.text),'') IS NOT NULL
        )
        ${allowedLanguageIds === undefined ? Prisma.sql`` : Prisma.sql`AND la.language_id IN (${Prisma.join(allowedLanguageIds)}) AND lb.language_id IN (${Prisma.join(allowedLanguageIds)})`}
      ORDER BY
        coalesce(jp.corpus_rank,lb.frequency_rank,
          CASE WHEN lang.code='ja' AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(
              coalesce(lb.attributes->'kanji','[]'::jsonb) || coalesce(lb.attributes->'kana','[]'::jsonb)
            ) form WHERE form->>'common'='true'
          ) THEN 2147483645 ELSE 2147483647 END),
        confidence DESC, sense_id ASC, sp.concept_id ASC
    `);
  }
}
