import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../db/prisma.service';
import { GoogleOAuthChallengeService } from './google-oauth-challenge.service';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function firstCall<T>(mock: jest.Mock): T {
  const calls = mock.mock.calls as unknown[][];
  const call = calls[0];
  if (!call) {
    throw new Error('expected mock call');
  }
  return call[0] as T;
}

function setup(required = false, configured = true) {
  const prisma = {
    userSession: { findUnique: jest.fn() },
    googleOAuthChallenge: { create: jest.fn() },
  };
  const tx = {
    userSession: { findUnique: jest.fn() },
    googleOAuthChallenge: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const config = {
    get: jest.fn((key: string) =>
      key === 'GOOGLE_OAUTH_REQUIRE_CHALLENGE'
        ? required
        : key === 'GOOGLE_OAUTH_CLIENT_IDS'
          ? configured
            ? 'client-web'
            : ''
          : undefined,
    ),
  } as unknown as ConfigService;
  return {
    service: new GoogleOAuthChallengeService(
      prisma as unknown as PrismaService,
      config,
    ),
    prisma,
    tx,
  };
}

describe('GoogleOAuthChallengeService', () => {
  it('tạo challenge login và chỉ lưu hash', async () => {
    const { service, prisma } = setup();
    const result = await service.create('login');

    expect(result.challenge_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(result.nonce).toHaveLength(43);
    expect(result.binding_secret).toHaveLength(43);
    expect(result.expires_in).toBe(300);
    const args = firstCall<{
      data: {
        nonceHash: string;
        bindingHash: string;
        userId: bigint | null;
        sessionId: string | null;
      };
    }>(prisma.googleOAuthChallenge.create);
    expect(args.data).toMatchObject({ userId: null, sessionId: null });
    expect(args.data.nonceHash).toBe(sha256(result.nonce));
    expect(args.data.bindingHash).toBe(sha256(result.binding_secret));
    expect(args.data.nonceHash).not.toBe(result.nonce);
  });

  it('link challenge yêu cầu session active đúng user', async () => {
    const { service, prisma } = setup();
    prisma.userSession.findUnique.mockResolvedValue({
      userId: 7n,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: { status: 'active' },
    });

    const result = await service.create('link', 7n, 'session-1');
    const args = firstCall<{
      data: { purpose: string; userId: bigint; sessionId: string };
    }>(prisma.googleOAuthChallenge.create);
    expect(args.data).toMatchObject({
      purpose: 'link',
      userId: 7n,
      sessionId: 'session-1',
    });
    expect(result.expires_in).toBe(300);
  });

  it('challenge hợp lệ chỉ consume một lần', async () => {
    const { service, tx } = setup();
    const nonce = 'nonce-from-google';
    const bindingSecret = 'binding-secret-from-backend';
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

    await service.consume(
      tx as never,
      'login',
      { challenge_id: 'challenge-1', binding_secret: bindingSecret },
      { identityNonce: nonce },
    );
    const update = firstCall<{
      where: {
        id: string;
        consumedAt: null;
        expiresAt: { gt: Date };
      };
    }>(tx.googleOAuthChallenge.updateMany);
    expect(update.where).toMatchObject({
      id: 'challenge-1',
      consumedAt: null,
    });
    expect(update.where.expiresAt.gt).toBeInstanceOf(Date);
  });

  it('từ chối sai binding/purpose hoặc thiếu challenge khi bắt buộc', async () => {
    const optional = setup();
    optional.tx.googleOAuthChallenge.findUnique.mockResolvedValue({
      id: 'challenge-1',
      purpose: 'login',
      userId: null,
      sessionId: null,
      nonceHash: sha256('nonce'),
      bindingHash: sha256('binding'),
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    });
    await expect(
      optional.service.consume(
        optional.tx as never,
        'link',
        { challenge_id: 'challenge-1', binding_secret: 'wrong' },
        { userId: 1n, sessionId: 'session-1', identityNonce: 'nonce' },
      ),
    ).rejects.toMatchObject({ code: 'AUTH_OAUTH_CHALLENGE_INVALID' });

    const required = setup(true);
    expect(() => required.service.assertRequest({})).toThrow(
      'Google OAuth challenge không hợp lệ',
    );
  });

  it('không cấp challenge khi Google OAuth chưa cấu hình', async () => {
    const { service } = setup(false, false);

    await expect(service.create('login')).rejects.toMatchObject({
      code: 'AUTH_OAUTH_NOT_CONFIGURED',
    });
  });
});
