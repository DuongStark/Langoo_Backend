import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { v7 as uuidv7 } from 'uuid';
import { DomainException } from '../common/errors/domain.exception';
import { parseTtlSeconds } from '../config/jwt-ttl';
import { PrismaService } from '../db/prisma.service';
import {
  DEFAULT_DAILY_GOAL,
  DEFAULT_TIMEZONE,
} from '../users/settings.constants';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { hashPassword, verifyPassword } from './password-hash';
import {
  accessTokenTtl,
  assertUserActive,
  AuthUserRow,
  createDevice,
  generateRefreshToken,
  hashRefreshToken,
  isUniqueViolation,
  issueTokens,
  normalizeEmail,
  refreshExpiry,
  toUserResponse,
} from './session.helpers';
import {
  AuthResult,
  AuthTokens,
  JwtPayload,
  SessionResponse,
  UserResponse,
} from './types/auth.types';

// Giữ export tương thích cho các caller/test từng dùng helper từ auth.service.
export { parseTtlSeconds };
export { generateRefreshToken, hashRefreshToken, normalizeEmail };

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const expiresIn = accessTokenTtl(this.config);
    const email = normalizeEmail(dto.email);
    const existing = await this.prisma.user.findFirst({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      throw emailTaken();
    }

    const passwordHash = await hashPassword(this.config, dto.password);
    const sessionId = uuidv7();
    const refreshToken = generateRefreshToken();

    let user: AuthUserRow;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email,
            displayName: dto.display_name ?? null,
            status: 'active',
          },
        });
        const passwordIdentity = await tx.userIdentity.create({
          data: {
            userId: created.id,
            provider: 'password',
            providerUid: email,
            passwordHash,
          },
        });
        const deviceId = await createDevice(tx, created.id, dto.device ?? null);
        await tx.userSession.create({
          data: {
            id: sessionId,
            userId: created.id,
            deviceId,
            refreshTokenHash: hashRefreshToken(refreshToken),
            expiresAt: refreshExpiry(this.config),
          },
        });
        await tx.userSettings.create({
          data: {
            userId: created.id,
            timezone: DEFAULT_TIMEZONE,
            dailyGoal: DEFAULT_DAILY_GOAL,
            notify: {},
          },
        });
        return {
          ...created,
          identities: [passwordIdentity],
        };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw emailTaken();
      }
      throw error;
    }

    return {
      user: toUserResponse(user),
      ...(await issueTokens(
        this.jwt,
        user.id,
        sessionId,
        refreshToken,
        expiresIn,
      )),
    };
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const expiresIn = accessTokenTtl(this.config);
    const email = normalizeEmail(dto.email);
    const identity = await this.prisma.userIdentity.findUnique({
      where: {
        provider_providerUid: { provider: 'password', providerUid: email },
      },
      include: { user: true },
    });
    if (!identity?.passwordHash) {
      throw invalidCredentials();
    }

    const passwordOk = await verifyPassword(
      identity.passwordHash,
      dto.password,
    );
    if (!passwordOk) {
      throw invalidCredentials();
    }
    assertUserActive(identity.user.status);

    const sessionId = uuidv7();
    const refreshToken = generateRefreshToken();

    const user = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: identity.userId },
        data: { lastLoginAt: new Date() },
        include: { identities: true },
      });
      // Read in a separate statement after taking the user row lock.
      const currentPassword = await tx.userIdentity.findUnique({
        where: { id: identity.id },
        select: { provider: true, passwordHash: true },
      });
      if (
        !currentPassword ||
        currentPassword.provider !== 'password' ||
        !currentPassword.passwordHash ||
        currentPassword.passwordHash !== identity.passwordHash
      ) {
        throw invalidCredentials();
      }
      assertUserActive(updated.status);
      const deviceId = await createDevice(
        tx,
        identity.userId,
        dto.device ?? null,
      );
      await tx.userSession.create({
        data: {
          id: sessionId,
          userId: identity.userId,
          deviceId,
          refreshTokenHash: hashRefreshToken(refreshToken),
          expiresAt: refreshExpiry(this.config),
        },
      });
      return updated;
    });

    return {
      user: toUserResponse(user),
      ...(await issueTokens(
        this.jwt,
        user.id,
        sessionId,
        refreshToken,
        expiresIn,
      )),
    };
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const expiresIn = accessTokenTtl(this.config);
    const oldTokenHash = hashRefreshToken(refreshToken);
    const session = await this.prisma.userSession.findUnique({
      where: { refreshTokenHash: oldTokenHash },
      include: { user: true },
    });
    if (!session || session.revokedAt) {
      throw invalidRefreshToken();
    }
    const now = new Date();
    if (session.expiresAt <= now) {
      throw new DomainException(
        'AUTH_REFRESH_TOKEN_EXPIRED',
        'Refresh token đã hết hạn, vui lòng đăng nhập lại',
        HttpStatus.UNAUTHORIZED,
      );
    }
    assertUserActive(session.user.status);

    const newToken = generateRefreshToken();
    const rotated = await this.prisma.userSession.updateMany({
      where: {
        id: session.id,
        refreshTokenHash: oldTokenHash,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        refreshTokenHash: hashRefreshToken(newToken),
        lastUsedAt: new Date(),
      },
    });
    if (rotated.count !== 1) {
      throw invalidRefreshToken();
    }

    return issueTokens(
      this.jwt,
      session.userId,
      session.id,
      newToken,
      expiresIn,
    );
  }

  async logout(payload: JwtPayload): Promise<SessionResponse> {
    const session = await this.prisma.userSession.findUnique({
      where: { id: payload.sid },
    });
    if (!session || session.userId !== BigInt(payload.sub)) {
      throw new DomainException(
        'AUTH_TOKEN_INVALID',
        'Access token không hợp lệ',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (session.revokedAt) {
      return { id: session.id, revoked_at: session.revokedAt.toISOString() };
    }

    await this.prisma.userSession.updateMany({
      where: { id: session.id, userId: session.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    // A concurrent logout may have won the update; return its stored timestamp.
    const revoked = await this.prisma.userSession.findUnique({
      where: { id: session.id },
    });
    if (!revoked || revoked.userId !== session.userId || !revoked.revokedAt) {
      throw new DomainException(
        'AUTH_TOKEN_INVALID',
        'Access token không hợp lệ',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return {
      id: revoked.id,
      revoked_at: revoked.revokedAt.toISOString(),
    };
  }

  async me(userId: bigint): Promise<UserResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { identities: true },
    });
    if (!user) {
      throw new DomainException(
        'AUTH_TOKEN_INVALID',
        'Access token không hợp lệ',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return toUserResponse(user);
  }
}

function emailTaken(): DomainException {
  return new DomainException(
    'AUTH_EMAIL_TAKEN',
    'Email đã được đăng ký',
    HttpStatus.CONFLICT,
  );
}

function invalidCredentials(): DomainException {
  return new DomainException(
    'AUTH_INVALID_CREDENTIALS',
    'Email hoặc mật khẩu không đúng',
    HttpStatus.UNAUTHORIZED,
  );
}

function invalidRefreshToken(): DomainException {
  return new DomainException(
    'AUTH_INVALID_REFRESH_TOKEN',
    'Refresh token không hợp lệ hoặc đã bị thu hồi',
    HttpStatus.UNAUTHORIZED,
  );
}
