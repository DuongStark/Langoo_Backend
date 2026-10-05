/** Token DI cho dịch vụ lưu trữ tệp (local dev/VPS; S3 backlog). */
export const STORAGE_SERVICE = 'STORAGE_SERVICE';

export interface StorageService {
  put(key: string, data: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

export type SupportedImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export const SUPPORTED_IMAGE_MIMES: SupportedImageMime[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export const MIME_EXTENSION: Record<SupportedImageMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Nhận diện ảnh bằng magic bytes — không tin `mimetype` do client khai. */
export function sniffImageMime(buffer: Buffer): SupportedImageMime | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * Key do server sinh (ví dụ `feedback/12/<uuid>.jpg`): chữ thường, số, `/`, `_`,
 * `-`, `.` (phần mở rộng); chặn `..` để không thoát khỏi thư mục gốc.
 */
export function assertSafeStorageKey(key: string): void {
  if (
    key.length === 0 ||
    key.length > 200 ||
    key.includes('..') ||
    !/^[a-z0-9][a-z0-9/_.-]*$/.test(key)
  ) {
    throw new Error(`Storage key không hợp lệ: ${key}`);
  }
}
