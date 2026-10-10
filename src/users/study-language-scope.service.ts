import { Injectable } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import {
  profileLanguageIds,
  profileLanguageScopeKey,
} from './profile-languages';

export interface StudyLanguageScope {
  profileId: string;
  languageIds: number[];
  key: string;
}

/** Read on every request so a profile edit immediately changes dictionary scope. */
@Injectable()
export class StudyLanguageScopeService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(userId?: bigint): Promise<StudyLanguageScope | null> {
    if (userId === undefined) return null;
    const settings = await this.prisma.userSettings.findUnique({
      where: { userId },
    });
    const profile = await this.prisma.studyProfile.findFirst({
      where: settings?.activeProfileId
        ? { userId, id: settings.activeProfileId }
        : { userId, isDefault: true },
      select: { id: true, primaryLanguageId: true, secondaryLanguageId: true },
    });
    // Anonymous browsing / onboarding without a profile keeps the public catalog.
    if (!profile) return null;
    const languageIds = profileLanguageIds(
      profile.primaryLanguageId,
      profile.secondaryLanguageId,
    );
    return {
      profileId: profile.id,
      languageIds,
      key: profileLanguageScopeKey(
        profile.id,
        profile.primaryLanguageId,
        profile.secondaryLanguageId,
      ),
    };
  }
}
