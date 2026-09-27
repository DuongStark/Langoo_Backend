import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import { Prisma } from '../../generated/prisma/client';

export interface DueRow {
  srs_id: bigint;
  face_id: string;
  item_id: string;
  collection_id: string;
  meaning_vi: string;
  sense_id: bigint;
  language_id: number;
  role: string;
  lang_code: string;
  lang_name_vi: string;
  lemma: string;
  reading: string | null;
  romanization: string | null;
  pos: string | null;
  forms: string[];
  direction: string;
  state: string;
  due_at: Date;
}

export interface DueQueryParams {
  userId: bigint;
  profileId: string;
  primaryLanguageId: number;
  secondaryLanguageId: number | null;
  now: Date;
  learnAheadMinutes: number;
  limit: number;
}

export interface DayCounts {
  introducedToday: number;
  reviewsToday: number;
}

/**
 * Hàng đợi SRS: đọc `app.srs_state` + join core/public để lấy nội dung thẻ.
 * Thứ tự + lọc theo Anki (docs/srs.md §3); daily cap do service áp sau khi đếm.
 */
@Injectable()
export class DueRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findCandidates(params: DueQueryParams): Promise<DueRow[]> {
    const {
      userId,
      profileId,
      primaryLanguageId,
      secondaryLanguageId,
      now,
      learnAheadMinutes,
      limit,
    } = params;
    const secondary = secondaryLanguageId ?? -1;
    const learnAhead = new Date(now.getTime() + learnAheadMinutes * 60_000);

    return this.prisma.$queryRaw<DueRow[]>`
      SELECT
        s.id                AS srs_id,
        f.id                AS face_id,
        f.item_id,
        i.collection_id,
        i.meaning_vi,
        f.sense_id,
        f.language_id,
        f.role,
        lg.code             AS lang_code,
        lg.name_vi          AS lang_name_vi,
        lx.lemma,
        lx.reading,
        lx.romanization,
        lx.pos,
        (
          SELECT coalesce(array_agg(fm.form_text ORDER BY fm.form_order), '{}')
          FROM core.lexeme_form fm
          WHERE fm.lexeme_id = lx.id
        ) AS forms,
        s.direction,
        s.state,
        s.due_at
      FROM app.srs_state s
      JOIN app.collection_item_face f ON f.id = s.face_id
      JOIN app.collection_item i ON i.id = f.item_id
      JOIN app.collection c ON c.id = i.collection_id
      JOIN core.sense se ON se.id = f.sense_id
      JOIN core.lexeme lx ON lx.id = se.lexeme_id
      JOIN public.language lg ON lg.id = f.language_id
      WHERE s.user_id = ${userId}
        AND s.profile_id = ${profileId}
        AND c.profile_id = ${profileId}
        AND c.archived_at IS NULL
        AND i.status <> 'paused'
        AND s.suspended = false
        AND (s.buried_until IS NULL OR s.buried_until <= ${now})
        AND (f.language_id = ${primaryLanguageId} OR f.language_id = ${secondary})
        AND (
          s.due_at <= ${now}
          OR (
            s.state IN ('learning', 'relearning')
            AND s.due_at <= ${learnAhead}
          )
        )
      ORDER BY
        CASE s.state
          WHEN 'learning' THEN 0
          WHEN 'relearning' THEN 0
          WHEN 'review' THEN 1
          ELSE 2
        END,
        s.due_at ASC,
        s.id ASC
      LIMIT ${limit}
    `;
  }

  /** Nguồn thẻ cho phiên `practice` (ôn trước): bỏ điều kiện đến hạn, lọc collection tùy chọn. */
  async findPracticeCandidates(
    params: DueQueryParams & { collectionId?: string },
  ): Promise<DueRow[]> {
    const {
      userId,
      profileId,
      primaryLanguageId,
      secondaryLanguageId,
      limit,
      collectionId,
    } = params;
    const secondary = secondaryLanguageId ?? -1;
    const collectionFilter =
      collectionId !== undefined
        ? Prisma.sql`AND i.collection_id = ${collectionId}::uuid`
        : Prisma.sql``;

    return this.prisma.$queryRaw<DueRow[]>`
      SELECT
        s.id                AS srs_id,
        f.id                AS face_id,
        f.item_id,
        i.collection_id,
        i.meaning_vi,
        f.sense_id,
        f.language_id,
        f.role,
        lg.code             AS lang_code,
        lg.name_vi          AS lang_name_vi,
        lx.lemma,
        lx.reading,
        lx.romanization,
        lx.pos,
        (
          SELECT coalesce(array_agg(fm.form_text ORDER BY fm.form_order), '{}')
          FROM core.lexeme_form fm
          WHERE fm.lexeme_id = lx.id
        ) AS forms,
        s.direction,
        s.state,
        s.due_at
      FROM app.srs_state s
      JOIN app.collection_item_face f ON f.id = s.face_id
      JOIN app.collection_item i ON i.id = f.item_id
      JOIN app.collection c ON c.id = i.collection_id
      JOIN core.sense se ON se.id = f.sense_id
      JOIN core.lexeme lx ON lx.id = se.lexeme_id
      JOIN public.language lg ON lg.id = f.language_id
      WHERE s.user_id = ${userId}
        AND s.profile_id = ${profileId}
        AND c.profile_id = ${profileId}
        AND c.archived_at IS NULL
        AND i.status <> 'paused'
        AND s.suspended = false
        AND (s.buried_until IS NULL OR s.buried_until <= ${params.now})
        AND (f.language_id = ${primaryLanguageId} OR f.language_id = ${secondary})
        ${collectionFilter}
      ORDER BY
        CASE s.state
          WHEN 'learning' THEN 0
          WHEN 'relearning' THEN 0
          WHEN 'review' THEN 1
          ELSE 2
        END,
        s.due_at ASC,
        s.id ASC
      LIMIT ${limit}
    `;
  }

  /** Số thẻ mới giới thiệu hôm nay + số lượt review (không tính lượt thẻ mới) hôm nay. */
  async getDayCounts(params: {
    userId: bigint;
    profileId: string;
    dayStart: Date;
  }): Promise<DayCounts> {
    const introduced = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count
      FROM app.srs_state
      WHERE user_id = ${params.userId}
        AND profile_id = ${params.profileId}
        AND introduced_at IS NOT NULL
        AND introduced_at >= ${params.dayStart}
    `;
    const reviews = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count
      FROM app.review_log
      WHERE user_id = ${params.userId}
        AND reviewed_at >= ${params.dayStart}
        AND prev_state IS NOT NULL
        AND prev_state <> 'new'
    `;
    return {
      introducedToday: Number(introduced[0]?.count ?? 0n),
      reviewsToday: Number(reviews[0]?.count ?? 0n),
    };
  }
}
