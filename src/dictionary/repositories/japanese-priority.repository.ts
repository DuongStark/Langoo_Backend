import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import { Prisma } from '../../generated/prisma/client';

export interface JapaneseSensePreference {
  lexeme_id: bigint;
  sense_id: bigint;
  display_order: number;
  recommended: boolean;
  basis: 'curated_learner' | 'source_metadata';
}

/** Bounded batch lookup; BCCWJ is word evidence, never sense frequency. */
@Injectable()
export class JapanesePriorityRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getByLexemes(ids: bigint[]): Promise<JapaneseSensePreference[]> {
    if (ids.length === 0) return [];
    return this.prisma.$queryRaw<JapaneseSensePreference[]>(Prisma.sql`
      WITH candidates AS (
        SELECT s.lexeme_id,s.id AS sense_id,s.sense_no,p.display_order AS curated_order,
          NULLIF(btrim(sc.gloss_vi),'') IS NOT NULL AS has_vi_translation,
          coalesce(s.attributes->'misc','[]'::jsonb) ?| ARRAY['arch','obs','obsc','rare','hist'] AS restricted,
          coalesce(s.attributes->'field','[]'::jsonb) <> '[]'::jsonb AS specialized,
          count(p.sense_id) OVER (PARTITION BY s.lexeme_id) AS curated_count
        FROM core.sense s
        JOIN core.lexeme l ON l.id=s.lexeme_id
        JOIN public.source src ON src.id=l.source_id AND src.code='jmdict'
        JOIN public.language lg ON lg.id=l.language_id AND lg.code='ja'
        LEFT JOIN serve.sense_card sc ON sc.sense_id=s.id
        LEFT JOIN serve.japanese_sense_priority p ON p.sense_id=s.id
        WHERE s.lexeme_id IN (${Prisma.join(ids)})
          AND EXISTS (SELECT 1 FROM core.dictionary_priority_run r
                      WHERE r.active AND r.policy='ja-bccwj-v1' AND r.language_id=l.language_id)
      ), ordered AS (
        SELECT *, row_number() OVER (PARTITION BY lexeme_id
          ORDER BY has_vi_translation DESC, curated_order ASC NULLS LAST,
            restricted, specialized, sense_no, sense_id)::int AS display_order
        FROM candidates
      )
      SELECT lexeme_id,sense_id,display_order,
        CASE WHEN curated_count>0 THEN curated_order IS NOT NULL
             ELSE NOT restricted AND NOT specialized AND display_order<=3 END AS recommended,
        CASE WHEN curated_count>0 THEN 'curated_learner' ELSE 'source_metadata' END AS basis
      FROM ordered ORDER BY lexeme_id,display_order
    `);
  }
}
