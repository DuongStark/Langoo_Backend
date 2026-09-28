import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import { PrismaService } from '../../db/prisma.service';
import {
  GoogleIdTokenVerifier,
  GoogleIdentity,
} from './google-id-token.verifier';
import { GoogleOAuthChallengeService } from './google-oauth-challenge.service';
import { GoogleOauthService } from './google-oauth.service';

const TEST_SECRET = 'unit-test-secret-0123456789abcdef0123456789';

interface TxMock {
  userIdentity: { findUnique: jest.Mock; create: jest.Mock };
  user: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
  userSettings: { create: jest.Mock };
  userSession: { create: jest.Mock };
  device: { create: jest.Mock };
  googleOAuthChallenge: { findUnique: jest.Mock; updateMany: jest.Mock };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1n,
    email: 'new@example.com',
    displayName: 'An',
    avatarUrl: null,
    status: 'active',
    createdAt: new Date('2026-09-28T00:00:00.000Z'),
    lastLoginAt: null,
    ...overrides,
  };
}

function googleIdentity(
  overrides: Partial<GoogleIdentity> = {},
): GoogleIdentity {
  return {
    sub: 'google-sub-1',
    email: ' New@Example.com ',
    emailVerified: true,
    name: 'An',
    picture: 'https://img.example/avatar.png',
    hostedDomain: null,
    nonce: null,
    ...overrides,
  };
}

function createSetup(requireChallenge = false): {
  service: GoogleOauthService;
  prisma: {
    user: { findUnique: jest.Mock };
    userIdentity: { findUnique: jest.Mock };
    googleOAuthChallenge: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  tx: TxMock;
  jwt: JwtService;
  verifier: { verify: jest.Mock };
} {
  const tx: TxMock = {
    userIdentity: { findUnique: jest.fn(), create: jest.fn() },
    user: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    userSettings: { create: jest.fn() },
    userSession: { create: jest.fn() },
    device: { create: jest.fn() },
    googleOAuthChallenge: { findUnique: jest.fn(), updateMany: jest.fn() },
  };
  const prisma = {
    user: { findUnique: jest.fn() },
    userIdentity: { findUnique: jest.fn() },
    googleOAuthChallenge: { create: jest.fn() },
    $transaction: jest.fn((fn: (client: TxMock) => Promise<unknown>) => fn(tx)),
  };
  const values: Record<string, string | number | boolean> = {
    JWT_ACCESS_SECRET: TEST_SECRET,
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL_DAYS: 30,
    GOOGLE_OAUTH_REQUIRE_CHALLENGE: requireChallenge,
  };
  const config = {
    get: jest.fn((key: string) => values[key]),
    getOrThrow: jest.fn((key: string) => {
      if (values[key] === undefined) {
        throw new Error(`missing config ${key}`);
      }
      return values[key];
    }),
  } as unknown as ConfigService;
  const jwt = new JwtService({ secret: TEST_SECRET });
  const verifier = { verify: jest.fn() };

  const service = new GoogleOauthService(
    prisma as unknown as PrismaService,
    jwt,
    config,
    verifier as unknown as GoogleIdTokenVerifier,
    new GoogleOAuthChallengeService(prisma as unknown as PrismaService, config),
  );
  return { service, prisma, tx, jwt, verifier };
}

function firstArg<T>(mock: jest.Mock): T {
  const call = mock.mock.calls[0] as unknown[];
  return call[0] as T;
}

describe('GoogleOauthService', () => {
  it('tạo user mới đủ user/identity/settings/session và trả token nội bộ', async () => {
    const { service, tx, jwt, verifier } = createSetup();
    verifier.verify.mockResolvedValue(googleIdentity());
    tx.userIdentity.findUnique.mockResolvedValue(null);
    tx.user.findFirst.mockResolvedValue(null);
    tx.user.create.mockResolvedValue(userRow());
    tx.user.update.mockResolvedValue(
      userRow({ lastLoginAt: new Date('2026-09-28T01:00:00.000Z') }),
    );
    tx.device.create.mockResolvedValue({ id: 'device-1' });
    let capturedSessionHash = '';
    tx.userSession.create.mockImplementation(
      (args: { data: { refreshTokenHash: string } }) => {
        capturedSessionHash = args.data.refreshTokenHash;
        return Promise.resolve({ id: 'session-1' });
      },
    );

    const result = await service.login({
      id_token: 'id-token',
      device: { platform: 'ios', app_version: '1.2.3' },
    });

    // Email được chuẩn hoá trước khi tra/tạo user.
    expect(tx.user.findFirst).toHaveBeenCalledWith({
      where: { email: 'new@example.com' },
    });
    const userCreateArgs = firstArg<{
      data: { email: string; displayName: string; avatarUrl: string };
    }>(tx.user.create);
    expect(userCreateArgs.data).toMatchObject({
      email: 'new@example.com',
      displayName: 'An',
      avatarUrl: 'https://img.example/avatar.png',
    });

    const identityArgs = firstArg<{
      data: {
        userId: bigint;
        provider: string;
        providerUid: string;
        emailVerifiedAt: Date;
      };
    }>(tx.userIdentity.create);
    expect(identityArgs.data).toMatchObject({
      userId: 1n,
      provider: 'google',
      providerUid: 'google-sub-1',
    });
    expect(identityArgs.data.emailVerifiedAt).toBeInstanceOf(Date);

    const settingsArgs = firstArg<{
      data: { userId: bigint; timezone: string; dailyGoal: number };
    }>(tx.userSettings.create);
    expect(settingsArgs.data).toMatchObject({
      userId: 1n,
      timezone: 'Asia/Ho_Chi_Minh',
      dailyGoal: 20,
    });

    const sessionArgs = firstArg<{
      data: { userId: bigint; deviceId: string | null };
    }>(tx.userSession.create);
    const deviceArgs = firstArg<{
      data: { id: string; platform: string; appVersion: string | null };
    }>(tx.device.create);
    expect(deviceArgs.data).toMatchObject({
      platform: 'ios',
      appVersion: '1.2.3',
    });
    expect(sessionArgs.data).toMatchObject({
      userId: 1n,
      deviceId: deviceArgs.data.id,
    });
    expect(capturedSessionHash).toBe(sha256(result.refresh_token));

    const updateArgs = firstArg<{ data: { lastLoginAt: Date } }>(
      tx.user.update,
    );
    expect(updateArgs.data.lastLoginAt).toBeInstanceOf(Date);

    expect(result.user.id).toBe('1');
    expect(result.user.last_login_at).toBe('2026-09-28T01:00:00.000Z');
    expect(result.expires_in).toBe(900);
    const payload = await jwt.verifyAsync<{ sub: string; typ: string }>(
      result.access_token,
    );
    expect(payload.sub).toBe('1');
    expect(payload.typ).toBe('access');
  });

  it('đã liên kết trước đó → không tạo user/settings, tôn trọng avatar có sẵn', async () => {
    const { service, tx, verifier } = createSetup();
    verifier.verify.mockResolvedValue(googleIdentity());
    tx.userIdentity.findUnique.mockResolvedValue({
      userId: 7n,
      user: userRow({ id: 7n, avatarUrl: 'https://old.example/avatar.png' }),
    });
    tx.user.update.mockResolvedValue(userRow({ id: 7n }));

    const result = await service.login({ id_token: 'id-token' });

    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.userSettings.create).not.toHaveBeenCalled();
    expect(tx.userIdentity.create).not.toHaveBeenCalled();
    const updateArgs = firstArg<{ where: { id: bigint }; data: unknown }>(
      tx.user.update,
    );
    expect(updateArgs.where).toEqual({ id: 7n });
    expect(updateArgs.data).not.toHaveProperty('avatarUrl');
    expect(result.user.id).toBe('7');
  });

  it('email trùng tài khoản password → yêu cầu liên kết chủ động, không tạo session', async () => {
    const { service, tx, verifier } = createSetup();
    verifier.verify.mockResolvedValue(googleIdentity());
    tx.userIdentity.findUnique.mockResolvedValue(null);
    tx.user.findFirst.mockResolvedValue(
      userRow({ id: 3n, avatarUrl: 'https://old.example/avatar.png' }),
    );
    await expect(service.login({ id_token: 'id-token' })).rejects.toMatchObject(
      {
        code: 'AUTH_OAUTH_LINK_REQUIRED',
      },
    );
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.userIdentity.create).not.toHaveBeenCalled();
    expect(tx.userSession.create).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('liên kết chủ động yêu cầu mật khẩu và không tạo session mới', async () => {
    const { service, prisma, tx, verifier } = createSetup();
    const passwordHash = await argon2.hash('matkhau12345', {
      type: argon2.argon2id,
      memoryCost: 4096,
      timeCost: 1,
    });
    verifier.verify.mockResolvedValue(googleIdentity());
    prisma.user.findUnique.mockResolvedValue({
      ...userRow({ id: 3n }),
      identities: [
        {
          provider: 'password',
          passwordHash,
        },
      ],
    });
    tx.userIdentity.findUnique.mockResolvedValue(null);
    tx.userIdentity.create.mockResolvedValue({
      createdAt: new Date('2026-09-28T02:00:00.000Z'),
    });

    const result = await service.link(3n, {
      id_token: 'id-token',
      password: 'matkhau12345',
    });

    expect(result).toEqual({
      provider: 'google',
      linked_at: '2026-09-28T02:00:00.000Z',
    });
    const calls = tx.userIdentity.create.mock.calls as unknown[][];
    const createArgs = calls[0]?.[0] as {
      data: { userId: bigint; provider: string; providerUid: string };
    };
    expect(createArgs.data).toMatchObject({
      userId: 3n,
      provider: 'google',
      providerUid: 'google-sub-1',
    });
    expect(tx.userSession.create).not.toHaveBeenCalled();
  });

  it('liên kết chủ động sai mật khẩu → không ghi identity', async () => {
    const { service, prisma, tx, verifier } = createSetup();
    const passwordHash = await argon2.hash('matkhau-khac', {
      type: argon2.argon2id,
      memoryCost: 4096,
      timeCost: 1,
    });
    verifier.verify.mockResolvedValue(googleIdentity());
    prisma.user.findUnique.mockResolvedValue({
      ...userRow({ id: 3n }),
      identities: [{ provider: 'password', passwordHash }],
    });

    await expect(
      service.link(3n, { id_token: 'id-token', password: 'matkhau12345' }),
    ).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
    expect(tx.userIdentity.create).not.toHaveBeenCalled();
  });

  it('email trùng user chưa có avatar vẫn yêu cầu link, không ghi đè user', async () => {
    const { service, tx, verifier } = createSetup();
    verifier.verify.mockResolvedValue(googleIdentity());
    tx.userIdentity.findUnique.mockResolvedValue(null);
    tx.user.findFirst.mockResolvedValue(userRow({ id: 3n, avatarUrl: null }));
    await expect(service.login({ id_token: 'id-token' })).rejects.toMatchObject(
      {
        code: 'AUTH_OAUTH_LINK_REQUIRED',
      },
    );
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('email chưa xác thực → 403 AUTH_OAUTH_EMAIL_UNVERIFIED, không chạm DB', async () => {
    const { service, prisma, verifier } = createSetup();
    verifier.verify.mockResolvedValue(googleIdentity({ emailVerified: false }));

    await expect(service.login({ id_token: 'id-token' })).rejects.toMatchObject(
      { code: 'AUTH_OAUTH_EMAIL_UNVERIFIED' },
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('nonce lệch hoặc token có nonce mà request không gửi → 401', async () => {
    const { service, verifier } = createSetup();
    verifier.verify.mockResolvedValue(
      googleIdentity({ nonce: 'nonce-google' }),
    );

    await expect(
      service.login({ id_token: 'id-token', nonce: 'nonce-khac' }),
    ).rejects.toMatchObject({ code: 'AUTH_OAUTH_TOKEN_INVALID' });

    await expect(service.login({ id_token: 'id-token' })).rejects.toMatchObject(
      { code: 'AUTH_OAUTH_TOKEN_INVALID' },
    );
  });

  it('nonce khớp → đăng nhập bình thường', async () => {
    const { service, tx, verifier } = createSetup();
    verifier.verify.mockResolvedValue(
      googleIdentity({ nonce: 'nonce-google' }),
    );
    tx.userIdentity.findUnique.mockResolvedValue({
      userId: 1n,
      user: userRow(),
    });
    tx.user.update.mockResolvedValue(userRow());

    const result = await service.login({
      id_token: 'id-token',
      nonce: 'nonce-google',
    });

    expect(result.user.id).toBe('1');
  });

  it('challenge login hợp lệ được consume trong transaction cấp session', async () => {
    const { service, tx, verifier } = createSetup(true);
    const nonce = 'nonce-from-challenge';
    const bindingSecret = 'binding-secret-from-challenge-0123456789';
    verifier.verify.mockResolvedValue(googleIdentity({ nonce }));
    tx.googleOAuthChallenge.findUnique.mockResolvedValue({
      id: 'challenge-1',
      purpose: 'login',
      userId: null,
      sessionId: null,
      nonceHash: sha256(nonce),
      bindingHash: sha256(bindingSecret),
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    });
    tx.googleOAuthChallenge.updateMany.mockResolvedValue({ count: 1 });
    tx.userIdentity.findUnique.mockResolvedValue({
      userId: 1n,
      user: userRow(),
    });
    tx.user.update.mockResolvedValue(userRow());

    await service.login({
      id_token: 'id-token',
      nonce,
      challenge_id: 'challenge-1',
      binding_secret: bindingSecret,
    });

    expect(tx.googleOAuthChallenge.updateMany).toHaveBeenCalled();
    expect(tx.userSession.create).toHaveBeenCalled();
  });

  it('challenge login không cần client gửi lại nonce (token nonce đối chiếu qua challenge)', async () => {
    const { service, tx, verifier } = createSetup();
    const nonce = 'nonce-from-challenge';
    const bindingSecret = 'binding-secret-from-challenge-0123456789';
    verifier.verify.mockResolvedValue(googleIdentity({ nonce }));
    tx.googleOAuthChallenge.findUnique.mockResolvedValue({
      id: 'challenge-1',
      purpose: 'login',
      userId: null,
      sessionId: null,
      nonceHash: sha256(nonce),
      bindingHash: sha256(bindingSecret),
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    });
    tx.googleOAuthChallenge.updateMany.mockResolvedValue({ count: 1 });
    tx.userIdentity.findUnique.mockResolvedValue({
      userId: 1n,
      user: userRow(),
    });
    tx.user.update.mockResolvedValue(userRow());

    const result = await service.login({
      id_token: 'id-token',
      challenge_id: 'challenge-1',
      binding_secret: bindingSecret,
    });

    expect(result.user.id).toBe('1');
    expect(tx.googleOAuthChallenge.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.userSession.create).toHaveBeenCalledTimes(1);
  });

  it('challenge + nonce gửi kèm lệch token → 401', async () => {
    const { service, verifier } = createSetup();
    verifier.verify.mockResolvedValue(googleIdentity({ nonce: 'nonce-token' }));

    await expect(
      service.login({
        id_token: 'id-token',
        nonce: 'nonce-khac',
        challenge_id: 'challenge-1',
        binding_secret: 'binding-secret-from-challenge-0123456789',
      }),
    ).rejects.toMatchObject({ code: 'AUTH_OAUTH_TOKEN_INVALID' });
  });

  it('bật bắt buộc challenge → thiếu challenge bị từ chối trước transaction', async () => {
    const { service, tx, verifier } = createSetup(true);
    verifier.verify.mockResolvedValue(googleIdentity());

    await expect(service.login({ id_token: 'id-token' })).rejects.toMatchObject(
      {
        code: 'AUTH_OAUTH_CHALLENGE_INVALID',
      },
    );
    expect(tx.userSession.create).not.toHaveBeenCalled();
  });

  it('tài khoản locked/deleted → 403', async () => {
    const { service, tx, verifier } = createSetup();
    verifier.verify.mockResolvedValue(googleIdentity());
    tx.userIdentity.findUnique.mockResolvedValue({
      userId: 1n,
      user: userRow({ status: 'locked' }),
    });

    await expect(service.login({ id_token: 'id-token' })).rejects.toMatchObject(
      { code: 'AUTH_ACCOUNT_LOCKED' },
    );

    tx.userIdentity.findUnique.mockResolvedValue({
      userId: 1n,
      user: userRow({ status: 'deleted' }),
    });
    await expect(service.login({ id_token: 'id-token' })).rejects.toMatchObject(
      { code: 'AUTH_ACCOUNT_DELETED' },
    );
  });

  it('đua tạo user (P2002 lần đầu) → chạy lại và thành công', async () => {
    const { service, prisma, tx, verifier } = createSetup();
    verifier.verify.mockResolvedValue(googleIdentity());
    let attempts = 0;
    prisma.$transaction.mockImplementation(
      (fn: (client: TxMock) => Promise<unknown>) => {
        attempts += 1;
        if (attempts === 1) {
          return Promise.reject(
            Object.assign(new Error('unique violation'), { code: 'P2002' }),
          );
        }
        return fn(tx);
      },
    );
    tx.userIdentity.findUnique.mockResolvedValue({
      userId: 1n,
      user: userRow(),
    });
    tx.user.update.mockResolvedValue(userRow());

    await service.login({ id_token: 'id-token' });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('P2002 lặp lại → 409 AUTH_OAUTH_CONFLICT', async () => {
    const { service, prisma, verifier } = createSetup();
    verifier.verify.mockResolvedValue(googleIdentity());
    prisma.$transaction.mockRejectedValue(
      Object.assign(new Error('unique violation'), { code: 'P2002' }),
    );

    await expect(service.login({ id_token: 'id-token' })).rejects.toMatchObject(
      { code: 'AUTH_OAUTH_CONFLICT' },
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });
});
