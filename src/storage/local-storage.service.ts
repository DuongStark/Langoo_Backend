import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertSafeStorageKey, StorageService } from './storage.service';

/**
 * Lưu tệp trên đĩa (dev). Thư mục gốc từ `STORAGE_DIR` (mặc định `uploads/`).
 * Production (Render disk ephemeral) cần adapter s3 — interface giữ nguyên.
 */
@Injectable()
export class LocalStorageService implements StorageService {
  private readonly root: string;

  constructor(config: ConfigService) {
    const dir = config.get<string>('STORAGE_DIR') ?? 'uploads';
    this.root = path.resolve(process.cwd(), dir);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const full = this.resolvePath(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  }

  async get(key: string): Promise<Buffer | null> {
    const full = this.resolvePath(key);
    try {
      return await readFile(full);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: unknown }).code === 'ENOENT'
      ) {
        return null;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolvePath(key), { force: true });
  }

  private resolvePath(key: string): string {
    assertSafeStorageKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(`${this.root}${path.sep}`)) {
      throw new Error('Đường dẫn tệp vượt ngoài thư mục lưu trữ');
    }
    return full;
  }
}
