import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { PrismaService } from '../../db/prisma.service';
import { Prisma } from '../../generated/prisma/client';

export type AiUsageFeature = 'chat' | 'quiz';

/** Client Prisma hoặc transaction client — dùng chung cho đọc/ghi ai_usage. */
export type AiDbClient = Prisma.TransactionClient;

export interface AiDailyUsage {
  requestCount: number;
  limit: number;
  period: string;
}

/**
 * Quota + thống kê AI theo ngày (bảng app.ai_usage, PK user_id + period + feature).
 * `period` luôn là ngày địa phương của user (xem ai-usage caller), DB lưu UTC.
 */
@Injectable()
export class AiUsageService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Giữ chỗ 1 request theo cách nguyên tử: insert/cộng dồn có điều kiện
   * `request_count < limit`. Hết quota → 429, không trả row.
   */
  async reserveDailyRequest(
    client: AiDbClient,
    userId: bigint,
    period: Date,
    feature: AiUsageFeature,
    limit: number,
  ): Promise<number> {
    if (limit <= 0) {
      throw quotaExceeded(limit);
    }

    const rows = await client.$queryRaw<{ request_count: number }[]>(
      Prisma.sql`
        INSERT INTO app.ai_usage (user_id, period, feature, request_count)
        VALUES (${userId}, ${period}, ${feature}, 1)
        ON CONFLICT (user_id, period, feature) DO UPDATE
          SET request_count = app.ai_usage.request_count + 1
          WHERE app.ai_usage.request_count < ${limit}
        RETURNING request_count
      `,
    );

    if (rows.length === 0) {
      throw quotaExceeded(limit);
    }
    return rows[0].request_count;
  }

  /** Cộng token/chi phí vào dòng usage đã được reserve. */
  async addUsage(
    client: AiDbClient,
    userId: bigint,
    period: Date,
    feature: AiUsageFeature,
    tokensIn: number,
    tokensOut: number,
    costUsd: number,
  ): Promise<void> {
    await client.$executeRaw(
      Prisma.sql`
        UPDATE app.ai_usage
        SET tokens_in = tokens_in + ${tokensIn},
            tokens_out = tokens_out + ${tokensOut},
            cost_usd = cost_usd + ${costUsd}
        WHERE user_id = ${userId}
          AND period = ${period}
          AND feature = ${feature}
      `,
    );
  }

  async getDailyRequestCount(
    client: AiDbClient,
    userId: bigint,
    period: Date,
    feature: AiUsageFeature,
  ): Promise<number> {
    const row = await client.aiUsage.findUnique({
      where: { userId_period_feature: { userId, period, feature } },
      select: { requestCount: true },
    });
    return row?.requestCount ?? 0;
  }
}

function quotaExceeded(limit: number): DomainException {
  return new DomainException(
    'AI_QUOTA_EXCEEDED',
    'Đã hết lượt dùng AI hôm nay, vui lòng thử lại vào ngày mai',
    HttpStatus.TOO_MANY_REQUESTS,
    { limit },
  );
}
