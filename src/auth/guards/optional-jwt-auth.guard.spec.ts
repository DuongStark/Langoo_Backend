import { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../db/prisma.service';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';

const SECRET = 'unit-test-secret-0123456789abcdef0123456789';
const SID = '019a0000-0000-7000-8000-000000000001';

interface RequestMock {
  headers: { authorization?: string };
  user?: { sub: string; sid: string };
}

function createSetup(): {
  guard: OptionalJwtAuthGuard;
  jwt: JwtService;
  findSession: jest.Mock;
  contextFor: (authorization?: string) => {
    context: ExecutionContext;
    request: RequestMock;
  };
} {
  const jwt = new JwtService({ secret: SECRET });
  const findSession = jest.fn().mockResolvedValue({
    userId: 5n,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    user: { status: 'active' },
  });
  const guard = new OptionalJwtAuthGuard(jwt, {
    userSession: { findUnique: findSession },
  } as unknown as PrismaService);

  const contextFor = (
    authorization?: string,
  ): { context: ExecutionContext; request: RequestMock } => {
    const request: RequestMock = { headers: {} };
    if (authorization !== undefined) {
      request.headers.authorization = authorization;
    }
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { context, request };
  };

  return { guard, jwt, contextFor, findSession };
}

describe('OptionalJwtAuthGuard', () => {
  it('không có header → cho qua, request.user undefined', async () => {
    const { guard, contextFor, findSession } = createSetup();
    const { context, request } = contextFor();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBeUndefined();
    expect(findSession).not.toHaveBeenCalled();
  });

  it('token hợp lệ → gắn payload vào request', async () => {
    const { guard, jwt, contextFor } = createSetup();
    const token = await jwt.signAsync(
      { sub: '5', sid: SID, typ: 'access' },
      { expiresIn: 900 },
    );
    const { context, request } = contextFor(`Bearer ${token}`);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toMatchObject({ sub: '5', sid: SID });
  });

  it('token sai → AUTH_TOKEN_INVALID (route công khai vẫn phải từ chối token bẩn)', async () => {
    const { guard, contextFor } = createSetup();
    const { context } = contextFor('Bearer token-khong-hop-le');

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: 'AUTH_TOKEN_INVALID',
    });
  });

  it('header không phải Bearer → AUTH_TOKEN_INVALID', async () => {
    const { guard, contextFor } = createSetup();
    const { context } = contextFor('Basic abc123');

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: 'AUTH_TOKEN_INVALID',
    });
  });

  it('token thu hồi không được coi là guest', async () => {
    const { guard, jwt, findSession, contextFor } = createSetup();
    findSession.mockResolvedValue(null);
    const token = await jwt.signAsync(
      { sub: '5', sid: SID, typ: 'access' },
      { expiresIn: 900 },
    );
    const { context, request } = contextFor(`Bearer ${token}`);
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: 'AUTH_TOKEN_INVALID',
    });
    expect(request.user).toBeUndefined();
  });
});
