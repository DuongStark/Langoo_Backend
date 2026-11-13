import { NestExpressApplication } from '@nestjs/platform-express';

/** Caddy must verify its edge peer and overwrite XFF with one resolved client IP.
 * Never consume CF-Connecting-IP directly here or trust every proxy hop.
 * Candidate/harness: docs/ops/m12-feedback-sync-2026-11-13/.
 */
export function configureHttpProxy(app: NestExpressApplication): void {
  app.set('trust proxy', 'loopback');
}
