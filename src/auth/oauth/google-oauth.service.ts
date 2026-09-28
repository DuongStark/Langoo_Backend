import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { v7 as uuidv7 } from 'uuid';
import { DomainException } from '../../common/errors/domain.exception';
import { PrismaService } from '../../db/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import {
  DEFAULT_DAILY_GOAL,
  DEFAULT_TIMEZONE,
} from '../../users/settings.constants';
import { DeviceInfoDto } from '../dto/device-info.dto';
import { GoogleLoginDto } from '../dto/google-login.dto';
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
} from '../session.helpers';
import { AuthResult } from '../types/auth.types';
import {
  GoogleIdTokenVerifier,
  GoogleIdentity,
} from './google-id-token.verifier';

/**
 * Đăng nhập/đăng ký bằng Google ID token.
 *
 * Chính sách liên kết (chốt 2026-09-28): nếu email Google đã xác thực trùng
 * tài khoản password có sẵn thì tự động liên kết (chỉ khi email_verified=true).
 */
@Injectable()
export class GoogleOauthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly verifier: GoogleIdTokenVerifier,
  ) {}

  async login(dto: GoogleLoginDto): Promise<AuthResult> {
    const identity = await this.verifier.verify(dto.id_token);
    if (identity.nonce !== (dto.nonce ?? null)) {
      throw nonceMismatch();
    }
    if (!identity.emailVerified) {
      throw emailUnverified();
    }

    const email = normalizeEmail(identity.email);
    const expiresIn = accessTokenTtl(this.config);
    const sessionId = uuidv7();
    const refreshToken = generateRefreshToken();

    const user = await this.resolveUser(
      identity,
      email,
      dto.device ?? null,
      sessionId,
      refreshToken,
    );

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

  /**
   * Hai request đồng thời (cùng `sub` hoặc cùng email) có thể đua tạo user/identity.
   * P2002 → chạy lại 1 lần; lần này dòng thắng đã tồn tại nên đi nhánh "đã liên kết".
   */
  private async resolveUser(
    identity: GoogleIdentity,
    email: string,
    device: DeviceInfoDto | null,
    sessionId: string,
    refreshToken: string,
  ): Promise<AuthUserRow> {
    try {
      return await this.prisma.$transaction((tx) =>
        this.applyLogin(tx, identity, email, device, sessionId, refreshToken),
      );
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      try {
        return await this.prisma.$transaction((tx) =>
          this.applyLogin(tx, identity, email, device, sessionId, refreshToken),
        );
      } catch (retryError) {
        if (isUniqueViolation(retryError)) {
          throw new DomainException(
            'AUTH_OAUTH_CONFLICT',
            'Không thể đồng bộ tài khoản Google, vui lòng thử lại',
            HttpStatus.CONFLICT,
          );
        }
        throw retryError;
      }
    }
  }

  private async applyLogin(
    tx: Prisma.TransactionClient,
    identity: GoogleIdentity,
    email: string,
    device: DeviceInfoDto | null,
    sessionId: string,
    refreshToken: string,
  ): Promise<AuthUserRow> {
    const linked = await tx.userIdentity.findUnique({
      where: {
        provider_providerUid: { provider: 'google', providerUid: identity.sub },
      },
      include: { user: true },
    });

    let userId: bigint;
    let avatarUpgrade: string | null = null;

    if (linked) {
      assertUserActive(linked.user.status);
      userId = linked.userId;
      avatarUpgrade = linked.user.avatarUrl === null ? identity.picture : null;
    } else {
      const existing = await tx.user.findFirst({ where: { email } });
      if (existing) {
        assertUserActive(existing.status);
        await tx.userIdentity.create({
          data: {
            userId: existing.id,
            provider: 'google',
            providerUid: identity.sub,
            emailVerifiedAt: new Date(),
          },
        });
        userId = existing.id;
        avatarUpgrade = existing.avatarUrl === null ? identity.picture : null;
      } else {
        const created = await tx.user.create({
          data: {
            email,
            displayName: identity.name,
            avatarUrl: identity.picture,
            status: 'active',
          },
        });
        await tx.userIdentity.create({
          data: {
            userId: created.id,
            provider: 'google',
            providerUid: identity.sub,
            emailVerifiedAt: new Date(),
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
        userId = created.id;
      }
    }

    const deviceId = await createDevice(tx, userId, device);
    await tx.userSession.create({
      data: {
        id: sessionId,
        userId,
        deviceId,
        refreshTokenHash: hashRefreshToken(refreshToken),
        expiresAt: refreshExpiry(this.config),
      },
    });

    return tx.user.update({
      where: { id: userId },
      data: {
        lastLoginAt: new Date(),
        ...(avatarUpgrade === null ? {} : { avatarUrl: avatarUpgrade }),
      },
    });
  }
}

function nonceMismatch(): DomainException {
  return new DomainException(
    'AUTH_OAUTH_TOKEN_INVALID',
    'Nonce của Google ID token không khớp',
    HttpStatus.UNAUTHORIZED,
  );
}

function emailUnverified(): DomainException {
  return new DomainException(
    'AUTH_OAUTH_EMAIL_UNVERIFIED',
    'Email của tài khoản Google chưa được xác thực',
    HttpStatus.FORBIDDEN,
  );
}
