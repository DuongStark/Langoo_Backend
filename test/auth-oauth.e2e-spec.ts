import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import {
  GoogleIdTokenVerifier,
  GoogleIdentity,
} from '../src/auth/oauth/google-id-token.verifier';
import { DomainException } from '../src/common/errors/domain.exception';
import { PrismaService } from '../src/db/prisma.service';

/**
 * Token giả cho e2e: `stub|<sub>|<email>|<true|false>|<nonce tùy chọn>`.
 * Verifier thật bị override bằng stub để không gọi Google; logic liên kết/session
 * chạy trên DB thật `langoo_test`.
 */
function stubIdentity(token: string): GoogleIdentity {
  const [prefix, sub, email, verified, nonce] = token.split('|');
  if (prefix !== 'stub') {
    throw new DomainException(
      'AUTH_OAUTH_TOKEN_INVALID',
      'Google ID token không hợp lệ hoặc đã hết hạn',
      HttpStatus.UNAUTHORIZED,
    );
  }
  return {
    sub,
    email,
    emailVerified: verified === 'true',
    name: null,
    picture: null,
    nonce: nonce === undefined || nonce === '' ? null : nonce,
  };
}

const verifierStub = {
  verify: jest.fn((idToken: string) => Promise.resolve(stubIdentity(idToken))),
};

interface AuthBody {
  user: {
    id: string;
    email: string;
    avatar_url: string | null;
    last_login_at: string | null;
  };
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

describe('Google OAuth (e2e — langoo_test)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;

  const runId = Date.now();
  let subCounter = 0;
  const nextSub = (): string => `e2e-google-${runId}-${++subCounter}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(GoogleIdTokenVerifier)
      .useValue(verifierStub)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('lần đầu: tạo user + settings + identity Google + session, token dùng được', async () => {
    const sub = nextSub();
    const email = `e2e-oauth-first-${runId}@langoo.test`;

    const res = await request(server)
      .post('/v1/auth/oauth/google')
      .send({
        id_token: `stub|${sub}|${email}|true`,
        device: { platform: 'android', app_version: '1.0.0' },
      })
      .expect(200);
    const body = res.body as AuthBody;

    expect(body.user.email).toBe(email);
    expect(body.user.last_login_at).not.toBeNull();
    expect(body.expires_in).toBe(900);

    const meRes = await request(server)
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${body.access_token}`)
      .expect(200);
    expect((meRes.body as { id: string }).id).toBe(body.user.id);

    const userId = BigInt(body.user.id);
    const settings = await prisma.userSettings.findUnique({
      where: { userId },
    });
    expect(settings).not.toBeNull();

    const identity = await prisma.userIdentity.findFirst({
      where: { userId, provider: 'google', providerUid: sub },
    });
    expect(identity).not.toBeNull();
    expect(identity?.emailVerifiedAt).not.toBeNull();

    const sessionCount = await prisma.userSession.count({
      where: { userId, revokedAt: null },
    });
    expect(sessionCount).toBe(1);
  });

  it('lần sau (cùng sub): dùng lại user, tạo session mới', async () => {
    const sub = nextSub();
    const email = `e2e-oauth-repeat-${runId}@langoo.test`;
    const token = `stub|${sub}|${email}|true`;

    const first = await request(server)
      .post('/v1/auth/oauth/google')
      .send({ id_token: token })
      .expect(200);
    const second = await request(server)
      .post('/v1/auth/oauth/google')
      .send({ id_token: token })
      .expect(200);

    const firstBody = first.body as AuthBody;
    const secondBody = second.body as AuthBody;
    expect(secondBody.user.id).toBe(firstBody.user.id);
    expect(secondBody.refresh_token).not.toBe(firstBody.refresh_token);

    const identities = await prisma.userIdentity.count({
      where: { userId: BigInt(firstBody.user.id), provider: 'google' },
    });
    expect(identities).toBe(1);

    const sessionCount = await prisma.userSession.count({
      where: { userId: BigInt(firstBody.user.id), revokedAt: null },
    });
    expect(sessionCount).toBe(2);
  });

  it('email trùng tài khoản password → tự động liên kết, cả hai cách đăng nhập vào một user', async () => {
    const email = `e2e-oauth-link-${runId}@langoo.test`;
    const password = 'matkhau-e2e-123';

    const registerRes = await request(server)
      .post('/v1/auth/register')
      .send({ email, password })
      .expect(201);
    const registered = registerRes.body as AuthBody;

    const oauthRes = await request(server)
      .post('/v1/auth/oauth/google')
      .send({ id_token: `stub|${nextSub()}|${email}|true` })
      .expect(200);
    const oauthBody = oauthRes.body as AuthBody;
    expect(oauthBody.user.id).toBe(registered.user.id);

    const loginRes = await request(server)
      .post('/v1/auth/login')
      .send({ email, password })
      .expect(200);
    expect((loginRes.body as AuthBody).user.id).toBe(registered.user.id);

    const identities = await prisma.userIdentity.count({
      where: { userId: BigInt(registered.user.id) },
    });
    expect(identities).toBe(2);
  });

  it('email Google chưa xác thực → 403 AUTH_OAUTH_EMAIL_UNVERIFIED', async () => {
    const res = await request(server)
      .post('/v1/auth/oauth/google')
      .send({
        id_token: `stub|${nextSub()}|unverified-${runId}@langoo.test|false`,
      })
      .expect(403);

    expect(res.body).toMatchObject({ code: 'AUTH_OAUTH_EMAIL_UNVERIFIED' });
  });

  it('ID token không hợp lệ → 401 AUTH_OAUTH_TOKEN_INVALID', async () => {
    const res = await request(server)
      .post('/v1/auth/oauth/google')
      .send({ id_token: 'token-khong-hop-le' })
      .expect(401);

    expect(res.body).toMatchObject({ code: 'AUTH_OAUTH_TOKEN_INVALID' });
  });

  it('nonce lệch → 401 AUTH_OAUTH_TOKEN_INVALID', async () => {
    const res = await request(server)
      .post('/v1/auth/oauth/google')
      .send({
        id_token: `stub|${nextSub()}|nonce-${runId}@langoo.test|true|nonce-google`,
        nonce: 'nonce-khac',
      })
      .expect(401);

    expect(res.body).toMatchObject({ code: 'AUTH_OAUTH_TOKEN_INVALID' });
  });

  it('device sai kiểu → 400 VALIDATION_FAILED', async () => {
    const res = await request(server)
      .post('/v1/auth/oauth/google')
      .send({
        id_token: `stub|${nextSub()}|device-${runId}@langoo.test|true`,
        device: [],
      })
      .expect(400);

    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('tài khoản bị khoá → 403 AUTH_ACCOUNT_LOCKED', async () => {
    const email = `e2e-oauth-locked-${runId}@langoo.test`;
    const registerRes = await request(server)
      .post('/v1/auth/register')
      .send({ email, password: 'matkhau-e2e-123' })
      .expect(201);
    const userId = BigInt((registerRes.body as AuthBody).user.id);

    await prisma.user.update({
      where: { id: userId },
      data: { status: 'locked' },
    });

    const res = await request(server)
      .post('/v1/auth/oauth/google')
      .send({ id_token: `stub|${nextSub()}|${email}|true` })
      .expect(403);

    expect(res.body).toMatchObject({ code: 'AUTH_ACCOUNT_LOCKED' });
  });
});
