import { createHash, randomBytes } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v7 as uuidv7 } from 'uuid';
import { DomainException } from '../common/errors/domain.exception';
import { PrismaService } from '../db/prisma.service';
import { lockUser } from '../users/user-lock';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { hashPassword } from './password-hash';
import { PasswordResetMailer } from './password-reset.mailer';
import { normalizeEmail } from './session.helpers';

const RESET_TOKEN_BYTES = 32;
const RESET_TTL_MS = 15 * 60 * 1000;
const CHALLENGE_PRUNE_MS = 60 * 60 * 1000;
const ADDRESS_MIN_INTERVAL_MS = 60 * 1000;
const ADDRESS_HOUR_LIMIT = 5;

export const PASSWORD_FORGOT_MESSAGE =
  'Nếu email tồn tại, hướng dẫn đặt lại mật khẩu đã được gửi';

interface PasswordIdentityRow {
  id: bigint;
  userId: bigint;
  provider: string;
  providerUid: string;
  passwordHash: string | null;
  user: { email: string; status: string };
}

interface ResetChallengeRow {
  consumedAt: Date | null;
  expiresAt: Date;
  emailAtIssue: string;
  identity: PasswordIdentityRow;
}

interface IssuedChallenge {
  email: string;
  token: string;
}

export interface PasswordForgotResult {
  message: string;
}

export interface PasswordResetResult {
  user_id: string;
  sessions_revoked: number;
  next_action: 'login';
}

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mailer: PasswordResetMailer,
  ) {}

  forgot(dto: ForgotPasswordDto): Promise<PasswordForgotResult> {
    if (!this.mailer.isConfigured()) {
      return Promise.reject(passwordResetUnavailable());
    }

    const email = normalizeEmail(dto.email);
    setImmediate(() => {
      void this.deliverResetEmail(email).catch(() =>
        this.logger.warn('Không xử lý được email đặt lại mật khẩu'),
      );
    });

    return Promise.resolve({ message: PASSWORD_FORGOT_MESSAGE });
  }

  async reset(dto: ResetPasswordDto): Promise<PasswordResetResult> {
    if (!this.mailer.isConfigured()) {
      throw passwordResetUnavailable();
    }

    const tokenHash = hashResetToken(dto.token);
    const preliminary = await this.prisma.passwordResetChallenge.findUnique({
      where: { tokenHash },
      include: { identity: { include: { user: true } } },
    });
    if (!isUsableChallenge(preliminary, new Date())) {
      throw invalidChallenge();
    }

    // Argon2 chạy ngoài transaction, sau khi token đã hợp lệ sơ bộ.
    const newPasswordHash = await hashPassword(this.config, dto.new_password);

    return this.prisma.$transaction(async (tx) => {
      await lockUser(tx, preliminary.identity.userId);

      const challenge = await tx.passwordResetChallenge.findUnique({
        where: { tokenHash },
        include: { identity: { include: { user: true } } },
      });
      const now = new Date();
      if (!isUsableChallenge(challenge, now)) {
        throw invalidChallenge();
      }

      // Mọi link chưa dùng của identity hết hiệu lực trong cùng transaction.
      await tx.passwordResetChallenge.updateMany({
        where: { identityId: challenge.identity.id, consumedAt: null },
        data: { consumedAt: now },
      });
      await tx.userIdentity.update({
        where: { id: challenge.identity.id },
        data: { passwordHash: newPasswordHash, emailVerifiedAt: now },
      });
      const sessions = await tx.userSession.updateMany({
        where: { userId: challenge.identity.userId, revokedAt: null },
        data: { revokedAt: now },
      });

      return {
        user_id: challenge.identity.userId.toString(),
        sessions_revoked: sessions.count,
        next_action: 'login' as const,
      };
    });
  }

  private async deliverResetEmail(email: string): Promise<void> {
    const issued = await this.issueChallenge(email);
    if (issued) {
      await this.mailer.sendResetLink(issued.email, issued.token);
    }
  }

  private async issueChallenge(email: string): Promise<IssuedChallenge | null> {
    const identity = await this.prisma.userIdentity.findUnique({
      where: {
        provider_providerUid: { provider: 'password', providerUid: email },
      },
      include: { user: true },
    });
    if (!isEligiblePasswordIdentity(identity, email)) {
      return null;
    }

    const token = randomBytes(RESET_TOKEN_BYTES).toString('base64url');
    const tokenHash = hashResetToken(token);

    return this.prisma.$transaction(async (tx) => {
      await lockUser(tx, identity.userId);

      // Đọc lại sau lock: identity/email/status có thể vừa đổi.
      const fresh = await tx.userIdentity.findUnique({
        where: { id: identity.id },
        include: { user: true },
      });
      if (!isEligiblePasswordIdentity(fresh, email)) {
        return null;
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + RESET_TTL_MS);
      const minuteFloor = new Date(now.getTime() - ADDRESS_MIN_INTERVAL_MS);
      const hourFloor = new Date(now.getTime() - CHALLENGE_PRUNE_MS);

      await tx.passwordResetChallenge.deleteMany({
        where: { identityId: fresh.id, createdAt: { lt: hourFloor } },
      });
      const recentMinute = await tx.passwordResetChallenge.count({
        where: { identityId: fresh.id, createdAt: { gt: minuteFloor } },
      });
      const recentHour = await tx.passwordResetChallenge.count({
        where: { identityId: fresh.id, createdAt: { gt: hourFloor } },
      });
      if (recentMinute > 0 || recentHour >= ADDRESS_HOUR_LIMIT) {
        return null;
      }

      await tx.passwordResetChallenge.create({
        data: {
          id: uuidv7(),
          identityId: fresh.id,
          tokenHash,
          emailAtIssue: fresh.providerUid,
          createdAt: now,
          expiresAt,
        },
      });

      return { email: fresh.providerUid, token };
    });
  }
}

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function isEligiblePasswordIdentity(
  identity: PasswordIdentityRow | null,
  requestedEmail: string,
): identity is PasswordIdentityRow {
  return (
    identity !== null &&
    identity.provider === 'password' &&
    identity.passwordHash !== null &&
    identity.providerUid === requestedEmail &&
    normalizeEmail(identity.user.email) === identity.providerUid &&
    identity.user.status === 'active'
  );
}

function isUsableChallenge(
  challenge: ResetChallengeRow | null,
  now: Date,
): challenge is ResetChallengeRow {
  if (challenge === null || challenge.consumedAt !== null) {
    return false;
  }
  if (challenge.expiresAt <= now) {
    return false;
  }
  const identity = challenge.identity;
  return (
    identity.provider === 'password' &&
    identity.passwordHash !== null &&
    identity.providerUid === challenge.emailAtIssue &&
    normalizeEmail(identity.user.email) === challenge.emailAtIssue &&
    identity.user.status === 'active'
  );
}

function invalidChallenge(): DomainException {
  return new DomainException(
    'AUTH_CHALLENGE_INVALID',
    'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn',
    HttpStatus.BAD_REQUEST,
  );
}

function passwordResetUnavailable(): DomainException {
  return new DomainException(
    'AUTH_PASSWORD_RESET_UNAVAILABLE',
    'Chức năng đặt lại mật khẩu chưa được cấu hình',
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}
