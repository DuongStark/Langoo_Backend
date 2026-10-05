import { ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerException, ThrottlerStorage } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../auth/guards/jwt-auth.guard';

const LIMIT = 10;
const TTL_MS = 3_600_000;

/** Authenticate before counting the user's feedback quota; global IP limits still apply. */
@Injectable()
export class FeedbackRateLimitGuard extends JwtAuthGuard {
  constructor(
    jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(ThrottlerStorage) private readonly storage: ThrottlerStorage,
  ) {
    super(jwt);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await super.canActivate(context);
    if (this.config.get<boolean>('RATE_LIMIT_ENABLED') === false) return true;
    const http = context.switchToHttp();
    const req = http.getRequest<AuthenticatedRequest>();
    const res = http.getResponse<Response>();
    const record = await this.storage.increment(
      `feedback:user:${req.user!.sub}`,
      TTL_MS,
      LIMIT,
      TTL_MS,
      'feedback-user',
    );
    res.setHeader('X-RateLimit-Limit-Feedback', LIMIT);
    res.setHeader(
      'X-RateLimit-Remaining-Feedback',
      Math.max(0, LIMIT - record.totalHits),
    );
    res.setHeader('X-RateLimit-Reset-Feedback', record.timeToExpire);
    if (record.isBlocked) {
      res.setHeader('Retry-After', record.timeToBlockExpire);
      throw new ThrottlerException();
    }
    return true;
  }
}
