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
    const surfaceExactCondition = Prisma.join(
      queries.map(
        (_query, index) =>
          Prisma.sql`(lower(h.surface) = lower(${queries[index]}))`,
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

    /* Query chữ thường → chỉ gợi ý bản chữ thường (ẩn tên riêng VIẾT HOA/Title khi
       không khớp chính xác); query có chữ hoa thì giữ cả Title-case. */
    const queryHasUpper = queries.some(
      (query) => query !== query.toLowerCase(),
    );
    const enPrefixNoise = queryHasUpper
      ? Prisma.sql`(
          surface ~ '^[A-Za-z]+([-''][A-Za-z]+)*$'
          AND (surface !~ '[A-Z]' OR surface ~ '^[A-Z][^A-Z]*$')
        )`
      : Prisma.sql`(
          surface ~ '^[A-Za-z]+([-''][A-Za-z]+)*$'
          AND surface = lower(surface)
        )`;

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
          cl.source_id,
          CASE WHEN ${exactCondition} THEN 0 ELSE 1 END AS exact_rank,
          CASE WHEN ${prefixCondition} THEN 0 ELSE 1 END AS prefix_rank,
          CASE WHEN ${surfaceExactCondition} THEN 0 ELSE 1 END AS surface_exact_rank,
          CASE WHEN h.frequency_rank IS NULL THEN 1 ELSE 0 END AS frequency_null_rank,
          coalesce(h.frequency_rank, 2147483647) AS frequency_sort,
          length(h.surface) AS surface_length,
          CASE
            WHEN h.language_id = 2 AND cl.source_id = 1 THEN 0
            WHEN h.language_id = 1 AND cl.source_id = 8 THEN 0
            WHEN cl.source_id IN (1, 8) THEN 1
            WHEN cl.source_id = 5 THEN 2
            ELSE 3
          END AS source_priority,
          CASE WHEN h.surface_kind = 'lemma' THEN 1 ELSE 0 END AS kind_rank
        FROM hits h
        JOIN core.lexeme cl ON cl.id = h.lexeme_id
      ),
      /* Một lexeme có thể khớp nhiều dòng (lemma + form) — giữ dòng tốt nhất,
         ưu tiên form kanji/kana để nhãn hiển thị đúng "mặt chữ". */
      per_lexeme AS (
        SELECT
          ranked.*,
          row_number() OVER (
            PARTITION BY lexeme_id
            ORDER BY exact_rank, prefix_rank, surface_exact_rank, kind_rank, surface_length, surface_kind, surface
          ) AS lexeme_rn
        FROM ranked
      ),
      kept AS (SELECT * FROM per_lexeme WHERE lexeme_rn = 1),
      /* Gộp trùng nguồn: ẩn bản nguồn phụ khi cùng mặt chữ đã có nguồn ưu tiên
         (jmdict/wiktextract), ẩn bản không reading khi có bản cùng surface+POS có
         reading ưu tiên hơn, và giữ 1 dòng cho mỗi (ngôn ngữ, mặt chữ, POS, reading). */
      enriched AS (
        SELECT
          kept.*,
          min(source_priority) OVER (PARTITION BY language_id, lower(surface)) AS surface_priority,
          min(CASE WHEN reading IS NOT NULL THEN source_priority END) OVER (
            PARTITION BY language_id, lower(surface), pos
          ) AS reading_priority,
          row_number() OVER (
            PARTITION BY language_id, lower(surface), pos, coalesce(reading, '')
            ORDER BY source_priority, frequency_null_rank, frequency_sort, lexeme_id
          ) AS entry_rn
        FROM kept
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
      FROM enriched
      WHERE source_priority = surface_priority
        AND (
          reading IS NOT NULL
          OR reading_priority IS NULL
          OR source_priority <= reading_priority
        )
        AND entry_rn = 1
        /* EN: bỏ kết quả prefix nhiễu (viết tắt in hoa, có số/khoảng trắng,
           hậu tố "-") — vẫn hiện nếu khớp chính xác. JA/VI không áp dụng. */
        AND (language_id <> 1 OR exact_rank = 0 OR ${enPrefixNoise})
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
