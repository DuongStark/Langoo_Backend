import express from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureHttpProxy } from './http-proxy';

describe('M12-A03 Express trust boundary', () => {
  it('trusts only loopback, never an arbitrary private/public peer', () => {
    const app = express();
    configureHttpProxy(app as unknown as NestExpressApplication);
    const trust = app.get('trust proxy fn') as (
      ip: string,
      hop: number,
    ) => boolean;
    expect(trust('127.0.0.1', 0)).toBe(true);
    expect(trust('::1', 0)).toBe(true);
    expect(trust('172.20.0.2', 0)).toBe(false);
    expect(trust('203.0.113.1', 0)).toBe(false);
  });
});
