import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { DictionarySearchCursor } from '../dictionary-search-cursor';

export interface SearchRow {
  lexeme_id: bigint;
  language_id: number;
  lang_code: string;
  surface: string;
  reading: string | null;
  pos: string | null;
  frequency_rank: number | null;
  homograph_no: number | null;
  surface_kind: string;
  is_exact: boolean;
  exact_rank: 0 | 1;
  prefix_rank: 0 | 1;
  frequency_null_rank: 0 | 1;
  frequency_sort: number;
  surface_length: number;
}

/**
 * Tìm "mặt chữ" trong serve.dictionary_search (view, schema serve KHÔNG map Prisma).
 * `queries` dùng so khớp chính xác; `patterns` đã escape ký tự LIKE để dùng trong ILIKE.
 */
export interface SearchParams {
  queries: string[];
  patterns: string[];
  lang: string | null;
  limit: number;
  cursor: DictionarySearchCursor | null;
}

@Injectable()
export class DictionarySearchRepository {
  constructor(private readonly prisma: PrismaService) {}

  async search(params: SearchParams): Promise<SearchRow[]> {
    const { queries, patterns, lang, limit, cursor } = params;
    const langCondition =
      lang === null ? Prisma.sql`` : Prisma.sql`AND ds.lang_code = ${lang}`;

    const matchCondition = Prisma.join(
      patterns.map(
        (pattern) => Prisma.sql`(
          ds.surface ILIKE '%' || ${pattern} || '%' ESCAPE '\\'
          OR coalesce(ds.reading, '') ILIKE '%' || ${pattern} || '%' ESCAPE '\\'
          OR coalesce(cl.romanization, '') ILIKE '%' || ${pattern} || '%' ESCAPE '\\'
        )`,
      ),
      ' OR ',
    );
    const exactCondition = Prisma.join(
      patterns.map(
        (_pattern, index) => Prisma.sql`(
          lower(ds.surface) = lower(${queries[index]})
          OR lower(coalesce(ds.reading, '')) = lower(${queries[index]})
          OR lower(coalesce(cl.romanization, '')) = lower(${queries[index]})
        )`,
      ),
      ' OR ',
    );
    const prefixCondition = Prisma.join(
      patterns.map(
        (pattern) => Prisma.sql`(
          lower(ds.surface) LIKE lower(${pattern}) || '%' ESCAPE '\\'
          OR lower(coalesce(ds.reading, '')) LIKE lower(${pattern}) || '%' ESCAPE '\\'
          OR lower(coalesce(cl.romanization, '')) LIKE lower(${pattern}) || '%' ESCAPE '\\'
        )`,
      ),
      ' OR ',
    );
    const cursorCondition = cursor
      ? Prisma.sql`
          AND (
            exact_rank,
            prefix_rank,
            frequency_null_rank,
            frequency_sort,
            surface_length,
            lexeme_id,
            surface_kind,
            surface
          ) > (
            ${cursor.exactRank},
            ${cursor.prefixRank},
            ${cursor.frequencyNullRank},
            ${cursor.frequencyRank},
            ${cursor.surfaceLength},
            ${BigInt(cursor.lexemeId)},
            ${cursor.surfaceKind},
            ${cursor.surface}
          )
        `
      : Prisma.sql``;

    return this.prisma.$queryRaw<SearchRow[]>(Prisma.sql`
      WITH ranked AS (
        SELECT
          ds.lexeme_id,
          ds.language_id,
          ds.lang_code,
          ds.surface,
          ds.reading,
          ds.pos,
          ds.frequency_rank,
          ds.homograph_no,
          ds.surface_kind,
          CASE WHEN ${exactCondition} THEN 0 ELSE 1 END AS exact_rank,
          CASE WHEN ${prefixCondition} THEN 0 ELSE 1 END AS prefix_rank,
          CASE WHEN ds.frequency_rank IS NULL THEN 1 ELSE 0 END AS frequency_null_rank,
          coalesce(ds.frequency_rank, 2147483647) AS frequency_sort,
          length(ds.surface) AS surface_length
        FROM serve.dictionary_search ds
        JOIN core.lexeme cl ON cl.id = ds.lexeme_id
        WHERE (${matchCondition})
          ${langCondition}
      )
      SELECT
        lexeme_id,
        language_id,
        lang_code,
        surface,
        reading,
        pos,
        frequency_rank,
        homograph_no,
        surface_kind,
        (exact_rank = 0) AS is_exact,
        exact_rank,
        prefix_rank,
        frequency_null_rank,
        frequency_sort,
        surface_length
      FROM ranked
      WHERE TRUE
        ${cursorCondition}
      ORDER BY
        exact_rank ASC,
        prefix_rank ASC,
        frequency_null_rank ASC,
        frequency_sort ASC,
        surface_length ASC,
        lexeme_id ASC,
        surface_kind ASC,
        surface ASC
      LIMIT ${limit}
    `);
  }
}
