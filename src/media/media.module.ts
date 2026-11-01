import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '../db/db.module';
import { SenseImageRepository } from './sense-image.repository';
import { SenseImageService } from './sense-image.service';

@Module({
  imports: [DbModule, ConfigModule],
  providers: [SenseImageRepository, SenseImageService],
  exports: [SenseImageService],
})
export class MediaModule {}
