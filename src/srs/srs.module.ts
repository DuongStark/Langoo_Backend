import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DueRepository } from './repositories/due.repository';
import { SrsStatsRepository } from './repositories/srs-stats.repository';
import { ReviewEngine } from './review-engine.service';
import { SrsController } from './srs.controller';
import { SrsService } from './srs.service';

/**
 * Module SRS: scheduler Anki thuần (src/srs/scheduler) + hàng đợi/ghi lượt ôn.
 * Chỉ ghi app.*; đọc core/public để lấy nội dung thẻ.
 */
@Module({
  imports: [AuthModule],
  controllers: [SrsController],
  providers: [SrsService, ReviewEngine, DueRepository, SrsStatsRepository],
  exports: [SrsService, ReviewEngine, DueRepository],
})
export class SrsModule {}
