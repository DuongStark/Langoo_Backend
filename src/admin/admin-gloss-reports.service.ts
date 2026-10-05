import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException } from '../common/errors/domain.exception';
import {
  decodePostgresTimeCursor,
  encodeTimeIdCursor,
} from '../common/pagination/time-cursor';
import { PrismaService } from '../db/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { AdminAuditService } from './admin-audit.service';
import {
  AdminGlossReportQueryDto,
  UpdateGlossReportDto,
} from './dto/admin.dto';

export interface AdminGlossReportResponse {
  id: string;
  target_kind: string;
  target_id: string;
  language_id: number | null;
  issue: string;
  comment: string | null;
  status: string;
  user: { id: string; email: string } | null;
  created_at: string;
  resolved_at: string | null;
}

const DEFAULT_PAGE = 20;
const MAX_PAGE = 100;

interface ReportRow {
  id: bigint;
  targetKind: string;
  targetId: string;
  languageId: number | null;
  issue: string;
  comment: string | null;
  status: string;
  createdAt: Date;
  resolvedAt: Date | null;
  createdAtKey?: string;
  user: { id: bigint | string; email: string } | null;
}

/**
 * Xử lý `app.gloss_report` (báo lỗi gloss của người dùng) — dữ liệu user chủ động
 * gửi, ngoại lệ duy nhất admin được xem chi tiết. KHÔNG ghi vào core.
 */
@Injectable()
export class AdminGlossReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  async list(
    query: AdminGlossReportQueryDto,
  ): Promise<{ data: AdminGlossReportResponse[]; next_cursor: string | null }> {
    const limit = clampLimit(query.limit);
    const cursor =
      query.cursor === undefined || query.cursor === ''
        ? null
        : decodePostgresTimeCursor(query.cursor, 'bigint');

    const rows = await this.prisma.$queryRaw<ReportRow[]>(Prisma.sql`
      SELECT r.id, r.target_kind AS "targetKind", r.target_id AS "targetId",
             r.language_id AS "languageId", r.issue, r.comment, r.status,
             r.created_at AS "createdAt", r.resolved_at AS "resolvedAt",
             to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAtKey",
             CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object('id', u.id::text, 'email', u.email) END AS "user"
      FROM app.gloss_report r LEFT JOIN app.users u ON u.id = r.user_id
      WHERE true
        ${query.status === undefined ? Prisma.empty : Prisma.sql`AND r.status = ${query.status}`}
        ${query.issue === undefined ? Prisma.empty : Prisma.sql`AND r.issue = ${query.issue}`}
        ${query.target_kind === undefined ? Prisma.empty : Prisma.sql`AND r.target_kind = ${query.target_kind}`}
        ${cursor ? Prisma.sql`AND (r.created_at, r.id) < (${cursor.createdAt}::timestamptz, ${cursor.id}::bigint)` : Prisma.empty}
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ${limit + 1}
    `);

    const hasNext = rows.length > limit;
    const page = hasNext ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    return {
      data: page.map(toResponse),
      next_cursor:
        hasNext && last
          ? encodeTimeIdCursor({
              createdAt: last.createdAt,
              createdAtKey: last.createdAtKey,
              id: last.id.toString(),
            })
          : null,
    };
  }

  async update(
    adminUserId: bigint,
    reportId: string,
    dto: UpdateGlossReportDto,
  ): Promise<AdminGlossReportResponse> {
    const existing = await this.prisma.glossReport.findUnique({
      where: { id: BigInt(reportId) },
      select: { id: true, status: true },
    });
    if (!existing) {
      throw new DomainException(
        'GLOSS_REPORT_NOT_FOUND',
        'Không tìm thấy báo lỗi gloss',
        HttpStatus.NOT_FOUND,
      );
    }

    const resolvedAt =
      dto.status === 'fixed' || dto.status === 'rejected' ? new Date() : null;

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.glossReport.update({
        where: { id: existing.id },
        data: { status: dto.status, resolvedAt },
        include: { user: { select: { id: true, email: true } } },
      });
      await this.audit.record(tx, {
        adminUserId,
        action: 'gloss-report.update',
        targetKind: 'gloss_report',
        targetId: existing.id.toString(),
        payload: { status: dto.status },
      });
      return row;
    });
    return toResponse(updated);
  }
}

function clampLimit(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_PAGE;
  }
  return Math.min(Math.max(value, 1), MAX_PAGE);
}

function toResponse(row: ReportRow): AdminGlossReportResponse {
  return {
    id: row.id.toString(),
    target_kind: row.targetKind,
    target_id: row.targetId,
    language_id: row.languageId,
    issue: row.issue,
    comment: row.comment,
    status: row.status,
    user: row.user
      ? { id: row.user.id.toString(), email: row.user.email }
      : null,
    created_at: row.createdAt.toISOString(),
    resolved_at: row.resolvedAt?.toISOString() ?? null,
  };
}
