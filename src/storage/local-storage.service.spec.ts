import { ConfigService } from '@nestjs/config';
import { rm } from 'node:fs/promises';
import { LocalStorageService } from './local-storage.service';

const ROOT = '/tmp/opencode/m13-storage-spec';

function createService(): LocalStorageService {
  const config = {
    get: jest.fn((key: string) => (key === 'STORAGE_DIR' ? ROOT : undefined)),
  } as unknown as ConfigService;
  return new LocalStorageService(config);
}

describe('LocalStorageService', () => {
  afterAll(async () => {
    await rm(ROOT, { recursive: true, force: true });
  });

  it('put → get → delete round-trip', async () => {
    const storage = createService();
    const key = `feedback/1/${Date.now()}.png`;
    const data = Buffer.from('nội dung ảnh');

    await storage.put(key, data);
    await expect(storage.get(key)).resolves.toEqual(data);

    await storage.delete(key);
    await expect(storage.get(key)).resolves.toBeNull();
  });

  it('get key không tồn tại → null (không ném lỗi)', async () => {
    const storage = createService();
    await expect(storage.get('feedback/1/khong-co.png')).resolves.toBeNull();
  });

  it('chặn key traversal', async () => {
    const storage = createService();
    await expect(
      storage.put('../thoat-ra-ngoai.png', Buffer.from('x')),
    ).rejects.toThrow('Storage key không hợp lệ');
  });
});
