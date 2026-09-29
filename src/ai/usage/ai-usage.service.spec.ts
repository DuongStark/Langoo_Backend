import { PrismaService } from '../../db/prisma.service';
import { AiUsageService } from './ai-usage.service';

function createSetup() {
  const prisma = {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    aiUsage: { findUnique: jest.fn() },
  };
  const service = new AiUsageService(prisma as unknown as PrismaService);
  return { service, prisma };
}

const PERIOD = new Date('2026-09-29T00:00:00.000Z');

describe('AiUsageService', () => {
  it('reserve thành công trả request_count sau khi cộng', async () => {
    const { service, prisma } = createSetup();
    prisma.$queryRaw.mockResolvedValue([{ request_count: 3 }]);

    const count = await service.reserveDailyRequest(
      prisma as never,
      1n,
      PERIOD,
      'chat',
      50,
    );

    expect(count).toBe(3);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('hết quota (0 row trả về) → 429 AI_QUOTA_EXCEEDED', async () => {
    const { service, prisma } = createSetup();
    prisma.$queryRaw.mockResolvedValue([]);

    await expect(
      service.reserveDailyRequest(prisma as never, 1n, PERIOD, 'chat', 2),
    ).rejects.toMatchObject({ code: 'AI_QUOTA_EXCEEDED' });
  });

  it('limit <= 0 chặn trước khi chạm DB', async () => {
    const { service, prisma } = createSetup();

    await expect(
      service.reserveDailyRequest(prisma as never, 1n, PERIOD, 'chat', 0),
    ).rejects.toMatchObject({ code: 'AI_QUOTA_EXCEEDED' });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('addUsage cộng token/chi phí vào dòng usage', async () => {
    const { service, prisma } = createSetup();
    prisma.$executeRaw.mockResolvedValue(1);

    await service.addUsage(prisma as never, 1n, PERIOD, 'chat', 10, 5, 0.001);

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('getDailyRequestCount trả 0 khi chưa có dòng', async () => {
    const { service, prisma } = createSetup();
    prisma.aiUsage.findUnique.mockResolvedValue(null);

    await expect(
      service.getDailyRequestCount(prisma as never, 1n, PERIOD, 'chat'),
    ).resolves.toBe(0);
  });
});
