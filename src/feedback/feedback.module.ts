import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { AdminFeedbackController } from './admin-feedback.controller';
import {
  FeedbackController,
  MeFeedbackController,
} from './feedback.controller';
import { FeedbackService } from './feedback.service';

/**
 * Module feedback (M13): user gửi/xem feedback (text + ảnh), admin xử lý hàng chờ.
 * Ảnh qua StorageService; audit qua AdminModule.
 */
@Module({
  imports: [AuthModule, AdminModule],
  controllers: [
    FeedbackController,
    MeFeedbackController,
    AdminFeedbackController,
  ],
  providers: [FeedbackService],
})
export class FeedbackModule {}
