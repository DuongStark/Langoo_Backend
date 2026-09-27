import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DueRepository } from './repositories/due.repository';
import { SrsStatsRepository } from './repositories/srs-stats.repository';
import { SrsController } from './srs.controller';
import { SrsService } from './srs.service';

/**
 * Module SRS: scheduler Anki thuần (src/srs/scheduler) + hàng đợi/ghi lượt ôn.
 * Chỉ ghi app.*; đọc core/public để lấy nội dung thẻ.
 */
@Module({
  imports: [AuthModule],
  controllers: [SrsController],
  providers: [SrsService, DueRepository, SrsStatsRepository],
  exports: [SrsService],
})
export class SrsModule {}
