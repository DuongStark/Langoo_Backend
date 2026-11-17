import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';

export interface ViSourceRow {
  source_lexeme_id: bigint;
  assertion_id: bigint;
  source_sense_id: bigint | null;
  target_text: string;
  sense_hint: string | null;
  source_ordinal: number;
  en_lemma: string;
  en_pos: string | null;
  frequency_rank: number | null;
}

export interface JaTargetRow {
  source_lexeme_id: bigint;
  assertion_id: bigint;
  source_sense_id: bigint | null;
  target_text: string;
  sense_hint: string | null;
  source_ordinal: number;
}

export interface ReverseReferenceRequest {
  key: string;
  kind: 'en' | 'ja';
  source_lexeme_id: string;
  source_sense_id: string | null;
  assertion_id: string | null;
  text: string;
  hint: string | null;
}

export interface ReverseReferenceCandidate {
  key: string;
  lexeme_id: bigint;
  sense_id: bigint | null;
  evidence_priority: number;
  source_priority: number;
}

const LANGUAGE_ID_EN = 1;
const LANGUAGE_ID_JA = 2;
const LANGUAGE_ID_VI = 3;

/**
 * Tra ngược Việt→Anh/Nhật từ `core.translation_assertion`:
 *  - VI: assertion đích tiếng Việt (language_id=3) → source lexeme tiếng Anh
 *  - JA: assertion đích tiếng Nhật (language_id=2) của cùng source lexeme
 * Chỉ đọc core; index (target_language_id, target_text) + (source_lexeme_id, source_sense_id).
 */
@Injectable()
export class ReverseLookupRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findViSources(query: string, lowered: string): Promise<ViSourceRow[]> {
    return this.prisma.$queryRaw<ViSourceRow[]>`
      SELECT
        a.source_lexeme_id,
        a.id AS assertion_id,
        a.source_sense_id,
        a.target_text,
        a.sense_hint,
        a.source_ordinal,
        l.lemma AS en_lemma,
        l.pos AS en_pos,
        l.frequency_rank
      FROM core.translation_assertion a
      JOIN core.lexeme l ON l.id = a.source_lexeme_id
      WHERE a.target_language_id = ${LANGUAGE_ID_VI}
        AND l.language_id = ${LANGUAGE_ID_EN}
        AND (
          (a.target_text = ${query} OR lower(a.target_text) = ${lowered})
          OR (public.f_unaccent(lower(a.target_text)) = public.f_unaccent(${lowered})
            AND NOT EXISTS (
              SELECT 1 FROM core.translation_assertion exact_a
              JOIN core.lexeme exact_l ON exact_l.id = exact_a.source_lexeme_id
              WHERE exact_a.target_language_id = ${LANGUAGE_ID_VI}
                AND exact_l.language_id = ${LANGUAGE_ID_EN}
                AND lower(exact_a.target_text) = ${lowered}
            ))
        )
      ORDER BY l.frequency_rank ASC NULLS LAST, a.source_lexeme_id ASC, a.source_ordinal ASC
      LIMIT 50
    `;
  }

  /**
   * Prefix VI (không phân biệt hoa/thường & dấu) → source EN lexemes.
   * Dùng cho autocomplete VI→EN/JA; bảng chỉ ~29k assertion VI nên seq scan ổn.
   */
  async findViSourcesByPrefix(
    query: string,
    limit = 200,
  ): Promise<ViSourceRow[]> {
    const pattern = query.replace(/[\\%_]/g, '\\$&') + '%';
    return this.prisma.$queryRaw<ViSourceRow[]>`
      SELECT
        a.source_lexeme_id,
        a.id AS assertion_id,
        a.source_sense_id,
        a.target_text,
        a.sense_hint,
        a.source_ordinal,
        l.lemma AS en_lemma,
        l.pos AS en_pos,
        l.frequency_rank
      FROM core.translation_assertion a
      JOIN core.lexeme l ON l.id = a.source_lexeme_id
      WHERE a.target_language_id = ${LANGUAGE_ID_VI}
        AND l.language_id = ${LANGUAGE_ID_EN}
        AND public.f_unaccent(lower(a.target_text)) LIKE public.f_unaccent(lower(${pattern})) ESCAPE '\\'
      ORDER BY
        (lower(a.target_text) = lower(${query})) DESC,
        (lower(a.target_text) LIKE lower(${pattern}) ESCAPE '\\') DESC,
        length(a.target_text) ASC,
        l.frequency_rank ASC NULLS LAST,
        a.source_lexeme_id ASC,
        a.source_ordinal ASC
      LIMIT ${limit}
    `;
  }

  async findJaTargets(lexemeIds: bigint[]): Promise<JaTargetRow[]> {
    if (lexemeIds.length === 0) return [];
    return this.prisma.$queryRaw<JaTargetRow[]>`
      SELECT
        a.source_lexeme_id,
        a.id AS assertion_id,
        a.source_sense_id,
        a.target_text,
        a.sense_hint,
        a.source_ordinal
      FROM core.translation_assertion a
      WHERE a.target_language_id = ${LANGUAGE_ID_JA}
        AND a.source_lexeme_id = ANY(${lexemeIds}::bigint[])
      ORDER BY a.source_lexeme_id ASC, a.source_ordinal ASC
    `;
  }
  /** One bounded page query. Never trusts pending mappings or a first-sense fallback. */
  async findReferenceCandidates(
    requests: ReverseReferenceRequest[],
  ): Promise<ReverseReferenceCandidate[]> {
    if (requests.length === 0) return [];
    return this.prisma.$queryRaw<ReverseReferenceCandidate[]>`
      WITH requests AS MATERIALIZED (
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(requests)}::jsonb)
        AS r(key text,kind text,source_lexeme_id bigint,source_sense_id bigint,
             assertion_id bigint,text text,hint text)
      )
      SELECT r.key,s.lexeme_id,s.id AS sense_id,
             CASE WHEN s.id=r.source_sense_id THEN 0 ELSE 1 END::int AS evidence_priority,
             0::int AS source_priority
      FROM requests r
      JOIN core.lexeme l ON l.id=r.source_lexeme_id AND l.language_id=1
      JOIN core.sense s ON s.lexeme_id=l.id
      WHERE r.kind='en' AND (
        (r.source_sense_id IS NOT NULL AND s.id=r.source_sense_id)
        OR (r.source_sense_id IS NULL AND nullif(btrim(r.hint),'') IS NOT NULL AND (
          (s.definition_language_id=1 AND lower(btrim(s.definition))=lower(btrim(r.hint)))
          OR EXISTS(SELECT 1 FROM core.sense_gloss g WHERE g.sense_id=s.id AND g.language_id=1
                    AND lower(btrim(g.text))=lower(btrim(r.hint)))
        ))
        OR (r.source_sense_id IS NULL AND nullif(btrim(r.hint),'') IS NULL
            AND (SELECT count(*) FROM core.sense one_s WHERE one_s.lexeme_id=l.id)=1)
      )
      UNION ALL
      SELECT r.key,l.id AS lexeme_id,s.id AS sense_id,
        CASE
          WHEN EXISTS(SELECT 1 FROM core.translation_target_candidate tc
            WHERE tc.assertion_id=r.assertion_id AND tc.decision='accepted'
              AND tc.target_sense_id=s.id
              AND (tc.target_lexeme_id IS NULL OR tc.target_lexeme_id=l.id)) THEN 0
          WHEN nullif(btrim(r.hint),'') IS NOT NULL AND (
            (s.definition_language_id=1 AND lower(btrim(s.definition))=lower(btrim(r.hint)))
            OR EXISTS(SELECT 1 FROM core.sense_gloss g WHERE g.sense_id=s.id AND g.language_id=1
                      AND lower(btrim(g.text))=lower(btrim(r.hint)))
          ) THEN 1
          WHEN EXISTS(SELECT 1 FROM core.sense source_s
            JOIN core.sense_concept a ON a.sense_id=source_s.id
              AND a.relation='exact' AND a.verified AND a.confidence>=0.7::real
            JOIN core.concept c ON c.id=a.concept_id AND c.status='curated'
            JOIN core.sense_concept b ON b.concept_id=c.id AND b.sense_id=s.id
              AND b.relation='exact' AND b.verified AND b.confidence>=0.7::real
            WHERE source_s.id=r.source_sense_id AND source_s.lexeme_id=r.source_lexeme_id) THEN 2
          WHEN s.id IS NOT NULL AND (SELECT count(*) FROM core.sense one_s WHERE one_s.lexeme_id=l.id)=1 THEN 3
          ELSE 100
        END::int AS evidence_priority,
        CASE WHEN src.code='jmdict' THEN 0 ELSE 1 END::int AS source_priority
      FROM requests r
      JOIN LATERAL (
        SELECT word.id FROM core.lexeme word WHERE word.language_id=2 AND word.lemma=r.text
        UNION
        SELECT form.lexeme_id FROM core.lexeme_form form WHERE form.form_text=r.text AND form.kind IN ('kanji','kana')
      ) identity ON r.kind='ja'
      JOIN core.lexeme l ON l.id=identity.id AND l.language_id=2
        AND coalesce(l.attributes->>'wikt_pos','')<>'romanization'
      LEFT JOIN public.source src ON src.id=l.source_id
      LEFT JOIN core.sense s ON s.lexeme_id=l.id AND (
        NOT EXISTS(SELECT 1 FROM core.sense_form sf WHERE sf.sense_id=s.id)
        OR EXISTS(SELECT 1 FROM core.sense_form sf JOIN core.lexeme_form f ON f.id=sf.form_id
                  WHERE sf.sense_id=s.id AND f.lexeme_id=l.id AND f.form_text=r.text)
      )
    `;
  }
}
