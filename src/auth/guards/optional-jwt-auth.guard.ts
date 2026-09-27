import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DomainException } from '../../common/errors/domain.exception';
import { JwtPayload } from '../types/auth.types';
import { AuthenticatedRequest } from './jwt-auth.guard';

/**
 * Xác thực Bearer access token NẾU client gửi kèm — dùng cho endpoint công khai
 * (ví dụ tra từ điển): không có token vẫn qua, nhưng token bẩn thì bị từ chối
 * để client sớm phát hiện (thay vì âm thầm coi là khách vãng lai).
 */
@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (!header) {
      return true;
    }
    if (!header.startsWith('Bearer ')) {
      throw invalidToken();
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
      throw invalidToken();
    }
  }
}

function invalidToken(): DomainException {
  return new DomainException(
    'AUTH_TOKEN_INVALID',
    'Access token không hợp lệ hoặc đã hết hạn',
    HttpStatus.UNAUTHORIZED,
  );
}
