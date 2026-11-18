import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { QuizBankRepository } from '../ai/quiz/bank/quiz-bank.repository';
import { DomainException } from '../common/errors/domain.exception';
import { parsePositivePostgresBigInt } from '../common/ids/postgres-id';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor';
import { LanguageRepository } from '../db/repositories/language.repository';
import { PrismaService } from '../db/prisma.service';
import { Prisma } from '../generated/prisma/client';
import {
  assertLanguagesInProfile,
  profileLanguageIds,
} from '../users/profile-languages';
import { lockUser } from '../users/user-lock';
import { CreateItemDto } from './dto/create-item.dto';
import { ListItemsQueryDto } from './dto/list-items-query.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { SenseLookupRepository } from './repositories/sense-lookup.repository';
import {
  DeletedResponse,
  ItemListResult,
  ItemResponse,
} from './types/collections.types';

const DEFAULT_ITEMS_LIMIT = 20;
const MAX_POSITION = 2147483647;

interface CollectionOwnedRow {
  id: string;
  profileId: string;
}

interface ItemFaceRow {
  id: string;
  senseId: bigint;
  languageId: number;
  role: string;
}

interface ItemTagRow {
  tagId: bigint;
}

interface ItemRow {
  id: string;
  collectionId: string;
  conceptId: bigint | null;
  anchorSenseId: bigint;
  meaningVi: string;
  meaningSource: string;
  note: string | null;
  status: string;
  position: number;
  addedFromDeckId: bigint | null;
  createdAt: Date;
  updatedAt: Date;
  faces: ItemFaceRow[];
  itemTags: ItemTagRow[];
}

/** Item trong collection: 1–2 face, mỗi face 2 srs_state (transaction). */
@Injectable()
export class ItemsService {
  private readonly logger = new Logger(ItemsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly senseLookup: SenseLookupRepository,
    private readonly languages: LanguageRepository,
    @Optional() private readonly quizBankRepo?: QuizBankRepository,
  ) {}

  async list(
    userId: bigint,
    collectionId: string,
    query: ListItemsQueryDto,
  ): Promise<ItemListResult> {
    const collection = await this.findOwnedCollection(userId, collectionId);
    const allowed = await this.collectionLanguages(
      userId,
      collection.profileId,
    );
    if (query.language_id !== undefined) {
      const existing = await this.languages.findExistingIds([
        query.language_id,
      ]);
      if (!existing.has(query.language_id)) {
        throw new DomainException(
          'LANGUAGE_NOT_FOUND',
          `Ngôn ngữ không tồn tại: ${query.language_id}`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const limit = query.limit ?? DEFAULT_ITEMS_LIMIT;
    const order = query.order ?? 'asc';
    const visibleLanguages =
      query.language_id === undefined
        ? allowed
        : allowed.filter((id) => id === query.language_id);
    const where: Prisma.CollectionItemWhereInput = {
      collectionId,
      faces: { some: { languageId: { in: visibleLanguages } } },
    };
    if (query.status !== undefined) {
      where.status = query.status;
    }
    if (query.cursor !== undefined) {
      const cursor = decodeCursor(query.cursor);
      if ((cursor.order ?? 'asc') !== order) {
        throw new DomainException(
          'VALIDATION_FAILED',
          'Cursor không cùng thứ tự sắp xếp; hãy tải lại trang đầu',
          HttpStatus.BAD_REQUEST,
        );
      }
      const compare = order === 'desc' ? 'lt' : 'gt';
      where.OR = [
        { position: { [compare]: cursor.position } },
        { position: cursor.position, id: { [compare]: cursor.id } },
      ];
    }

    const rows = await this.prisma.collectionItem.findMany({
      where,
      orderBy: [{ position: order }, { id: order }],
      take: limit + 1,
      include: {
        faces: { where: { languageId: { in: visibleLanguages } } },
        itemTags: true,
      },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const data = page.map(toItemResponse);
    if (query.include === 'display') {
      try {
        const ids = [
          ...new Set(
            data.flatMap((item) =>
              item.display_sense_id ? [item.display_sense_id] : [],
            ),
          ),
        ].map(BigInt);
        const displays = await this.senseLookup.findDisplays(
          ids,
          visibleLanguages,
        );
        for (const item of data)
          item.display = displays.get(item.display_sense_id ?? '') ?? null;
      } catch {
        throw new DomainException(
          'COLLECTION_READ_UNAVAILABLE',
          'Chưa đọc được dữ liệu hiển thị, hãy thử lại',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
    }
    return {
      data,
      next_cursor:
        hasMore && last !== undefined
          ? encodeCursor({
              position: last.position,
              id: last.id,
              ...(order === 'desc' ? { order } : {}),
            })
          : null,
    };
  }

  async add(
    userId: bigint,
    collectionId: string,
    dto: CreateItemDto,
  ): Promise<ItemResponse> {
    const collection = await this.findOwnedCollection(userId, collectionId);

    const anchorId = parsePositivePostgresBigInt(dto.sense_id, 'sense_id');
    const secondaryId =
      dto.secondary_sense_id !== undefined
        ? parsePositivePostgresBigInt(
            dto.secondary_sense_id,
            'secondary_sense_id',
          )
        : null;
    const ids = secondaryId !== null ? [anchorId, secondaryId] : [anchorId];
    const uniqueIds = [...new Set(ids.map((id) => id.toString()))].map((id) =>
      BigInt(id),
    );
    const senses = await this.senseLookup.findManyByIds(uniqueIds);
    const byId = new Map(
      senses.map((sense) => [sense.sense_id.toString(), sense]),
    );

    const anchor = byId.get(anchorId.toString());
    if (!anchor) {
      throw senseNotFound();
    }

    let secondary = null;
    if (secondaryId !== null) {
      secondary = byId.get(secondaryId.toString()) ?? null;
      if (!secondary) {
        throw senseNotFound();
      }
      if (secondary.language_id === anchor.language_id) {
        throw new DomainException(
          'COLLECTION_FACE_LANGUAGE_DUPLICATE',
          'Mặt phụ phải ở ngôn ngữ khác mặt chính',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    let conceptId: bigint | null = anchor.concept_id ?? null;
    if (secondary !== null) {
      const pair = await this.senseLookup.findCuratedPair(
        anchorId,
        secondary.sense_id,
      );
      if (!pair) {
        throw new DomainException(
          'COLLECTION_SENSE_PAIR_INVALID',
          'Hai mặt không phải là một cặp nghĩa đã được duyệt',
          HttpStatus.BAD_REQUEST,
        );
      }
      conceptId = pair.concept_id;
      if (dto.concept_id !== undefined) {
        const requestedConceptId = parsePositivePostgresBigInt(
          dto.concept_id,
          'concept_id',
        );
        if (requestedConceptId !== pair.concept_id) {
          throw conceptInvalid();
        }
      }
    } else if (dto.concept_id !== undefined) {
      const requestedConceptId = parsePositivePostgresBigInt(
        dto.concept_id,
        'concept_id',
      );
      const valid = await this.senseLookup.hasCuratedConceptMapping(
        anchorId,
        requestedConceptId,
      );
      if (!valid) {
        throw conceptInvalid();
      }
      conceptId = requestedConceptId;
    }

    const tagIds = uniqueBigInts(dto.tag_ids ?? []);
    await this.assertTagsOwned(userId, tagIds);

    const itemId = uuidv7();
    const anchorFaceId = uuidv7();
    const secondaryFaceId = secondary !== null ? uuidv7() : null;
    const now = new Date();

    try {
      await this.prisma.$transaction(async (tx) => {
        await lockUser(tx, userId);
        const profile = await tx.studyProfile.findFirst({
          where: { id: collection.profileId, userId },
          select: {
            id: true,
            primaryLanguageId: true,
            secondaryLanguageId: true,
          },
        });
        if (!profile) {
          throw new DomainException(
            'PROFILE_NOT_FOUND',
            'Không tìm thấy hồ sơ học của bộ sưu tập',
            HttpStatus.CONFLICT,
          );
        }
        assertLanguagesInProfile(
          profileLanguageIds(
            profile.primaryLanguageId,
            profile.secondaryLanguageId,
          ),
          [anchor.language_id, ...(secondary ? [secondary.language_id] : [])],
        );

        const maxPosition = await tx.collectionItem.aggregate({
          where: { collectionId },
          _max: { position: true },
        });
        if (maxPosition._max.position === MAX_POSITION) {
          throw positionLimitReached();
        }
        const position = (maxPosition._max.position ?? 0) + 1;

        await tx.collectionItem.create({
          data: {
            id: itemId,
            collectionId,
            conceptId,
            anchorSenseId: anchorId,
            meaningVi: dto.meaning_vi.trim(),
            meaningSource: 'user',
            note: dto.note ?? null,
            status: dto.status ?? 'learning',
            position,
          },
        });

        await tx.collectionItemFace.create({
          data: {
            id: anchorFaceId,
            itemId,
            senseId: anchorId,
            languageId: anchor.language_id,
            role: 'primary',
          },
        });
        if (secondary !== null && secondaryFaceId !== null) {
          await tx.collectionItemFace.create({
            data: {
              id: secondaryFaceId,
              itemId,
              senseId: secondary.sense_id,
              languageId: secondary.language_id,
              role: 'secondary',
            },
          });
        }

        const faceIds = [
          anchorFaceId,
          ...(secondaryFaceId ? [secondaryFaceId] : []),
        ];
        await tx.srsState.createMany({
          data: faceIds.flatMap((faceId) =>
            (['recognize', 'recall'] as const).map((direction) => ({
              faceId,
              userId,
              profileId: collection.profileId,
              direction,
              state: 'new',
              dueAt: now,
            })),
          ),
        });

        if (tagIds.length > 0) {
          await tx.collectionItemTag.createMany({
            data: tagIds.map((tagId) => ({ itemId, tagId })),
          });
        }

        await tx.collection.update({
          where: { id: collectionId },
          data: { itemCount: { increment: 1 } },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DomainException(
          'ITEM_ALREADY_EXISTS',
          'Từ này đã có trong bộ sưu tập',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }

    const response = await this.getItemOrThrow(userId, collectionId, itemId);

    if (this.quizBankRepo) {
      const sensesToPrewarm = [
        { senseId: anchorId, languageId: anchor.language_id },
        ...(secondary
          ? [{ senseId: secondary.sense_id, languageId: secondary.language_id }]
          : []),
      ];
      try {
        await this.quizBankRepo.enqueueUserSavedSenses(userId, sensesToPrewarm);
      } catch (err) {
        this.logger.warn(
          `Pre-warm quiz bank skipped for item ${itemId}: ${err instanceof Error ? err.message : 'unknown'}`,
        );
      }
    }

    return response;
  }

  async update(
    userId: bigint,
    collectionId: string,
    itemId: string,
    dto: UpdateItemDto,
  ): Promise<ItemResponse> {
    await this.findOwnedCollection(userId, collectionId);
    await this.assertItemExists(collectionId, itemId);

    let tagIds: bigint[] | null = null;
    if (dto.tag_ids !== undefined) {
      tagIds = uniqueBigInts(dto.tag_ids);
      await this.assertTagsOwned(userId, tagIds);
    }

    await this.prisma.$transaction(async (tx) => {
      await lockUser(tx, userId);
      await tx.collectionItem.update({
        where: { id: itemId },
        data: {
          ...(dto.meaning_vi !== undefined
            ? { meaningVi: dto.meaning_vi.trim() }
            : {}),
          ...(dto.meaning_vi !== undefined ? { meaningSource: 'user' } : {}),
          ...(dto.note !== undefined ? { note: dto.note } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          ...(dto.position !== undefined ? { position: dto.position } : {}),
        },
      });

      if (tagIds !== null) {
        await tx.collectionItemTag.deleteMany({ where: { itemId } });
        if (tagIds.length > 0) {
          await tx.collectionItemTag.createMany({
            data: tagIds.map((tagId) => ({ itemId, tagId })),
          });
        }
      }
    });

    return this.getItemOrThrow(userId, collectionId, itemId);
  }

  async remove(
    userId: bigint,
    collectionId: string,
    itemId: string,
  ): Promise<DeletedResponse> {
    await this.findOwnedCollection(userId, collectionId);
    const deletedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await lockUser(tx, userId);
      const deleted = await tx.collectionItem.deleteMany({
        where: { id: itemId, collectionId },
      });
      if (deleted.count === 0) {
        throw itemNotFound();
      }
      await tx.collection.update({
        where: { id: collectionId },
        data: { itemCount: { decrement: 1 } },
      });
    });

    return { id: itemId, deleted_at: deletedAt.toISOString() };
  }

  private async findOwnedCollection(
    userId: bigint,
    collectionId: string,
  ): Promise<CollectionOwnedRow> {
    const collection = await this.prisma.collection.findFirst({
      where: { id: collectionId, ownerId: userId },
      select: { id: true, profileId: true },
    });
    if (!collection) {
      throw new DomainException(
        'COLLECTION_NOT_FOUND',
        'Không tìm thấy bộ sưu tập',
        HttpStatus.NOT_FOUND,
      );
    }
    return collection;
  }

  private async assertItemExists(
    collectionId: string,
    itemId: string,
  ): Promise<void> {
    const item = await this.prisma.collectionItem.findFirst({
      where: { id: itemId, collectionId },
      select: { id: true },
    });
    if (!item) {
      throw itemNotFound();
    }
  }

  private async assertTagsOwned(
    userId: bigint,
    tagIds: bigint[],
  ): Promise<void> {
    if (tagIds.length === 0) {
      return;
    }
    const unique = [...new Set(tagIds.map((id) => id.toString()))];
    const found = await this.prisma.tag.findMany({
      where: { id: { in: unique.map((id) => BigInt(id)) }, userId },
      select: { id: true },
    });
    if (found.length !== unique.length) {
      throw new DomainException(
        'TAG_NOT_FOUND',
        'Có tag không tồn tại hoặc không thuộc bạn',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  private async getItemOrThrow(
    userId: bigint,
    collectionId: string,
    itemId: string,
  ): Promise<ItemResponse> {
    const collection = await this.findOwnedCollection(userId, collectionId);
    const allowed = await this.collectionLanguages(
      userId,
      collection.profileId,
    );
    const row = await this.prisma.collectionItem.findFirst({
      where: { id: itemId, collectionId },
      include: { faces: true, itemTags: true },
    });
    if (!row) {
      throw itemNotFound();
    }
    return toItemResponse({
      ...row,
      faces: row.faces.filter((face) => allowed.includes(face.languageId)),
    });
  }

  private async collectionLanguages(
    userId: bigint,
    profileId: string,
  ): Promise<number[]> {
    const profile = await this.prisma.studyProfile.findFirst({
      where: { id: profileId, userId },
      select: { primaryLanguageId: true, secondaryLanguageId: true },
    });
    if (!profile)
      throw new DomainException(
        'PROFILE_NOT_FOUND',
        'Không tìm thấy hồ sơ học',
        HttpStatus.NOT_FOUND,
      );
    return profileLanguageIds(
      profile.primaryLanguageId,
      profile.secondaryLanguageId,
    );
  }
}

function senseNotFound(): DomainException {
  return new DomainException(
    'SENSE_NOT_FOUND',
    'Không tìm thấy nghĩa',
    HttpStatus.NOT_FOUND,
  );
}

function itemNotFound(): DomainException {
  return new DomainException(
    'ITEM_NOT_FOUND',
    'Không tìm thấy từ trong bộ sưu tập',
    HttpStatus.NOT_FOUND,
  );
}

function conceptInvalid(): DomainException {
  return new DomainException(
    'COLLECTION_CONCEPT_INVALID',
    'Khái niệm không thuộc nghĩa đã được duyệt của mặt này',
    HttpStatus.BAD_REQUEST,
  );
}

function positionLimitReached(): DomainException {
  return new DomainException(
    'COLLECTION_POSITION_LIMIT_REACHED',
    'Bộ sưu tập đã đạt giới hạn vị trí của item',
    HttpStatus.CONFLICT,
  );
}

function uniqueBigInts(rawIds: string[]): bigint[] {
  const values = rawIds.map((id) => parsePositivePostgresBigInt(id, 'tag_id'));
  return [...new Map(values.map((id) => [id.toString(), id])).values()];
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

function toItemResponse(row: ItemRow): ItemResponse {
  return {
    id: row.id,
    collection_id: row.collectionId,
    concept_id: row.conceptId?.toString() ?? null,
    anchor_sense_id: row.anchorSenseId.toString(),
    display_sense_id:
      (
        row.faces.find((face) => face.senseId === row.anchorSenseId) ??
        row.faces[0]
      )?.senseId.toString() ?? null,
    meaning_vi: row.meaningVi,
    meaning_source: row.meaningSource,
    note: row.note,
    status: row.status,
    position: row.position,
    added_from_deck_id: row.addedFromDeckId?.toString() ?? null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    faces: row.faces.map((face) => ({
      id: face.id,
      sense_id: face.senseId.toString(),
      language_id: face.languageId,
      role: face.role,
    })),
    tag_ids: row.itemTags.map((tag) => tag.tagId.toString()),
  };
}
