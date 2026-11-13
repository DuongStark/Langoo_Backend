import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

/** Default-deny HTTP storage; public controllers may opt in deliberately. */
@Injectable()
export class HttpSecurityMiddleware implements NestMiddleware {
  use(_request: Request, response: Response, next: NextFunction): void {
    response.removeHeader('X-Powered-By');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-store');
    next();
  }
}
