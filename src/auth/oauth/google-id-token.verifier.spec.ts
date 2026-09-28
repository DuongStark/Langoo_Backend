import { ConfigService } from '@nestjs/config';
import { GoogleIdTokenVerifier } from './google-id-token.verifier';

const mockVerifyIdToken = jest.fn();

jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: (...args: unknown[]) =>
      mockVerifyIdToken(...args) as unknown,
  })),
}));

function configWith(value: string | undefined): ConfigService {
  return {
    get: jest.fn((key: string) =>
      key === 'GOOGLE_OAUTH_CLIENT_IDS' ? value : undefined,
    ),
  } as unknown as ConfigService;
}

describe('GoogleIdTokenVerifier', () => {
  beforeEach(() => {
    mockVerifyIdToken.mockReset();
  });

  it('chưa cấu hình client id → 503 AUTH_OAUTH_NOT_CONFIGURED, không gọi Google', async () => {
    const verifier = new GoogleIdTokenVerifier(configWith(undefined));
    await expect(verifier.verify('token')).rejects.toMatchObject({
      code: 'AUTH_OAUTH_NOT_CONFIGURED',
    });

    const empty = new GoogleIdTokenVerifier(configWith(' , ,'));
    await expect(empty.verify('token')).rejects.toMatchObject({
      code: 'AUTH_OAUTH_NOT_CONFIGURED',
    });
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
  });

  it('verify thành công: map claims (trim tên/ảnh) và truyền audience đã tách', async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({
        sub: 'sub-1',
        email: 'User@Example.com',
        email_verified: true,
        name: '  An  ',
        picture: 'https://img.example/avatar.png',
        nonce: 'nonce-1',
      }),
    });
    const verifier = new GoogleIdTokenVerifier(
      configWith(' client-web , client-ios ,, '),
    );

    const identity = await verifier.verify('id-token');

    expect(mockVerifyIdToken).toHaveBeenCalledWith({
      idToken: 'id-token',
      audience: ['client-web', 'client-ios'],
    });
    expect(identity).toEqual({
      sub: 'sub-1',
      email: 'User@Example.com',
      emailVerified: true,
      name: 'An',
      picture: 'https://img.example/avatar.png',
      nonce: 'nonce-1',
    });
  });

  it('email_verified thiếu/false → emailVerified=false; claim rỗng → null', async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({
        sub: 'sub-2',
        email: 'user@example.com',
        name: '   ',
        picture: undefined,
        nonce: '',
      }),
    });
    const verifier = new GoogleIdTokenVerifier(configWith('client-web'));

    const identity = await verifier.verify('id-token');

    expect(identity.emailVerified).toBe(false);
    expect(identity.name).toBeNull();
    expect(identity.picture).toBeNull();
    expect(identity.nonce).toBeNull();
  });

  it('thư viện ném lỗi (sai chữ ký/hết hạn/sai audience) → 401 AUTH_OAUTH_TOKEN_INVALID', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('Wrong recipient'));
    const verifier = new GoogleIdTokenVerifier(configWith('client-web'));

    await expect(verifier.verify('id-token')).rejects.toMatchObject({
      code: 'AUTH_OAUTH_TOKEN_INVALID',
    });
  });

  it('payload thiếu sub/email → 401 AUTH_OAUTH_TOKEN_INVALID', async () => {
    const verifier = new GoogleIdTokenVerifier(configWith('client-web'));

    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({ sub: '', email: 'user@example.com' }),
    });
    await expect(verifier.verify('id-token')).rejects.toMatchObject({
      code: 'AUTH_OAUTH_TOKEN_INVALID',
    });

    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({ sub: 'sub-3', email: '   ' }),
    });
    await expect(verifier.verify('id-token')).rejects.toMatchObject({
      code: 'AUTH_OAUTH_TOKEN_INVALID',
    });

    mockVerifyIdToken.mockResolvedValue({ getPayload: () => undefined });
    await expect(verifier.verify('id-token')).rejects.toMatchObject({
      code: 'AUTH_OAUTH_TOKEN_INVALID',
    });
  });
});
