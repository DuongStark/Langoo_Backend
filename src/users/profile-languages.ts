import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../common/errors/domain.exception';

export function profileLanguageIds(
  primaryLanguageId: number,
  secondaryLanguageId: number | null,
): number[] {
  return [
    ...new Set(
      [primaryLanguageId, secondaryLanguageId].filter(
        (languageId): languageId is number => languageId !== null,
      ),
    ),
  ];
}

export function assertLanguagesInProfile(
  allowedLanguageIds: number[],
  requestedLanguageIds: number[],
): void {
  const allowed = new Set(allowedLanguageIds);
  const unsupportedLanguageIds = [
    ...new Set(requestedLanguageIds.filter((id) => !allowed.has(id))),
  ];
  if (unsupportedLanguageIds.length === 0) return;

  throw new DomainException(
    'COLLECTION_LANGUAGE_NOT_IN_PROFILE',
    'Ngôn ngữ của từ không nằm trong hồ sơ học của bộ sưu tập',
    HttpStatus.CONFLICT,
    {
      allowed_language_ids: allowedLanguageIds,
      unsupported_language_ids: unsupportedLanguageIds,
    },
  );
}

export function profileLanguageScopeKey(
  profileId: string,
  primary: number,
  secondary: number | null,
): string {
  return `${profileId}:${profileLanguageIds(primary, secondary)
    .sort((a, b) => a - b)
    .join(',')}`;
}
