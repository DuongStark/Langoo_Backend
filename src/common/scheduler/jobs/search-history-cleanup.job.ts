import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { JobRunResult, ScheduledJob } from '../schedule';

export const SEARCH_HISTORY_KEEP = 50;

/**
 * Giữ 50 dòng `search_history` gần nhất mỗi user (CONTEXT §6.4).
 * Chạy hàng ngày 03:00 UTC — xoá theo batch một câu DELETE ... WHERE IN.
 */
@Injectable()
export class SearchHistoryCleanupJob implements ScheduledJob {
  readonly name = 'search-history-cleanup';
  readonly schedule = { kind: 'daily', hourUtc: 3, minuteUtc: 0 } as const;

  async run(tx: Prisma.TransactionClient): Promise<JobRunResult> {
    const deleted = await tx.$executeRaw(
      Prisma.sql`
        DELETE FROM app.search_history
        WHERE id IN (
          SELECT ranked.id FROM (
            SELECT id,
                   row_number() OVER (
                     PARTITION BY user_id
                     ORDER BY created_at DESC, id DESC
                   ) AS rn
            FROM app.search_history
          ) ranked
          WHERE ranked.rn > ${SEARCH_HISTORY_KEEP}
        )
      `,
    );
    return { deleted };
  }
}
