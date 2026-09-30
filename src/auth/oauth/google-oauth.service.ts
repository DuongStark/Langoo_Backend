import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import { v7 as uuidv7 } from 'uuid';
import { DomainException } from '../../common/errors/domain.exception';
import { PrismaService } from '../../db/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import {
  DEFAULT_DAILY_GOAL,
  DEFAULT_TIMEZONE,
} from '../../users/settings.constants';
import { DeviceInfoDto } from '../dto/device-info.dto';
import { GoogleLinkDto, GoogleLoginDto } from '../dto/google-login.dto';
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
import { AuthResult, GoogleLinkResult } from '../types/auth.types';
import {
  GoogleIdTokenVerifier,
  GoogleIdentity,
} from './google-id-token.verifier';
import {
  GoogleOAuthChallengeRequest,
  GoogleOAuthChallengeService,
} from './google-oauth-challenge.service';

/**
 * Đăng nhập/đăng ký bằng Google ID token.
 *
 * Email chỉ được dùng để phát hiện xung đột. Liên kết với tài khoản password
 * phải đi qua `link()` và xác nhận mật khẩu hiện tại.
 */
@Injectable()
export class GoogleOauthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly verifier: GoogleIdTokenVerifier,
    private readonly challenge: GoogleOAuthChallengeService,
  ) {}

  /**
   * Challenge (nếu dùng) đã đối chiếu hash nonce trong token với challenge do
   * backend cấp, nên client không buộc gửi lại `nonce`; nếu vẫn gửi thì phải khớp.
   * Không dùng challenge: giữ quy tắc bearer — token có nonce thì request phải khớp.
   */
  private assertNonceMatches(
    identity: GoogleIdentity,
    dto: GoogleLoginDto,
    hasChallenge: boolean,
  ): void {
    if (!hasChallenge) {
      if (identity.nonce !== (dto.nonce ?? null)) {
        throw nonceMismatch();
      }
      return;
    }
    if (dto.nonce !== undefined && identity.nonce !== dto.nonce) {
      throw nonceMismatch();
    }
  }

  async login(dto: GoogleLoginDto): Promise<AuthResult> {
    const identity = await this.verifier.verify(dto.id_token);
    this.challenge.assertRequest(dto);
    this.assertNonceMatches(identity, dto, this.challenge.hasChallenge(dto));
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
      dto,
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
   * Liên kết chủ động yêu cầu access token của user và mật khẩu hiện tại.
   * Đây là đường thay thế an toàn cho auto-link theo email.
   */
  async link(
    userId: bigint,
    dto: GoogleLinkDto,
    sessionId?: string,
  ): Promise<GoogleLinkResult> {
    const identity = await this.verifier.verify(dto.id_token);
    this.challenge.assertRequest(dto);
    this.assertNonceMatches(identity, dto, this.challenge.hasChallenge(dto));
    if (!identity.emailVerified) {
      throw emailUnverified();
    }

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
    assertUserActive(user.status);

    const passwordIdentity = user.identities.find(
      (candidate) =>
        candidate.provider === 'password' && candidate.passwordHash,
    );
    if (!passwordIdentity?.passwordHash) {
      throw new DomainException(
        'AUTH_OAUTH_LINK_PASSWORD_REQUIRED',
        'Cần tài khoản mật khẩu để xác nhận liên kết Google',
        HttpStatus.CONFLICT,
      );
    }
    let passwordOk = false;
    try {
      passwordOk = await argon2.verify(
        passwordIdentity.passwordHash,
        dto.password,
      );
    } catch {
      passwordOk = false;
    }
    if (!passwordOk) {
      throw new DomainException(
        'AUTH_INVALID_CREDENTIALS',
        'Email hoặc mật khẩu không đúng',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const email = normalizeEmail(identity.email);
    if (email !== normalizeEmail(user.email)) {
      throw new DomainException(
        'AUTH_OAUTH_EMAIL_MISMATCH',
        'Email Google không trùng tài khoản hiện tại',
        HttpStatus.CONFLICT,
      );
    }

    let linkedAt: Date;
    try {
      linkedAt = await this.prisma.$transaction(async (tx) => {
        await this.challenge.consume(tx, 'link', dto, {
          userId,
          sessionId,
          identityNonce: identity.nonce,
        });
        const linked = await tx.userIdentity.findUnique({
          where: {
            provider_providerUid: {
              provider: 'google',
              providerUid: identity.sub,
            },
          },
        });
        if (linked) {
          if (linked.userId !== userId) {
            throw new DomainException(
              'AUTH_OAUTH_IDENTITY_TAKEN',
              'Tài khoản Google đã được liên kết với tài khoản khác',
              HttpStatus.CONFLICT,
            );
          }
          return linked.createdAt;
        }

        const created = await tx.userIdentity.create({
          data: {
            userId,
            provider: 'google',
            providerUid: identity.sub,
            emailVerifiedAt: new Date(),
          },
        });
        return created.createdAt;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const linked = await this.prisma.userIdentity.findUnique({
        where: {
          provider_providerUid: {
            provider: 'google',
            providerUid: identity.sub,
          },
        },
      });
      if (!linked || linked.userId !== userId) {
        throw new DomainException(
          'AUTH_OAUTH_IDENTITY_TAKEN',
          'Tài khoản Google đã được liên kết với tài khoản khác',
          HttpStatus.CONFLICT,
        );
      }
      linkedAt = linked.createdAt;
    }

    return { provider: 'google', linked_at: linkedAt.toISOString() };
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
    challenge: GoogleOAuthChallengeRequest,
  ): Promise<AuthUserRow> {
    try {
      return await this.prisma.$transaction((tx) =>
        this.applyLogin(
          tx,
          identity,
          email,
          device,
          sessionId,
          refreshToken,
          challenge,
        ),
      );
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      try {
        return await this.prisma.$transaction((tx) =>
          this.applyLogin(
            tx,
            identity,
            email,
            device,
            sessionId,
            refreshToken,
            challenge,
          ),
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
    challenge: GoogleOAuthChallengeRequest,
  ): Promise<AuthUserRow> {
    await this.challenge.consume(tx, 'login', challenge, {
      identityNonce: identity.nonce,
    });
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
        throw linkRequired();
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

function linkRequired(): DomainException {
  return new DomainException(
    'AUTH_OAUTH_LINK_REQUIRED',
    'Email đã có tài khoản. Hãy đăng nhập tài khoản đó để liên kết Google',
    HttpStatus.CONFLICT,
  );
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
