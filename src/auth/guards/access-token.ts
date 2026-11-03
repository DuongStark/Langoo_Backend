import { HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { isUUID } from 'class-validator';
import { DomainException } from '../../common/errors/domain.exception';
import { JwtPayload } from '../types/auth.types';

const MAX_USER_ID = 9223372036854775807n;

/** Signature/claims only. Protected APIs must also check the live session. */
export async function verifyBearerAccessToken(
  jwt: JwtService,
  authorization?: string,
): Promise<JwtPayload> {
  if (!authorization) {
    throw new DomainException(
      'AUTH_TOKEN_MISSING',
      'Thiếu access token',
      HttpStatus.UNAUTHORIZED,
    );
  }
  if (!authorization.startsWith('Bearer ')) throw invalidAccessToken();
  try {
    const payload = await jwt.verifyAsync<JwtPayload>(
      authorization.slice('Bearer '.length).trim(),
      { algorithms: ['HS256'] },
    );
    if (
      payload.typ !== 'access' ||
      typeof payload.sub !== 'string' ||
      !/^[1-9]\d{0,18}$/.test(payload.sub) ||
      BigInt(payload.sub) > MAX_USER_ID ||
      typeof payload.sid !== 'string' ||
      !isUUID(payload.sid) ||
      typeof payload.exp !== 'number' ||
      !Number.isSafeInteger(payload.exp)
    ) {
      throw invalidAccessToken();
    }
    return payload;
  } catch {
    throw invalidAccessToken();
  }
}

export function invalidAccessToken(): DomainException {
  return new DomainException(
    'AUTH_TOKEN_INVALID',
    'Access token không hợp lệ hoặc đã hết hạn',
    HttpStatus.UNAUTHORIZED,
  );
}
