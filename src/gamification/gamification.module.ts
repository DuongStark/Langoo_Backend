import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GamificationController } from './gamification.controller';
import { GamificationService } from './gamification.service';

/**
 * Streak, user_stats và thành tích cập nhật trong transaction của lượt ôn.
 * M8.3 tạm dừng XP mới, giữ dữ liệu lịch sử.
 */
@Module({
  imports: [AuthModule],
  controllers: [GamificationController],
  providers: [GamificationService],
  exports: [GamificationService],
})
export class GamificationModule {}
