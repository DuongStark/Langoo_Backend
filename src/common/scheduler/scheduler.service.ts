import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../db/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { isJobDue, ScheduledJob } from './schedule';

export const SCHEDULED_JOBS = 'SCHEDULED_JOBS';

const TICK_MS = 60_000;
const LOCK_NAME = 'langoo:scheduler';
const JOB_TIMEOUT_MS = 120_000;

/**
 * Scheduler nội bộ (M12): tick mỗi phút, mỗi job chạy trong transaction giữ
 * advisory lock chung → an toàn khi có nhiều instance.
 * Tắt bằng SCHEDULER_ENABLED=false (e2e/test tự tắt).
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly lastRun = new Map<string, Date>();
  private timer?: NodeJS.Timeout;
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(SCHEDULED_JOBS) private readonly jobs: ScheduledJob[],
  ) {}

  onModuleInit(): void {
    const enabled =
      this.config.get<boolean>('SCHEDULER_ENABLED') !== false &&
      this.config.get<string>('NODE_ENV') !== 'test';
    if (!enabled) {
      this.logger.log(
        'Scheduler tắt (SCHEDULER_ENABLED=false hoặc NODE_ENV=test)',
      );
      return;
    }
    const now = new Date();
    for (const job of this.jobs) {
      this.lastRun.set(job.name, now);
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_MS);
    this.timer.unref();
    this.logger.log(
      `Scheduler bật (${this.jobs.map((job) => job.name).join(', ')})`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  /** Một lượt quét (public để test gọi tay). */
  async tick(): Promise<void> {
    if (this.ticking) {
      return;
    }
    this.ticking = true;
    try {
      const now = new Date();
      const due = this.jobs.filter((job) =>
        isJobDue(job.schedule, this.lastRun.get(job.name) ?? null, now),
      );
      for (const job of due) {
        try {
          await this.prisma.$transaction(
            async (tx) => {
              const rows = await tx.$queryRaw<{ locked: boolean }[]>(
                Prisma.sql`SELECT pg_try_advisory_xact_lock(hashtext(${LOCK_NAME})) AS locked`,
              );
              if (rows[0]?.locked !== true) {
                return;
              }
              const result = await job.run(tx, now);
              this.logger.log(
                `Job ${job.name}: ${
                  result.deleted !== undefined
                    ? `xoá ${result.deleted} dòng`
                    : (result.note ?? 'ok')
                }`,
              );
            },
            { timeout: JOB_TIMEOUT_MS },
          );
          this.lastRun.set(job.name, now);
        } catch (error) {
          // Không retry dồn dập: bỏ qua tới kỳ kế tiếp, chỉ log cảnh báo.
          this.lastRun.set(job.name, now);
          this.logger.warn(
            `Job ${job.name} lỗi: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown'}`,
          );
        }
      }
    } finally {
      this.ticking = false;
    }
  }
}
