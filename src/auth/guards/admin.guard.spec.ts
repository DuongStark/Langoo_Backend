import { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../db/prisma.service';
import { AdminGuard } from './admin.guard';

const TEST_SECRET = 'unit-test-secret-0123456789abcdef0123456789';
const SID = '019a0000-0000-7000-8000-000000000001';

function createSetup(): {
  guard: AdminGuard;
  jwt: JwtService;
  prisma: {
    user: { findUnique: jest.Mock };
    userSession: { findUnique: jest.Mock };
  };
} {
  const jwt = new JwtService({ secret: TEST_SECRET });
  const prisma = {
    user: { findUnique: jest.fn() },
    userSession: {
      findUnique: jest.fn().mockResolvedValue({
        userId: 5n,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        user: { status: 'active' },
      }),
    },
  };
  const guard = new AdminGuard(jwt, prisma as unknown as PrismaService);
  return { guard, jwt, prisma };
}

function contextWith(token: string | null): ExecutionContext {
  const request: Record<string, unknown> = {
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

async function sign(jwt: JwtService, sub: string): Promise<string> {
  return jwt.signAsync({ sub, sid: SID, typ: 'access' }, { expiresIn: 900 });
}

describe('AdminGuard', () => {
  it('admin active → cho qua', async () => {
    const { guard, jwt, prisma } = createSetup();
    prisma.user.findUnique.mockResolvedValue({
      role: 'admin',
      status: 'active',
    });

    await expect(
      guard.canActivate(contextWith(await sign(jwt, '5'))),
    ).resolves.toBe(true);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 5n },
      select: { role: true, status: true },
    });
  });

  it('user thường, admin bị khoá hoặc không tồn tại → 403 ADMIN_REQUIRED', async () => {
    const { guard, jwt, prisma } = createSetup();
    const token = await sign(jwt, '7');
    prisma.userSession.findUnique.mockResolvedValue({
      userId: 7n,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: { status: 'active' },
    });

    prisma.user.findUnique.mockResolvedValue({
      role: 'user',
      status: 'active',
    });
    await expect(guard.canActivate(contextWith(token))).rejects.toMatchObject({
      code: 'ADMIN_REQUIRED',
    });

    prisma.user.findUnique.mockResolvedValue({
      role: 'admin',
      status: 'locked',
    });
    await expect(guard.canActivate(contextWith(token))).rejects.toMatchObject({
      code: 'ADMIN_REQUIRED',
    });

    prisma.user.findUnique.mockResolvedValue(null);
    await expect(guard.canActivate(contextWith(token))).rejects.toMatchObject({
      code: 'ADMIN_REQUIRED',
    });
  });

  it('thiếu token → AUTH_TOKEN_MISSING; sub không phải số → AUTH_TOKEN_INVALID', async () => {
    const { guard, jwt } = createSetup();

    await expect(guard.canActivate(contextWith(null))).rejects.toMatchObject({
      code: 'AUTH_TOKEN_MISSING',
    });

    const weird = await sign(jwt, 'khong-phai-so');
    await expect(guard.canActivate(contextWith(weird))).rejects.toMatchObject({
      code: 'AUTH_TOKEN_INVALID',
    });
  });
});
