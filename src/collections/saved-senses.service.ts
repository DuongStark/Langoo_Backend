import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { DomainException } from '../common/errors/domain.exception';
import { parsePositivePostgresBigInt } from '../common/ids/postgres-id';
import { profileLanguageIds } from '../users/profile-languages';
import {
  SavedSensesQueryDto,
  SavedSensesResponseDto,
} from './dto/saved-senses.dto';

@Injectable()
export class SavedSensesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    userId: bigint,
    query: SavedSensesQueryDto,
  ): Promise<SavedSensesResponseDto> {
    // Defend the service boundary as well as the HTTP DTO.
    if (
      typeof query.sense_ids !== 'string' ||
      !/^\d{1,19}(,\d{1,19}){0,49}$/.test(query.sense_ids)
    ) {
      throw new DomainException(
        'VALIDATION_FAILED',
        'Cần 1–50 mã nghĩa hợp lệ',
        HttpStatus.BAD_REQUEST,
      );
    }
    const ids = [
      ...new Set(
        query.sense_ids
          .split(',')
          .map((id) => parsePositivePostgresBigInt(id, 'sense_id').toString()),
      ),
    ].map(BigInt);
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const profile = await tx.studyProfile.findFirst({
            where: { id: query.profile_id, userId },
            select: { primaryLanguageId: true, secondaryLanguageId: true },
          });
          if (!profile)
            throw new DomainException(
              'PROFILE_NOT_FOUND',
              'Không tìm thấy hồ sơ học',
              HttpStatus.NOT_FOUND,
            );
          const faces = await tx.collectionItemFace.findMany({
            where: {
              senseId: { in: ids },
              languageId: {
                in: profileLanguageIds(
                  profile.primaryLanguageId,
                  profile.secondaryLanguageId,
                ),
              },
              item: {
                collection: {
                  ownerId: userId,
                  profileId: query.profile_id,
                  archivedAt: null,
                  profile: { userId },
                },
              },
            },
            select: { senseId: true, item: { select: { collectionId: true } } },
          });
          const saved = new Map<string, Set<string>>();
          for (const face of faces) {
            const id = face.senseId.toString();
            const collections = saved.get(id) ?? new Set<string>();
            collections.add(face.item.collectionId);
            saved.set(id, collections);
          }
          return {
            profile_id: query.profile_id,
            data: ids.map((id) => ({
              sense_id: id.toString(),
              saved_collection_ids: [
                ...(saved.get(id.toString()) ?? []),
              ].sort(),
            })),
          };
        },
        { isolationLevel: 'RepeatableRead' },
      );
    } catch (error) {
      if (error instanceof DomainException) throw error;
      throw new DomainException(
        'COLLECTION_READ_UNAVAILABLE',
        'Chưa đọc được trạng thái đã lưu, hãy thử lại',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
