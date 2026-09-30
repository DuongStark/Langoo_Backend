import { ConfigService } from '@nestjs/config';

export interface PgPoolTuning {
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
}

/**
 * Cấu hình pool `pg` dùng chung cho PrismaPg (runtime) và pool health check.
 * Nhận cả giá trị đã validate (number) lẫn chuỗi env thô.
 */
export function pgPoolTuning(config: ConfigService): PgPoolTuning {
  return {
    max: readInt(config, 'DB_POOL_MAX', 10, 1, 100),
    idleTimeoutMillis: readInt(
      config,
      'DB_POOL_IDLE_TIMEOUT_MS',
      30_000,
      1_000,
      600_000,
    ),
    connectionTimeoutMillis: readInt(
      config,
      'DB_POOL_CONNECTION_TIMEOUT_MS',
      10_000,
      1_000,
      60_000,
    ),
  };
}

function readInt(
  config: ConfigService,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = config.get<number | string>(key);
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(parsed), min), max);
}
