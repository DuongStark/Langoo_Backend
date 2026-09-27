import { HttpStatus, Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { DomainException } from '../common/errors/domain.exception';
import { PrismaService } from '../db/prisma.service';
import { LanguageRepository } from '../db/repositories/language.repository';
import { CreateProfileDto } from './dto/create-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { DeletedProfileResponse, ProfileResponse } from './types/users.types';

interface ProfileRow {
  id: string;
  name: string;
  primaryLanguageId: number;
  secondaryLanguageId: number | null;
  supportLanguageId: number;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly languages: LanguageRepository,
  ) {}

  async list(userId: bigint): Promise<ProfileResponse[]> {
    const profiles = await this.prisma.studyProfile.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return profiles.map(toProfileResponse);
  }

  async get(userId: bigint, profileId: string): Promise<ProfileResponse> {
    const profile = await this.findOwned(userId, profileId);
    return toProfileResponse(profile);
  }

  async create(
    userId: bigint,
    dto: CreateProfileDto,
  ): Promise<ProfileResponse> {
    assertLanguagesDiffer(
      dto.primary_language_id,
      dto.secondary_language_id ?? null,
      dto.support_language_id,
    );
    await this.assertLanguagesExist([
      dto.primary_language_id,
      ...(dto.secondary_language_id != null ? [dto.secondary_language_id] : []),
      dto.support_language_id,
    ]);

    const created = await this.prisma.$transaction(async (tx) => {
      const existingCount = await tx.studyProfile.count({ where: { userId } });
      // Hồ sơ đầu tiên tự động là mặc định (DB có partial unique: 1 default/user).
      const isDefault = dto.is_default ?? existingCount === 0;
      if (isDefault) {
        await tx.studyProfile.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      }

      const profile = await tx.studyProfile.create({
        data: {
          id: uuidv7(),
          userId,
          name: dto.name,
          primaryLanguageId: dto.primary_language_id,
          secondaryLanguageId: dto.secondary_language_id ?? null,
          supportLanguageId: dto.support_language_id,
          isDefault,
        },
      });

      if (isDefault) {
        await tx.userSettings.updateMany({
          where: { userId },
          data: { activeProfileId: profile.id },
        });
      }
      return profile;
    });

    return toProfileResponse(created);
  }

  async update(
    userId: bigint,
    profileId: string,
    dto: UpdateProfileDto,
  ): Promise<ProfileResponse> {
    const existing = await this.findOwned(userId, profileId);

    const primary = dto.primary_language_id ?? existing.primaryLanguageId;
    const secondary =
      dto.secondary_language_id === undefined
        ? existing.secondaryLanguageId
        : dto.secondary_language_id;
    const support = dto.support_language_id ?? existing.supportLanguageId;

    assertLanguagesDiffer(primary, secondary, support);
    const languagesTouched =
      dto.primary_language_id !== undefined ||
      dto.secondary_language_id !== undefined ||
      dto.support_language_id !== undefined;
    if (languagesTouched) {
      await this.assertLanguagesExist([
        primary,
        ...(secondary != null ? [secondary] : []),
        support,
      ]);
    }

    if (dto.is_default === false && existing.isDefault) {
      throw profileIsDefault();
    }

    const makeDefault = dto.is_default === true && !existing.isDefault;
    const updated = await this.prisma.$transaction(async (tx) => {
      if (makeDefault) {
        await tx.studyProfile.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      }
      const profile = await tx.studyProfile.update({
        where: { id: profileId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.primary_language_id !== undefined
            ? { primaryLanguageId: dto.primary_language_id }
            : {}),
          ...(dto.secondary_language_id !== undefined
            ? { secondaryLanguageId: dto.secondary_language_id }
            : {}),
          ...(dto.support_language_id !== undefined
            ? { supportLanguageId: dto.support_language_id }
            : {}),
          ...(makeDefault ? { isDefault: true } : {}),
        },
      });
      if (makeDefault) {
        await tx.userSettings.updateMany({
          where: { userId },
          data: { activeProfileId: profileId },
        });
      }
      return profile;
    });

    return toProfileResponse(updated);
  }

  async remove(
    userId: bigint,
    profileId: string,
  ): Promise<DeletedProfileResponse> {
    const existing = await this.findOwned(userId, profileId);
    const count = await this.prisma.studyProfile.count({ where: { userId } });

    if (count <= 1) {
      throw new DomainException(
        'PROFILE_LAST_CANNOT_DELETE',
        'Không thể xoá hồ sơ duy nhất',
        HttpStatus.CONFLICT,
      );
    }
    if (existing.isDefault) {
      throw profileIsDefault();
    }

    await this.prisma.studyProfile.delete({ where: { id: profileId } });
    return { id: profileId, deleted_at: new Date().toISOString() };
  }

  /** Chỉ trả hồ sơ thuộc user hiện tại — nếu không, coi như không tồn tại (404). */
  private async findOwned(
    userId: bigint,
    profileId: string,
  ): Promise<ProfileRow> {
    const profile = await this.prisma.studyProfile.findFirst({
      where: { id: profileId, userId },
    });
    if (!profile) {
      throw new DomainException(
        'PROFILE_NOT_FOUND',
        'Không tìm thấy hồ sơ học',
        HttpStatus.NOT_FOUND,
      );
    }
    return profile;
  }

  private async assertLanguagesExist(ids: number[]): Promise<void> {
    const unique = [...new Set(ids)];
    const existing = await this.languages.findExistingIds(unique);
    const missing = unique.filter((id) => !existing.has(id));
    if (missing.length > 0) {
      throw new DomainException(
        'LANGUAGE_NOT_FOUND',
        `Ngôn ngữ không tồn tại: ${missing.join(', ')}`,
        HttpStatus.BAD_REQUEST,
        { missing_language_ids: missing },
      );
    }
  }
}

export function assertLanguagesDiffer(
  primary: number,
  secondary: number | null,
  support: number,
): void {
  const conflict =
    primary === support ||
    (secondary !== null && (secondary === primary || secondary === support));
  if (conflict) {
    throw new DomainException(
      'PROFILE_LANGUAGES_CONFLICT',
      'Ba ngôn ngữ của hồ sơ phải khác nhau',
      HttpStatus.BAD_REQUEST,
    );
  }
}

function profileIsDefault(): DomainException {
  return new DomainException(
    'PROFILE_IS_DEFAULT',
    'Hồ sơ đang là mặc định — hãy đặt hồ sơ khác làm mặc định trước',
    HttpStatus.CONFLICT,
  );
}

function toProfileResponse(profile: ProfileRow): ProfileResponse {
  return {
    id: profile.id,
    name: profile.name,
    primary_language_id: profile.primaryLanguageId,
    secondary_language_id: profile.secondaryLanguageId,
    support_language_id: profile.supportLanguageId,
    is_default: profile.isDefault,
    created_at: profile.createdAt.toISOString(),
    updated_at: profile.updatedAt.toISOString(),
  };
}
