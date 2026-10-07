import { Injectable } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';

export interface SourceRow {
  id: number;
  code: string;
  name: string | null;
  license: string | null;
  attribution: string | null;
  url: string | null;
  version: string | null;
}

export interface SourceCountRow {
  source_id: number | null;
  count: number;
}

/**
 * Nguồn dữ liệu (`public.source`) + số dòng đóng góp theo bảng.
 * Chỉ đọc core/public; không phải Prisma model (schema ngoài `app`).
 */
@Injectable()
export class SourcesRepository {
  constructor(private readonly prisma: PrismaService) {}

  listSources(): Promise<SourceRow[]> {
    return this.prisma.$queryRaw<SourceRow[]>`
      SELECT id, code, name, license, attribution, url, version
      FROM public.source
      ORDER BY id ASC
    `;
  }

  countLexemes(): Promise<SourceCountRow[]> {
    return this.prisma.$queryRaw<SourceCountRow[]>`
      SELECT source_id, count(*)::int AS count FROM core.lexeme GROUP BY 1
    `;
  }

  countSenses(): Promise<SourceCountRow[]> {
    return this.prisma.$queryRaw<SourceCountRow[]>`
      SELECT source_id, count(*)::int AS count FROM core.sense GROUP BY 1
    `;
  }

  countGlosses(): Promise<SourceCountRow[]> {
    return this.prisma.$queryRaw<SourceCountRow[]>`
      SELECT source_id, count(*)::int AS count FROM core.sense_gloss GROUP BY 1
    `;
  }

  countConcepts(): Promise<SourceCountRow[]> {
    return this.prisma.$queryRaw<SourceCountRow[]>`
      SELECT source_id, count(*)::int AS count FROM core.concept GROUP BY 1
    `;
  }

  countConceptGlosses(): Promise<SourceCountRow[]> {
    return this.prisma.$queryRaw<SourceCountRow[]>`
      SELECT source_id, count(*)::int AS count FROM core.concept_gloss GROUP BY 1
    `;
  }

  countKanji(): Promise<SourceCountRow[]> {
    return this.prisma.$queryRaw<SourceCountRow[]>`
      SELECT source_id, count(*)::int AS count FROM core.kanji GROUP BY 1
    `;
  }

  countExamples(): Promise<SourceCountRow[]> {
    return this.prisma.$queryRaw<SourceCountRow[]>`
      SELECT source_id, count(*)::int AS count FROM core.example GROUP BY 1
    `;
  }
}
