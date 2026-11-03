import { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../db/prisma.service';
import { JwtAuthGuard } from './jwt-auth.guard';

const SID = '019a0000-0000-7000-8000-000000000001';
const SECRET = 'm25-unit-secret-0123456789abcdef0123456789';

function contextFor(token: string) {
  const request = {
    headers: { authorization: `Bearer ${token}` },
    user: undefined,
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

async function setup() {
  const jwt = new JwtService({ secret: SECRET });
  const session = {
    userId: 5n,
    revokedAt: null as Date | null,
    expiresAt: new Date(Date.now() + 60_000),
    user: { status: 'active' },
  };
  const findUnique = jest.fn().mockResolvedValue(session);
  const module = await Test.createTestingModule({
    providers: [
      JwtAuthGuard,
      { provide: JwtService, useValue: jwt },
      { provide: PrismaService, useValue: { userSession: { findUnique } } },
    ],
  }).compile();
  const token = await jwt.signAsync(
    { sub: '5', sid: SID, typ: 'access' },
    { expiresIn: 900 },
  );
  return { guard: module.get(JwtAuthGuard), jwt, session, findUnique, token };
}

describe('M2.5 JwtAuthGuard session revocation', () => {
  it('active session authenticates, then revocation blocks the same JWT without cache', async () => {
    const { guard, session, token } = await setup();
    const first = contextFor(token);
    await expect(guard.canActivate(first.context)).resolves.toBe(true);
    expect(first.request.user).toMatchObject({ sub: '5', sid: SID });
    session.revokedAt = new Date();
    const next = contextFor(token);
    await expect(guard.canActivate(next.context)).rejects.toMatchObject({
      code: 'AUTH_TOKEN_INVALID',
      status: 401,
    });
    expect(next.request.user).toBeUndefined();
  });

  it.each(['missing', 'expired', 'wrong-owner', 'locked', 'deleted'])(
    'rejects a %s session/account',
    async (kind) => {
      const { guard, session, findUnique, token } = await setup();
      if (kind === 'missing') findUnique.mockResolvedValue(null);
      if (kind === 'expired') session.expiresAt = new Date(Date.now() - 1);
      if (kind === 'wrong-owner') session.userId = 99n;
      if (kind === 'locked' || kind === 'deleted') session.user.status = kind;
      await expect(
        guard.canActivate(contextFor(token).context),
      ).rejects.toMatchObject({
        code: 'AUTH_TOKEN_INVALID',
        status: 401,
      });
    },
  );

  it('DB unavailable fails closed as 503, not a token rejection or guest', async () => {
    const { guard, findUnique, token } = await setup();
    findUnique.mockRejectedValue(new Error('database unavailable'));
    const { context, request } = contextFor(token);
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: 'AUTH_SERVICE_UNAVAILABLE',
      status: 503,
    });
    expect(request.user).toBeUndefined();
  });

  it.each([
    { sub: 'not-a-number', sid: SID, typ: 'access' },
    { sub: '9223372036854775808', sid: SID, typ: 'access' },
    { sub: '0', sid: SID, typ: 'access' },
    { sub: '5', sid: 'not-a-uuid', typ: 'access' },
    { sub: '5', sid: SID, typ: 'refresh' },
  ])('rejects malformed signed claims before DB: %j', async (claims) => {
    const { guard, jwt, findUnique } = await setup();
    const token = await jwt.signAsync(claims, { expiresIn: 900 });
    await expect(
      guard.canActivate(contextFor(token).context),
    ).rejects.toMatchObject({
      code: 'AUTH_TOKEN_INVALID',
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('rejects a JWT without expiry or with an unexpected algorithm', async () => {
    const { guard, jwt, findUnique } = await setup();
    const claims = { sub: '5', sid: SID, typ: 'access' };
    for (const token of [
      await jwt.signAsync(claims),
      await jwt.signAsync(claims, { expiresIn: 900, algorithm: 'HS384' }),
    ]) {
      await expect(
        guard.canActivate(contextFor(token).context),
      ).rejects.toMatchObject({
        code: 'AUTH_TOKEN_INVALID',
      });
    }
    expect(findUnique).not.toHaveBeenCalled();
  });
});
