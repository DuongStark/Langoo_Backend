import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedRequest } from '../guards/jwt-auth.guard';
import { JwtPayload } from '../types/auth.types';

/** Lấy payload JWT của request (chỉ dùng cùng JwtAuthGuard). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): JwtPayload => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      throw new Error('CurrentUser chỉ được dùng cùng JwtAuthGuard');
    }
    return request.user;
  },
);
