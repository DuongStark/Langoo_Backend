import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GamificationController } from './gamification.controller';
import { GamificationService } from './gamification.service';

/**
 * Streak và user_stats cập nhật trong transaction của lượt ôn.
 * M6.3 chỉ giữ hoạt động học tập, streak và thống kê.
 */
@Module({
  imports: [AuthModule],
  controllers: [GamificationController],
  providers: [GamificationService],
  exports: [GamificationService],
})
export class GamificationModule {}
