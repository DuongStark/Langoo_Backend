import { NestExpressApplication } from '@nestjs/platform-express';

/** Caddy connects from loopback on the VPS; other peers cannot supply client IPs. */
export function configureHttpProxy(app: NestExpressApplication): void {
  app.set('trust proxy', 'loopback');
}
