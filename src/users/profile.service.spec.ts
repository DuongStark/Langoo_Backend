import { PrismaService } from '../db/prisma.service';
import { LanguageRepository } from '../db/repositories/language.repository';
import { CreateProfileDto } from './dto/create-profile.dto';
import { ProfileService } from './profile.service';

interface TxMock {
  studyProfile: {
    count: jest.Mock;
    updateMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  userSettings: { updateMany: jest.Mock };
}

function firstArg<T>(mock: jest.Mock): T {
  const call = mock.mock.calls[0] as unknown[];
  return call[0] as T;
}

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'profile-1',
    userId: 1n,
    name: 'Nhật–Việt',
    primaryLanguageId: 2,
    secondaryLanguageId: 1,
    supportLanguageId: 3,
    isDefault: true,
    createdAt: new Date('2026-09-26T00:00:00.000Z'),
    updatedAt: new Date('2026-09-26T00:00:00.000Z'),
    ...overrides,
  };
}

function createSetup(): {
  service: ProfileService;
  prisma: {
    studyProfile: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      count: jest.Mock;
      delete: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  tx: TxMock;
  languages: { findExistingIds: jest.Mock };
} {
  const tx: TxMock = {
    studyProfile: {
      count: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    userSettings: { updateMany: jest.fn() },
  };
  const prisma = {
    studyProfile: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn((fn: (client: TxMock) => Promise<unknown>) => fn(tx)),
  };
  const languages = { findExistingIds: jest.fn() };
  const service = new ProfileService(
    prisma as unknown as PrismaService,
    languages as unknown as LanguageRepository,
  );
  return { service, prisma, tx, languages };
}

function createDto(
  overrides: Partial<CreateProfileDto> = {},
): CreateProfileDto {
  return {
    name: 'Nhật–Việt',
    primary_language_id: 2,
    secondary_language_id: 1,
    support_language_id: 3,
    ...overrides,
  };
}

describe('ProfileService', () => {
  describe('list', () => {
    it('trả danh sách đã map camelCase, default lên đầu', async () => {
      const { service, prisma } = createSetup();
      prisma.studyProfile.findMany.mockResolvedValue([profileRow()]);

      const rows = await service.list(1n);

      expect(prisma.studyProfile.findMany).toHaveBeenCalledWith({
        where: { userId: 1n },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      });
      expect(rows[0]).toMatchObject({
        id: 'profile-1',
        primary_language_id: 2,
        is_default: true,
        created_at: '2026-09-26T00:00:00.000Z',
      });
    });
  });

  describe('get', () => {
    it('không thuộc user hiện tại → PROFILE_NOT_FOUND', async () => {
      const { service, prisma } = createSetup();
      prisma.studyProfile.findFirst.mockResolvedValue(null);

      await expect(
        service.get(1n, 'profile-cua-nguoi-khac'),
      ).rejects.toMatchObject({ code: 'PROFILE_NOT_FOUND' });
      expect(prisma.studyProfile.findFirst).toHaveBeenCalledWith({
        where: { id: 'profile-cua-nguoi-khac', userId: 1n },
      });
    });
  });

  describe('create', () => {
    it('hồ sơ đầu tiên tự động là default + set active_profile_id', async () => {
      const { service, tx, languages } = createSetup();
      languages.findExistingIds.mockResolvedValue(new Set([1, 2, 3]));
      tx.studyProfile.count.mockResolvedValue(0);
      // Mock "echo" giống DB thật: trả lại dữ liệu vừa ghi.
      tx.studyProfile.create.mockImplementation(
        (args: { data: Record<string, unknown> }) =>
          Promise.resolve(profileRow({ ...args.data })),
      );

      const result = await service.create(1n, createDto());

      const args = firstArg<{
        data: { id: string; userId: bigint; isDefault: boolean; name: string };
      }>(tx.studyProfile.create);
      expect(args.data).toMatchObject({
        userId: 1n,
        isDefault: true,
        name: 'Nhật–Việt',
      });
      expect(args.data.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(result.id).toBe(args.data.id);
      expect(tx.userSettings.updateMany).toHaveBeenCalledWith({
        where: { userId: 1n },
        data: { activeProfileId: result.id },
      });
      expect(result.is_default).toBe(true);
    });

    it('đã có hồ sơ khác → mặc định is_default false, không đụng settings', async () => {
      const { service, tx, languages } = createSetup();
      languages.findExistingIds.mockResolvedValue(new Set([1, 2, 3]));
      tx.studyProfile.count.mockResolvedValue(1);
      tx.studyProfile.create.mockResolvedValue(
        profileRow({ isDefault: false }),
      );

      const result = await service.create(1n, createDto());

      const args = firstArg<{ data: { isDefault: boolean } }>(
        tx.studyProfile.create,
      );
      expect(args.data.isDefault).toBe(false);
      expect(tx.studyProfile.updateMany).not.toHaveBeenCalled();
      expect(tx.userSettings.updateMany).not.toHaveBeenCalled();
      expect(result.is_default).toBe(false);
    });

    it('gửi is_default=true → hạ default của hồ sơ cũ cùng transaction', async () => {
      const { service, tx, languages } = createSetup();
      languages.findExistingIds.mockResolvedValue(new Set([1, 2, 3]));
      tx.studyProfile.count.mockResolvedValue(1);
      tx.studyProfile.create.mockImplementation(
        (args: { data: Record<string, unknown> }) =>
          Promise.resolve(profileRow({ ...args.data })),
      );

      const result = await service.create(1n, createDto({ is_default: true }));

      expect(tx.studyProfile.updateMany).toHaveBeenCalledWith({
        where: { userId: 1n, isDefault: true },
        data: { isDefault: false },
      });
      const settingsArgs = firstArg<{
        where: { userId: bigint };
        data: { activeProfileId: string };
      }>(tx.userSettings.updateMany);
      expect(settingsArgs.where).toEqual({ userId: 1n });
      expect(settingsArgs.data.activeProfileId).toBe(result.id);
      expect(settingsArgs.data.activeProfileId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it('ba ngôn ngữ trùng nhau → PROFILE_LANGUAGES_CONFLICT, không cần tra DB', async () => {
      const { service, languages } = createSetup();

      await expect(
        service.create(1n, createDto({ secondary_language_id: 2 })),
      ).rejects.toMatchObject({ code: 'PROFILE_LANGUAGES_CONFLICT' });
      expect(languages.findExistingIds).not.toHaveBeenCalled();
    });

    it('ngôn ngữ không tồn tại → LANGUAGE_NOT_FOUND', async () => {
      const { service, languages } = createSetup();
      languages.findExistingIds.mockResolvedValue(new Set([2, 3]));

      await expect(
        service.create(1n, createDto({ secondary_language_id: 1 })),
      ).rejects.toMatchObject({ code: 'LANGUAGE_NOT_FOUND' });
    });
  });

  describe('update', () => {
    it('set default → hạ default cũ + cập nhật active_profile_id', async () => {
      const { service, prisma, tx, languages } = createSetup();
      prisma.studyProfile.findFirst.mockResolvedValue(
        profileRow({ isDefault: false }),
      );
      languages.findExistingIds.mockResolvedValue(new Set([1, 2, 3]));
      tx.studyProfile.update.mockResolvedValue(profileRow({ isDefault: true }));

      const result = await service.update(1n, 'profile-1', {
        is_default: true,
      });

      expect(tx.studyProfile.updateMany).toHaveBeenCalledWith({
        where: { userId: 1n, isDefault: true },
        data: { isDefault: false },
      });
      expect(tx.userSettings.updateMany).toHaveBeenCalledWith({
        where: { userId: 1n },
        data: { activeProfileId: 'profile-1' },
      });
      const args = firstArg<{ data: { isDefault?: boolean } }>(
        tx.studyProfile.update,
      );
      expect(args.data.isDefault).toBe(true);
      expect(result.is_default).toBe(true);
    });

    it('bỏ default trực tiếp → PROFILE_IS_DEFAULT', async () => {
      const { service, prisma } = createSetup();
      prisma.studyProfile.findFirst.mockResolvedValue(
        profileRow({ isDefault: true }),
      );

      await expect(
        service.update(1n, 'profile-1', { is_default: false }),
      ).rejects.toMatchObject({ code: 'PROFILE_IS_DEFAULT' });
    });

    it('đổi ngôn ngữ gây trùng → PROFILE_LANGUAGES_CONFLICT', async () => {
      const { service, prisma } = createSetup();
      prisma.studyProfile.findFirst.mockResolvedValue(profileRow());

      await expect(
        service.update(1n, 'profile-1', { secondary_language_id: 3 }),
      ).rejects.toMatchObject({ code: 'PROFILE_LANGUAGES_CONFLICT' });
    });
  });

  describe('remove', () => {
    it('hồ sơ duy nhất → PROFILE_LAST_CANNOT_DELETE', async () => {
      const { service, prisma } = createSetup();
      prisma.studyProfile.findFirst.mockResolvedValue(profileRow());
      prisma.studyProfile.count.mockResolvedValue(1);

      await expect(service.remove(1n, 'profile-1')).rejects.toMatchObject({
        code: 'PROFILE_LAST_CANNOT_DELETE',
      });
      expect(prisma.studyProfile.delete).not.toHaveBeenCalled();
    });

    it('đang default mà còn hồ sơ khác → PROFILE_IS_DEFAULT', async () => {
      const { service, prisma } = createSetup();
      prisma.studyProfile.findFirst.mockResolvedValue(
        profileRow({ isDefault: true }),
      );
      prisma.studyProfile.count.mockResolvedValue(2);

      await expect(service.remove(1n, 'profile-1')).rejects.toMatchObject({
        code: 'PROFILE_IS_DEFAULT',
      });
      expect(prisma.studyProfile.delete).not.toHaveBeenCalled();
    });

    it('xoá thành công → trả id + deleted_at', async () => {
      const { service, prisma } = createSetup();
      prisma.studyProfile.findFirst.mockResolvedValue(
        profileRow({ id: 'profile-2', isDefault: false }),
      );
      prisma.studyProfile.count.mockResolvedValue(2);
      prisma.studyProfile.delete.mockResolvedValue(profileRow());

      const result = await service.remove(1n, 'profile-2');

      expect(prisma.studyProfile.delete).toHaveBeenCalledWith({
        where: { id: 'profile-2' },
      });
      expect(result.id).toBe('profile-2');
      expect(typeof result.deleted_at).toBe('string');
    });
  });
});
