import { Module } from '@nestjs/common';
import { SourcesController } from './sources.controller';
import { SourcesRepository } from './sources.repository';
import { SourcesService } from './sources.service';

/** PrismaModule là @Global nên không cần import lại. */
@Module({
  controllers: [SourcesController],
  providers: [SourcesService, SourcesRepository],
})
export class SourcesModule {}
