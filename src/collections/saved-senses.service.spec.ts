import { SavedSensesService } from './saved-senses.service';
import { PrismaService } from '../db/prisma.service';

function setup() {
  const tx = {
    studyProfile: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ primaryLanguageId: 2, secondaryLanguageId: null }),
    },
    collectionItemFace: {
      findMany: jest.fn().mockResolvedValue([
        { senseId: 1n, item: { collectionId: 'c1' } },
        { senseId: 1n, item: { collectionId: 'c2' } },
        { senseId: 1n, item: { collectionId: 'c2' } },
      ]),
    },
  };
  const prisma = {
    $transaction: jest.fn((fn: (arg: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return {
    tx,
    prisma,
    service: new SavedSensesService(prisma as unknown as PrismaService),
  };
}

describe('M12-A18 saved sense membership', () => {
  it('batches face membership and enforces owner/profile/language/archive filters', async () => {
    const { service, tx, prisma } = setup();
    expect(
      await service.list(42n, { profile_id: 'p1', sense_ids: '1,2,01' }),
    ).toEqual({
      profile_id: 'p1',
      data: [
        { sense_id: '1', saved_collection_ids: ['c1', 'c2'] },
        { sense_id: '2', saved_collection_ids: [] },
      ],
    });
    expect(tx.studyProfile.findFirst).toHaveBeenCalledWith({
      where: { id: 'p1', userId: 42n },
      select: { primaryLanguageId: true, secondaryLanguageId: true },
    });
    expect(tx.collectionItemFace.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          senseId: { in: [1n, 2n] },
          languageId: { in: [2] },
          item: {
            collection: {
              ownerId: 42n,
              profileId: 'p1',
              archivedAt: null,
              profile: { userId: 42n },
            },
          },
        },
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
  });

  it('does not query membership for an unowned profile', async () => {
    const { service, tx } = setup();
    tx.studyProfile.findFirst.mockResolvedValue(null);
    await expect(
      service.list(42n, { profile_id: 'other', sense_ids: '1' }),
    ).rejects.toMatchObject({ code: 'PROFILE_NOT_FOUND' });
    expect(tx.collectionItemFace.findMany).not.toHaveBeenCalled();
  });

  it('does not turn database failure into not-saved', async () => {
    const { service, tx } = setup();
    tx.collectionItemFace.findMany.mockRejectedValue(
      new Error('private connection detail'),
    );
    await expect(
      service.list(42n, { profile_id: 'p1', sense_ids: '1' }),
    ).rejects.toMatchObject({
      code: 'COLLECTION_READ_UNAVAILABLE',
      message: 'Chưa đọc được trạng thái đã lưu, hãy thử lại',
    });
  });

  it.each(['', '0', '9223372036854775808', Array(51).fill('1').join(',')])(
    'rejects invalid batch %s before database access',
    async (sense_ids) => {
      const { service, prisma } = setup();
      await expect(
        service.list(42n, { profile_id: 'p1', sense_ids }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );
});
