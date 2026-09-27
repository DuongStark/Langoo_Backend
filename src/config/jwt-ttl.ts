const TTL_PATTERN = /^(\d+)([smhd])?$/;

const TTL_MULTIPLIERS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 24 * 60 * 60,
};

/**
 * Parse a JWT TTL such as `15m`, `900s`, `1h`, or `30d` into seconds.
 *
 * Environment variables are strings, so a value without a suffix is treated
 * as seconds. Zero, malformed values, and values outside JS's safe integer
 * range are rejected before the application starts.
 */
export function parseTtlSeconds(value: string): number {
  const match = TTL_PATTERN.exec(value.trim());
  if (!match) {
    throw new Error(`JWT_ACCESS_TTL không hợp lệ: "${value}"`);
  }

  const amount = Number(match[1]);
  const multiplier = TTL_MULTIPLIERS[match[2] ?? 's'];
  const seconds = amount * multiplier;
  if (
    amount <= 0 ||
    !Number.isSafeInteger(amount) ||
    !Number.isSafeInteger(seconds) ||
    seconds <= 0
  ) {
    throw new Error(`JWT_ACCESS_TTL không hợp lệ: "${value}"`);
  }
  return seconds;
}

export function isValidTtl(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  try {
    parseTtlSeconds(value);
    return true;
  } catch {
    return false;
  }
}
