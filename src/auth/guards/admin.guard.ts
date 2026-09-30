import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DomainException } from '../../common/errors/domain.exception';
import { PrismaService } from '../../db/prisma.service';
import { AuthenticatedRequest, JwtAuthGuard } from './jwt-auth.guard';

/**
 * Guard cho /v1/admin/*: JWT hợp lệ + user phải là `role='admin'` và đang active.
 * Đọc DB mỗi request (thao tác admin không nhiều) để thu hồi quyền có hiệu lực ngay,
 * không phụ thuộc claim cũ trong access token.
 */
@Injectable()
export class AdminGuard extends JwtAuthGuard implements CanActivate {
  constructor(
    jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {
    super(jwt);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await super.canActivate(context);
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    let userId: bigint;
    try {
      userId = BigInt(request.user!.sub);
    } catch {
      throw new DomainException(
        'AUTH_TOKEN_INVALID',
        'Access token không hợp lệ',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, status: true },
    });
    if (!user || user.role !== 'admin' || user.status !== 'active') {
      throw new DomainException(
        'ADMIN_REQUIRED',
        'Cần quyền quản trị để thực hiện thao tác này',
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}
