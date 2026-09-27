import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../errors/domain.exception';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_POSITION = 2147483647;

/** Con trỏ keyset cho danh sách item: vị trí + id (uuid). */
export interface ItemCursor {
  position: number;
  id: string;
}

export function encodeCursor(cursor: ItemCursor): string {
  return Buffer.from(
    JSON.stringify({ p: cursor.position, i: cursor.id }),
    'utf8',
  ).toString('base64url');
}

export function decodeCursor(raw: string): ItemCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as { p?: unknown; i?: unknown };

    if (
      typeof parsed.p !== 'number' ||
      !Number.isInteger(parsed.p) ||
      parsed.p <= 0 ||
      parsed.p > MAX_POSITION ||
      typeof parsed.i !== 'string' ||
      !UUID_PATTERN.test(parsed.i)
    ) {
      throw new Error('shape');
    }
    return { position: parsed.p, id: parsed.i };
  } catch {
    throw new DomainException(
      'VALIDATION_FAILED',
      'Cursor không hợp lệ',
      HttpStatus.BAD_REQUEST,
    );
  }
}

/** Cursor keyset cho hàng đợi SRS: (bucket, dueAt, srsId). */
export interface DueCursorValue {
  /** 0 = learning, 1 = review, 2 = new. */
  bucket: 0 | 1 | 2;
  dueAt: string;
  srsId: string;
}

export function encodeDueCursor(cursor: DueCursorValue): string {
  return Buffer.from(
    JSON.stringify({ b: cursor.bucket, t: cursor.dueAt, i: cursor.srsId }),
    'utf8',
  ).toString('base64url');
}

export function decodeDueCursor(raw: string): DueCursorValue {
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as { b?: unknown; t?: unknown; i?: unknown };

    const bucket = parsed.b;
    if (
      (bucket !== 0 && bucket !== 1 && bucket !== 2) ||
      typeof parsed.t !== 'string' ||
      Number.isNaN(Date.parse(parsed.t)) ||
      typeof parsed.i !== 'string' ||
      !/^\d+$/.test(parsed.i)
    ) {
      throw new Error('shape');
    }
    return { bucket, dueAt: parsed.t, srsId: parsed.i };
  } catch {
    throw new DomainException(
      'VALIDATION_FAILED',
      'Cursor không hợp lệ',
      HttpStatus.BAD_REQUEST,
    );
  }
}
