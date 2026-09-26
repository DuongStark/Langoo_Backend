import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';

interface AuthBody {
  user: {
    id: string;
    email: string;
    display_name: string | null;
    last_login_at: string | null;
  };
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

describe('Auth (e2e — langoo_test)', () => {
  let app: INestApplication;
  let server: Server;

  const email = `e2e-auth-${Date.now()}@langoo.test`;
  const password = 'matkhau-e2e-123';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('luồng đầy đủ: register → me → login → refresh xoay token → logout', async () => {
    const registerRes = await request(server)
      .post('/v1/auth/register')
      .send({
        email,
        password,
        display_name: 'E2E',
        device: { platform: 'android', app_version: '1.0.0' },
      })
      .expect(201);
    const registerBody = registerRes.body as AuthBody;
    expect(registerBody.user.email).toBe(email);
    expect(registerBody.user.display_name).toBe('E2E');
    expect(registerBody.expires_in).toBe(900);
    expect(registerBody.refresh_token.length).toBeGreaterThanOrEqual(40);

    const meRes = await request(server)
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${registerBody.access_token}`)
      .expect(200);
    expect((meRes.body as { email: string }).email).toBe(email);

    const loginRes = await request(server)
      .post('/v1/auth/login')
      .send({ email, password })
      .expect(200);
    const loginBody = loginRes.body as AuthBody;
    expect(loginBody.refresh_token).not.toBe(registerBody.refresh_token);
    expect(loginBody.user.last_login_at).not.toBeNull();

    const refreshRes = await request(server)
      .post('/v1/auth/refresh')
      .send({ refresh_token: loginBody.refresh_token })
      .expect(200);
    const refreshBody = refreshRes.body as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    expect(refreshBody.refresh_token).not.toBe(loginBody.refresh_token);
    expect(refreshBody.expires_in).toBe(900);

    const reuseRes = await request(server)
      .post('/v1/auth/refresh')
      .send({ refresh_token: loginBody.refresh_token })
      .expect(401);
    expect(reuseRes.body).toMatchObject({ code: 'AUTH_INVALID_REFRESH_TOKEN' });

    const logoutRes = await request(server)
      .post('/v1/auth/logout')
      .set('Authorization', `Bearer ${refreshBody.access_token}`)
      .expect(200);
    const logoutBody = logoutRes.body as { revoked_at: string | null };
    expect(typeof logoutBody.revoked_at).toBe('string');

    const afterLogoutRes = await request(server)
      .post('/v1/auth/refresh')
      .send({ refresh_token: refreshBody.refresh_token })
      .expect(401);
    expect(afterLogoutRes.body).toMatchObject({
      code: 'AUTH_INVALID_REFRESH_TOKEN',
    });
  });

  it('đăng ký trùng email → 409 AUTH_EMAIL_TAKEN', async () => {
    const res = await request(server)
      .post('/v1/auth/register')
      .send({ email, password })
      .expect(409);

    expect(res.body).toMatchObject({ code: 'AUTH_EMAIL_TAKEN' });
  });

  it('sai mật khẩu → 401 AUTH_INVALID_CREDENTIALS', async () => {
    const res = await request(server)
      .post('/v1/auth/login')
      .send({ email, password: 'sai-mat-khau-123' })
      .expect(401);

    expect(res.body).toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
  });

  it('dữ liệu không hợp lệ → 400 VALIDATION_FAILED', async () => {
    const res = await request(server)
      .post('/v1/auth/register')
      .send({ email: 'khong-phai-email', password: '123' })
      .expect(400);

    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('me không có token → 401 AUTH_TOKEN_MISSING', async () => {
    const res = await request(server).get('/v1/auth/me').expect(401);

    expect(res.body).toMatchObject({ code: 'AUTH_TOKEN_MISSING' });
  });

  it('me với token hỏng → 401 AUTH_TOKEN_INVALID', async () => {
    const res = await request(server)
      .get('/v1/auth/me')
      .set('Authorization', 'Bearer token-khong-hop-le')
      .expect(401);

    expect(res.body).toMatchObject({ code: 'AUTH_TOKEN_INVALID' });
  });
});
