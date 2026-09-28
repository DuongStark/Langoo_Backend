import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v7 as uuidv7 } from 'uuid';
import { DomainException } from '../../common/errors/domain.exception';
import { PrismaService } from '../../db/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { GoogleOAuthChallengePurpose } from '../dto/google-oauth-challenge.dto';

const CHALLENGE_TTL_SECONDS = 300;

export interface GoogleOAuthChallengeResult {
  challenge_id: string;
  nonce: string;
  binding_secret: string;
  expires_in: number;
}

export interface GoogleOAuthChallengeRequest {
  challenge_id?: string;
  binding_secret?: string;
}

export interface GoogleOAuthChallengeContext {
  userId?: bigint;
  sessionId?: string;
  identityNonce: string | null;
}

/**
 * PostgreSQL-backed one-time nonce challenge for the optional C rollout.
 * The feature is deliberately opt-in: existing SDK clients keep the bearer
 * flow until they send challenge_id + binding_secret.
 */
@Injectable()
export class GoogleOAuthChallengeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  isRequired(): boolean {
    return this.config.get<boolean>('GOOGLE_OAUTH_REQUIRE_CHALLENGE') === true;
  }

  private isConfigured(): boolean {
    const raw = this.config.get<string>('GOOGLE_OAUTH_CLIENT_IDS') ?? '';
    return raw.split(',').some((value) => value.trim() !== '');
  }

  hasChallenge(request: GoogleOAuthChallengeRequest): boolean {
    return (
      request.challenge_id !== undefined || request.binding_secret !== undefined
    );
  }

  assertRequest(request: GoogleOAuthChallengeRequest): void {
    const hasChallenge = this.hasChallenge(request);
    if (
      hasChallenge &&
      (typeof request.challenge_id !== 'string' ||
        request.challenge_id.trim() === '' ||
        typeof request.binding_secret !== 'string' ||
        request.binding_secret.length === 0)
    ) {
      throw invalidChallenge();
    }
    if (
      (request.challenge_id === undefined) !==
        (request.binding_secret === undefined) ||
      (this.isRequired() && !hasChallenge)
    ) {
      throw invalidChallenge();
    }
  }

  async create(
    purpose: GoogleOAuthChallengePurpose,
    userId?: bigint,
    sessionId?: string,
  ): Promise<GoogleOAuthChallengeResult> {
    if (!this.isConfigured()) {
      throw new DomainException(
        'AUTH_OAUTH_NOT_CONFIGURED',
        'Đăng nhập Google chưa được cấu hình',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (
      purpose === 'link' &&
      (userId === undefined || sessionId === undefined)
    ) {
      throw new DomainException(
        'AUTH_TOKEN_MISSING',
        'Liên kết Google cần access token hợp lệ',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (
      purpose === 'login' &&
      (userId !== undefined || sessionId !== undefined)
    ) {
      throw invalidChallenge();
    }

    if (purpose === 'link') {
      const session = await this.prisma.userSession.findUnique({
        where: { id: sessionId },
        include: { user: true },
      });
      const now = new Date();
      if (
        !session ||
        session.userId !== userId ||
        session.revokedAt !== null ||
        session.expiresAt <= now ||
        session.user.status !== 'active'
      ) {
        throw new DomainException(
          'AUTH_TOKEN_INVALID',
          'Access token không hợp lệ hoặc đã hết hạn',
          HttpStatus.UNAUTHORIZED,
        );
      }
    }

    const challengeId = uuidv7();
    const nonce = randomSecret();
    const bindingSecret = randomSecret();
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000);

    await this.prisma.googleOAuthChallenge.create({
      data: {
        id: challengeId,
        purpose,
        userId: userId ?? null,
        sessionId: sessionId ?? null,
        nonceHash: sha256(nonce),
        bindingHash: sha256(bindingSecret),
        expiresAt,
      },
    });

    return {
      challenge_id: challengeId,
      nonce,
      binding_secret: bindingSecret,
      expires_in: CHALLENGE_TTL_SECONDS,
    };
  }

  async consume(
    tx: Prisma.TransactionClient,
    purpose: GoogleOAuthChallengePurpose,
    request: GoogleOAuthChallengeRequest,
    context: GoogleOAuthChallengeContext,
  ): Promise<void> {
    this.assertRequest(request);
    if (!this.hasChallenge(request)) {
      return;
    }

    const challenge = await tx.googleOAuthChallenge.findUnique({
      where: { id: request.challenge_id! },
    });
    const now = new Date();
    const linkSession =
      purpose === 'link' && context.sessionId
        ? await tx.userSession.findUnique({
            where: { id: context.sessionId },
            select: { userId: true, revokedAt: true, expiresAt: true },
          })
        : null;
    if (
      !challenge ||
      challenge.purpose !== purpose ||
      challenge.expiresAt <= now ||
      challenge.consumedAt !== null ||
      !sameNullableBigInt(challenge.userId, context.userId) ||
      !sameNullableString(challenge.sessionId, context.sessionId) ||
      (purpose === 'link' &&
        (!linkSession ||
          linkSession.userId !== context.userId ||
          linkSession.revokedAt !== null ||
          linkSession.expiresAt <= now)) ||
      context.identityNonce === null ||
      !safeHashEqual(challenge.nonceHash, sha256(context.identityNonce)) ||
      !safeHashEqual(challenge.bindingHash, sha256(request.binding_secret!))
    ) {
      throw invalidChallenge();
    }

    const consumed = await tx.googleOAuthChallenge.updateMany({
      where: {
        id: challenge.id,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) {
      throw invalidChallenge();
    }
  }
}

function randomSecret(): string {
  return randomBytes(32).toString('base64url');
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function safeHashEqual(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(actual, 'hex');
  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

function sameNullableBigInt(
  expected: bigint | null,
  actual: bigint | undefined,
): boolean {
  return expected === null ? actual === undefined : expected === actual;
}

function sameNullableString(
  expected: string | null,
  actual: string | undefined,
): boolean {
  return expected === null ? actual === undefined : expected === actual;
}

function invalidChallenge(): DomainException {
  return new DomainException(
    'AUTH_OAUTH_CHALLENGE_INVALID',
    'Google OAuth challenge không hợp lệ, đã hết hạn hoặc đã được dùng',
    HttpStatus.UNAUTHORIZED,
  );
}
