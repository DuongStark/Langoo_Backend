import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../../generated/prisma/client';
import { ChatRetentionJob } from './chat-retention.job';

function configWith(value: string | number | undefined): ConfigService {
  return {
    get: jest.fn((key: string) =>
      key === 'CHAT_RETENTION_DAYS' ? value : undefined,
    ),
  } as unknown as ConfigService;
}

function txMock(): { $executeRaw: jest.Mock } {
  return { $executeRaw: jest.fn().mockResolvedValue(3) };
}

describe('ChatRetentionJob', () => {
  it('CHAT_RETENTION_DAYS=0 → tắt, không chạm DB', async () => {
    const job = new ChatRetentionJob(configWith('0'));
    const tx = txMock();

    const result = await job.run(tx as unknown as Prisma.TransactionClient);

    expect(result.note).toContain('disabled');
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('mặc định 180 ngày khi env trống và xoá phiên cũ', async () => {
    const job = new ChatRetentionJob(configWith(undefined));
    const tx = txMock();

    const result = await job.run(tx as unknown as Prisma.TransactionClient);

    expect(result.deleted).toBe(3);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('giá trị rác → dùng mặc định 180; giá trị hợp lệ đọc được', async () => {
    const junk = new ChatRetentionJob(configWith('khong-phai-so'));
    await junk.run(txMock() as unknown as Prisma.TransactionClient);

    const custom = new ChatRetentionJob(configWith('30'));
    const tx = txMock();
    await custom.run(tx as unknown as Prisma.TransactionClient);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });
});
