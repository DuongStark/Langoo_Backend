import { PrismaService } from '../db/prisma.service';
import { LanguageRepository } from '../db/repositories/language.repository';
import { assertValidTimezone, SettingsService } from './settings.service';

function firstArg<T>(mock: jest.Mock): T {
  const call = mock.mock.calls[0] as unknown[];
  return call[0] as T;
}

function settingsRow(overrides: Record<string, unknown> = {}) {
  return {
    userId: 1n,
    timezone: 'Asia/Ho_Chi_Minh',
    uiLanguageId: null,
    dailyGoal: 20,
    notify: {},
    activeProfileId: null,
    srsNewPerDay: 20,
    srsReviewPerDay: 200,
    updatedAt: new Date('2026-09-26T00:00:00.000Z'),
    ...overrides,
  };
}

function createSetup(): {
  service: SettingsService;
  prisma: {
    userSettings: { findUnique: jest.Mock; upsert: jest.Mock };
    studyProfile: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  languages: { findExistingIds: jest.Mock };
} {
  const userSettings = { findUnique: jest.fn(), upsert: jest.fn() };
  const studyProfile = { findFirst: jest.fn() };
  const tx = {
    $queryRaw: jest.fn(),
    userSettings,
    studyProfile,
  };
  const prisma = {
    userSettings,
    studyProfile,
    $transaction: jest.fn((fn: (client: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  const languages = { findExistingIds: jest.fn() };
  const service = new SettingsService(
    prisma as unknown as PrismaService,
    languages as unknown as LanguageRepository,
  );
  return { service, prisma, languages };
}

describe('SettingsService', () => {
  describe('get', () => {
    it('chưa có row → trả mặc định, active fallback về profile default', async () => {
      const { service, prisma } = createSetup();
      prisma.userSettings.findUnique.mockResolvedValue(null);
      prisma.studyProfile.findFirst.mockResolvedValue({ id: 'profile-1' });

      const result = await service.get(1n);

      expect(result).toEqual({
        timezone: 'Asia/Ho_Chi_Minh',
        ui_language_id: null,
        daily_goal: 20,
        notify: {},
        active_profile_id: 'profile-1',
        srs_new_per_day: 20,
        srs_review_per_day: 200,
        updated_at: null,
      });
    });

    it('có row → map đúng (ngày ISO)', async () => {
      const { service, prisma } = createSetup();
      prisma.userSettings.findUnique.mockResolvedValue(
        settingsRow({
          timezone: 'Asia/Tokyo',
          dailyGoal: 30,
          notify: { review_reminder: true },
          activeProfileId: 'profile-9',
        }),
      );

      const result = await service.get(1n);

      expect(result).toMatchObject({
        timezone: 'Asia/Tokyo',
        daily_goal: 30,
        notify: { review_reminder: true },
        active_profile_id: 'profile-9',
        updated_at: '2026-09-26T00:00:00.000Z',
      });
    });
  });

  describe('update', () => {
    it('upsert đúng các field gửi lên và trả resource', async () => {
      const { service, prisma } = createSetup();
      prisma.userSettings.upsert.mockResolvedValue(
        settingsRow({
          timezone: 'Asia/Tokyo',
          dailyGoal: 30,
          notify: { review_reminder: true },
        }),
      );

      const result = await service.update(1n, {
        timezone: 'Asia/Tokyo',
        daily_goal: 30,
        notify: { review_reminder: true },
      });

      const args = firstArg<{
        where: { userId: bigint };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }>(prisma.userSettings.upsert);
      expect(args.where).toEqual({ userId: 1n });
      expect(args.update).toMatchObject({
        timezone: 'Asia/Tokyo',
        dailyGoal: 30,
        notify: { review_reminder: true },
      });
      expect(result.timezone).toBe('Asia/Tokyo');
    });

    it('chưa có row → nhánh create có mặc định cho field thiếu', async () => {
      const { service, prisma } = createSetup();
      prisma.userSettings.upsert.mockResolvedValue(
        settingsRow({ dailyGoal: 25 }),
      );

      await service.update(1n, { daily_goal: 25 });

      const args = firstArg<{
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }>(prisma.userSettings.upsert);
      expect(args.create).toMatchObject({
        userId: 1n,
        timezone: 'Asia/Ho_Chi_Minh',
        dailyGoal: 25,
        notify: {},
        uiLanguageId: null,
        activeProfileId: null,
      });
      expect(args.update).toEqual({ dailyGoal: 25 });
    });

    it('múi giờ sai → SETTINGS_TIMEZONE_INVALID, không ghi DB', async () => {
      const { service, prisma } = createSetup();

      await expect(
        service.update(1n, { timezone: 'Sai/Mui' }),
      ).rejects.toMatchObject({ code: 'SETTINGS_TIMEZONE_INVALID' });
      expect(prisma.userSettings.upsert).not.toHaveBeenCalled();
    });

    it('từ chối timezone là numeric offset', () => {
      expect(() => assertValidTimezone('+07:00')).toThrow(
        'Múi giờ không hợp lệ',
      );
      expect(() => assertValidTimezone('Asia/Tokyo')).not.toThrow();
    });

    it('user cũ chưa có settings → create giữ profile default làm active', async () => {
      const { service, prisma } = createSetup();
      prisma.userSettings.findUnique.mockResolvedValue(null);
      prisma.studyProfile.findFirst.mockResolvedValue({ id: 'profile-1' });
      prisma.userSettings.upsert.mockResolvedValue(
        settingsRow({ dailyGoal: 25, activeProfileId: 'profile-1' }),
      );

      await service.update(1n, { daily_goal: 25 });

      const args = firstArg<{ create: Record<string, unknown> }>(
        prisma.userSettings.upsert,
      );
      expect(args.create.activeProfileId).toBe('profile-1');
    });

    it('active_profile_id không thuộc user → SETTINGS_ACTIVE_PROFILE_INVALID', async () => {
      const { service, prisma } = createSetup();
      prisma.studyProfile.findFirst.mockResolvedValue(null);

      await expect(
        service.update(1n, {
          active_profile_id: '01a0dc8a-7191-7e18-93b0-32e8378986fe',
        }),
      ).rejects.toMatchObject({ code: 'SETTINGS_ACTIVE_PROFILE_INVALID' });
    });

    it('ui_language_id không tồn tại → LANGUAGE_NOT_FOUND', async () => {
      const { service, languages } = createSetup();
      languages.findExistingIds.mockResolvedValue(new Set<number>());

      await expect(
        service.update(1n, { ui_language_id: 99 }),
      ).rejects.toMatchObject({ code: 'LANGUAGE_NOT_FOUND' });
    });
  });
});
