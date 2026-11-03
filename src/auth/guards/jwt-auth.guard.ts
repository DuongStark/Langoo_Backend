import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { DomainException } from '../../common/errors/domain.exception';
import { PrismaService } from '../../db/prisma.service';
import { JwtPayload } from '../types/auth.types';
import { invalidAccessToken, verifyBearerAccessToken } from './access-token';

export type AuthenticatedRequest = Request & { user?: JwtPayload };

/**
 * Xác thực JWT và session từ DB mỗi request để logout thu hồi ngay.
 * Không cache session active: trạng thái cached sẽ giữ quyền sau revocation.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly sessions: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const payload = await verifyBearerAccessToken(
      this.jwt,
      request.headers.authorization,
    );
    let session;
    try {
      session = await this.sessions.userSession.findUnique({
        where: { id: payload.sid },
        select: {
          userId: true,
          revokedAt: true,
          expiresAt: true,
          user: { select: { status: true } },
        },
      });
    } catch {
      throw new DomainException(
        'AUTH_SERVICE_UNAVAILABLE',
        'Không thể xác minh phiên đăng nhập, vui lòng thử lại sau',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (
      !session ||
      session.userId !== BigInt(payload.sub) ||
      session.revokedAt !== null ||
      session.expiresAt <= new Date() ||
      session.user.status !== 'active'
    ) {
      throw invalidAccessToken();
    }
    request.user = payload;
    return true;
  }
}
