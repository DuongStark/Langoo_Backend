import { createHash, randomBytes } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import { v7 as uuidv7 } from 'uuid';
import { DomainException } from '../common/errors/domain.exception';
import { PrismaService } from '../db/prisma.service';
import {
  DEFAULT_DAILY_GOAL,
  DEFAULT_TIMEZONE,
} from '../users/settings.constants';
import { DeviceInfoDto } from './dto/device-info.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import {
  AuthResult,
  AuthTokens,
  JwtPayload,
  SessionResponse,
  UserResponse,
} from './types/auth.types';

/** Các cột của app.users mà tầng auth cần. */
interface AuthUserRow {
  id: bigint;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: string;
  createdAt: Date;
  lastLoginAt: Date | null;
}

/** Client Prisma trong transaction. */
type TxClient = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
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
        await tx.userIdentity.create({
          data: {
            userId: created.id,
            provider: 'password',
            providerUid: email,
            passwordHash,
          },
        });
        const deviceId = await this.createDevice(
          tx,
          created.id,
          dto.device ?? null,
        );
        await tx.userSession.create({
          data: {
            id: sessionId,
            userId: created.id,
            deviceId,
            refreshTokenHash: hashRefreshToken(refreshToken),
            expiresAt: this.refreshExpiry(),
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
        return created;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw emailTaken();
      }
      throw error;
    }

    return {
      user: toUserResponse(user),
      ...(await this.issueTokens(user.id, sessionId, refreshToken)),
    };
  }

  async login(dto: LoginDto): Promise<AuthResult> {
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

    const passwordOk = await argon2.verify(identity.passwordHash, dto.password);
    if (!passwordOk) {
      throw invalidCredentials();
    }
    this.assertUserActive(identity.user.status);

    const sessionId = uuidv7();
    const refreshToken = generateRefreshToken();

    const user = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: identity.userId },
        data: { lastLoginAt: new Date() },
      });
      const deviceId = await this.createDevice(
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
          expiresAt: this.refreshExpiry(),
        },
      });
      return updated;
    });

    return {
      user: toUserResponse(user),
      ...(await this.issueTokens(user.id, sessionId, refreshToken)),
    };
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const session = await this.prisma.userSession.findUnique({
      where: { refreshTokenHash: hashRefreshToken(refreshToken) },
      include: { user: true },
    });
    if (!session || session.revokedAt) {
      throw invalidRefreshToken();
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new DomainException(
        'AUTH_REFRESH_TOKEN_EXPIRED',
        'Refresh token đã hết hạn, vui lòng đăng nhập lại',
        HttpStatus.UNAUTHORIZED,
      );
    }
    this.assertUserActive(session.user.status);

    const newToken = generateRefreshToken();
    await this.prisma.userSession.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: hashRefreshToken(newToken),
        lastUsedAt: new Date(),
      },
    });

    return this.issueTokens(session.userId, session.id, newToken);
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
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
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

  private async issueTokens(
    userId: bigint,
    sessionId: string,
    refreshToken: string,
  ): Promise<AuthTokens> {
    const expiresIn = parseTtlSeconds(
      this.config.getOrThrow<string>('JWT_ACCESS_TTL'),
    );
    const access_token = await this.jwt.signAsync(
      { sub: userId.toString(), sid: sessionId, typ: 'access' },
      { expiresIn },
    );
    return { access_token, refresh_token: refreshToken, expires_in: expiresIn };
  }

  private async createDevice(
    tx: TxClient,
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

  private refreshExpiry(): Date {
    const days = this.config.getOrThrow<number>('JWT_REFRESH_TTL_DAYS');
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  private assertUserActive(status: string): void {
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

/** '15m' | '1h' | '900s' | '30d' → số giây. Không hỗ trợ giá trị phức tạp. */
export function parseTtlSeconds(value: string): number {
  const match = /^(\d+)([smhd])?$/.exec(value.trim());
  if (!match) {
    throw new Error(`JWT_ACCESS_TTL không hợp lệ: "${value}"`);
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? 's';
  const multiplier =
    unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
  return amount * multiplier;
}

function toUserResponse(user: AuthUserRow): UserResponse {
  return {
    id: user.id.toString(),
    email: user.email,
    display_name: user.displayName,
    avatar_url: user.avatarUrl,
    status: user.status,
    created_at: user.createdAt.toISOString(),
    last_login_at: user.lastLoginAt?.toISOString() ?? null,
  };
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

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
