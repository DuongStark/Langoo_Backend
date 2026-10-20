import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';

export interface ViSourceRow {
  source_lexeme_id: bigint;
  target_text: string;
  sense_hint: string | null;
  source_ordinal: number;
  en_lemma: string;
  en_pos: string | null;
  frequency_rank: number | null;
}

export interface JaTargetRow {
  source_lexeme_id: bigint;
  target_text: string;
  sense_hint: string | null;
  source_ordinal: number;
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
        AND (a.target_text = ${query} OR lower(a.target_text) = ${lowered})
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
    return this.prisma.$queryRaw<ViSourceRow[]>`
      SELECT
        a.source_lexeme_id,
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
        AND public.f_unaccent(lower(a.target_text)) LIKE public.f_unaccent(lower(${query})) || '%'
      ORDER BY
        (lower(a.target_text) = lower(${query})) DESC,
        (lower(a.target_text) LIKE lower(${query}) || '%') DESC,
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
        a.target_text,
        a.sense_hint,
        a.source_ordinal
      FROM core.translation_assertion a
      WHERE a.target_language_id = ${LANGUAGE_ID_JA}
        AND a.source_lexeme_id = ANY(${lexemeIds}::bigint[])
      ORDER BY a.source_lexeme_id ASC, a.source_ordinal ASC
    `;
  }
}
