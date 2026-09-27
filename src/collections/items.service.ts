import { HttpStatus, Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { DomainException } from '../common/errors/domain.exception';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor';
import { LanguageRepository } from '../db/repositories/language.repository';
import { PrismaService } from '../db/prisma.service';
import { Prisma } from '../generated/prisma/client';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly senseLookup: SenseLookupRepository,
    private readonly languages: LanguageRepository,
  ) {}

  async list(
    userId: bigint,
    collectionId: string,
    query: ListItemsQueryDto,
  ): Promise<ItemListResult> {
    await this.findOwnedCollection(userId, collectionId);
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
    const where: Prisma.CollectionItemWhereInput = { collectionId };
    if (query.status !== undefined) {
      where.status = query.status;
    }
    if (query.language_id !== undefined) {
      where.faces = { some: { languageId: query.language_id } };
    }
    if (query.cursor !== undefined) {
      const cursor = decodeCursor(query.cursor);
      where.OR = [
        { position: { gt: cursor.position } },
        { position: cursor.position, id: { gt: cursor.id } },
      ];
    }

    const rows = await this.prisma.collectionItem.findMany({
      where,
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      include: { faces: true, itemTags: true },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      data: page.map(toItemResponse),
      next_cursor:
        hasMore && last !== undefined
          ? encodeCursor({ position: last.position, id: last.id })
          : null,
    };
  }

  async add(
    userId: bigint,
    collectionId: string,
    dto: CreateItemDto,
  ): Promise<ItemResponse> {
    const collection = await this.findOwnedCollection(userId, collectionId);

    const anchorId = BigInt(dto.sense_id);
    const secondaryId =
      dto.secondary_sense_id !== undefined
        ? BigInt(dto.secondary_sense_id)
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
    if (dto.concept_id !== undefined) {
      conceptId = BigInt(dto.concept_id);
      const exists = await this.senseLookup.conceptExists(conceptId);
      if (!exists) {
        throw new DomainException(
          'CONCEPT_NOT_FOUND',
          'Không tìm thấy khái niệm',
          HttpStatus.NOT_FOUND,
        );
      }
    }

    const tagIds = dto.tag_ids?.map((id) => BigInt(id)) ?? [];
    await this.assertTagsOwned(userId, tagIds);

    const itemId = uuidv7();
    const anchorFaceId = uuidv7();
    const secondaryFaceId = secondary !== null ? uuidv7() : null;
    const now = new Date();

    try {
      await this.prisma.$transaction(async (tx) => {
        const maxPosition = await tx.collectionItem.aggregate({
          where: { collectionId },
          _max: { position: true },
        });
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

    return this.getItemOrThrow(collectionId, itemId);
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
      tagIds = dto.tag_ids.map((id) => BigInt(id));
      await this.assertTagsOwned(userId, tagIds);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.collectionItem.update({
        where: { id: itemId },
        data: {
          ...(dto.meaning_vi !== undefined
            ? { meaningVi: dto.meaning_vi.trim() }
            : {}),
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

    return this.getItemOrThrow(collectionId, itemId);
  }

  async remove(
    userId: bigint,
    collectionId: string,
    itemId: string,
  ): Promise<DeletedResponse> {
    await this.findOwnedCollection(userId, collectionId);
    await this.assertItemExists(collectionId, itemId);

    const deletedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.collectionItem.delete({ where: { id: itemId } });
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
    collectionId: string,
    itemId: string,
  ): Promise<ItemResponse> {
    const row = await this.prisma.collectionItem.findFirst({
      where: { id: itemId, collectionId },
      include: { faces: true, itemTags: true },
    });
    if (!row) {
      throw itemNotFound();
    }
    return toItemResponse(row);
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
