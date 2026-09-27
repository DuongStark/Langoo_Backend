import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException } from '../common/errors/domain.exception';
import { PrismaService } from '../db/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { LanguageRepository } from '../db/repositories/language.repository';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import {
  DEFAULT_DAILY_GOAL,
  DEFAULT_SRS_NEW_PER_DAY,
  DEFAULT_SRS_REVIEW_PER_DAY,
  DEFAULT_TIMEZONE,
} from './settings.constants';
import { SettingsResponse } from './types/users.types';
import { lockUser } from './user-lock';

interface SettingsRow {
  timezone: string;
  uiLanguageId: number | null;
  dailyGoal: number;
  notify: unknown;
  activeProfileId: string | null;
  srsNewPerDay: number;
  srsReviewPerDay: number;
  updatedAt: Date;
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly languages: LanguageRepository,
  ) {}

  /**
   * Trả settings của user; nếu chưa có row (user cũ) thì trả mặc định,
   * `active_profile_id` fallback về hồ sơ đang là mặc định.
   */
  async get(userId: bigint): Promise<SettingsResponse> {
    const row = await this.prisma.userSettings.findUnique({
      where: { userId },
    });
    if (row) {
      return toSettingsResponse(row);
    }

    const defaultProfile = await this.prisma.studyProfile.findFirst({
      where: { userId, isDefault: true },
      select: { id: true },
    });
    return {
      timezone: DEFAULT_TIMEZONE,
      ui_language_id: null,
      daily_goal: DEFAULT_DAILY_GOAL,
      notify: {},
      active_profile_id: defaultProfile?.id ?? null,
      srs_new_per_day: DEFAULT_SRS_NEW_PER_DAY,
      srs_review_per_day: DEFAULT_SRS_REVIEW_PER_DAY,
      updated_at: null,
    };
  }

  async update(
    userId: bigint,
    dto: UpdateSettingsDto,
  ): Promise<SettingsResponse> {
    const timezone = dto.timezone?.trim();
    if (timezone !== undefined) {
      assertValidTimezone(timezone);
    }

    if (dto.ui_language_id !== undefined && dto.ui_language_id !== null) {
      const existing = await this.languages.findExistingIds([
        dto.ui_language_id,
      ]);
      if (!existing.has(dto.ui_language_id)) {
        throw new DomainException(
          'LANGUAGE_NOT_FOUND',
          `Ngôn ngữ không tồn tại: ${dto.ui_language_id}`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const row = await this.prisma.$transaction(async (tx) => {
      await lockUser(tx, userId);

      const existingSettings = await tx.userSettings.findUnique({
        where: { userId },
      });

      if (
        dto.active_profile_id !== undefined &&
        dto.active_profile_id !== null
      ) {
        const profile = await tx.studyProfile.findFirst({
          where: { id: dto.active_profile_id, userId },
          select: { id: true },
        });
        if (!profile) {
          throw new DomainException(
            'SETTINGS_ACTIVE_PROFILE_INVALID',
            'Hồ sơ học không tồn tại hoặc không thuộc bạn',
            HttpStatus.BAD_REQUEST,
          );
        }
      }

      let activeProfileId: string | null;
      if (dto.active_profile_id !== undefined) {
        activeProfileId = dto.active_profile_id;
      } else if (existingSettings) {
        activeProfileId = existingSettings.activeProfileId;
      } else {
        const defaultProfile = await tx.studyProfile.findFirst({
          where: { userId, isDefault: true },
          select: { id: true },
        });
        activeProfileId = defaultProfile?.id ?? null;
      }

      return tx.userSettings.upsert({
        where: { userId },
        create: {
          userId,
          timezone: timezone ?? DEFAULT_TIMEZONE,
          uiLanguageId: dto.ui_language_id ?? null,
          dailyGoal: dto.daily_goal ?? DEFAULT_DAILY_GOAL,
          notify: (dto.notify ?? {}) as Prisma.InputJsonValue,
          activeProfileId,
          srsNewPerDay: dto.srs_new_per_day ?? DEFAULT_SRS_NEW_PER_DAY,
          srsReviewPerDay: dto.srs_review_per_day ?? DEFAULT_SRS_REVIEW_PER_DAY,
        },
        update: {
          ...(timezone !== undefined ? { timezone } : {}),
          ...(dto.ui_language_id !== undefined
            ? { uiLanguageId: dto.ui_language_id }
            : {}),
          ...(dto.daily_goal !== undefined
            ? { dailyGoal: dto.daily_goal }
            : {}),
          ...(dto.notify !== undefined
            ? { notify: dto.notify as Prisma.InputJsonValue }
            : {}),
          ...(dto.active_profile_id !== undefined
            ? { activeProfileId: dto.active_profile_id }
            : {}),
          ...(dto.srs_new_per_day !== undefined
            ? { srsNewPerDay: dto.srs_new_per_day }
            : {}),
          ...(dto.srs_review_per_day !== undefined
            ? { srsReviewPerDay: dto.srs_review_per_day }
            : {}),
        },
      });
    });

    return toSettingsResponse(row);
  }
}

/** Kiểm tra múi giờ IANA hợp lệ bằng Intl (không cần thư viện ngoài). */
export function assertValidTimezone(timezone: string): void {
  // Numeric offsets are accepted by Intl but are not IANA zone identifiers.
  if (/^[+-]/.test(timezone)) {
    throw new DomainException(
      'SETTINGS_TIMEZONE_INVALID',
      `Múi giờ không hợp lệ: "${timezone}"`,
      HttpStatus.BAD_REQUEST,
    );
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new DomainException(
      'SETTINGS_TIMEZONE_INVALID',
      `Múi giờ không hợp lệ: "${timezone}"`,
      HttpStatus.BAD_REQUEST,
    );
  }
}

function toSettingsResponse(row: SettingsRow): SettingsResponse {
  return {
    timezone: row.timezone,
    ui_language_id: row.uiLanguageId,
    daily_goal: row.dailyGoal,
    notify: (row.notify ?? {}) as Record<string, unknown>,
    active_profile_id: row.activeProfileId,
    srs_new_per_day: row.srsNewPerDay,
    srs_review_per_day: row.srsReviewPerDay,
    updated_at: row.updatedAt.toISOString(),
  };
}
