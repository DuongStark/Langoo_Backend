import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';

interface Tokens {
  access_token: string;
  refresh_token: string;
  user: { id: string };
}

describe('M2.5 immediate logout revocation (HTTP + PostgreSQL)', () => {
  let app: INestApplication;
  let server: Server;
  let db: PrismaService;
  let jwt: JwtService;
  const users: bigint[] = [];
  const runId = Date.now();
  const password = 'm25-test-password-123';
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  async function fixture(label: string) {
    const email = `m25-${runId}-${label}@langoo.test`;
    const r = await request(server)
      .post('/v1/auth/register')
      .send({ email, password })
      .expect(201);
    const body = r.body as Tokens;
    users.push(BigInt(body.user.id));
    return {
      ...body,
      email,
      sid: jwt.decode<{ sid: string }>(body.access_token).sid,
    };
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    server = app.getHttpServer() as Server;
    db = app.get(PrismaService);
    jwt = app.get(JwtService);
  });
  afterAll(async () => {
    if (db) await db.user.deleteMany({ where: { id: { in: users } } });
    await app?.close();
  });

  it('logout invalidates all access/refresh tokens for that session and preserves another login', async () => {
    const first = await fixture('isolation');
    const other = (
      await request(server)
        .post('/v1/auth/login')
        .send({ email: first.email, password })
        .expect(200)
    ).body as Tokens;
    const refreshed = (
      await request(server)
        .post('/v1/auth/refresh')
        .send({ refresh_token: first.refresh_token })
        .expect(200)
    ).body as Tokens;
    const loggedOut = await request(server)
      .post('/v1/auth/logout')
      .set(auth(refreshed.access_token))
      .expect(200);
    for (const token of [first.access_token, refreshed.access_token]) {
      const rejected = await request(server)
        .get('/v1/auth/me')
        .set(auth(token))
        .expect(401);
      expect(rejected.body).toMatchObject({ code: 'AUTH_TOKEN_INVALID' });
    }
    await request(server)
      .post('/v1/auth/refresh')
      .send({ refresh_token: refreshed.refresh_token })
      .expect(401);
    await request(server)
      .get('/v1/auth/me')
      .set(auth(other.access_token))
      .expect(200);
    const retry = await request(server)
      .post('/v1/auth/logout')
      .set(auth(refreshed.access_token))
      .expect(200);
    expect(retry.body).toEqual(loggedOut.body);
  });

  it('revoked token is rejected by private, optional, feedback and admin routes; guest browsing survives', async () => {
    const user = await fixture('guards');
    await db.user.update({
      where: { id: BigInt(user.user.id) },
      data: { role: 'admin' },
    });
    await request(server)
      .get('/v1/admin/stats')
      .set(auth(user.access_token))
      .expect(200);
    await request(server)
      .post('/v1/auth/logout')
      .set(auth(user.access_token))
      .expect(200);
    for (const path of [
      '/v1/collections',
      '/v1/dictionary/search?q=run',
      '/v1/admin/stats',
    ]) {
      await request(server).get(path).set(auth(user.access_token)).expect(401);
    }
    await request(server)
      .post('/v1/feedback')
      .set(auth(user.access_token))
      .send({ category: 'bug', content: 'm25 revoked feedback' })
      .expect(401);
    await request(server).get('/v1/dictionary/search?q=run').expect(200);
  });

  it('refresh racing logout cannot revive the session', async () => {
    const user = await fixture('race');
    const [rotated, revoked] = await Promise.all([
      request(server)
        .post('/v1/auth/refresh')
        .send({ refresh_token: user.refresh_token }),
      request(server).post('/v1/auth/logout').set(auth(user.access_token)),
    ]);
    expect(revoked.status).toBe(200);
    expect([200, 401]).toContain(rotated.status);
    await request(server)
      .get('/v1/auth/me')
      .set(auth(user.access_token))
      .expect(401);
    if (rotated.status === 200) {
      const body = rotated.body as Tokens;
      await request(server)
        .get('/v1/auth/me')
        .set(auth(body.access_token))
        .expect(401);
      await request(server)
        .post('/v1/auth/refresh')
        .send({ refresh_token: body.refresh_token })
        .expect(401);
    }
  });

  it('simultaneous logout retries keep one stable revocation timestamp', async () => {
    const user = await fixture('retry');
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        request(server).post('/v1/auth/logout').set(auth(user.access_token)),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(
      new Set(
        responses.map((r) => (r.body as { revoked_at: string }).revoked_at),
      ).size,
    ).toBe(1);
  });

  it.each(['expired', 'missing', 'locked', 'deleted'])(
    'rejects %s session/account even if JWT has time left',
    async (state) => {
      const user = await fixture(state);
      if (state === 'expired')
        await db.userSession.update({
          where: { id: user.sid },
          data: { expiresAt: new Date(Date.now() - 1000) },
        });
      if (state === 'missing')
        await db.userSession.delete({ where: { id: user.sid } });
      if (state === 'locked' || state === 'deleted')
        await db.user.update({
          where: { id: BigInt(user.user.id) },
          data: { status: state },
        });
      await request(server)
        .get('/v1/auth/me')
        .set(auth(user.access_token))
        .expect(401);
    },
  );

  it('a correctly signed but mismatched sub/sid cannot access or revoke another user session', async () => {
    const a = await fixture('owner-a');
    const b = await fixture('owner-b');
    const mismatch = await jwt.signAsync(
      { typ: 'access', sub: a.user.id, sid: b.sid },
      { expiresIn: 900 },
    );
    await request(server).get('/v1/auth/me').set(auth(mismatch)).expect(401);
    await request(server)
      .post('/v1/auth/logout')
      .set(auth(mismatch))
      .expect(401);
    await request(server)
      .get('/v1/auth/me')
      .set(auth(b.access_token))
      .expect(200);
  });

  it('DB lookup failure returns 503 without treating a valid token as anonymous', async () => {
    const user = await fixture('db-error');
    const failed = jest
      .spyOn(db.userSession, 'findUnique')
      .mockRejectedValue(new Error('m25 DB unavailable'));
    try {
      for (const path of ['/v1/auth/me', '/v1/dictionary/search?q=run']) {
        const res = await request(server)
          .get(path)
          .set(auth(user.access_token))
          .expect(503);
        expect(res.body).toMatchObject({ code: 'AUTH_SERVICE_UNAVAILABLE' });
      }
    } finally {
      failed.mockRestore();
    }
  });
});
