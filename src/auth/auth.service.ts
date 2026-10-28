import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
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

    const passwordHash = await this.hashPassword(dto.password);
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

    const passwordOk = await this.verifyPassword(
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

    const revoked = await this.prisma.userSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    return {
      id: revoked.id,
      revoked_at: revoked.revokedAt?.toISOString() ?? null,
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

  private async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: this.config.getOrThrow<number>('ARGON2_MEMORY_COST'),
      timeCost: this.config.getOrThrow<number>('ARGON2_TIME_COST'),
      parallelism: 1,
    });
  }

  /** Hash lưu DB có thể hỏng (seed/di trú) — coi như sai mật khẩu, không 500. */
  private async verifyPassword(
    storedHash: string,
    password: string,
  ): Promise<boolean> {
    try {
      return await argon2.verify(storedHash, password);
    } catch {
      return false;
    }
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
