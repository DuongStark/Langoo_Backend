import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { verifyBearerAccessToken } from './access-token';
import { AuthenticatedRequest } from './jwt-auth.guard';

/** Only for logout: the service verifies ownership and permits revoked-session retries. */
@Injectable()
export class LogoutJwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.user = await verifyBearerAccessToken(
      this.jwt,
      request.headers.authorization,
    );
    return true;
  }
}
