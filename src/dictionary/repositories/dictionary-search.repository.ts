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
 *
 * DB2: truy vấn dùng 3 nhánh `UNION` (mặt chữ / cách đọc / romaji) — mỗi nhánh chỉ lọc
 * trên MỘT cột nên planner dùng được index: GIN trigram (pattern ≥3 ký tự) và GIN bigram
 * `core.bigrams` (pattern 1–2 ký tự); biểu thức OR trộn nhiều cột/bảng như trước không
 * thể dùng index. `ILIKE` luôn giữ làm điều kiện kiểm chứng vì bigram chỉ là điều kiện
 * CẦN (mất thứ tự/khoảng cách). Tập kết quả giữ nguyên như OR cũ (`UNION` khử trùng lặp).
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
    const langFilter =
      lang === null ? Prisma.sql`` : Prisma.sql`AND ds.lang_code = ${lang}`;

    const surfaceMatch = Prisma.join(
      patterns.map(
        (pattern, index) => Prisma.sql`(
          core.bigrams(lower(ds.surface)) @> core.bigrams(lower(${queries[index]}))
          AND ds.surface ILIKE '%' || ${pattern} || '%' ESCAPE '\\'
        )`,
      ),
      ' OR ',
    );
    const readingMatch = Prisma.join(
      patterns.map(
        (pattern, index) => Prisma.sql`(
          core.bigrams(lower(ds.reading)) @> core.bigrams(lower(${queries[index]}))
          AND ds.reading ILIKE '%' || ${pattern} || '%' ESCAPE '\\'
        )`,
      ),
      ' OR ',
    );
    const romanizationMatch = Prisma.join(
      patterns.map(
        (pattern, index) => Prisma.sql`(
          core.bigrams(lower(cl2.romanization)) @> core.bigrams(lower(${queries[index]}))
          AND cl2.romanization ILIKE '%' || ${pattern} || '%' ESCAPE '\\'
        )`,
      ),
      ' OR ',
    );

    const exactCondition = Prisma.join(
      patterns.map(
        (_pattern, index) => Prisma.sql`(
          lower(h.surface) = lower(${queries[index]})
          OR lower(h.reading) = lower(${queries[index]})
          OR lower(cl.romanization) = lower(${queries[index]})
        )`,
      ),
      ' OR ',
    );
    const prefixCondition = Prisma.join(
      patterns.map(
        (pattern) => Prisma.sql`(
          lower(h.surface) LIKE lower(${pattern}) || '%' ESCAPE '\\'
          OR lower(h.reading) LIKE lower(${pattern}) || '%' ESCAPE '\\'
          OR lower(cl.romanization) LIKE lower(${pattern}) || '%' ESCAPE '\\'
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
      WITH hits AS (
        SELECT
          ds.lexeme_id,
          ds.language_id,
          ds.lang_code,
          ds.surface,
          ds.reading,
          ds.pos,
          ds.frequency_rank,
          ds.homograph_no,
          ds.surface_kind
        FROM serve.dictionary_search ds
        WHERE (${surfaceMatch})
          ${langFilter}
        UNION
        SELECT
          ds.lexeme_id,
          ds.language_id,
          ds.lang_code,
          ds.surface,
          ds.reading,
          ds.pos,
          ds.frequency_rank,
          ds.homograph_no,
          ds.surface_kind
        FROM serve.dictionary_search ds
        WHERE (${readingMatch})
          ${langFilter}
        UNION
        SELECT
          ds.lexeme_id,
          ds.language_id,
          ds.lang_code,
          ds.surface,
          ds.reading,
          ds.pos,
          ds.frequency_rank,
          ds.homograph_no,
          ds.surface_kind
        FROM serve.dictionary_search ds
        JOIN core.lexeme cl2 ON cl2.id = ds.lexeme_id
        WHERE (${romanizationMatch})
          ${langFilter}
      ),
      ranked AS (
        SELECT
          h.lexeme_id,
          h.language_id,
          h.lang_code,
          h.surface,
          h.reading,
          h.pos,
          h.frequency_rank,
          h.homograph_no,
          h.surface_kind,
          CASE WHEN ${exactCondition} THEN 0 ELSE 1 END AS exact_rank,
          CASE WHEN ${prefixCondition} THEN 0 ELSE 1 END AS prefix_rank,
          CASE WHEN h.frequency_rank IS NULL THEN 1 ELSE 0 END AS frequency_null_rank,
          coalesce(h.frequency_rank, 2147483647) AS frequency_sort,
          length(h.surface) AS surface_length
        FROM hits h
        JOIN core.lexeme cl ON cl.id = h.lexeme_id
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
