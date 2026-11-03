import { ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../db/prisma.service';
import { AuthenticatedRequest, JwtAuthGuard } from './jwt-auth.guard';

/**
 * Xác thực Bearer access token NẾU client gửi kèm — dùng cho endpoint công khai
 * (ví dụ tra từ điển): không có token vẫn qua, nhưng token bẩn thì bị từ chối
 * để client sớm phát hiện (thay vì âm thầm coi là khách vãng lai).
 */
@Injectable()
export class OptionalJwtAuthGuard extends JwtAuthGuard {
  constructor(jwt: JwtService, prisma: PrismaService) {
    super(jwt, prisma);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (!header) {
      return true;
    }
    return super.canActivate(context);
  }
}
