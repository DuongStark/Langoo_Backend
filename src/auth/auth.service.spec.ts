import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import { PrismaService } from '../db/prisma.service';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { JwtPayload } from './types/auth.types';

const TEST_SECRET = 'unit-test-secret-0123456789abcdef0123456789';
const ARGON2_MEMORY_COST = 4096;
const ARGON2_TIME_COST = 1;

interface TxMock {
  user: { create: jest.Mock; update: jest.Mock };
  userIdentity: { create: jest.Mock };
  userSession: { create: jest.Mock };
  device: { create: jest.Mock };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Lấy tham số đầu tiên của lần gọi mock gần nhất (thay cho expect.objectContaining). */
function firstArg<T>(mock: jest.Mock): T {
  const call = mock.mock.calls[0] as unknown[];
  return call[0] as T;
}

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1n,
    email: 'new@example.com',
    displayName: 'An',
    avatarUrl: null,
    status: 'active',
    createdAt: new Date('2026-09-26T00:00:00.000Z'),
    lastLoginAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function createSetup(): {
  service: AuthService;
  prisma: {
    user: { findFirst: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    userIdentity: { findUnique: jest.Mock };
    userSession: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    device: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  tx: TxMock;
  jwt: JwtService;
} {
  const tx: TxMock = {
    user: { create: jest.fn(), update: jest.fn() },
    userIdentity: { create: jest.fn() },
    userSession: { create: jest.fn() },
    device: { create: jest.fn() },
  };
  const prisma = {
    user: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    userIdentity: { findUnique: jest.fn() },
    userSession: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    device: { create: jest.fn() },
    $transaction: jest.fn((fn: (client: TxMock) => Promise<unknown>) => fn(tx)),
  };
  const values: Record<string, string | number> = {
    JWT_ACCESS_SECRET: TEST_SECRET,
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL_DAYS: 30,
    ARGON2_MEMORY_COST,
    ARGON2_TIME_COST,
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

  const service = new AuthService(
    prisma as unknown as PrismaService,
    jwt,
    config,
  );
  return { service, prisma, tx, jwt };
}

function registerDto(overrides: Partial<RegisterDto> = {}): RegisterDto {
  return {
    email: ' New@Example.com ',
    password: 'matkhau12345',
    ...overrides,
  };
}

describe('AuthService', () => {
  describe('register', () => {
    it('chuẩn hoá email, hash argon2id (không lưu plaintext) và tạo đủ user/identity/session', async () => {
      const { service, prisma, tx } = createSetup();
      prisma.user.findFirst.mockResolvedValue(null);
      let capturedHash = '';
      tx.userIdentity.create.mockImplementation(
        (args: { data: { passwordHash: string } }) => {
          capturedHash = args.data.passwordHash;
          return Promise.resolve({ id: 10n });
        },
      );
      tx.user.create.mockResolvedValue(userRow());
      let capturedSessionHash = '';
      tx.userSession.create.mockImplementation(
        (args: { data: { refreshTokenHash: string } }) => {
          capturedSessionHash = args.data.refreshTokenHash;
          return Promise.resolve({ id: 'session-1' });
        },
      );

      const result = await service.register(registerDto());

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { email: 'new@example.com' },
        select: { id: true },
      });
      const userCreateArgs = firstArg<{ data: { email: string } }>(
        tx.user.create,
      );
      expect(userCreateArgs.data.email).toBe('new@example.com');
      expect(capturedHash).not.toContain('matkhau12345');
      await expect(argon2.verify(capturedHash, 'matkhau12345')).resolves.toBe(
        true,
      );
      expect(capturedSessionHash).toBe(sha256(result.refresh_token));
      expect(result.user.email).toBe('new@example.com');
      expect(result.expires_in).toBe(900);
    });

    it('access token chứa sub/sid (uuid v7) và hết hạn sau 15 phút', async () => {
      const { service, prisma, tx, jwt } = createSetup();
      prisma.user.findFirst.mockResolvedValue(null);
      tx.user.create.mockResolvedValue(userRow());
      tx.userIdentity.create.mockResolvedValue({ id: 10n });
      let sessionId = '';
      tx.userSession.create.mockImplementation(
        (args: { data: { id: string } }) => {
          sessionId = args.data.id;
          return Promise.resolve({ id: sessionId });
        },
      );

      const result = await service.register(registerDto());

      expect(sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      const payload = await jwt.verifyAsync<JwtPayload>(result.access_token);
      expect(payload.sub).toBe('1');
      expect(payload.sid).toBe(sessionId);
      expect(payload.typ).toBe('access');
      expect(payload.exp! - payload.iat!).toBe(900);
    });

    it('email đã tồn tại → AUTH_EMAIL_TAKEN', async () => {
      const { service, prisma } = createSetup();
      prisma.user.findFirst.mockResolvedValue({ id: 1n });

      await expect(service.register(registerDto())).rejects.toMatchObject({
        code: 'AUTH_EMAIL_TAKEN',
      });
    });

    it('đua ghi đồng thời (P2002) cũng trả AUTH_EMAIL_TAKEN', async () => {
      const { service, prisma, tx } = createSetup();
      prisma.user.findFirst.mockResolvedValue(null);
      tx.user.create.mockRejectedValue(
        Object.assign(new Error('unique violation'), { code: 'P2002' }),
      );

      await expect(service.register(registerDto())).rejects.toMatchObject({
        code: 'AUTH_EMAIL_TAKEN',
      });
    });

    it('tạo device khi client gửi device info', async () => {
      const { service, prisma, tx } = createSetup();
      prisma.user.findFirst.mockResolvedValue(null);
      tx.user.create.mockResolvedValue(userRow());
      tx.userIdentity.create.mockResolvedValue({ id: 10n });
      tx.device.create.mockResolvedValue({ id: 'device-1' });
      tx.userSession.create.mockResolvedValue({ id: 'session-1' });

      await service.register(
        registerDto({
          device: { platform: 'android', app_version: '1.0.0' },
        }),
      );

      const deviceArgs = firstArg<{
        data: { platform: string; appVersion: string | null };
      }>(tx.device.create);
      expect(deviceArgs.data).toMatchObject({
        platform: 'android',
        appVersion: '1.0.0',
      });
    });
  });

  describe('login', () => {
    it('sai mật khẩu → AUTH_INVALID_CREDENTIALS (không tiết lộ tài khoản tồn tại)', async () => {
      const { service, prisma } = createSetup();
      const passwordHash = await argon2.hash('mat-khau-khac', {
        type: argon2.argon2id,
        memoryCost: ARGON2_MEMORY_COST,
        timeCost: ARGON2_TIME_COST,
      });
      prisma.userIdentity.findUnique.mockResolvedValue({
        id: 10n,
        userId: 1n,
        passwordHash,
        user: userRow(),
      });

      await expect(
        service.login({
          email: 'new@example.com',
          password: 'matkhau12345',
        }),
      ).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
    });

    it('không có identity → AUTH_INVALID_CREDENTIALS', async () => {
      const { service, prisma } = createSetup();
      prisma.userIdentity.findUnique.mockResolvedValue(null);

      await expect(
        service.login({
          email: 'khong-ton-tai@example.com',
          password: 'matkhau12345',
        }),
      ).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
    });

    it('tài khoản locked → AUTH_ACCOUNT_LOCKED', async () => {
      const { service, prisma } = createSetup();
      const passwordHash = await argon2.hash('matkhau12345', {
        type: argon2.argon2id,
        memoryCost: ARGON2_MEMORY_COST,
        timeCost: ARGON2_TIME_COST,
      });
      prisma.userIdentity.findUnique.mockResolvedValue({
        id: 10n,
        userId: 1n,
        passwordHash,
        user: userRow({ status: 'locked' }),
      });

      await expect(
        service.login({
          email: 'new@example.com',
          password: 'matkhau12345',
        }),
      ).rejects.toMatchObject({ code: 'AUTH_ACCOUNT_LOCKED' });
    });

    it('đúng mật khẩu → cập nhật last_login_at và trả token', async () => {
      const { service, prisma, tx } = createSetup();
      const passwordHash = await argon2.hash('matkhau12345', {
        type: argon2.argon2id,
        memoryCost: ARGON2_MEMORY_COST,
        timeCost: ARGON2_TIME_COST,
      });
      prisma.userIdentity.findUnique.mockResolvedValue({
        id: 10n,
        userId: 1n,
        passwordHash,
        user: userRow(),
      });
      tx.user.update.mockResolvedValue(
        userRow({ lastLoginAt: new Date('2026-09-26T01:00:00.000Z') }),
      );
      tx.userSession.create.mockResolvedValue({ id: 'session-2' });

      const result = await service.login({
        email: 'new@example.com',
        password: 'matkhau12345',
      });

      const updateArgs = firstArg<{ data: { lastLoginAt: Date } }>(
        tx.user.update,
      );
      expect(updateArgs.data.lastLoginAt).toBeInstanceOf(Date);
      expect(result.user.last_login_at).toBe('2026-09-26T01:00:00.000Z');
      expect(result.access_token).toBeTruthy();
      expect(result.refresh_token).toBeTruthy();
    });
  });

  describe('refresh', () => {
    const activeSession = {
      id: 'session-1',
      userId: 1n,
      refreshTokenHash: sha256('token-cu'),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      user: userRow(),
    };

    it('token không tồn tại → AUTH_INVALID_REFRESH_TOKEN', async () => {
      const { service, prisma } = createSetup();
      prisma.userSession.findUnique.mockResolvedValue(null);

      await expect(service.refresh('token-la')).rejects.toMatchObject({
        code: 'AUTH_INVALID_REFRESH_TOKEN',
      });
    });

    it('session đã thu hồi → AUTH_INVALID_REFRESH_TOKEN', async () => {
      const { service, prisma } = createSetup();
      prisma.userSession.findUnique.mockResolvedValue({
        ...activeSession,
        revokedAt: new Date(),
      });

      await expect(service.refresh('token-cu')).rejects.toMatchObject({
        code: 'AUTH_INVALID_REFRESH_TOKEN',
      });
    });

    it('session hết hạn → AUTH_REFRESH_TOKEN_EXPIRED', async () => {
      const { service, prisma } = createSetup();
      prisma.userSession.findUnique.mockResolvedValue({
        ...activeSession,
        expiresAt: new Date(Date.now() - 60_000),
      });

      await expect(service.refresh('token-cu')).rejects.toMatchObject({
        code: 'AUTH_REFRESH_TOKEN_EXPIRED',
      });
    });

    it('xoay vòng: ghi hash mới và trả refresh token mới khác token cũ', async () => {
      const { service, prisma } = createSetup();
      prisma.userSession.findUnique.mockResolvedValue(activeSession);
      let capturedHash = '';
      prisma.userSession.update.mockImplementation(
        (args: { data: { refreshTokenHash: string } }) => {
          capturedHash = args.data.refreshTokenHash;
          return Promise.resolve({ id: 'session-1' });
        },
      );

      const result = await service.refresh('token-cu');

      expect(result.refresh_token).not.toBe('token-cu');
      expect(capturedHash).toBe(sha256(result.refresh_token));
      const updateArgs = firstArg<{
        where: { id: string };
        data: { lastUsedAt: Date };
      }>(prisma.userSession.update);
      expect(updateArgs.where).toEqual({ id: 'session-1' });
      expect(updateArgs.data.lastUsedAt).toBeInstanceOf(Date);
    });

    it('tài khoản bị khoá → AUTH_ACCOUNT_LOCKED', async () => {
      const { service, prisma } = createSetup();
      prisma.userSession.findUnique.mockResolvedValue({
        ...activeSession,
        user: userRow({ status: 'locked' }),
      });

      await expect(service.refresh('token-cu')).rejects.toMatchObject({
        code: 'AUTH_ACCOUNT_LOCKED',
      });
    });
  });

  describe('logout', () => {
    const payload: JwtPayload = { sub: '1', sid: 'session-1', typ: 'access' };

    it('thu hồi session và trả resource', async () => {
      const { service, prisma } = createSetup();
      prisma.userSession.findUnique.mockResolvedValue({
        id: 'session-1',
        userId: 1n,
        revokedAt: null,
      });
      prisma.userSession.update.mockResolvedValue({
        id: 'session-1',
        userId: 1n,
        revokedAt: new Date('2026-09-26T02:00:00.000Z'),
      });

      const result = await service.logout(payload);

      const updateArgs = firstArg<{
        where: { id: string };
        data: { revokedAt: Date };
      }>(prisma.userSession.update);
      expect(updateArgs.where).toEqual({ id: 'session-1' });
      expect(updateArgs.data.revokedAt).toBeInstanceOf(Date);
      expect(result).toEqual({
        id: 'session-1',
        revoked_at: '2026-09-26T02:00:00.000Z',
      });
    });

    it('session đã thu hồi trước đó → idempotent, không update lại', async () => {
      const { service, prisma } = createSetup();
      prisma.userSession.findUnique.mockResolvedValue({
        id: 'session-1',
        userId: 1n,
        revokedAt: new Date('2026-09-26T02:00:00.000Z'),
      });

      const result = await service.logout(payload);

      expect(prisma.userSession.update).not.toHaveBeenCalled();
      expect(result.revoked_at).toBe('2026-09-26T02:00:00.000Z');
    });

    it('session không tồn tại hoặc không thuộc user → AUTH_TOKEN_INVALID', async () => {
      const { service, prisma } = createSetup();
      prisma.userSession.findUnique.mockResolvedValue({
        id: 'session-1',
        userId: 999n,
        revokedAt: null,
      });

      await expect(service.logout(payload)).rejects.toMatchObject({
        code: 'AUTH_TOKEN_INVALID',
      });
    });
  });

  describe('me', () => {
    it('trả thông tin user (id dạng chuỗi, ngày ISO)', async () => {
      const { service, prisma } = createSetup();
      prisma.user.findUnique.mockResolvedValue(userRow({ id: 5n }));

      const result = await service.me(5n);

      expect(result.id).toBe('5');
      expect(result.created_at).toBe('2026-09-26T00:00:00.000Z');
      expect(result.display_name).toBe('An');
    });

    it('user không tồn tại → AUTH_TOKEN_INVALID', async () => {
      const { service, prisma } = createSetup();
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.me(5n)).rejects.toMatchObject({
        code: 'AUTH_TOKEN_INVALID',
      });
    });
  });
});
