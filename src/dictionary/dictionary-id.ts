import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../common/errors/domain.exception';

const MAX_SIGNED_BIGINT = 9223372036854775807n;

/** Parse an externally supplied PostgreSQL bigint id without going through Number. */
export function parseDictionaryId(raw: string): bigint {
  if (!/^\d+$/.test(raw)) {
    throw invalidDictionaryId();
  }

  const value = BigInt(raw);
  if (value <= 0n || value > MAX_SIGNED_BIGINT) {
    throw invalidDictionaryId();
  }
  return value;
}

function invalidDictionaryId(): DomainException {
  return new DomainException(
    'VALIDATION_FAILED',
    'Id từ điển phải là số nguyên dương trong phạm vi bigint',
    HttpStatus.BAD_REQUEST,
  );
}
