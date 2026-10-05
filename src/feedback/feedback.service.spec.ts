import { PrismaService } from '../db/prisma.service';
import { AdminAuditService } from '../admin/admin-audit.service';
import { FeedbackService } from './feedback.service';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function file(buffer: Buffer, mimetype = 'image/png') {
  return {
    buffer,
    mimetype,
    originalname: 'a.png',
    size: buffer.length,
  } as Express.Multer.File;
}

function feedbackRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'f0000000-0000-7000-8000-000000000001',
    category: 'bug',
    content: 'nội dung phản hồi dài đủ 10 ký tự',
    status: 'new',
    adminNote: null,
    createdAt: new Date('2026-09-30T10:00:00.000Z'),
    updatedAt: new Date('2026-09-30T10:00:00.000Z'),
    ...overrides,
  };
}

function createSetup() {
  const tx = {
    $queryRaw: jest.fn(),
    feedback: { create: jest.fn(), update: jest.fn() },
    feedbackAttachment: { createMany: jest.fn() },
  };
  const prisma = {
    feedback: {
      create: tx.feedback.create,
      update: tx.feedback.update,
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    feedbackAttachment: { findFirst: jest.fn() },
    $transaction: jest.fn((fn: (client: unknown) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  const audit = { record: jest.fn() };
  const storage = {
    put: jest.fn(),
    get: jest.fn(),
    delete: jest.fn(),
  };
  const service = new FeedbackService(
    prisma as unknown as PrismaService,
    audit as unknown as AdminAuditService,
    storage,
  );
  return { service, prisma, tx, audit, storage };
}

function firstArg<T>(mock: jest.Mock): T {
  const calls = mock.mock.calls as unknown[][];
  const call = calls[0];
  if (!call) {
    throw new Error('expected mock call');
  }
  return call[0] as T;
}

describe('FeedbackService', () => {
  it('tạo feedback không ảnh — không chạm storage, trả resource', async () => {
    const { service, prisma, tx, storage } = createSetup();
    prisma.feedback.findUnique.mockResolvedValue(null);
    tx.feedback.create.mockResolvedValue(feedbackRow());

    const result = await service.create(
      1n,
      { category: 'bug', content: 'nội dung phản hồi dài đủ 10 ký tự' },
      [],
    );

    expect(storage.put).not.toHaveBeenCalled();
    expect(tx.feedbackAttachment.createMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({ category: 'bug', status: 'new' });
  });

  it('tạo feedback có ảnh: lưu storage trước, ghi metadata trong transaction', async () => {
    const { service, prisma, tx, storage } = createSetup();
    prisma.feedback.findUnique.mockResolvedValue(null);
    tx.feedback.create.mockResolvedValue(feedbackRow());
    tx.feedbackAttachment.createMany.mockResolvedValue({ count: 1 });

    const result = await service.create(
      1n,
      { category: 'content', content: 'nội dung phản hồi dài đủ 10 ký tự' },
      [file(PNG)],
    );

    const putArgs = storage.put.mock.calls[0] as [string, Buffer, string];
    expect(putArgs[0]).toMatch(/^feedback\/1\/[0-9a-f-]+\.png$/);
    expect(putArgs[2]).toBe('image/png');

    const createManyArgs = firstArg<{
      data: { mime: string; sizeBytes: number }[];
    }>(tx.feedbackAttachment.createMany);
    expect(createManyArgs.data[0]).toMatchObject({
      mime: 'image/png',
      sizeBytes: PNG.length,
    });
    expect(result.attachments).toHaveLength(1);
  });

  it('tệp không phải ảnh / quá 3 tệp → 400 ATTACHMENT_INVALID', async () => {
    const { service, storage } = createSetup();

    await expect(
      service.create(
        1n,
        { category: 'bug', content: 'nội dung phản hồi dài đủ 10 ký tự' },
        [file(Buffer.from('khong-phai-anh'))],
      ),
    ).rejects.toMatchObject({ code: 'ATTACHMENT_INVALID' });
    expect(storage.put).not.toHaveBeenCalled();

    await expect(
      service.create(
        1n,
        { category: 'bug', content: 'nội dung phản hồi dài đủ 10 ký tự' },
        [file(PNG), file(PNG), file(PNG), file(PNG)],
      ),
    ).rejects.toMatchObject({ code: 'ATTACHMENT_INVALID' });
  });

  it('storage lỗi giữa chừng → dọn tệp đã lưu và trả 503', async () => {
    const { service, storage } = createSetup();
    storage.put
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('disk full'));

    await expect(
      service.create(
        1n,
        { category: 'bug', content: 'nội dung phản hồi dài đủ 10 ký tự' },
        [file(PNG), file(PNG)],
      ),
    ).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    expect(storage.delete).toHaveBeenCalledTimes(2);
  });

  it('adminUpdate ghi audit trong cùng transaction', async () => {
    const { service, tx, audit } = createSetup();
    tx.$queryRaw.mockResolvedValue([{ status: 'new', adminNote: null }]);
    tx.feedback.update.mockResolvedValue(
      feedbackRow({
        status: 'resolved',
        adminNote: 'đã sửa',
        user: { id: 9n, email: 'user@example.com' },
      }),
    );

    const result = await service.adminUpdate(5n, 'f1', {
      status: 'resolved',
      admin_note: 'đã sửa',
    });

    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        adminUserId: 5n,
        action: 'feedback.update',
        targetId: 'f1',
        payload: {
          status: 'resolved',
          before: { status: 'new', admin_note: null },
          after: { status: 'resolved', admin_note: 'đã sửa' },
        },
      }),
    );
    expect(result).toMatchObject({
      status: 'resolved',
      admin_note: 'đã sửa',
      user: { id: '9', email: 'user@example.com' },
    });
  });

  it('dọn cả object được tạo một phần bởi lần put thất bại', async () => {
    const { service, storage, prisma } = createSetup();
    const objects = new Map<string, Buffer>();
    storage.put.mockImplementation((key: string, buffer: Buffer) => {
      objects.set(key, buffer.subarray(0, 4));
      return Promise.reject(new Error('partial write failure'));
    });
    storage.delete.mockImplementation((key: string) => {
      objects.delete(key);
      return Promise.resolve();
    });
    await expect(
      service.create(
        1n,
        { category: 'bug', content: 'partial upload failure' },
        [file(PNG)],
      ),
    ).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    expect(objects.size).toBe(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('getAttachment: thiếu metadata hoặc mất tệp → 404', async () => {
    const { service, prisma, storage } = createSetup();
    prisma.feedbackAttachment.findFirst.mockResolvedValue(null);

    await expect(service.getAttachment('f1', 'a1')).rejects.toMatchObject({
      code: 'ATTACHMENT_NOT_FOUND',
    });

    prisma.feedbackAttachment.findFirst.mockResolvedValue({
      storageKey: 'feedback/1/a.png',
      mime: 'image/png',
    });
    storage.get.mockResolvedValue(null);
    await expect(service.getAttachment('f1', 'a1')).rejects.toMatchObject({
      code: 'ATTACHMENT_NOT_FOUND',
    });

    storage.get.mockResolvedValue(PNG);
    await expect(service.getAttachment('f1', 'a1')).resolves.toMatchObject({
      mime: 'image/png',
    });
  });
});
