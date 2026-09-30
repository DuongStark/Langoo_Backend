import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { withUtcTimezone } from './connection-url';
import { pgPoolTuning } from './pool-options';

/** Token DI cho pg Pool (dùng chung toàn app, đóng khi shutdown). */
export const PG_POOL = Symbol('PG_POOL');

/**
 * Pool kết nối runtime (DATABASE_URL — pooled khi chạy cloud).
 * Ghi dữ liệu người học vẫn phải qua tầng repository/service (M1+).
 */
export const pgPoolProvider: Provider = {
  provide: PG_POOL,
  inject: [ConfigService],
  useFactory: (configService: ConfigService): Pool => {
    const logger = new Logger('PgPool');
    const pool = new Pool({
      connectionString: withUtcTimezone(
        configService.getOrThrow<string>('DATABASE_URL'),
      ),
      ...pgPoolTuning(configService),
      application_name: 'langoo-api',
    });
    pool.on('error', (error) => {
      logger.error(`Lỗi PostgreSQL client nhàn rỗi: ${error.message}`);
    });
    return pool;
  },
};
