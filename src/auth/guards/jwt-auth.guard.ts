import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { DomainException } from '../../common/errors/domain.exception';
import { JwtPayload } from '../types/auth.types';

export type AuthenticatedRequest = Request & { user?: JwtPayload };

/**
 * Xác thực Bearer access token (HS256, hết hạn 15 phút).
 * KHÔNG tra DB mỗi request — access token ngắn hạn tự hết hiệu lực;
 * refresh token của session bị thu hồi ngay khi logout.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new DomainException(
        'AUTH_TOKEN_MISSING',
        'Thiếu access token',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const token = header.slice('Bearer '.length).trim();
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      if (payload.typ !== 'access' || !payload.sub || !payload.sid) {
        throw new Error('claims không hợp lệ');
      }
      request.user = payload;
      return true;
    } catch {
      throw new DomainException(
        'AUTH_TOKEN_INVALID',
        'Access token không hợp lệ hoặc đã hết hạn',
        HttpStatus.UNAUTHORIZED,
      );
    }
  }
}
