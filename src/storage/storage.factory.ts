import { ConfigService } from '@nestjs/config';
import { LocalStorageService } from './local-storage.service';
import { StorageService } from './storage.service';

/**
 * Chọn storage theo `STORAGE_PROVIDER` (mặc định `local`).
 * Adapter `s3` (R2/S3) nằm trong backlog — chọn sẽ fail-fast để lộ cấu hình sai.
 */
export function createStorageService(config: ConfigService): StorageService {
  const provider = config.get<string>('STORAGE_PROVIDER') ?? 'local';
  if (provider === 'local') {
    return new LocalStorageService(config);
  }
  throw new Error(
    `STORAGE_PROVIDER=${provider} chưa được triển khai — dùng "local" (adapter S3/R2 là backlog)`,
  );
}
