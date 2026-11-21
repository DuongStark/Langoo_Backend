import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import { Prisma } from '../../generated/prisma/client';

export interface ImportLexemeCandidate {
  lexeme_id: bigint;
  language_id: number;
  lemma: string;
  reading: string | null;
  pos: string | null;
  frequency_rank: number | null;
  match_source: number; // 1=lemma, 2=lexeme_form, 3=reading
  matched_key: string;
  is_jmdict: boolean;
  has_vi_gloss: boolean;
  en_learner_rank: number | null;
}

export interface ImportTopSenseRow {
  lexeme_id: bigint;
  sense_id: bigint;
  language_id: number;
  lemma: string;
  reading: string | null;
  pos: string | null;
  concept_id: bigint | null;
  meaning_vi: string;
  meaning_source: 'machine' | 'source';
}

/**
 * Tra cứu từ điển theo lô (chỉ đọc `core`/`serve`) phục vụ M5.3 Auto Import List.
 * Tận dụng trực tiếp B-tree index `lexeme_lemma_prefix`, `lexeme_reading_lookup`,
 * `sense_order_per_lexeme`, `sense_gloss_language` và bảng xếp hạng M10.5/M4.5.
 */
@Injectable()
export class ItemImportLookupRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * M4.9: Definition các sense của lexeme JA nguồn `wiktextract` (vd "polite form of 読む (yomu)")
   * để nhận ra mục "dạng chia" khi import khớp exact vào mục đó.
   */
  async findWiktionaryDefinitions(
    lexemeIds: bigint[],
  ): Promise<{ lexeme_id: bigint; definition: string }[]> {
    if (lexemeIds.length === 0) return [];
    return this.prisma.$queryRaw<{ lexeme_id: bigint; definition: string }[]>(
      Prisma.sql`
        SELECT s.lexeme_id, s.definition
        FROM core.sense s
        JOIN core.lexeme l ON l.id = s.lexeme_id
        JOIN public.source src ON src.id = l.source_id
        WHERE s.lexeme_id = ANY(${lexemeIds}::bigint[])
          AND l.language_id = 2
          AND src.code = 'wiktextract'
          AND s.definition IS NOT NULL
        ORDER BY s.lexeme_id, s.sense_no
      `,
    );
  }

  async findLexemeCandidates(
    lookupWords: string[],
    kanaReadings: string[],
    allowedLanguageIds: number[],
  ): Promise<ImportLexemeCandidate[]> {
    if (lookupWords.length === 0 || allowedLanguageIds.length === 0) {
      return [];
    }

    const includeReadingBranch =
      allowedLanguageIds.includes(2) && kanaReadings.length > 0;

    const readingUnion = includeReadingBranch
      ? Prisma.sql`
        UNION ALL
        SELECT
          l.id AS lexeme_id,
          l.language_id,
          l.lemma,
          l.reading,
          l.pos,
          l.frequency_rank,
          l.source_id,
          l.attributes,
          3 AS match_source,
          l.reading AS matched_key
        FROM core.lexeme l
        WHERE l.language_id = 2
          AND l.reading = ANY(${kanaReadings}::text[])
      `
      : Prisma.sql``;

    return this.prisma.$queryRaw<ImportLexemeCandidate[]>(Prisma.sql`
      WITH matched_lexemes AS (
        SELECT
          l.id AS lexeme_id,
          l.language_id,
          l.lemma,
          l.reading,
          l.pos,
          l.frequency_rank,
          l.source_id,
          l.attributes,
          1 AS match_source,
          l.lemma AS matched_key
        FROM core.lexeme l
        WHERE l.language_id = ANY(${allowedLanguageIds}::smallint[])
          AND l.lemma = ANY(${lookupWords}::text[])
        UNION ALL
        SELECT
          l.id AS lexeme_id,
          l.language_id,
          l.lemma,
          l.reading,
          l.pos,
          l.frequency_rank,
          l.source_id,
          l.attributes,
          2 AS match_source,
          f.form_text AS matched_key
        FROM core.lexeme_form f
        JOIN core.lexeme l ON l.id = f.lexeme_id
        WHERE l.language_id = ANY(${allowedLanguageIds}::smallint[])
          AND f.form_text = ANY(${lookupWords}::text[])
        ${readingUnion}
      )
      SELECT
        m.lexeme_id,
        m.language_id,
        m.lemma,
        m.reading,
        m.pos,
        m.frequency_rank,
        MIN(m.match_source)::int AS match_source,
        m.matched_key,
        COALESCE(src.code = 'jmdict', false) AS is_jmdict,
        EXISTS (
          SELECT 1
          FROM core.sense s
          JOIN core.sense_gloss g ON g.sense_id = s.id AND g.language_id = 3
          WHERE s.lexeme_id = m.lexeme_id
        ) AS has_vi_gloss,
        (
          SELECT MIN(p.display_order)::int
          FROM core.sense s
          JOIN serve.english_sense_priority p ON p.sense_id = s.id
          WHERE s.lexeme_id = m.lexeme_id
            AND m.language_id = 1
        ) AS en_learner_rank
      FROM matched_lexemes m
      LEFT JOIN public.source src ON src.id = m.source_id
      WHERE NOT (
          m.language_id = 2
          AND COALESCE(m.attributes->>'wikt_pos', '') = 'romanization'
        )
        AND EXISTS (SELECT 1 FROM core.sense s WHERE s.lexeme_id = m.lexeme_id)
      GROUP BY
        m.lexeme_id,
        m.language_id,
        m.lemma,
        m.reading,
        m.pos,
        m.frequency_rank,
        m.matched_key,
        src.code
    `);
  }

  /**
   * Chọn đúng 1 sense tốt nhất cho mỗi lexeme thắng cuộc theo đúng quy tắc
   * M10.5 (EN) / M4.5 (JA) + nghĩa tiếng Việt gọn theo policy DeckRepository.
   */
  async findTopSensesByLexemeIds(
    lexemeIds: bigint[],
  ): Promise<ImportTopSenseRow[]> {
    if (lexemeIds.length === 0) return [];
    return this.prisma.$queryRaw<ImportTopSenseRow[]>(Prisma.sql`
      WITH sense_candidates AS (
        SELECT
          s.lexeme_id,
          s.id AS sense_id,
          l.language_id,
          l.lemma,
          l.reading,
          l.pos,
          s.sense_no,
          COALESCE(ep.display_order, jp.display_order) AS curated_order,
          NULLIF(btrim(vi.text), '') IS NOT NULL AS has_vi_translation,
          COALESCE(s.attributes->'misc', '[]'::jsonb) ?| ARRAY['arch','obs','obsc','rare','hist'] AS restricted,
          COALESCE(s.attributes->'field', '[]'::jsonb) <> '[]'::jsonb AS specialized,
          COALESCE(NULLIF(btrim(vi.text), ''), NULLIF(btrim(en.text), ''), l.lemma) AS meaning_vi,
          CASE
            WHEN NULLIF(btrim(vi.text), '') IS NOT NULL
              AND vi.is_machine
              AND vi.reviewed_by IS NULL
              THEN 'machine'
            ELSE 'source'
          END AS meaning_source
        FROM core.sense s
        JOIN core.lexeme l ON l.id = s.lexeme_id
        LEFT JOIN serve.english_sense_priority ep
          ON ep.sense_id = s.id AND l.language_id = 1
        LEFT JOIN serve.japanese_sense_priority jp
          ON jp.sense_id = s.id AND l.language_id = 2
        LEFT JOIN LATERAL (
          SELECT g.text, g.is_machine, g.reviewed_by
          FROM core.sense_gloss g
          WHERE g.sense_id = s.id AND g.language_id = 3
          ORDER BY (g.reviewed_by IS NOT NULL) DESC, g.is_machine ASC, g.rank ASC
          LIMIT 1
        ) vi ON true
        LEFT JOIN LATERAL (
          SELECT g.text
          FROM core.sense_gloss g
          WHERE g.sense_id = s.id AND g.language_id = 1
          ORDER BY (g.reviewed_by IS NOT NULL) DESC, g.is_machine ASC, g.rank ASC
          LIMIT 1
        ) en ON true
        WHERE s.lexeme_id = ANY(${lexemeIds}::bigint[])
      ),
      ranked AS (
        SELECT
          *,
          row_number() OVER (
            PARTITION BY lexeme_id
            ORDER BY
              CASE WHEN language_id = 1 THEN curated_order END ASC NULLS LAST,
              has_vi_translation DESC,
              CASE WHEN language_id = 2 THEN curated_order END ASC NULLS LAST,
              restricted ASC,
              specialized ASC,
              sense_no ASC,
              sense_id ASC
          ) AS rn
        FROM sense_candidates
      )
      SELECT
        r.lexeme_id,
        r.sense_id,
        r.language_id,
        r.lemma,
        r.reading,
        r.pos,
        (
          SELECT sc.concept_id
          FROM core.sense_concept sc
          JOIN core.concept c ON c.id = sc.concept_id
          WHERE sc.sense_id = r.sense_id
            AND c.status = 'curated'
            AND sc.confidence >= 0.7
          ORDER BY sc.confidence DESC, sc.concept_id ASC
          LIMIT 1
        ) AS concept_id,
        r.meaning_vi,
        r.meaning_source
      FROM ranked r
      WHERE r.rn = 1
    `);
  }

  /**
   * Kiểm tra nhanh xem các từ không khớp trong hồ sơ có tồn tại ở ngôn ngữ khác không
   * để phân biệt `language_not_in_profile` vs `not_in_dictionary`.
   */
  async findExistingWordsInLanguages(
    lookupWords: string[],
    kanaReadings: string[],
    languageIds: number[],
  ): Promise<Set<string>> {
    if (lookupWords.length === 0 || languageIds.length === 0) {
      return new Set();
    }

    const includeReadingBranch =
      languageIds.includes(2) && kanaReadings.length > 0;

    const readingUnion = includeReadingBranch
      ? Prisma.sql`
        UNION ALL
        SELECT l.reading AS matched_key
        FROM core.lexeme l
        WHERE l.language_id = 2
          AND l.reading = ANY(${kanaReadings}::text[])
          AND EXISTS (SELECT 1 FROM core.sense s WHERE s.lexeme_id = l.id)
      `
      : Prisma.sql``;

    const rows = await this.prisma.$queryRaw<{ matched_key: string }[]>(
      Prisma.sql`
        SELECT DISTINCT matched_key FROM (
          SELECT l.lemma AS matched_key
          FROM core.lexeme l
          WHERE l.language_id = ANY(${languageIds}::smallint[])
            AND l.lemma = ANY(${lookupWords}::text[])
            AND NOT (
              l.language_id = 2
              AND COALESCE(l.attributes->>'wikt_pos', '') = 'romanization'
            )
            AND EXISTS (SELECT 1 FROM core.sense s WHERE s.lexeme_id = l.id)
          UNION ALL
          SELECT f.form_text AS matched_key
          FROM core.lexeme_form f
          JOIN core.lexeme l ON l.id = f.lexeme_id
          WHERE l.language_id = ANY(${languageIds}::smallint[])
            AND f.form_text = ANY(${lookupWords}::text[])
            AND NOT (
              l.language_id = 2
              AND COALESCE(l.attributes->>'wikt_pos', '') = 'romanization'
            )
            AND EXISTS (SELECT 1 FROM core.sense s WHERE s.lexeme_id = l.id)
          ${readingUnion}
        ) found
      `,
    );

    return new Set(rows.map((r) => r.matched_key));
  }

  /**
   * M4.9 (§4.4): Tra các mục từ tiếng Nhật theo đúng reading kana (ăn B-tree
   * `lexeme_reading_lookup`) để cứu trường hợp file bị cụt chữ cuối (vd `引っ越` + `ひっこし` -> `引っ越し`).
   */
  async findJapaneseByReadings(
    kanaReadings: string[],
  ): Promise<ImportLexemeCandidate[]> {
    if (kanaReadings.length === 0) return [];
    return this.prisma.$queryRaw<ImportLexemeCandidate[]>(Prisma.sql`
      SELECT
        l.id AS lexeme_id,
        l.language_id,
        l.lemma,
        l.reading,
        l.pos,
        l.frequency_rank,
        3::int AS match_source,
        l.reading AS matched_key,
        COALESCE(src.code = 'jmdict', false) AS is_jmdict,
        EXISTS (
          SELECT 1
          FROM core.sense s
          JOIN core.sense_gloss g ON g.sense_id = s.id AND g.language_id = 3
          WHERE s.lexeme_id = l.id
        ) AS has_vi_gloss,
        NULL::int AS en_learner_rank
      FROM core.lexeme l
      LEFT JOIN public.source src ON src.id = l.source_id
      WHERE l.language_id = 2
        AND l.reading = ANY(${kanaReadings}::text[])
        AND NOT (COALESCE(l.attributes->>'wikt_pos', '') = 'romanization')
        AND EXISTS (SELECT 1 FROM core.sense s WHERE s.lexeme_id = l.id)
    `);
  }

  /**
   * M5.3.2: Tra theo lô mã ent_seq JMdict (vd từ file backup `.japanese`) trong 1 câu SQL,
   * ăn thẳng UNIQUE B-tree index `lexeme_external_id_key` (`external_id = 'jmdict:<id>'`).
   */
  async findJapaneseByJmdictIds(
    jmdictIds: string[],
  ): Promise<ImportLexemeCandidate[]> {
    if (jmdictIds.length === 0) return [];
    const externalIds = jmdictIds.map((id) => `jmdict:${id}`);
    return this.prisma.$queryRaw<ImportLexemeCandidate[]>(Prisma.sql`
      SELECT
        l.id AS lexeme_id,
        l.language_id,
        l.lemma,
        l.reading,
        l.pos,
        l.frequency_rank,
        1::int AS match_source,
        split_part(l.external_id, ':', 2) AS matched_key,
        true AS is_jmdict,
        EXISTS (
          SELECT 1
          FROM core.sense s
          JOIN core.sense_gloss g ON g.sense_id = s.id AND g.language_id = 3
          WHERE s.lexeme_id = l.id
        ) AS has_vi_gloss,
        NULL::int AS en_learner_rank
      FROM core.lexeme l
      WHERE l.external_id = ANY(${externalIds}::text[])
        AND EXISTS (SELECT 1 FROM core.sense s WHERE s.lexeme_id = l.id)
    `);
  }
}
