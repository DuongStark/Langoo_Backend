import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException } from '../common/errors/domain.exception';
import {
  decodeBigintTimeCursor,
  encodeTimeIdCursor,
} from '../common/pagination/time-cursor';
import { PrismaService } from '../db/prisma.service';
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
  user: { id: bigint; email: string } | null;
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
        : decodeBigintTimeCursor(query.cursor);

    const rows = await this.prisma.glossReport.findMany({
      where: {
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.issue === undefined ? {} : { issue: query.issue }),
        ...(query.target_kind === undefined
          ? {}
          : { targetKind: query.target_kind }),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      include: { user: { select: { id: true, email: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasNext = rows.length > limit;
    const page = hasNext ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    return {
      data: page.map(toResponse),
      next_cursor:
        hasNext && last
          ? encodeTimeIdCursor({
              createdAt: last.createdAt,
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
