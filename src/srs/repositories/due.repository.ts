import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import { Prisma } from '../../generated/prisma/client';

export interface DueRow {
  srs_id: bigint;
  face_id: string;
  item_id: string;
  collection_id: string;
  item_position: number;
  meaning_vi: string;
  meaning_source: string;
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
  state: string;
  learning_is_interday: boolean;
  due_at: Date;
  /** Six-digit UTC key from PostgreSQL; Date alone loses sub-millisecond data. */
  due_at_key: string;
}

export interface DueQueryParams {
  userId: bigint;
  profileId: string;
  primaryLanguageId: number;
  secondaryLanguageId: number | null;
  now: Date;
  learnAheadMinutes: number;
  limit: number;
  collectionId?: string;
  includeLearnAhead?: boolean;
}

export interface DayCounts {
  introducedToday: number;
  reviewsToday: number;
}

/** Reads the complete eligible set; queue/cursor selection happens in one place. */
@Injectable()
export class DueRepository {
  constructor(private readonly prisma: PrismaService) {}

  findCandidates(params: DueQueryParams): Promise<DueRow[]> {
    return this.findRows(params, true);
  }

  /** Source for `practice`: ownership and suspension still apply, due/cap does not. */
  findPracticeCandidates(
    params: DueQueryParams & { collectionId?: string },
  ): Promise<DueRow[]> {
    return this.findRows(params, false);
  }

  private async findRows(
    params: DueQueryParams,
    dueOnly: boolean,
  ): Promise<DueRow[]> {
    const secondary = params.secondaryLanguageId ?? -1;
    const learnAhead = new Date(
      params.now.getTime() + params.learnAheadMinutes * 60_000,
    );
    const collectionFilter =
      params.collectionId === undefined
        ? Prisma.sql``
        : Prisma.sql`AND i.collection_id = ${params.collectionId}::uuid`;
    const dueFilter = dueOnly
      ? Prisma.sql`
        AND (
          s.due_at <= ${params.now}
          ${
            params.includeLearnAhead === false
              ? Prisma.sql``
              : Prisma.sql`OR (
            s.state IN ('learning', 'relearning')
            AND NOT s.learning_is_interday
            AND s.due_at <= ${learnAhead}
          )`
          }
        )`
      : Prisma.sql``;
    // Practice intentionally has a bounded snapshot; regular due retrieval
    // returns the full eligible set so the queue can apply caps and cursors
    // without silently dropping cards at an arbitrary SQL limit.
    // Mỗi item có tối đa 2 face. Practice overfetch đủ sibling để
    // service chọn một đại diện cho mỗi item mà vẫn trả đủ số câu yêu cầu.
    const practiceLimit = params.limit * 2;
    const limitClause = dueOnly
      ? Prisma.sql``
      : Prisma.sql`LIMIT ${practiceLimit}`;

    return this.prisma.$queryRaw<DueRow[]>`
      SELECT
        s.id                AS srs_id,
        f.id                AS face_id,
        f.item_id,
        i.collection_id,
        i.position          AS item_position,
        i.meaning_vi,
        i.meaning_source,
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
        s.state,
        s.learning_is_interday,
        s.due_at,
        to_char(
          s.due_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        ) AS due_at_key
      FROM app.srs_state s
      JOIN app.collection_item_face f ON f.id = s.face_id
      JOIN app.collection_item i ON i.id = f.item_id
      JOIN app.collection c ON c.id = i.collection_id
      JOIN core.sense se ON se.id = f.sense_id
      JOIN core.lexeme lx ON lx.id = se.lexeme_id
      JOIN public.language lg ON lg.id = f.language_id
      WHERE s.user_id = ${params.userId}
        AND s.profile_id = ${params.profileId}
        AND c.profile_id = ${params.profileId}
        AND c.owner_id = ${params.userId}
        AND c.archived_at IS NULL
        AND i.status <> 'paused'
        AND s.suspended = false
        AND (s.buried_until IS NULL OR s.buried_until <= ${params.now})
        AND (f.language_id = ${params.primaryLanguageId} OR f.language_id = ${secondary})
        ${collectionFilter}
        ${dueFilter}
      ORDER BY
        CASE
          WHEN s.state IN ('learning', 'relearning') AND NOT s.learning_is_interday THEN 0
          WHEN s.state IN ('learning', 'relearning') THEN 1
          WHEN s.state = 'review' THEN 2
          ELSE 3
        END,
        CASE WHEN s.state = 'new' THEN i.collection_id END ASC,
        CASE WHEN s.state = 'new' THEN i.position END ASC,
        CASE WHEN s.state = 'new' THEN i.id END ASC,
        s.due_at ASC,
        s.id ASC
      ${limitClause}
    `;
  }

  async getDayCounts(params: {
    userId: bigint;
    profileId: string;
    dayStart: Date;
    dayEnd: Date;
  }): Promise<DayCounts> {
    const rows = await this.prisma.$queryRaw<
      { introduced: bigint; reviews: bigint }[]
    >`
      SELECT
        count(*) FILTER (WHERE queue_kind_before = 'new') AS introduced,
        count(*) FILTER (
          WHERE queue_kind_before IN ('review', 'interday_learning')
        ) AS reviews
      FROM app.review_log
      WHERE user_id = ${params.userId}
        AND profile_id = ${params.profileId}
        AND reviewed_at >= ${params.dayStart}
        AND reviewed_at < ${params.dayEnd}
    `;
    return {
      introducedToday: Number(rows[0]?.introduced ?? 0n),
      reviewsToday: Number(rows[0]?.reviews ?? 0n),
    };
  }
}
