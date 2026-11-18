import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException } from '../common/errors/domain.exception';
import { PrismaService } from '../db/prisma.service';
import { Prisma } from '../generated/prisma/client';

export const TIMESERIES_METRICS = [
  'signups',
  'reviews',
  'ai_requests',
] as const;
export type TimeseriesMetric = (typeof TIMESERIES_METRICS)[number];

const MAX_DAYS = 180;

export interface AdminStatsOverview {
  users: {
    total: number;
    active: number;
    locked: number;
    deleted: number;
    signups_7d: number;
    signups_30d: number;
    active_7d: number;
    active_30d: number;
  };
  learning: {
    reviews_7d: number;
    reviews_30d: number;
    collections: number;
    items: number;
    quiz_sessions: number;
    srs_due_now: number;
    streak_distribution: { bucket: string; users: number }[];
  };
  content: {
    gloss_reports_total: number;
    gloss_reports_by_status: { status: string; count: number }[];
    gloss_reports_open_by_issue: { issue: string; count: number }[];
    concepts_by_status: { status: string; count: number }[];
    sense_gloss: { total: number; machine: number; reviewed: number };
    sense_pairs: number;
  };
  ai: {
    window_days: number;
    by_feature: {
      feature: string;
      requests: number;
      tokens_in: number;
      tokens_out: number;
      cost_usd: number;
    }[];
    users_at_quota_today: number;
  };
}

export interface TimeseriesPoint {
  date: string;
  value: number;
}

/**
 * Thống kê vận hành M13 — CHỈ số liệu tổng hợp (không trả nội dung cá nhân).
 * Đọc app/core/serve bằng raw SQL read-only; ngày theo UTC.
 */
@Injectable()
export class AdminStatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async overview(): Promise<AdminStatsOverview> {
    const [users, learning, streaks, content, ai, quota] = await Promise.all([
      this.usersSummary(),
      this.learningSummary(),
      this.streakDistribution(),
      this.contentSummary(),
      this.aiSummary(),
      this.usersAtQuotaToday(),
    ]);

    return {
      users,
      learning: { ...learning, streak_distribution: streaks },
      content,
      ai: { ...ai, users_at_quota_today: quota },
    };
  }

  async timeseries(
    metric: string,
    days: number,
  ): Promise<{ metric: string; days: number; points: TimeseriesPoint[] }> {
    if (!(TIMESERIES_METRICS as readonly string[]).includes(metric)) {
      throw new DomainException(
        'VALIDATION_FAILED',
        `metric phải thuộc: ${TIMESERIES_METRICS.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const window = Math.min(Math.max(days, 1), MAX_DAYS);
    const rows = await this.metricRows(metric as TimeseriesMetric, window);
    return { metric, days: window, points: rows };
  }

  private async usersSummary(): Promise<AdminStatsOverview['users']> {
    const rows = await this.prisma.$queryRaw<
      {
        total: number;
        active: number;
        locked: number;
        deleted: number;
        signups_7d: number;
        signups_30d: number;
        active_7d: number;
        active_30d: number;
      }[]
    >(Prisma.sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE status = 'active')::int AS active,
             count(*) FILTER (WHERE status = 'locked')::int AS locked,
             count(*) FILTER (WHERE status = 'deleted')::int AS deleted,
             count(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS signups_7d,
             count(*) FILTER (WHERE created_at >= now() - interval '30 days')::int AS signups_30d,
             count(*) FILTER (WHERE last_login_at >= now() - interval '7 days')::int AS active_7d,
             count(*) FILTER (WHERE last_login_at >= now() - interval '30 days')::int AS active_30d
      FROM app.users
    `);
    return rows[0];
  }

  private async learningSummary(): Promise<
    Omit<AdminStatsOverview['learning'], 'streak_distribution'>
  > {
    const rows = await this.prisma.$queryRaw<
      {
        reviews_7d: number;
        reviews_30d: number;
        collections: number;
        items: number;
        quiz_sessions: number;
        srs_due_now: number;
      }[]
    >(Prisma.sql`
      SELECT
        (SELECT count(*) FROM app.review_log
          WHERE reviewed_at >= now() - interval '7 days')::int AS reviews_7d,
        (SELECT count(*) FROM app.review_log
          WHERE reviewed_at >= now() - interval '30 days')::int AS reviews_30d,
        (SELECT count(*) FROM app.collection WHERE archived_at IS NULL)::int AS collections,
        (SELECT count(*) FROM app.collection_item)::int AS items,
        (SELECT count(*) FROM app.study_session WHERE kind = 'quiz')::int AS quiz_sessions,
        (SELECT count(*) FROM app.srs_state s
          JOIN app.collection_item_face f ON f.id = s.face_id
          JOIN app.collection_item i ON i.id = f.item_id
          JOIN app.collection c ON c.id = i.collection_id
          JOIN app.study_profile p ON p.id = s.profile_id AND p.user_id = s.user_id
          WHERE NOT s.suspended AND s.due_at <= now()
            AND (s.buried_until IS NULL OR s.buried_until <= now())
            AND i.status <> 'paused' AND c.archived_at IS NULL
            AND c.owner_id = s.user_id AND c.profile_id = s.profile_id
            AND (f.language_id = p.primary_language_id OR f.language_id = p.secondary_language_id)
        )::int AS srs_due_now
    `);
    return rows[0];
  }

  private async streakDistribution(): Promise<
    AdminStatsOverview['learning']['streak_distribution']
  > {
    const rows = await this.prisma.$queryRaw<
      { bucket: string; users: number }[]
    >(
      Prisma.sql`
        SELECT bucket, count(*)::int AS users
        FROM (
          SELECT CASE
                   WHEN coalesce(streak_current, 0) = 0 THEN '0'
                   WHEN streak_current BETWEEN 1 AND 6 THEN '1-6'
                   WHEN streak_current BETWEEN 7 AND 29 THEN '7-29'
                   ELSE '30+'
                 END AS bucket
          FROM app.user_stats
        ) ranked
        GROUP BY bucket
        ORDER BY bucket
      `,
    );
    return rows;
  }

  private async contentSummary(): Promise<AdminStatsOverview['content']> {
    const [reports, byStatus, byIssue, concepts, glosses, pairs] =
      await Promise.all([
        this.prisma.$queryRaw<{ total: number }[]>(Prisma.sql`
          SELECT count(*)::int AS total FROM app.gloss_report
        `),
        this.prisma.$queryRaw<{ status: string; count: number }[]>(Prisma.sql`
          SELECT status, count(*)::int AS count FROM app.gloss_report GROUP BY status ORDER BY status
        `),
        this.prisma.$queryRaw<{ issue: string; count: number }[]>(Prisma.sql`
          SELECT issue, count(*)::int AS count FROM app.gloss_report WHERE status = 'open' GROUP BY issue ORDER BY count DESC
        `),
        this.prisma.$queryRaw<{ status: string; count: number }[]>(Prisma.sql`
          SELECT status, count(*)::int AS count FROM core.concept GROUP BY status ORDER BY status
        `),
        this.prisma.$queryRaw<
          { total: number; machine: number; reviewed: number }[]
        >(Prisma.sql`
          SELECT count(*)::int AS total,
                 count(*) FILTER (WHERE is_machine)::int AS machine,
                 count(*) FILTER (WHERE reviewed_by IS NOT NULL)::int AS reviewed
          FROM core.sense_gloss
        `),
        this.prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
          SELECT count(*)::int AS count FROM serve.sense_pair
        `),
      ]);

    return {
      gloss_reports_total: reports[0].total,
      gloss_reports_by_status: byStatus,
      gloss_reports_open_by_issue: byIssue,
      concepts_by_status: concepts,
      sense_gloss: glosses[0],
      sense_pairs: pairs[0].count,
    };
  }

  private async aiSummary(): Promise<
    Omit<AdminStatsOverview['ai'], 'users_at_quota_today'>
  > {
    const rows = await this.prisma.$queryRaw<
      {
        feature: string;
        requests: number;
        tokens_in: string | bigint;
        tokens_out: string | bigint;
        cost_usd: string;
      }[]
    >(Prisma.sql`
      SELECT feature,
             sum(request_count)::int AS requests,
             sum(tokens_in)::bigint AS tokens_in,
             sum(tokens_out)::bigint AS tokens_out,
             sum(cost_usd)::numeric AS cost_usd
      FROM app.ai_usage
      WHERE period >= (now() - interval '30 days')::date
      GROUP BY feature
      ORDER BY feature
    `);
    return {
      window_days: 30,
      by_feature: rows.map((row) => ({
        feature: row.feature,
        requests: row.requests,
        tokens_in: Number(row.tokens_in),
        tokens_out: Number(row.tokens_out),
        cost_usd: Number(row.cost_usd),
      })),
    };
  }

  private async usersAtQuotaToday(): Promise<number> {
    const chatLimit = this.positiveConfig('AI_DAILY_REQUEST_LIMIT', 50);
    const quizLimit = this.positiveConfig('AI_QUIZ_DAILY_LIMIT', 15);
    const rows = await this.prisma.$queryRaw<{ count: number }[]>(
      Prisma.sql`
        SELECT count(DISTINCT usage.user_id)::int AS count
        FROM app.ai_usage usage
        LEFT JOIN app.user_settings settings ON settings.user_id = usage.user_id
        WHERE usage.period = (now() AT TIME ZONE coalesce(settings.timezone, 'Asia/Ho_Chi_Minh'))::date
          AND ((usage.feature = 'chat' AND usage.request_count >= ${chatLimit})
               OR (usage.feature = 'quiz' AND usage.request_count >= ${quizLimit}))
      `,
    );
    return rows[0].count;
  }

  private metricRows(
    metric: TimeseriesMetric,
    days: number,
  ): Promise<TimeseriesPoint[]> {
    if (metric === 'signups') {
      return this.prisma.$queryRaw<TimeseriesPoint[]>(Prisma.sql`
        SELECT to_char(day, 'YYYY-MM-DD') AS date,
               coalesce(counted.total, 0)::int AS value
        FROM generate_series(
               (now() - make_interval(days => ${days - 1}))::date,
               now()::date,
               interval '1 day'
             ) AS day
        LEFT JOIN (
          SELECT created_at::date AS date, count(*) AS total
          FROM app.users
          WHERE created_at >= now() - make_interval(days => ${days})
          GROUP BY created_at::date
        ) counted ON counted.date = day::date
        ORDER BY day
      `);
    }
    if (metric === 'reviews') {
      return this.prisma.$queryRaw<TimeseriesPoint[]>(Prisma.sql`
        SELECT to_char(day, 'YYYY-MM-DD') AS date,
               coalesce(counted.total, 0)::int AS value
        FROM generate_series(
               (now() - make_interval(days => ${days - 1}))::date,
               now()::date,
               interval '1 day'
             ) AS day
        LEFT JOIN (
          SELECT reviewed_at::date AS date, count(*) AS total
          FROM app.review_log
          WHERE reviewed_at >= now() - make_interval(days => ${days})
          GROUP BY reviewed_at::date
        ) counted ON counted.date = day::date
        ORDER BY day
      `);
    }
    return this.prisma.$queryRaw<TimeseriesPoint[]>(Prisma.sql`
      SELECT to_char(day, 'YYYY-MM-DD') AS date,
             coalesce(counted.total, 0)::int AS value
      FROM generate_series(
             (now() - make_interval(days => ${days - 1}))::date,
             now()::date,
             interval '1 day'
           ) AS day
      LEFT JOIN (
        SELECT period AS date, sum(request_count) AS total
        FROM app.ai_usage
        WHERE period >= (now() - make_interval(days => ${days}))::date
        GROUP BY period
      ) counted ON counted.date = day::date
      ORDER BY day
    `);
  }

  private positiveConfig(key: string, fallback: number): number {
    const raw = this.config.get<number | string>(key);
    const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw;
    if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    return Math.floor(parsed);
  }
}
