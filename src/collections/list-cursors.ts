import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../common/errors/domain.exception';
import { MAX_SIGNED_BIGINT } from '../common/ids/postgres-id';

const MAX_CURSOR_TEXT = 2000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export interface CollectionListCursor {
  updatedAt: string;
  id: string;
  profileId: string | null;
}

export interface TagListCursor {
  name: string;
  id: string;
}

export function encodeCollectionListCursor(
  cursor: CollectionListCursor,
): string {
  return encode({
    v: 1,
    t: cursor.updatedAt,
    i: cursor.id,
    p: cursor.profileId,
  });
}

export function decodeCollectionListCursor(raw: string): CollectionListCursor {
  const parsed = decode(raw);
  if (
    parsed.v !== 1 ||
    typeof parsed.t !== 'string' ||
    !UTC_TIMESTAMP_PATTERN.test(parsed.t) ||
    Number.isNaN(Date.parse(parsed.t)) ||
    typeof parsed.i !== 'string' ||
    !UUID_PATTERN.test(parsed.i) ||
    (parsed.p !== null &&
      (typeof parsed.p !== 'string' || !UUID_PATTERN.test(parsed.p)))
  ) {
    throw invalidCursor();
  }
  return { updatedAt: parsed.t, id: parsed.i, profileId: parsed.p };
}

export function encodeTagListCursor(cursor: TagListCursor): string {
  return encode({ v: 1, n: cursor.name, i: cursor.id });
}

export function decodeTagListCursor(raw: string): TagListCursor {
  const parsed = decode(raw);
  if (
    parsed.v !== 1 ||
    typeof parsed.n !== 'string' ||
    parsed.n.length === 0 ||
    parsed.n.length > 40 ||
    typeof parsed.i !== 'string' ||
    !/^\d+$/.test(parsed.i) ||
    BigInt(parsed.i) <= 0n ||
    BigInt(parsed.i) > MAX_SIGNED_BIGINT
  ) {
    throw invalidCursor();
  }
  return { name: parsed.n, id: parsed.i };
}

function encode(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decode(raw: string): Record<string, unknown> {
  try {
    if (raw.length === 0 || raw.length > MAX_CURSOR_TEXT) {
      throw new Error('length');
    }
    const parsed: unknown = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    );
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('shape');
    }
    return parsed as Record<string, unknown>;
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
