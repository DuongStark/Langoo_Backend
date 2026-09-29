import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,6}Z$/;
const MAX_SIGNED_BIGINT = 9223372036854775807n;
const MAX_CURSOR_LENGTH = 1024;

export interface ChatSessionCursor {
  createdAt: Date;
  id: string;
}

export interface ChatMessageCursor {
  createdAt: Date;
  id: bigint;
}

export function encodeChatSessionCursor(cursor: ChatSessionCursor): string {
  return Buffer.from(
    JSON.stringify({ v: 1, t: cursor.createdAt.toISOString(), i: cursor.id }),
    'utf8',
  ).toString('base64url');
}

export function decodeChatSessionCursor(raw: string): ChatSessionCursor {
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

export function encodeChatMessageCursor(cursor: ChatMessageCursor): string {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      t: cursor.createdAt.toISOString(),
      i: cursor.id.toString(),
    }),
    'utf8',
  ).toString('base64url');
}

export function decodeChatMessageCursor(raw: string): ChatMessageCursor {
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
