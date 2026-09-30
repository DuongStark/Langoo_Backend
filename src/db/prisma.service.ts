import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { withUtcTimezone } from './connection-url';
import { pgPoolTuning } from './pool-options';

/**
 * Prisma Client cho schema `app` (dữ liệu người học).
 * Prisma 7 dùng driver adapter — ở đây là `pg` qua DATABASE_URL.
 *
 * Không dùng Prisma cho `core`/`serve`/`public`/`staging` — các schema đó đọc
 * bằng `$queryRaw` trong repository.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(configService: ConfigService) {
    super({
      adapter: new PrismaPg({
        connectionString: withUtcTimezone(
          configService.getOrThrow<string>('DATABASE_URL'),
        ),
        ...pgPoolTuning(configService),
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    await this.warnIfTimezoneDrift();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** ENV-01: session DB phải là UTC; lệch thì cảnh báo sớm thay vì lỗi ngầm. */
  private async warnIfTimezoneDrift(): Promise<void> {
    try {
      const rows = await this.$queryRaw<{ tz: string }[]>`
        SELECT current_setting('TimeZone') AS tz
      `;
      const timezone = rows[0]?.tz ?? 'unknown';
      if (timezone.toUpperCase() !== 'UTC') {
        this.logger.warn(
          `DB session TimeZone=${timezone} (không phải UTC) — kiểm tra options=-c timezone=UTC trong DATABASE_URL`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Không đọc được TimeZone của DB: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }
}
