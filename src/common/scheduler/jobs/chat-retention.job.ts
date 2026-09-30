import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../../generated/prisma/client';
import { JobRunResult, ScheduledJob } from '../schedule';

/**
 * Retention chat (quyết định CONTEXT §14.4): xoá cứng phiên chat không hoạt động
 * quá `CHAT_RETENTION_DAYS` ngày (cascade tin nhắn). Chạy hàng ngày 03:30 UTC.
 * `CHAT_RETENTION_DAYS=0` để tắt.
 */
@Injectable()
export class ChatRetentionJob implements ScheduledJob {
  readonly name = 'chat-retention';
  readonly schedule = { kind: 'daily', hourUtc: 3, minuteUtc: 30 } as const;

  constructor(private readonly config: ConfigService) {}

  async run(tx: Prisma.TransactionClient): Promise<JobRunResult> {
    const days = this.retentionDays();
    if (days <= 0) {
      return { note: 'disabled (CHAT_RETENTION_DAYS=0)' };
    }
    const deleted = await tx.$executeRaw(
      Prisma.sql`
        DELETE FROM app.chat_session
        WHERE COALESCE(last_message_at, created_at)
              < now() - make_interval(days => ${days})
      `,
    );
    return { deleted };
  }

  private retentionDays(): number {
    const raw = this.config.get<number | string>('CHAT_RETENTION_DAYS');
    const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw;
    if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
      return 180;
    }
    return Math.max(0, Math.floor(parsed));
  }
}
