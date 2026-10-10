import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../common/errors/domain.exception';

const MAX_SIGNED_BIGINT = 9223372036854775807n;
const MAX_CURSOR_TEXT = 1000;

export interface DictionarySearchCursor {
  version: 5;
  query: string;
  lang: string | null;
  scopeKey?: string;
  exactRank: 0 | 1;
  prefixRank: 0 | 1;
  jaSourceRank: 0 | 1;
  viTranslationRank: 0 | 1;
  frequencyNullRank: 0 | 1;
  frequencyRank: number;
  surfaceLength: number;
  lexemeId: string;
  surfaceKind: string;
  surface: string;
}

export function encodeDictionarySearchCursor(
  cursor: DictionarySearchCursor,
): string {
  return Buffer.from(
    JSON.stringify({
      v: cursor.version,
      q: cursor.query,
      l: cursor.lang,
      h: cursor.scopeKey,
      e: cursor.exactRank,
      p: cursor.prefixRank,
      j: cursor.jaSourceRank,
      t: cursor.viTranslationRank,
      n: cursor.frequencyNullRank,
      f: cursor.frequencyRank,
      z: cursor.surfaceLength,
      i: cursor.lexemeId,
      k: cursor.surfaceKind,
      s: cursor.surface,
    }),
    'utf8',
  ).toString('base64url');
}

export function decodeDictionarySearchCursor(
  raw: string,
): DictionarySearchCursor {
  try {
    if (raw.length === 0 || raw.length > 2000) {
      throw new Error('length');
    }

    const parsed = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;

    if (
      parsed.v !== 5 ||
      (parsed.h !== undefined &&
        (typeof parsed.h !== 'string' || parsed.h.length > 100)) ||
      typeof parsed.q !== 'string' ||
      parsed.q.length === 0 ||
      parsed.q.length > 100 ||
      (parsed.l !== null &&
        (typeof parsed.l !== 'string' || parsed.l.length > 10)) ||
      !isBinaryRank(parsed.e) ||
      !isBinaryRank(parsed.p) ||
      !isBinaryRank(parsed.j) ||
      !isBinaryRank(parsed.t) ||
      !isBinaryRank(parsed.n) ||
      !isPositiveInt(parsed.f) ||
      !isPositiveInt(parsed.z) ||
      typeof parsed.i !== 'string' ||
      !/^\d+$/.test(parsed.i) ||
      BigInt(parsed.i) <= 0n ||
      BigInt(parsed.i) > MAX_SIGNED_BIGINT ||
      typeof parsed.k !== 'string' ||
      parsed.k.length === 0 ||
      parsed.k.length > MAX_CURSOR_TEXT ||
      typeof parsed.s !== 'string' ||
      parsed.s.length === 0 ||
      parsed.s.length > MAX_CURSOR_TEXT
    ) {
      throw new Error('shape');
    }

    return {
      version: 5,
      query: parsed.q,
      lang: parsed.l,
      ...(parsed.h === undefined ? {} : { scopeKey: parsed.h }),
      exactRank: parsed.e,
      prefixRank: parsed.p,
      jaSourceRank: parsed.j,
      viTranslationRank: parsed.t,
      frequencyNullRank: parsed.n,
      frequencyRank: parsed.f,
      surfaceLength: parsed.z,
      lexemeId: parsed.i,
      surfaceKind: parsed.k,
      surface: parsed.s,
    };
  } catch {
    throw new DomainException(
      'VALIDATION_FAILED',
      'Cursor không hợp lệ',
      HttpStatus.BAD_REQUEST,
    );
  }
}

function isBinaryRank(value: unknown): value is 0 | 1 {
  return value === 0 || value === 1;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
