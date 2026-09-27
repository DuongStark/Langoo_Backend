import { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';

const SECRET = 'unit-test-secret-0123456789abcdef0123456789';

interface RequestMock {
  headers: { authorization?: string };
  user?: { sub: string; sid: string };
}

function createSetup(): {
  guard: OptionalJwtAuthGuard;
  jwt: JwtService;
  contextFor: (authorization?: string) => {
    context: ExecutionContext;
    request: RequestMock;
  };
} {
  const jwt = new JwtService({ secret: SECRET });
  const guard = new OptionalJwtAuthGuard(jwt);

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

  return { guard, jwt, contextFor };
}

describe('OptionalJwtAuthGuard', () => {
  it('không có header → cho qua, request.user undefined', async () => {
    const { guard, contextFor } = createSetup();
    const { context, request } = contextFor();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBeUndefined();
  });

  it('token hợp lệ → gắn payload vào request', async () => {
    const { guard, jwt, contextFor } = createSetup();
    const token = await jwt.signAsync(
      { sub: '5', sid: 'session-1', typ: 'access' },
      { expiresIn: 900 },
    );
    const { context, request } = contextFor(`Bearer ${token}`);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toMatchObject({ sub: '5', sid: 'session-1' });
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
});
