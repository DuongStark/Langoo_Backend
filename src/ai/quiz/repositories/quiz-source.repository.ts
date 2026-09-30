import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../db/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { QuizSourceItem } from '../../providers/ai-quiz.provider';

interface SourceRow {
  item_id: string;
  sense_id: bigint;
  concept_id: bigint | null;
  language_id: number;
  lemma: string;
  reading: string | null;
  romanization: string | null;
  meaning_vi: string;
}

/**
 * Nguồn từ vựng cho quiz: item thuộc profile (collection không archive, item
 * không paused) + nghĩa/language đọc từ serve.sense_card.
 * Thứ tự ưu tiên: review → relearning → learning → new, rồi vị trí item.
 */
@Injectable()
export class QuizSourceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findSourceItems(params: {
    userId: bigint;
    profileId: string;
    collectionId: string | null;
  }): Promise<QuizSourceItem[]> {
    const { userId, profileId, collectionId } = params;
    const rows = await this.prisma.$queryRaw<SourceRow[]>(Prisma.sql`
      SELECT
        i.id AS item_id,
        i.anchor_sense_id AS sense_id,
        i.concept_id,
        sc.language_id,
        sc.lemma,
        sc.reading,
        sc.romanization,
        COALESCE(NULLIF(btrim(i.meaning_vi), ''), sc.gloss_vi, sc.gloss_en, sc.lemma) AS meaning_vi
      FROM app.collection_item i
      JOIN app.collection c ON c.id = i.collection_id
      JOIN serve.sense_card sc ON sc.sense_id = i.anchor_sense_id
      LEFT JOIN LATERAL (
        SELECT s.state
        FROM app.srs_state s
        WHERE s.face_id IN (
          SELECT f.id FROM app.collection_item_face f WHERE f.item_id = i.id
        )
        ORDER BY CASE s.state
                   WHEN 'review' THEN 1
                   WHEN 'relearning' THEN 2
                   WHEN 'learning' THEN 3
                   ELSE 4
                 END
        LIMIT 1
      ) st ON true
      WHERE c.owner_id = ${userId}
        AND c.profile_id = ${profileId}::uuid
        AND c.archived_at IS NULL
        AND i.status <> 'paused'
        AND (${collectionId}::uuid IS NULL OR i.collection_id = ${collectionId}::uuid)
      ORDER BY
        CASE COALESCE(st.state, 'new')
          WHEN 'review' THEN 1
          WHEN 'relearning' THEN 2
          WHEN 'learning' THEN 3
          ELSE 4
        END,
        i.position,
        i.id
    `);

    return rows.map((row) => ({
      itemId: row.item_id,
      senseId: row.sense_id.toString(),
      conceptId: row.concept_id?.toString() ?? null,
      languageId: Number(row.language_id),
      lemma: row.lemma,
      reading: row.reading,
      romanization: row.romanization,
      meaningVi: row.meaning_vi,
    }));
  }
}
