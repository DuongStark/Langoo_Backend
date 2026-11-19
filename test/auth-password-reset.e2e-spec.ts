import { createHash } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';
import { PasswordResetMailer } from '../src/auth/password-reset.mailer';
import {
  PASSWORD_FORGOT_MESSAGE,
  hashResetToken,
} from '../src/auth/password-reset.service';

interface AuthBody {
  user: { id: string; email: string };
  access_token: string;
  refresh_token: string;
}

interface ResetBody {
  user_id: string;
  sessions_revoked: number;
  next_action: 'login';
}

describe('M2.3 B password recovery (e2e — langoo_test)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;

  const runId = Date.now();
  const password = 'matkhau-cu-12345';
  const newPassword = 'matkhau-moi-67890';
  const userIds: bigint[] = [];
  const sent: { to: string; token: string }[] = [];
  const mailer = {
    isConfigured: () => true,
    sendResetLink: (to: string, token: string): Promise<void> => {
      sent.push({ to, token });
      return Promise.resolve();
    },
  };

  const settle = async (): Promise<void> => {
    await new Promise<void>((resolve) => setTimeout(resolve, 600));
  };

  async function waitForSends(count: number): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (sent.length < count) {
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for ${count} reset emails`);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  }

  async function register(
    label: string,
  ): Promise<AuthBody & { email: string }> {
    const email = `m23b-${runId}-${label}@langoo.test`;
    const res = await request(server)
      .post('/v1/auth/register')
      .send({ email, password })
      .expect(201);
    const body = res.body as AuthBody;
    userIds.push(BigInt(body.user.id));
    return { ...body, email };
  }

  async function forgot(email: string): Promise<{ message: string }> {
    const res = await request(server)
      .post('/v1/auth/password/forgot')
      .send({ email })
      .expect(202);
    return res.body as { message: string };
  }

  function reset(token: string, nextPassword = newPassword) {
    return request(server)
      .post('/v1/auth/password/reset')
      .send({ token, new_password: nextPassword });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PasswordResetMailer)
      .useValue(mailer)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await app?.close();
  });

  it('token tốt đổi mật khẩu, thu hồi mọi phiên và không tự đăng nhập', async () => {
    const user = await register('success');
    const secondLogin = await request(server)
      .post('/v1/auth/login')
      .send({ email: user.email, password })
      .expect(200);
    const second = secondLogin.body as AuthBody;

    const before = sent.length;
    expect(await forgot(user.email)).toEqual({
      message: PASSWORD_FORGOT_MESSAGE,
    });
    await waitForSends(before + 1);
    expect(sent.length).toBe(before + 1);

    const link = sent[sent.length - 1];
    expect(link.to).toBe(user.email);
    expect(link.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const resetRes = await reset(link.token).expect(200);
    const resetBody = resetRes.body as ResetBody;
    expect(resetBody).toEqual({
      user_id: user.user.id,
      sessions_revoked: 2,
      next_action: 'login',
    });
    expect(resetBody).not.toHaveProperty('access_token');

    for (const accessToken of [user.access_token, second.access_token]) {
      const rejected = await request(server)
        .get('/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(401);
      expect(rejected.body).toMatchObject({ code: 'AUTH_TOKEN_INVALID' });
    }
    await request(server)
      .post('/v1/auth/refresh')
      .send({ refresh_token: second.refresh_token })
      .expect(401);

    const replay = await reset(link.token).expect(400);
    expect(replay.body).toMatchObject({ code: 'AUTH_CHALLENGE_INVALID' });

    const oldLogin = await request(server)
      .post('/v1/auth/login')
      .send({ email: user.email, password })
      .expect(401);
    expect(oldLogin.body).toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
    await request(server)
      .post('/v1/auth/login')
      .send({ email: user.email, password: newPassword })
      .expect(200);
  });

  it('link cũ vẫn dùng được khi gửi lại; cooldown 1/phút không phát thêm mail', async () => {
    const user = await register('repeat');
    const firstBase = sent.length;
    expect(await forgot(user.email)).toEqual({
      message: PASSWORD_FORGOT_MESSAGE,
    });
    await waitForSends(firstBase + 1);
    const first = sent[firstBase];

    const identity = await prisma.userIdentity.findFirstOrThrow({
      where: { userId: BigInt(user.user.id), provider: 'password' },
      select: { id: true },
    });
    // Đẩy challenge đầu ra ngoài cửa sổ 1 phút để lần gửi sau được phát.
    await prisma.passwordResetChallenge.update({
      where: { tokenHash: hashResetToken(first.token) },
      data: { createdAt: new Date(Date.now() - 2 * 60 * 1000) },
    });

    const secondBase = sent.length;
    expect(await forgot(user.email)).toEqual({
      message: PASSWORD_FORGOT_MESSAGE,
    });
    await waitForSends(secondBase + 1);
    const second = sent[secondBase];

    // Gửi lần 3 ngay sau lần 2: vẫn 202 thống nhất nhưng không phát mail.
    expect(await forgot(user.email)).toEqual({
      message: PASSWORD_FORGOT_MESSAGE,
    });
    await settle();
    expect(sent.length).toBe(secondBase + 1);

    await reset(first.token).expect(200);
    // Reset thành công tiêu thụ mọi link chưa dùng của identity.
    const stale = await reset(second.token).expect(400);
    expect(stale.body).toMatchObject({ code: 'AUTH_CHALLENGE_INVALID' });
    expect(identity.id).toBeGreaterThan(0n);
  });

  it('token hết hạn trả AUTH_CHALLENGE_INVALID và không đổi mật khẩu', async () => {
    const user = await register('expired');
    const before = sent.length;
    expect(await forgot(user.email)).toEqual({
      message: PASSWORD_FORGOT_MESSAGE,
    });
    await waitForSends(before + 1);
    const link = sent[before];

    await prisma.passwordResetChallenge.update({
      where: { tokenHash: hashResetToken(link.token) },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    const expired = await reset(link.token).expect(400);
    expect(expired.body).toMatchObject({ code: 'AUTH_CHALLENGE_INVALID' });
    await request(server)
      .post('/v1/auth/login')
      .send({ email: user.email, password })
      .expect(200);
  });

  it('email lạ, Google-only và tài khoản khoá nhận cùng 202 nhưng không gửi mail', async () => {
    const before = sent.length;
    const expected = { message: PASSWORD_FORGOT_MESSAGE };

    expect(await forgot(`missing-${runId}@langoo.test`)).toEqual(expected);
    await settle();
    expect(sent.length).toBe(before);

    const googleUser = await prisma.user.create({
      data: { email: `m23b-${runId}-google@langoo.test`, status: 'active' },
    });
    userIds.push(googleUser.id);
    await prisma.userIdentity.create({
      data: {
        userId: googleUser.id,
        provider: 'google',
        providerUid: `google-${runId}`,
      },
    });
    expect(await forgot(googleUser.email)).toEqual(expected);
    await settle();
    expect(sent.length).toBe(before);

    const locked = await register('locked');
    await prisma.user.update({
      where: { id: BigInt(locked.user.id) },
      data: { status: 'locked' },
    });
    expect(await forgot(locked.email)).toEqual(expected);
    await settle();
    expect(sent.length).toBe(before);
  });

  it('đổi địa chỉ sau khi phát token thì token cũ không dùng được', async () => {
    const user = await register('address');
    const before = sent.length;
    expect(await forgot(user.email)).toEqual({
      message: PASSWORD_FORGOT_MESSAGE,
    });
    await waitForSends(before + 1);
    const link = sent[before];

    const newEmail = `m23b-${runId}-address-new@langoo.test`;
    await prisma.user.update({
      where: { id: BigInt(user.user.id) },
      data: { email: newEmail },
    });
    await prisma.userIdentity.updateMany({
      where: { userId: BigInt(user.user.id), provider: 'password' },
      data: { providerUid: newEmail },
    });

    const changed = await reset(link.token).expect(400);
    expect(changed.body).toMatchObject({ code: 'AUTH_CHALLENGE_INVALID' });
  });

  it('token sai định dạng hoặc sai hoàn toàn trả 400', async () => {
    await request(server)
      .post('/v1/auth/password/reset')
      .send({ token: 'short', new_password: newPassword })
      .expect(400);
    const invalid = await reset('A'.repeat(43)).expect(400);
    expect(invalid.body).toMatchObject({ code: 'AUTH_CHALLENGE_INVALID' });
  });

  it('challenge lưu SHA-256, không lưu token thô', async () => {
    const user = await register('hash');
    const before = sent.length;
    await forgot(user.email);
    await waitForSends(before + 1);
    const token = sent[before].token;
    const row = await prisma.passwordResetChallenge.findUniqueOrThrow({
      where: { tokenHash: hashResetToken(token) },
    });
    expect(row.tokenHash).toBe(
      createHash('sha256').update(token).digest('hex'),
    );
    expect(row.tokenHash).not.toBe(token);
  });
});
