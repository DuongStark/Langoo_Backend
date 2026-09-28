import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoginTicket, OAuth2Client, TokenPayload } from 'google-auth-library';
import { DomainException } from '../../common/errors/domain.exception';

/** Danh tính Google đã xác minh — chỉ chứa dữ liệu tin được từ ID token. */
export interface GoogleIdentity {
  /** `sub`: id ổn định của tài khoản Google (khoá liên kết trong user_identity). */
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
  /** Google Workspace hosted domain, nếu ID token có claim `hd`. */
  hostedDomain: string | null;
  nonce: string | null;
}

/**
 * Xác minh Google ID token (chữ ký JWKS, iss/aud/exp) qua thư viện chính chủ.
 * Danh sách audience hợp lệ đọc từ GOOGLE_OAUTH_CLIENT_IDS (nhiều client id
 * cho web/iOS/Android, cách nhau dấu phẩy). Chưa cấu hình → 503.
 */
@Injectable()
export class GoogleIdTokenVerifier {
  private readonly audiences: string[];
  private readonly client = new OAuth2Client({
    transporterOptions: {
      timeout: 5000,
      retryConfig: {
        retry: 1,
        noResponseRetries: 1,
        retryDelay: 100,
        httpMethodsToRetry: ['GET'],
        statusCodesToRetry: [
          [429, 429],
          [500, 599],
        ],
      },
    },
  });

  constructor(config: ConfigService) {
    const raw = config.get<string>('GOOGLE_OAUTH_CLIENT_IDS') ?? '';
    this.audiences = raw
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value !== '');
  }

  async verify(idToken: string): Promise<GoogleIdentity> {
    if (this.audiences.length === 0) {
      throw new DomainException(
        'AUTH_OAUTH_NOT_CONFIGURED',
        'Đăng nhập Google chưa được cấu hình',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    let payload: TokenPayload | undefined;
    try {
      const ticket: LoginTicket = await this.client.verifyIdToken({
        idToken,
        audience: this.audiences,
      });
      payload = ticket.getPayload();
    } catch (error) {
      if (isProviderUnavailable(error)) {
        throw providerUnavailable();
      }
      throw invalidGoogleToken();
    }

    if (
      payload === undefined ||
      typeof payload.sub !== 'string' ||
      payload.sub === '' ||
      typeof payload.email !== 'string' ||
      payload.email.trim() === ''
    ) {
      throw invalidGoogleToken();
    }

    return {
      sub: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified === true,
      name: cleanClaim(payload.name),
      picture: cleanClaim(payload.picture),
      hostedDomain: cleanClaim(payload.hd),
      nonce:
        typeof payload.nonce === 'string' && payload.nonce !== ''
          ? payload.nonce
          : null,
    };
  }
}

function cleanClaim(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function invalidGoogleToken(): DomainException {
  return new DomainException(
    'AUTH_OAUTH_TOKEN_INVALID',
    'Google ID token không hợp lệ hoặc đã hết hạn',
    HttpStatus.UNAUTHORIZED,
  );
}

function providerUnavailable(): DomainException {
  return new DomainException(
    'AUTH_OAUTH_PROVIDER_UNAVAILABLE',
    'Dịch vụ xác minh Google hiện không khả dụng, vui lòng thử lại',
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}

/**
 * Google Auth Library wraps network/API failures differently across transports.
 * Use structured status/code fields only; malformed or rejected JWTs remain 401.
 */
function isProviderUnavailable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const record = error as {
    code?: unknown;
    response?: { status?: unknown; statusCode?: unknown };
    status?: unknown;
    statusCode?: unknown;
  };
  const code = typeof record.code === 'string' ? record.code : null;
  if (
    code !== null &&
    new Set([
      'ECONNABORTED',
      'ECONNREFUSED',
      'ECONNRESET',
      'EAI_AGAIN',
      'ENETUNREACH',
      'ENOTFOUND',
      'ETIMEDOUT',
      'EHOSTUNREACH',
    ]).has(code)
  ) {
    return true;
  }

  const status = Number(
    record.response?.status ??
      record.response?.statusCode ??
      record.status ??
      record.statusCode,
  );
  return status === 429 || status >= 500;
}
