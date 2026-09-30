import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createStorageService } from './storage.factory';
import { STORAGE_SERVICE } from './storage.service';

/** Module lưu trữ tệp dùng chung (feedback ảnh…). */
@Global()
@Module({
  providers: [
    {
      provide: STORAGE_SERVICE,
      inject: [ConfigService],
      useFactory: createStorageService,
    },
  ],
  exports: [STORAGE_SERVICE],
})
export class StorageModule {}
