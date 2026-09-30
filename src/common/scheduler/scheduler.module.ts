import { Module } from '@nestjs/common';
import { ChatRetentionJob } from './jobs/chat-retention.job';
import { PartitionEnsureJob } from './jobs/partition-ensure.job';
import { SearchHistoryCleanupJob } from './jobs/search-history-cleanup.job';
import { SCHEDULED_JOBS, SchedulerService } from './scheduler.service';

/**
 * Module scheduler nội bộ (M12): dọn search_history, tạo partition review_log,
 * retention chat. Không phụ thuộc module nghiệp vụ — chạy SQL trên schema app.
 */
@Module({
  providers: [
    SchedulerService,
    SearchHistoryCleanupJob,
    PartitionEnsureJob,
    ChatRetentionJob,
    {
      provide: SCHEDULED_JOBS,
      inject: [SearchHistoryCleanupJob, PartitionEnsureJob, ChatRetentionJob],
      useFactory: (
        searchHistory: SearchHistoryCleanupJob,
        partitions: PartitionEnsureJob,
        chatRetention: ChatRetentionJob,
      ) => [searchHistory, partitions, chatRetention],
    },
  ],
})
export class SchedulerModule {}
