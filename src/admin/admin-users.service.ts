import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException } from '../common/errors/domain.exception';
import { parsePositivePostgresBigInt } from '../common/ids/postgres-id';
import {
  decodePostgresTimeCursor,
  encodeTimeIdCursor,
} from '../common/pagination/time-cursor';
import { PrismaService } from '../db/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { AdminAuditService } from './admin-audit.service';
import {
  AdminUserDto,
  AdminUserQueryDto,
  UpdateUserStatusDto,
} from './dto/admin.dto';

const DEFAULT_PAGE = 20;
const MAX_PAGE = 100;

function clampLimit(limit?: number): number {
  if (limit === undefined) return DEFAULT_PAGE;
  return Math.min(Math.max(limit, 1), MAX_PAGE);
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

interface UserRow {
  id: bigint;
  email: string;
  displayName: string | null;
  role: string;
  status: string;
  createdAt: Date;
  lastLoginAt: Date | null;
  createdAtKey?: string;
}

/**
 * Khoá/mở tài khoản người học (M13): chỉ đổi `active <-> locked`, không xoá cứng,
 * không đụng tài khoản admin (kể cả chính mình) — có audit.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  /** Danh sách/tìm người học — chỉ metadata tài khoản, keyset (created_at, id) desc. */
  async list(query: AdminUserQueryDto): Promise<{
    data: AdminUserDto[];
    next_cursor: string | null;
  }> {
    const limit = clampLimit(query.limit);
    const cursor =
      query.cursor === undefined || query.cursor === ''
        ? null
        : decodePostgresTimeCursor(query.cursor, 'bigint');
    const search =
      query.q !== undefined && query.q.trim() !== ''
        ? `%${escapeLikePattern(query.q.trim())}%`
        : null;

    const rows = await this.prisma.$queryRaw<UserRow[]>(Prisma.sql`
      SELECT u.id, u.email, u.display_name AS "displayName", u.role, u.status,
             u.created_at AS "createdAt", u.last_login_at AS "lastLoginAt",
             to_char(u.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAtKey"
      FROM app.users u
      WHERE TRUE
        ${query.status === undefined ? Prisma.empty : Prisma.sql`AND u.status = ${query.status}`}
        ${query.role === undefined ? Prisma.empty : Prisma.sql`AND u.role = ${query.role}`}
        ${
          search === null
            ? Prisma.empty
            : Prisma.sql`AND (u.email ILIKE ${search} ESCAPE '\\' OR u.display_name ILIKE ${search} ESCAPE '\\')`
        }
        ${cursor ? Prisma.sql`AND (u.created_at, u.id) < (${cursor.createdAt}::timestamptz, ${cursor.id}::bigint)` : Prisma.empty}
      ORDER BY u.created_at DESC, u.id DESC
      LIMIT ${limit + 1}
    `);

    const hasNext = rows.length > limit;
    const page = hasNext ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    return {
      data: page.map((row) => ({
        id: row.id.toString(),
        email: row.email,
        display_name: row.displayName,
        role: row.role,
        status: row.status,
        created_at: row.createdAt.toISOString(),
        last_login_at: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
      })),
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

  async updateStatus(
    adminUserId: bigint,
    rawUserId: string,
    dto: UpdateUserStatusDto,
  ): Promise<{ id: string; status: string }> {
    const userId = parsePositivePostgresBigInt(rawUserId, 'ID người dùng');

    if (userId === adminUserId) {
      throw new DomainException(
        'USER_STATUS_INVALID',
        'Không thể tự đổi trạng thái tài khoản của chính mình',
        HttpStatus.CONFLICT,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const [target] = await tx.$queryRaw<
        { id: bigint; status: string; role: string }[]
      >(
        Prisma.sql`SELECT id, status, role FROM app.users WHERE id = ${userId} FOR UPDATE`,
      );
      if (!target) {
        throw new DomainException(
          'USER_NOT_FOUND',
          'Không tìm thấy người dùng',
          HttpStatus.NOT_FOUND,
        );
      }
      if (target.role === 'admin') {
        throw new DomainException(
          'USER_STATUS_INVALID',
          'Không đổi trạng thái tài khoản quản trị',
          HttpStatus.CONFLICT,
        );
      }
      if (target.status === 'deleted') {
        throw new DomainException(
          'USER_STATUS_INVALID',
          'Tài khoản đã bị xoá, không thể hồi sinh bằng endpoint này',
          HttpStatus.CONFLICT,
        );
      }
      if (target.status === dto.status) {
        return { id: target.id.toString(), status: target.status };
      }

      const row = await tx.user.update({
        where: { id: userId },
        data: { status: dto.status },
      });
      await this.audit.record(tx, {
        adminUserId,
        action: 'user.status',
        targetKind: 'user',
        targetId: userId.toString(),
        payload: { status: dto.status },
      });
      return row;
    });

    return { id: updated.id.toString(), status: updated.status };
  }
}
