import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import { Prisma } from '../../generated/prisma/client';

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
}

/**
 * Tìm "mặt chữ" trong serve.dictionary_search (view, schema serve KHÔNG map Prisma).
 * `raw` dùng so khớp chính xác; `pattern` đã escape ký tự LIKE để dùng trong ILIKE.
 */
export interface SearchParams {
  raw: string;
  pattern: string;
  lang: string | null;
  limit: number;
}

@Injectable()
export class DictionarySearchRepository {
  constructor(private readonly prisma: PrismaService) {}

  async search(params: SearchParams): Promise<SearchRow[]> {
    const { raw, pattern, lang, limit } = params;
    const langCondition =
      lang === null ? Prisma.sql`` : Prisma.sql`AND ds.lang_code = ${lang}`;

    return this.prisma.$queryRaw<SearchRow[]>(Prisma.sql`
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
        (
          lower(ds.surface) = lower(${raw})
          OR lower(coalesce(ds.reading, '')) = lower(${raw})
        ) AS is_exact
      FROM serve.dictionary_search ds
      WHERE (
        ds.surface ILIKE '%' || ${pattern} || '%' ESCAPE '\\'
        OR coalesce(ds.reading, '') ILIKE '%' || ${pattern} || '%' ESCAPE '\\'
      )
        ${langCondition}
      ORDER BY
        is_exact DESC,
        (lower(ds.surface) LIKE lower(${pattern}) || '%' ESCAPE '\\') DESC,
        ds.frequency_rank ASC NULLS LAST,
        length(ds.surface) ASC,
        ds.lexeme_id ASC
      LIMIT ${limit}
    `);
  }
}
