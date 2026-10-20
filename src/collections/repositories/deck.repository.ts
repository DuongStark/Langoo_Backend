import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';

export interface DeckRow {
  id: bigint;
  title: string;
  description: string | null;
  language_id: number;
  item_count: number;
  is_published: boolean;
}

export interface DeckItemRow {
  anchor_sense_id: bigint;
  concept_id: bigint | null;
  position: number;
  sense_language_id: number;
  meaning_vi: string;
  meaning_source: string;
}

export interface DeckListItemRow {
  id: bigint;
  slug: string;
  title: string;
  description: string | null;
  language_id: number;
  level_label: string | null;
  item_count: number;
}

/**
 * Đọc bộ từ hệ thống `core.deck`/`core.deck_item` (chỉ đọc).
 * Nghĩa vi khi clone: gloss vi (máy chưa duyệt → meaning_source='machine'),
 * fallback en → lemma ('source').
 */
@Injectable()
export class DeckRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findPublished(deckId: bigint): Promise<DeckRow | null> {
    const rows = await this.prisma.$queryRaw<DeckRow[]>`
      SELECT id, title, description, language_id, item_count, is_published
      FROM core.deck
      WHERE id = ${deckId}
    `;
    return rows[0] ?? null;
  }

  async findPublishedList(): Promise<DeckListItemRow[]> {
    return this.prisma.$queryRaw<DeckListItemRow[]>`
      SELECT id, slug, title, description, language_id, level_label, item_count
      FROM core.deck
      WHERE is_published
      ORDER BY level_label NULLS LAST, id ASC
    `;
  }

  async findItems(deckId: bigint): Promise<DeckItemRow[]> {
    return this.prisma.$queryRaw<DeckItemRow[]>`
      SELECT
        di.anchor_sense_id,
        di.concept_id,
        di.position,
        x.language_id AS sense_language_id,
        COALESCE(vi.text, en.text, x.lemma) AS meaning_vi,
        CASE
          WHEN vi.text IS NOT NULL AND vi.is_machine AND vi.reviewed_by IS NULL
            THEN 'machine'
          ELSE 'source'
        END AS meaning_source
      FROM core.deck_item di
      JOIN core.sense s ON s.id = di.anchor_sense_id
      JOIN core.lexeme x ON x.id = s.lexeme_id
      LEFT JOIN LATERAL (
        SELECT g.text, g.is_machine, g.reviewed_by
        FROM core.sense_gloss g
        WHERE g.sense_id = s.id AND g.language_id = 3
        ORDER BY (g.reviewed_by IS NOT NULL) DESC, g.is_machine, g.rank
        LIMIT 1
      ) vi ON true
      LEFT JOIN LATERAL (
        SELECT g.text
        FROM core.sense_gloss g
        WHERE g.sense_id = s.id AND g.language_id = 1
        ORDER BY (g.reviewed_by IS NOT NULL) DESC, g.is_machine, g.rank
        LIMIT 1
      ) en ON true
      WHERE di.deck_id = ${deckId}
      ORDER BY di.position ASC, di.anchor_sense_id ASC
    `;
  }

  async hasCuratedConceptMapping(
    senseId: bigint,
    conceptId: bigint,
  ): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ ok: number }[]>`
      SELECT 1 AS ok
      FROM core.sense_concept sc
      JOIN core.concept c ON c.id = sc.concept_id
      WHERE sc.sense_id = ${senseId}
        AND sc.concept_id = ${conceptId}
        AND c.status = 'curated'
        AND sc.confidence >= 0.7
      LIMIT 1
    `;
    return rows.length > 0;
  }
}
