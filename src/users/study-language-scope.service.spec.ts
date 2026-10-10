import { PrismaService } from '../db/prisma.service';
import { StudyLanguageScopeService } from './study-language-scope.service';

describe('M6.2 active study language scope', () => {
  it('reads edits immediately: bilingual → JA-only → EN-only → bilingual', async () => {
    const prisma = {
      userSettings: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ activeProfileId: 'profile-1' }),
      },
      studyProfile: { findFirst: jest.fn() },
    };
    const service = new StudyLanguageScopeService(
      prisma as unknown as PrismaService,
    );
    for (const [primaryLanguageId, secondaryLanguageId, expected] of [
      [2, 1, [2, 1]],
      [2, null, [2]],
      [1, null, [1]],
      [1, 2, [1, 2]],
    ] as const) {
      prisma.studyProfile.findFirst.mockResolvedValue({
        id: 'profile-1',
        primaryLanguageId,
        secondaryLanguageId,
      });
      expect((await service.resolve(1n))?.languageIds).toEqual(expected);
    }
    expect(prisma.studyProfile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 1n, id: 'profile-1' } }),
    );
  });

  it('anonymous browsing does not read personal settings', async () => {
    const prisma = { userSettings: { findUnique: jest.fn() } };
    const service = new StudyLanguageScopeService(
      prisma as unknown as PrismaService,
    );
    expect(await service.resolve()).toBeNull();
    expect(prisma.userSettings.findUnique).not.toHaveBeenCalled();
  });
});
