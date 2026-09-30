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

  async run(tx: Prisma.TransactionClient): Promise<JobRunResult> {
    const rows = await tx.$queryRaw<{ month: string }[]>(
      Prisma.sql`
        SELECT to_char(
                 app.ensure_month_partition(
                   (date_trunc('month', now()) + make_interval(months => offset.months))::date
                 ),
                 'YYYY-MM'
               ) AS month
        FROM generate_series(1, 2) AS offset(months)
      `,
    );
    const months = rows.map((row) => row.month).join(', ');
    this.logger.log(`Đã đảm bảo partition review_log: ${months}`);
    return { note: `partitions: ${months}` };
  }
}
