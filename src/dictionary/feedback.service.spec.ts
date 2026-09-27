import { LanguageRepository } from '../db/repositories/language.repository';
import { PrismaService } from '../db/prisma.service';
import { FeedbackService } from './feedback.service';

function firstArg<T>(mock: jest.Mock): T {
  const call = mock.mock.calls[0] as unknown[];
  return call[0] as T;
}

function createSetup(): {
  service: FeedbackService;
  prisma: { glossReport: { create: jest.Mock } };
  languages: { findExistingIds: jest.Mock };
} {
  const prisma = { glossReport: { create: jest.fn() } };
  const languages = { findExistingIds: jest.fn(), findIdByCode: jest.fn() };
  const service = new FeedbackService(
    prisma as unknown as PrismaService,
    languages as unknown as LanguageRepository,
  );
  return { service, prisma, languages };
}

describe('FeedbackService', () => {
  it('ngôn ngữ không tồn tại → LANGUAGE_NOT_FOUND, không ghi', async () => {
    const { service, prisma, languages } = createSetup();
    languages.findExistingIds.mockResolvedValue(new Set<number>());

    await expect(
      service.create(1n, {
        target_kind: 'sense_gloss',
        target_id: '1',
        language_id: 99,
        issue: 'wrong',
      }),
    ).rejects.toMatchObject({ code: 'LANGUAGE_NOT_FOUND' });
    expect(prisma.glossReport.create).not.toHaveBeenCalled();
  });

  it('tạo báo lỗi gloss với user từ JWT và map response', async () => {
    const { service, prisma, languages } = createSetup();
    languages.findExistingIds.mockResolvedValue(new Set([3]));
    prisma.glossReport.create.mockResolvedValue({
      id: 12n,
      targetKind: 'sense_gloss',
      targetId: '1',
      languageId: 3,
      issue: 'wrong',
      comment: 'sai nghĩa',
      status: 'open',
      createdAt: new Date('2026-09-27T00:00:00.000Z'),
    });

    const result = await service.create(7n, {
      target_kind: 'sense_gloss',
      target_id: '1',
      language_id: 3,
      issue: 'wrong',
      comment: 'sai nghĩa',
    });

    const args = firstArg<{ data: Record<string, unknown> }>(
      prisma.glossReport.create,
    );
    expect(args.data).toMatchObject({
      userId: 7n,
      targetKind: 'sense_gloss',
      targetId: '1',
      languageId: 3,
      issue: 'wrong',
      comment: 'sai nghĩa',
    });
    expect(result).toMatchObject({
      id: '12',
      target_kind: 'sense_gloss',
      target_id: '1',
      status: 'open',
      created_at: '2026-09-27T00:00:00.000Z',
    });
  });

  it('không gửi language_id → không cần kiểm tra ngôn ngữ', async () => {
    const { service, prisma, languages } = createSetup();
    prisma.glossReport.create.mockResolvedValue({
      id: 13n,
      targetKind: 'example',
      targetId: 'ex-1',
      languageId: null,
      issue: 'missing',
      comment: null,
      status: 'open',
      createdAt: new Date('2026-09-27T00:00:00.000Z'),
    });

    await service.create(7n, {
      target_kind: 'example',
      target_id: 'ex-1',
      issue: 'missing',
    });

    expect(languages.findExistingIds).not.toHaveBeenCalled();
    expect(prisma.glossReport.create).toHaveBeenCalled();
  });
});
