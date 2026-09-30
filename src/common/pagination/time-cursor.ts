import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../errors/domain.exception';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,6}Z$/;
const MAX_SIGNED_BIGINT = 9223372036854775807n;
const MAX_CURSOR_LENGTH = 1024;

/**
 * Cursor keyset dùng chung theo mốc thời gian + id (uuid hoặc bigint).
 * Dùng cho danh sách sắp xếp giảm/tăng dần không đụng NULL.
 */
export function encodeTimeIdCursor(cursor: {
  createdAt: Date;
  id: string;
}): string {
  return Buffer.from(
    JSON.stringify({ v: 1, t: cursor.createdAt.toISOString(), i: cursor.id }),
    'utf8',
  ).toString('base64url');
}

export function decodeUuidTimeCursor(raw: string): {
  createdAt: Date;
  id: string;
} {
  const parsed = decodeCursor(raw);
  if (
    typeof parsed.t !== 'string' ||
    !ISO_PATTERN.test(parsed.t) ||
    typeof parsed.i !== 'string' ||
    !UUID_PATTERN.test(parsed.i)
  ) {
    throw invalidCursor();
  }
  return { createdAt: new Date(parsed.t), id: parsed.i };
}

export function decodeBigintTimeCursor(raw: string): {
  createdAt: Date;
  id: bigint;
} {
  const parsed = decodeCursor(raw);
  if (
    typeof parsed.t !== 'string' ||
    !ISO_PATTERN.test(parsed.t) ||
    typeof parsed.i !== 'string' ||
    !/^\d+$/.test(parsed.i)
  ) {
    throw invalidCursor();
  }
  const id = BigInt(parsed.i);
  if (id <= 0n || id > MAX_SIGNED_BIGINT) {
    throw invalidCursor();
  }
  return { createdAt: new Date(parsed.t), id };
}

function decodeCursor(raw: string): Record<string, unknown> {
  try {
    if (raw.length === 0 || raw.length > MAX_CURSOR_LENGTH) {
      throw new Error('length');
    }
    const parsed = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    if (parsed.v !== 1) {
      throw new Error('version');
    }
    return parsed;
  } catch {
    throw invalidCursor();
  }
}

function invalidCursor(): DomainException {
  return new DomainException(
    'VALIDATION_FAILED',
    'Cursor không hợp lệ',
    HttpStatus.BAD_REQUEST,
  );
}
