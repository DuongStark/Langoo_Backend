import { PrismaService } from '../db/prisma.service';
import { TagsService } from './tags.service';

function firstArg<T>(mock: jest.Mock): T {
  const call = mock.mock.calls[0] as unknown[];
  return call[0] as T;
}

const NOW = new Date('2026-09-27T00:00:00.000Z');

function createSetup(): {
  service: TagsService;
  prisma: {
    tag: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      delete: jest.Mock;
    };
  };
} {
  const prisma = {
    tag: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
  };
  const service = new TagsService(prisma as unknown as PrismaService);
  return { service, prisma };
}

describe('TagsService', () => {
  it('trùng tên (không phân biệt hoa thường) → 409 TAG_ALREADY_EXISTS', async () => {
    const { service, prisma } = createSetup();
    prisma.tag.findFirst.mockResolvedValue({ id: 5n });

    await expect(service.create(1n, { name: '#N5' })).rejects.toMatchObject({
      code: 'TAG_ALREADY_EXISTS',
    });
    expect(prisma.tag.create).not.toHaveBeenCalled();
  });

  it('tạo tag: trim tên, map response', async () => {
    const { service, prisma } = createSetup();
    prisma.tag.findFirst.mockResolvedValue(null);
    prisma.tag.create.mockResolvedValue({
      id: 5n,
      userId: 1n,
      name: '#n5',
      color: '#4f46e5',
      createdAt: NOW,
    });

    const result = await service.create(1n, {
      name: '  #n5  ',
      color: '#4f46e5',
    });

    const args = firstArg<{ data: { userId: bigint; name: string } }>(
      prisma.tag.create,
    );
    expect(args.data).toMatchObject({ userId: 1n, name: '#n5' });
    expect(result).toEqual({
      id: '5',
      name: '#n5',
      color: '#4f46e5',
      created_at: NOW.toISOString(),
    });
  });

  it('xoá tag không thuộc user → 404 TAG_NOT_FOUND; xoá thành công trả deleted_at', async () => {
    const { service, prisma } = createSetup();
    prisma.tag.findFirst.mockResolvedValue(null);

    await expect(service.remove(1n, '99')).rejects.toMatchObject({
      code: 'TAG_NOT_FOUND',
    });

    prisma.tag.findFirst.mockResolvedValue({ id: 5n });
    prisma.tag.delete.mockResolvedValue({ id: 5n });

    const result = await service.remove(1n, '5');
    expect(prisma.tag.delete).toHaveBeenCalledWith({ where: { id: 5n } });
    expect(result.id).toBe('5');
    expect(typeof result.deleted_at).toBe('string');
  });
});
