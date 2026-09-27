import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../errors/domain.exception';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
