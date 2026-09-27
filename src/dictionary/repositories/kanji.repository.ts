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
        kc.media_kinds
      FROM serve.kanji_card kc
      WHERE kc.literal = ${literal}
    `;
    return rows[0] ?? null;
  }
}
