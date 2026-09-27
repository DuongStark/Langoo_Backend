import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';

export interface SrsCounts {
  due_now: number;
  due_today: number;
  learning: number;
}

export interface Accuracy7d {
  total: number;
  passed: number;
}

/** Thống kê SRS — chỉ đọc, tính theo mốc ngày địa phương do service truyền vào. */
@Injectable()
export class SrsStatsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getCounts(params: {
    userId: bigint;
    profileId: string;
    primaryLanguageId: number;
    secondaryLanguageId: number | null;
    now: Date;
    dayEnd: Date;
  }): Promise<SrsCounts> {
    const secondary = params.secondaryLanguageId ?? -1;
    const rows = await this.prisma.$queryRaw<
      { due_now: number; due_today: number; learning: number }[]
    >`
      SELECT
        count(*) FILTER (
          WHERE s.state IN ('learning', 'relearning', 'review')
            AND s.due_at <= ${params.now}
        )::int AS due_now,
        count(*) FILTER (
          WHERE s.state IN ('learning', 'relearning', 'review')
            AND s.due_at <= ${params.dayEnd}
        )::int AS due_today,
        count(*) FILTER (
          WHERE s.state IN ('learning', 'relearning')
        )::int AS learning
      FROM app.srs_state s
      JOIN app.collection_item_face f ON f.id = s.face_id
      JOIN app.collection_item i ON i.id = f.item_id
      JOIN app.collection c ON c.id = i.collection_id
      WHERE s.user_id = ${params.userId}
        AND s.profile_id = ${params.profileId}
        AND c.profile_id = ${params.profileId}
        AND c.owner_id = ${params.userId}
        AND c.archived_at IS NULL
        AND i.status <> 'paused'
        AND s.suspended = false
        AND (s.buried_until IS NULL OR s.buried_until <= ${params.now})
        AND (f.language_id = ${params.primaryLanguageId} OR f.language_id = ${secondary})
    `;
    return rows[0] ?? { due_now: 0, due_today: 0, learning: 0 };
  }

  async getAccuracy7d(params: {
    userId: bigint;
    profileId: string;
    since: Date;
    until: Date;
  }): Promise<Accuracy7d> {
    const rows = await this.prisma.$queryRaw<
      { total: number; passed: number }[]
    >`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE rating >= 3)::int AS passed
      FROM app.review_log
      WHERE user_id = ${params.userId}
        AND profile_id = ${params.profileId}
        AND reviewed_at >= ${params.since}
        AND reviewed_at < ${params.until}
    `;
    return rows[0] ?? { total: 0, passed: 0 };
  }
}
