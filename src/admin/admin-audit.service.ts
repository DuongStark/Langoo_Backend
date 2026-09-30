import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../db/prisma.service';
import {
  decodeBigintTimeCursor,
  encodeTimeIdCursor,
} from '../common/pagination/time-cursor';

export interface AuditEntry {
  adminUserId: bigint;
  action: string;
  targetKind?: string | null;
  targetId?: string | null;
  payload?: Record<string, unknown>;
}

/** Ghi audit cho mọi mutation admin — gọi TRONG transaction của thao tác. */
@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
    await tx.adminAuditLog.create({
      data: {
        adminUserId: entry.adminUserId,
        action: entry.action,
        targetKind: entry.targetKind ?? null,
        targetId: entry.targetId ?? null,
        payload: (entry.payload ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  async list(query: { limit?: number; cursor?: string }): Promise<{
    data: {
      id: string;
      admin: { id: string; email: string };
      action: string;
      target_kind: string | null;
      target_id: string | null;
      payload: unknown;
      created_at: string;
    }[];
    next_cursor: string | null;
  }> {
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const cursor =
      query.cursor === undefined || query.cursor === ''
        ? null
        : decodeBigintTimeCursor(query.cursor);
    const rows = await this.prisma.adminAuditLog.findMany({
      where: cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {},
      include: { admin: { select: { id: true, email: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasNext = rows.length > limit;
    const page = hasNext ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    return {
      data: page.map((row) => ({
        id: row.id.toString(),
        admin: { id: row.admin.id.toString(), email: row.admin.email },
        action: row.action,
        target_kind: row.targetKind,
        target_id: row.targetId,
        payload: row.payload,
        created_at: row.createdAt.toISOString(),
      })),
      next_cursor:
        hasNext && last
          ? encodeTimeIdCursor({
              createdAt: last.createdAt,
              id: last.id.toString(),
            })
          : null,
    };
  }
}
