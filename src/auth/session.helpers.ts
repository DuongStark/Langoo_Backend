import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { DomainException } from '../common/errors/domain.exception';
import { parseTtlSeconds } from '../config/jwt-ttl';
import { Prisma } from '../generated/prisma/client';
import { DeviceInfoDto } from './dto/device-info.dto';
import { AuthTokens, UserResponse } from './types/auth.types';

export interface AuthIdentityRow {
  provider: string;
  passwordHash?: string | null;
  createdAt: Date;
}

/** Các cột của app.users mà tầng auth cần (login thường và OAuth dùng chung). */
export interface AuthUserRow {
  id: bigint;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: string;
  createdAt: Date;
  lastLoginAt: Date | null;
  identities?: AuthIdentityRow[];
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function accessTokenTtl(config: ConfigService): number {
  return parseTtlSeconds(config.getOrThrow<string>('JWT_ACCESS_TTL'));
}

export function refreshExpiry(config: ConfigService): Date {
  const days = config.getOrThrow<number>('JWT_REFRESH_TTL_DAYS');
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export async function issueTokens(
  jwt: JwtService,
  userId: bigint,
  sessionId: string,
  refreshToken: string,
  expiresIn: number,
): Promise<AuthTokens> {
  const access_token = await jwt.signAsync(
    { sub: userId.toString(), sid: sessionId, typ: 'access' },
    { expiresIn },
  );
  return { access_token, refresh_token: refreshToken, expires_in: expiresIn };
}

export async function createDevice(
  tx: Prisma.TransactionClient,
  userId: bigint,
  device: DeviceInfoDto | null,
): Promise<string | null> {
  if (!device) {
    return null;
  }
  const id = uuidv7();
  await tx.device.create({
    data: {
      id,
      userId,
      platform: device.platform,
      appVersion: device.app_version ?? null,
    },
  });
  return id;
}

export function assertUserActive(status: string): void {
  if (status === 'locked') {
    throw new DomainException(
      'AUTH_ACCOUNT_LOCKED',
      'Tài khoản đã bị khoá',
      HttpStatus.FORBIDDEN,
    );
  }
  if (status === 'deleted') {
    throw new DomainException(
      'AUTH_ACCOUNT_DELETED',
      'Tài khoản đã bị xoá',
      HttpStatus.FORBIDDEN,
    );
  }
}

export function toUserResponse(user: AuthUserRow): UserResponse {
  const identitiesList = user.identities ?? [];
  const identities = identitiesList.map((id) => ({
    provider: id.provider,
    created_at:
      id.createdAt instanceof Date
        ? id.createdAt.toISOString()
        : typeof id.createdAt === 'string'
          ? id.createdAt
          : new Date().toISOString(),
  }));
  const hasPassword = identitiesList.some(
    (id) => id.provider === 'password' && !!id.passwordHash,
  );
  const hasGoogle = identitiesList.some((id) => id.provider === 'google');

  return {
    id: user.id.toString(),
    email: user.email,
    display_name: user.displayName,
    avatar_url: user.avatarUrl,
    status: user.status,
    created_at: user.createdAt.toISOString(),
    last_login_at: user.lastLoginAt?.toISOString() ?? null,
    identities,
    has_password: hasPassword,
    has_google: hasGoogle,
  };
}

/** Prisma trả P2002 khi vi phạm unique — dùng để xử lý đua ghi. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
