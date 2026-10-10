import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';

export interface KanjiRow {
  literal: string;
  codepoint_ucs: number;
  grade: number | null;
  stroke_count: number | null;
  frequency_rank: number | null;
  jlpt_old: number | null;
  jlpt_new: number | null;
  radical_classical: number | null;
  radical_char: string | null;
  radical_name_vi: string | null;
  radical_meaning_vi: string | null;
  readings: unknown;
  meanings: unknown;
  nanori: unknown;
  query_codes: unknown;
  used_in_forms: bigint;
  media_kinds: string[] | null;
  parts: unknown;
}

export interface KanjiStrokeRow {
  objectKey: string;
  mime: string;
  sha256: string;
  bytes: number;
}

/** Chi tiết chữ Hán — view `serve.kanji_card` (schema serve KHÔNG map Prisma). */
@Injectable()
export class KanjiRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getByLiteral(literal: string): Promise<KanjiRow | null> {
    const rows = await this.prisma.$queryRaw<KanjiRow[]>`
      SELECT
        kc.literal,
        kc.codepoint_ucs,
        kc.grade,
        kc.stroke_count,
        kc.frequency_rank,
        kc.jlpt_old,
        kc.jlpt_new,
        kc.radical_classical,
        kc.radical_char,
        kc.radical_name_vi,
        kc.radical_meaning_vi,
        kc.readings,
        kc.meanings,
        kc.nanori,
        kc.query_codes,
        kc.used_in_forms,
        kc.media_kinds,
        coalesce((
          SELECT jsonb_agg(
            jsonb_build_object(
              'char', kr.part,
              'position', kr.position,
              'is_radical', (r.number IS NOT NULL),
              'radical_number', r.number,
              'name_vi', r.name_vi,
              'meaning_vi', r.meaning_vi
            )
            ORDER BY kr.position NULLS LAST, kr.part
          )
          FROM core.kanji_radical kr
          LEFT JOIN public.radical r
            ON r."character" = kr.part OR kr.part = ANY (r.variants)
          WHERE kr.kanji_literal = kc.literal
        ), '[]'::jsonb) AS parts
      FROM serve.kanji_card kc
      WHERE kc.literal = ${literal}
    `;
    return rows[0] ?? null;
  }

  /** Asset SVG thứ tự nét (KanjiVG) cho một chữ Hán — metadata, chưa đọc file. */
  async getStrokeAsset(literal: string): Promise<KanjiStrokeRow | null> {
    const rows = await this.prisma.$queryRaw<KanjiStrokeRow[]>`
      SELECT ma.object_key AS "objectKey", ma.mime, ma.sha256, ma.bytes
      FROM core.kanji_media km
      JOIN core.media_asset ma ON ma.id = km.asset_id
      WHERE km.kanji_literal = ${literal} AND km.kind = 'stroke_svg'
      ORDER BY ma.id ASC
      LIMIT 1
    `;
    return rows[0] ?? null;
  }
}
