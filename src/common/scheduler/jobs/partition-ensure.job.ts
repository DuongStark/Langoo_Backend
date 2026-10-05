import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { JobRunResult, ScheduledJob } from '../schedule';

/**
 * Tạo sẵn partition tháng cho `review_log` (hiện có 36 tháng tới 2029-08).
 * Chạy hàng tuần thứ Hai 04:00 UTC, đảm bảo trước 2 tháng.
 */
@Injectable()
export class PartitionEnsureJob implements ScheduledJob {
  private readonly logger = new Logger(PartitionEnsureJob.name);
  readonly name = 'review-log-partitions';
  readonly schedule = {
    kind: 'weekly',
    weekdayUtc: 1,
    hourUtc: 4,
    minuteUtc: 0,
  } as const;

  async run(tx: Prisma.TransactionClient, now: Date): Promise<JobRunResult> {
    const rows = await tx.$queryRaw<{ partition_name: string }[]>(
      Prisma.sql`
        SELECT app.ensure_month_partition(
                 (date_trunc('month', ${now}::timestamptz)
                  + make_interval(months => months_ahead.n))::date
               ) AS partition_name
        FROM generate_series(1, 2) AS months_ahead(n)
        ORDER BY months_ahead.n
      `,
    );
    const partitions = rows.map((row) => row.partition_name).join(', ');
    this.logger.log(`Đã đảm bảo partition review_log: ${partitions}`);
    return { note: `partitions: ${partitions}` };
  }
}
