import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException } from '../common/errors/domain.exception';
import { parsePositivePostgresBigInt } from '../common/ids/postgres-id';
import { PrismaService } from '../db/prisma.service';
import { AdminAuditService } from './admin-audit.service';
import { UpdateUserStatusDto } from './dto/admin.dto';

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

    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true, role: true },
    });
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

    const updated = await this.prisma.$transaction(async (tx) => {
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
