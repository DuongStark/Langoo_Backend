import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';

export interface GlossRow {
  id: bigint;
  language_id: number;
  text: string;
  detail: string | null;
  is_machine: boolean;
  reviewed: boolean;
  quality: number | null;
  rank: number;
}

export interface ExampleRow {
  id: bigint;
  language_id: number;
  text: string;
  translation: unknown;
  difficulty: number | null;
}

export interface PronunciationRow {
  id: bigint;
  ipa: string | null;
  audio_key: string | null;
  dialect: string | null;
}

export interface FormRow {
  id: bigint;
  kind: string;
  form_text: string;
  form_order: number;
  is_common: boolean;
}

/**
 * Nội dung chi tiết của một sense/lexeme (gloss, ví dụ, phát âm, form).
 * Chỉ đọc `core.*` — không ghi.
 */
/**
 * Toàn bộ gloss EN của các sense thuộc một lexeme (để chọn định nghĩa hiển thị
 * khác nhau cho sense con của wiktextract — tránh lặp định nghĩa cha).
 */
@Injectable()
export class SenseContentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getGlosses(senseId: bigint): Promise<GlossRow[]> {
    return this.prisma.$queryRaw<GlossRow[]>`
      SELECT
        id,
        language_id,
        text,
        detail,
        is_machine,
        (reviewed_by IS NOT NULL) AS reviewed,
        quality,
        rank
      FROM core.sense_gloss
      WHERE sense_id = ${senseId}
      ORDER BY language_id ASC, rank ASC
    `;
  }

  async getExamples(senseId: bigint, limit: number): Promise<ExampleRow[]> {
    return this.prisma.$queryRaw<ExampleRow[]>`
      SELECT id, language_id, text, translation, difficulty
      FROM core.example
      WHERE sense_id = ${senseId}
      ORDER BY id ASC
      LIMIT ${limit}
    `;
  }

  async getPronunciations(lexemeId: bigint): Promise<PronunciationRow[]> {
    return this.prisma.$queryRaw<PronunciationRow[]>`
      SELECT id, ipa, audio_key, dialect
      FROM core.pronunciation
      WHERE lexeme_id = ${lexemeId}
      ORDER BY id ASC
    `;
  }

  async getForms(lexemeId: bigint): Promise<FormRow[]> {
    return this.prisma.$queryRaw<FormRow[]>`
      SELECT id, kind, form_text, form_order, is_common
      FROM core.lexeme_form
      WHERE lexeme_id = ${lexemeId}
      ORDER BY kind ASC, form_order ASC
    `;
  }
}
