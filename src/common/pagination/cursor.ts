import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../errors/domain.exception';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_POSITION = 2147483647;
const MAX_BIGINT_ID = 9223372036854775807n;

/** Con trỏ keyset cho danh sách item: vị trí + id (uuid). */
export interface ItemCursor {
  order?: 'asc' | 'desc';
  position: number;
  id: string;
}

export function encodeCursor(cursor: ItemCursor): string {
  return Buffer.from(
    JSON.stringify({
      p: cursor.position,
      i: cursor.id,
      ...(cursor.order === undefined ? {} : { o: cursor.order }),
    }),
    'utf8',
  ).toString('base64url');
}

export function decodeCursor(raw: string): ItemCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as { p?: unknown; i?: unknown; o?: unknown };

    if (
      typeof parsed.p !== 'number' ||
      !Number.isInteger(parsed.p) ||
      parsed.p <= 0 ||
      parsed.p > MAX_POSITION ||
      typeof parsed.i !== 'string' ||
      !UUID_PATTERN.test(parsed.i) ||
      (parsed.o !== undefined && parsed.o !== 'asc' && parsed.o !== 'desc')
    ) {
      throw new Error('shape');
    }
    return {
      position: parsed.p,
      id: parsed.i,
      ...(parsed.o === undefined ? {} : { order: parsed.o }),
    };
  } catch {
    throw new DomainException(
      'VALIDATION_FAILED',
      'Cursor không hợp lệ',
      HttpStatus.BAD_REQUEST,
    );
  }
}

/** Cursor keyset cho hàng đợi SRS; new dùng thêm sortKey theo item position. */
export interface DueCursorValue {
  /** 0 = learning, 1 = review, 2 = new. */
  bucket: 0 | 1 | 2;
  dueAt: string;
  srsId: string;
  interday?: boolean;
  sortKey?: string;
  /** API cursors are versioned and bound to the queue context. */
  version?: 1;
  profileId?: string;
  collectionId?: string | null;
  day?: string;
  phase?: 'regular' | 'ahead';
}

export function encodeDueCursor(cursor: DueCursorValue): string {
  return Buffer.from(
    JSON.stringify({
      b: cursor.bucket,
      t: cursor.dueAt,
      i: cursor.srsId,
      ...(cursor.interday === undefined ? {} : { d: cursor.interday }),
      ...(cursor.sortKey === undefined ? {} : { k: cursor.sortKey }),
      ...(cursor.version === undefined ? {} : { v: cursor.version }),
      ...(cursor.profileId === undefined ? {} : { p: cursor.profileId }),
      ...(cursor.collectionId === undefined ? {} : { c: cursor.collectionId }),
      ...(cursor.day === undefined ? {} : { y: cursor.day }),
      ...(cursor.phase === undefined ? {} : { h: cursor.phase }),
    }),
    'utf8',
  ).toString('base64url');
}

export function decodeDueCursor(raw: string): DueCursorValue {
  try {
    if (raw.length > 1024) {
      throw new Error('size');
    }
    const parsed = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as {
      b?: unknown;
      t?: unknown;
      i?: unknown;
      d?: unknown;
      k?: unknown;
      v?: unknown;
      p?: unknown;
      c?: unknown;
      y?: unknown;
      h?: unknown;
    };

    const bucket = parsed.b;
    if (
      (bucket !== 0 && bucket !== 1 && bucket !== 2) ||
      typeof parsed.t !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,6}Z$/.test(parsed.t) ||
      Number.isNaN(Date.parse(parsed.t)) ||
      !isValidBigIntId(parsed.i) ||
      (parsed.d !== undefined && typeof parsed.d !== 'boolean') ||
      (parsed.k !== undefined && typeof parsed.k !== 'string') ||
      (parsed.v !== undefined && parsed.v !== 1) ||
      (parsed.p !== undefined &&
        (typeof parsed.p !== 'string' || !UUID_PATTERN.test(parsed.p))) ||
      (parsed.c !== undefined &&
        parsed.c !== null &&
        (typeof parsed.c !== 'string' || !UUID_PATTERN.test(parsed.c))) ||
      (parsed.y !== undefined &&
        (typeof parsed.y !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(parsed.y))) ||
      (parsed.h !== undefined && parsed.h !== 'regular' && parsed.h !== 'ahead')
    ) {
      throw new Error('shape');
    }
    return {
      bucket,
      dueAt: parsed.t,
      srsId: parsed.i,
      interday: parsed.d,
      sortKey: parsed.k,
      version: parsed.v,
      profileId: parsed.p,
      collectionId: parsed.c,
      day: parsed.y,
      phase: parsed.h,
    };
  } catch {
    throw new DomainException(
      'VALIDATION_FAILED',
      'Cursor không hợp lệ',
      HttpStatus.BAD_REQUEST,
    );
  }
}

function isValidBigIntId(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return false;
  try {
    const id = BigInt(value);
    return id > 0n && id <= MAX_BIGINT_ID;
  } catch {
    return false;
  }
}
