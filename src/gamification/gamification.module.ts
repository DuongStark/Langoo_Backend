import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GamificationController } from './gamification.controller';
import { GamificationService } from './gamification.service';

/**
 * Module gamification (M8): XP theo xp_rule + daily cap, streak, user_stats,
 * thành tích. Service được ReviewEngine gọi trong cùng transaction của lượt ôn.
 */
@Module({
  imports: [AuthModule],
  controllers: [GamificationController],
  providers: [GamificationService],
  exports: [GamificationService],
})
export class GamificationModule {}
