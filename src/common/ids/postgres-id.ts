import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../errors/domain.exception';

export const MAX_SIGNED_BIGINT = 9223372036854775807n;

/** Parse an externally supplied PostgreSQL bigint without going through Number. */
export function parsePositivePostgresBigInt(
  raw: unknown,
  label = 'ID',
): bigint {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    throw invalidPostgresId(label);
  }

  const value = BigInt(raw);
  if (value <= 0n || value > MAX_SIGNED_BIGINT) {
    throw invalidPostgresId(label);
  }
  return value;
}

/** Validate a client-visible UUID route parameter before it reaches Prisma. */
export function parseUuidParam(raw: unknown, label = 'ID'): string {
  if (
    typeof raw !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)
  ) {
    throw new DomainException(
      'VALIDATION_FAILED',
      `${label} phải là UUID hợp lệ`,
      HttpStatus.BAD_REQUEST,
    );
  }
  return raw;
}

function invalidPostgresId(label: string): DomainException {
  return new DomainException(
    'VALIDATION_FAILED',
    `${label} phải là số nguyên dương trong phạm vi bigint`,
    HttpStatus.BAD_REQUEST,
  );
}
