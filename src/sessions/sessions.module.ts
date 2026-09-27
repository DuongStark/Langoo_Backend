import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SrsModule } from '../srs/srs.module';
import { SessionSourceRepository } from './repositories/session-source.repository';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

/**
 * Module phiên ôn (M7): flashcard / multiple_choice / matching / typing —
 * đáp án chấm ở server; cập nhật SRS qua ReviewEngine dùng chung với M6.
 */
@Module({
  imports: [AuthModule, SrsModule],
  controllers: [SessionsController],
  providers: [SessionsService, SessionSourceRepository],
  exports: [SessionsService],
})
export class SessionsModule {}
