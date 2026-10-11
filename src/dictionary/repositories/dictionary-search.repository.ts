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
  frequency_source: string | null;
  ja_source_rank: 0 | 1;
  vi_translation_rank: 0 | 1;
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
 * CẦN (mất thứ tự/khoảng cách). Search giữ face tốt nhất mỗi lexeme trước
 * cursor/LIMIT; suggestions có thể gộp theo ngôn ngữ + surface + reading để nguồn
 * trùng không chiếm nhiều mục autocomplete.
 */
export interface SearchParams {
  queries: string[];
  patterns: string[];
  lang: string | null;
  allowedLanguageIds?: number[];
  limit: number;
  cursor: DictionarySearchCursor | null;
  /** Collapse source-level duplicates that display the same language/surface/reading. */
  deduplicateSurface?: boolean;
}

@Injectable()
export class DictionarySearchRepository {
  constructor(private readonly prisma: PrismaService) {}

  async search(params: SearchParams): Promise<SearchRow[]> {
    const {
      queries,
      patterns,
      lang,
      limit,
      cursor,
      deduplicateSurface = false,
    } = params;
    const langFilter = Prisma.sql`
      ${lang === null ? Prisma.sql`` : Prisma.sql`AND ds.lang_code = ${lang}`}
      ${params.allowedLanguageIds === undefined ? Prisma.sql`` : params.allowedLanguageIds.length === 0 ? Prisma.sql`AND FALSE` : Prisma.sql`AND ds.language_id IN (${Prisma.join(params.allowedLanguageIds)})`}
    `;

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
    // Prefer the spelling actually typed; derived kana remains a reading match.
    // Romaji search should still display the canonical kanji face when available.
    const surfaceExactCondition = Prisma.sql`lower(h.surface) = lower(${queries[0]})`;
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
            ja_source_rank,
            vi_translation_rank,
            frequency_null_rank,
            frequency_sort,
            surface_length,
            lexeme_id,
            surface_kind,
            surface
          ) > (
            ${cursor.exactRank},
            ${cursor.prefixRank},
            ${cursor.jaSourceRank},
            ${cursor.viTranslationRank},
            ${cursor.frequencyNullRank},
            ${cursor.frequencyRank},
            ${cursor.surfaceLength},
            ${BigInt(cursor.lexemeId)},
            ${cursor.surfaceKind},
            ${cursor.surface}
          )
        `
      : Prisma.sql``;

    const resultPartition = deduplicateSurface
      ? Prisma.sql`lang_code, lower(surface), coalesce(lower(reading), '')`
      : Prisma.sql`lexeme_id`;
    const resultOrder = deduplicateSurface
      ? Prisma.sql`exact_rank, prefix_rank, ja_source_rank, vi_translation_rank, frequency_null_rank, frequency_sort, surface_exact_rank, canonical_face_rank, surface_length, surface_kind, surface, lexeme_id`
      : Prisma.sql`exact_rank, prefix_rank, ja_source_rank, vi_translation_rank, surface_exact_rank, canonical_face_rank, surface_length, surface_kind, surface`;

    // EN/VI không có reading/romanization → bỏ 2 nhánh UNION để tránh quét thừa.
    const knowsReadings = lang === null || lang === 'ja' || lang === 'zh-Hans';
    const knowsRomanization = lang === null || lang === 'ja';
    const readingBranch = knowsReadings
      ? Prisma.sql`
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
          ${langFilter}`
      : Prisma.sql``;
    const romanizationBranch = knowsRomanization
      ? Prisma.sql`
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
          ${langFilter}`
      : Prisma.sql``;

    const query = Prisma.sql`
      WITH hits_raw AS (
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
${readingBranch}${romanizationBranch}
      ),
      hits AS (
        SELECT h.*
        FROM hits_raw h
        ORDER BY
          (lower(h.surface) = lower(${queries[0]})) DESC,
          (h.surface ILIKE ${patterns[0]} || '%' ESCAPE '\\') DESC,
          length(h.surface) ASC,
          h.frequency_rank ASC NULLS LAST,
          h.lexeme_id ASC
        LIMIT 5000
      ),
      lexeme_priority AS MATERIALIZED (
        SELECT cl.id AS lexeme_id,cl.lemma,cl.romanization,
          coalesce(jp.corpus_rank,cl.frequency_rank) AS frequency_rank,
          CASE WHEN jp.corpus_rank IS NOT NULL THEN 'bccwj-suw'
               WHEN cl.frequency_rank IS NOT NULL THEN 'lexeme' ELSE NULL END AS frequency_source,
          CASE WHEN coalesce(jp.corpus_rank,cl.frequency_rank) IS NULL THEN 1 ELSE 0 END AS frequency_null_rank,
          coalesce(jp.corpus_rank,cl.frequency_rank,
            CASE WHEN hit_ids.lang_code='ja' AND src.code='jmdict' THEN
              CASE WHEN EXISTS (
                SELECT 1 FROM jsonb_array_elements(
                  coalesce(cl.attributes->'kanji','[]'::jsonb) || coalesce(cl.attributes->'kana','[]'::jsonb)
                ) form WHERE form->>'common'='true'
              ) THEN 2147483645 ELSE 2147483646 END
            ELSE 2147483647 END) AS frequency_sort,
          CASE WHEN src.code='jmdict' THEN 0
               WHEN hit_ids.lang_code='en' AND EXISTS (
                 SELECT 1 FROM core.sense cs
                 JOIN core.sense_learner_priority cp ON cp.sense_id=cs.id
                 JOIN core.dictionary_priority_run cr ON cr.id=cp.run_id
                   AND cr.active AND cr.policy='en-m10.5-v1'
                 WHERE cs.lexeme_id=cl.id
               ) THEN 0
               ELSE 1 END AS source_rank,
          CASE WHEN hit_ids.lang_code='ja' AND src.code='jmdict' THEN 0
               WHEN hit_ids.lang_code='ja' THEN 1 ELSE 0 END AS ja_source_rank,
          CASE WHEN hit_ids.lang_code='ja' AND EXISTS (
              SELECT 1
              FROM core.sense vi_s
              JOIN core.sense_gloss vi_g ON vi_g.sense_id=vi_s.id
              JOIN public.language vi_l ON vi_l.id=vi_g.language_id AND vi_l.code='vi'
              WHERE vi_s.lexeme_id=cl.id AND NULLIF(btrim(vi_g.text),'') IS NOT NULL
            ) THEN 0 ELSE 1 END AS vi_translation_rank,
          CASE WHEN EXISTS (
              SELECT 1
              FROM core.sense vi_s
              JOIN core.sense_gloss vi_g ON vi_g.sense_id=vi_s.id
              JOIN public.language vi_l ON vi_l.id=vi_g.language_id AND vi_l.code='vi'
              WHERE vi_s.lexeme_id=cl.id AND NULLIF(btrim(vi_g.text),'') IS NOT NULL
            ) THEN 0 ELSE 1 END AS vi_rank
        FROM (SELECT DISTINCT lexeme_id,lang_code FROM hits) hit_ids
        JOIN core.lexeme cl ON cl.id=hit_ids.lexeme_id
        LEFT JOIN public.source src ON src.id=cl.source_id
        LEFT JOIN LATERAL (
          SELECT p.corpus_rank FROM serve.japanese_lexeme_priority p
          WHERE p.lexeme_id=cl.id AND hit_ids.lang_code='ja'
          LIMIT 1
        ) jp ON true
      ),
      ranked AS (
        SELECT h.lexeme_id,h.language_id,h.lang_code,h.surface,h.reading,h.pos,
          cl.frequency_rank,cl.frequency_source,h.homograph_no,h.surface_kind,
          CASE WHEN ${exactCondition} THEN 0 ELSE 1 END AS exact_rank,
          CASE WHEN ${prefixCondition} THEN 0 ELSE 1 END AS prefix_rank,
          CASE WHEN ${surfaceExactCondition} THEN 0 ELSE 1 END AS surface_exact_rank,
          CASE WHEN h.surface=cl.lemma THEN 0 ELSE 1 END AS canonical_face_rank,
          cl.frequency_null_rank,cl.frequency_sort,length(h.surface) AS surface_length,
          cl.source_rank,cl.ja_source_rank,cl.vi_translation_rank,cl.vi_rank
        FROM hits h JOIN lexeme_priority cl ON cl.lexeme_id=h.lexeme_id
      ),
      -- Ẩn bản sao theo cùng (lang, surface, pos) như bản canonical; canonical tính
      -- 1 lần bằng MATERIALIZED để tránh NOT EXISTS O(N²) (sự cố search 10/10).
      -- EN tạm thời VI-only: chỉ hiện từ EN đã có ít nhất 1 sense gloss VI.
      canonical AS MATERIALIZED (
        SELECT DISTINCT lang_code, lower(surface) AS surface_key, pos
        FROM ranked
        WHERE source_rank = 0
      ),
      visible AS (
        SELECT r.*
        FROM ranked r
        WHERE (r.lang_code <> 'en' OR r.vi_rank = 0)
          AND (r.source_rank = 0
            OR r.reading IS NOT NULL
            OR NOT EXISTS (
                SELECT 1 FROM canonical c
                WHERE c.lang_code = r.lang_code
                  AND c.surface_key = lower(r.surface)
                  AND (r.lang_code <> 'en' OR c.pos IS NOT DISTINCT FROM r.pos)
              ))
      ),
      per_result AS (
        SELECT visible.*,
          row_number() OVER (
            PARTITION BY ${resultPartition}
            ORDER BY ${resultOrder}
          ) AS face_no
        FROM visible
      )
      SELECT
        lexeme_id,
        language_id,
        lang_code,
        surface,
        reading,
        pos,
        frequency_rank,
        frequency_source,
        ja_source_rank,
        vi_translation_rank,
        homograph_no,
        surface_kind,
        (exact_rank = 0) AS is_exact,
        exact_rank,
        prefix_rank,
        frequency_null_rank,
        frequency_sort,
        surface_length
      FROM per_result
      WHERE face_no = 1
        ${cursorCondition}
      ORDER BY
        exact_rank ASC,
        prefix_rank ASC,
        ja_source_rank ASC,
        vi_translation_rank ASC,
        frequency_null_rank ASC,
        frequency_sort ASC,
        surface_length ASC,
        lexeme_id ASC,
        surface_kind ASC,
        surface ASC
      LIMIT ${limit}
    `;

    // statement_timeout phải arm TỪ ĐẦU statement: dùng SET LOCAL trong transaction
    // (set_config giữa statement không có tác dụng — kiểm chứng 10/10).
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '20000'`);
        // Query trên view lớn: ép custom plan để tránh plan generic quét full.
        await tx.$executeRawUnsafe(
          `SET LOCAL plan_cache_mode = 'force_custom_plan'`,
        );
        return tx.$queryRaw<SearchRow[]>(query);
      },
      { timeout: 25000, maxWait: 10000 },
    );
  }
}
