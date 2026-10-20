import { HttpStatus, Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { parsePositivePostgresBigInt } from '../common/ids/postgres-id';
import { DomainException } from '../common/errors/domain.exception';
import { PrismaService } from '../db/prisma.service';
import { Prisma } from '../generated/prisma/client';
import {
  assertLanguagesInProfile,
  profileLanguageIds,
} from '../users/profile-languages';
import { lockUser } from '../users/user-lock';
import { AppendFromDeckDto } from './dto/append-from-deck.dto';
import { CloneFromDeckDto } from './dto/clone-from-deck.dto';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { DeckItemsQueryDto } from './dto/deck-items-query.dto';
import { ListCollectionsQueryDto } from './dto/list-collections-query.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';
import {
  decodeCollectionListCursor,
  encodeCollectionListCursor,
} from './list-cursors';
import { DeckRepository } from './repositories/deck.repository';
import {
  AppendFromDeckResult,
  ArchivedResponse,
  CollectionListResult,
  CollectionResponse,
  DeckListResult,
  DeckPreviewResult,
} from './types/collections.types';

interface CollectionRow {
  id: string;
  profileId: string;
  ownerId: bigint;
  name: string;
  description: string | null;
  kind: string;
  clonedFromDeckId: bigint | null;
  clonedFromCollectionId: string | null;
  isPublic: boolean;
  itemCount: number;
  visibleItemCount?: number;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  updatedAtCursor?: string;
}

interface CollectionDbRow {
  id: string;
  profile_id: string;
  owner_id: bigint;
  name: string;
  description: string | null;
  kind: string;
  cloned_from_deck_id: bigint | null;
  cloned_from_collection_id: string | null;
  is_public: boolean;
  item_count: number;
  visible_item_count: number;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
  updated_at_cursor: string;
}

const CLONE_TRANSACTION_TIMEOUT_MS = 30_000;
/** Cùng giới hạn position với items.service (int4). */
const MAX_POSITION = 2_147_483_647;

@Injectable()
export class CollectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deckRepo: DeckRepository,
  ) {}

  async list(
    userId: bigint,
    query: ListCollectionsQueryDto = {},
  ): Promise<CollectionListResult> {
    const profileId = query.profile_id;
    if (profileId !== undefined) {
      await this.assertProfileOwned(userId, profileId);
    }
    const cursor =
      query.cursor === undefined
        ? undefined
        : decodeCollectionListCursor(query.cursor);
    if (cursor && cursor.profileId !== (profileId ?? null)) {
      throw new DomainException(
        'VALIDATION_FAILED',
        'Cursor không khớp với bộ lọc profile_id',
        HttpStatus.BAD_REQUEST,
      );
    }
    const limit = query.limit ?? 20;
    const profilePredicate =
      profileId === undefined
        ? Prisma.sql``
        : Prisma.sql`AND c.profile_id = ${profileId}::uuid`;
    const cursorPredicate =
      cursor === undefined
        ? Prisma.sql``
        : Prisma.sql`AND (c.updated_at, c.id) < (${cursor.updatedAt}::timestamptz, ${cursor.id}::uuid)`;
    const rows = await this.prisma.$queryRaw<CollectionDbRow[]>(Prisma.sql`
      SELECT
        c.id,
        c.profile_id,
        c.owner_id,
        c.name,
        c.description,
        c.kind,
        c.cloned_from_deck_id,
        c.cloned_from_collection_id,
        c.is_public,
        c.item_count,
        (SELECT count(*)::int FROM app.collection_item i
          WHERE i.collection_id=c.id AND EXISTS (
            SELECT 1 FROM app.collection_item_face f
            WHERE f.item_id=i.id AND f.language_id IN (p.primary_language_id, p.secondary_language_id)
          )) AS visible_item_count,
        c.created_at,
        c.updated_at,
        c.archived_at,
        to_char(c.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at_cursor
      FROM app.collection c
      JOIN app.study_profile p ON p.id=c.profile_id AND p.user_id=c.owner_id
      WHERE c.owner_id = ${userId}
        AND c.archived_at IS NULL
        ${profilePredicate}
        ${cursorPredicate}
      ORDER BY c.updated_at DESC, c.id DESC
      LIMIT ${limit + 1}
    `);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      data: page.map((row) => toCollectionResponse(fromDbRow(row))),
      next_cursor:
        hasMore && last !== undefined
          ? encodeCollectionListCursor({
              updatedAt: last.updated_at_cursor,
              id: last.id,
              profileId: profileId ?? null,
            })
          : null,
    };
  }

  async create(
    userId: bigint,
    dto: CreateCollectionDto,
  ): Promise<CollectionResponse> {
    const profileId = await this.resolveProfileId(userId, dto.profile_id);
    const created = await this.prisma.collection.create({
      data: {
        id: uuidv7(),
        profileId,
        ownerId: userId,
        name: dto.name.trim(),
        description: dto.description ?? null,
      },
    });
    return toCollectionResponse(created);
  }

  async get(userId: bigint, collectionId: string): Promise<CollectionResponse> {
    const row = await this.findOwned(userId, collectionId);
    return this.withVisibleCount(userId, row);
  }

  async update(
    userId: bigint,
    collectionId: string,
    dto: UpdateCollectionDto,
  ): Promise<CollectionResponse> {
    await this.findOwned(userId, collectionId);
    const row = await this.prisma.collection.update({
      where: { id: collectionId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
      },
    });
    return this.withVisibleCount(userId, row);
  }

  /** Xoá mềm: archive để giữ lịch sử ôn tập. */
  async archive(
    userId: bigint,
    collectionId: string,
  ): Promise<ArchivedResponse> {
    const existing = await this.findOwned(userId, collectionId);
    if (existing.archivedAt) {
      return {
        id: existing.id,
        archived_at: existing.archivedAt.toISOString(),
      };
    }
    const archivedAt = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      await lockUser(tx, userId);
      return tx.collection.update({
        where: { id: collectionId },
        data: { archivedAt },
      });
    });
    return {
      id: row.id,
      archived_at: (row.archivedAt ?? archivedAt).toISOString(),
    };
  }

  /**
   * Clone bộ từ hệ thống: tạo collection + item + face anchor + 2 srs_state/face
   * trong một transaction; dùng createMany (uuid v7 sinh trước) cho deck lớn.
   */
  async listDecks(): Promise<DeckListResult> {
    const rows = await this.deckRepo.findPublishedList();
    return {
      data: rows.map((row) => ({
        id: row.id.toString(),
        slug: row.slug,
        title: row.title,
        description: row.description,
        language_id: row.language_id,
        level_label: row.level_label,
        item_count: row.item_count,
      })),
    };
  }

  /** Preview từ trong deck mẫu (phân trang theo position). */
  async getDeckPreview(
    deckIdRaw: string,
    query: DeckItemsQueryDto,
  ): Promise<DeckPreviewResult> {
    const deckId = parsePositivePostgresBigInt(deckIdRaw, 'deck_id');
    const deck = await this.deckRepo.findPublishedDetail(deckId);
    if (!deck) {
      throw new DomainException(
        'DECK_NOT_FOUND',
        'Không tìm thấy bộ từ',
        HttpStatus.NOT_FOUND,
      );
    }
    const limit = query.limit ?? 20;
    const cursor =
      query.cursor === undefined || query.cursor === ''
        ? null
        : Number(query.cursor);
    const rows = await this.deckRepo.findPreviewItems(
      deckId,
      cursor,
      limit + 1,
    );
    const hasNext = rows.length > limit;
    const page = hasNext ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    return {
      deck: {
        id: deck.id.toString(),
        slug: deck.slug,
        title: deck.title,
        description: deck.description,
        language_id: deck.language_id,
        level_label: deck.level_label,
        item_count: deck.item_count,
      },
      items: page.map((row) => ({
        position: row.position,
        lemma: row.lemma,
        reading: row.reading,
        romanization: row.romanization,
        pos: row.pos,
        meaning_vi: row.meaning_vi,
      })),
      next_cursor: hasNext && last ? String(last.position) : null,
    };
  }

  async cloneFromDeck(
    userId: bigint,
    dto: CloneFromDeckDto,
  ): Promise<CollectionResponse> {
    const profileId = await this.resolveProfileId(userId, dto.profile_id);
    const deckId = parsePositivePostgresBigInt(dto.deck_id, 'deck_id');

    const deck = await this.deckRepo.findPublished(deckId);
    if (!deck || !deck.is_published) {
      throw new DomainException(
        'DECK_NOT_FOUND',
        'Không tìm thấy bộ từ',
        HttpStatus.NOT_FOUND,
      );
    }
    const deckItems = await this.deckRepo.findItems(deckId);
    for (const deckItem of deckItems) {
      if (
        deckItem.concept_id !== null &&
        !(await this.deckRepo.hasCuratedConceptMapping(
          deckItem.anchor_sense_id,
          deckItem.concept_id,
        ))
      ) {
        throw new DomainException(
          'DECK_CONCEPT_INVALID',
          'Deck chứa concept chưa được duyệt cho một nghĩa',
          HttpStatus.CONFLICT,
        );
      }
    }

    const collectionId = uuidv7();
    const now = new Date();
    const rows = deckItems.map((deckItem) => {
      const itemId = uuidv7();
      return {
        item: {
          id: itemId,
          collectionId,
          conceptId: deckItem.concept_id,
          anchorSenseId: deckItem.anchor_sense_id,
          meaningVi: deckItem.meaning_vi,
          meaningSource: deckItem.meaning_source,
          position: deckItem.position,
          addedFromDeckId: deckId,
        },
        face: {
          id: uuidv7(),
          itemId,
          senseId: deckItem.anchor_sense_id,
          languageId: deckItem.sense_language_id,
          role: 'primary',
        },
      };
    });

    const collection = await this.prisma.$transaction(
      async (tx) => {
        await lockUser(tx, userId);
        const profile = await tx.studyProfile.findFirst({
          where: { id: profileId, userId },
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
          rows.map((row) => row.face.languageId),
        );

        const created = await tx.collection.create({
          data: {
            id: collectionId,
            profileId,
            ownerId: userId,
            name: dto.name?.trim() ?? deck.title,
            description: deck.description,
            kind: 'cloned',
            clonedFromDeckId: deckId,
            itemCount: rows.length,
          },
        });

        if (rows.length > 0) {
          await tx.collectionItem.createMany({
            data: rows.map((row) => row.item),
          });
          await tx.collectionItemFace.createMany({
            data: rows.map((row) => row.face),
          });
          await tx.srsState.createMany({
            data: rows.flatMap((row) => [
              {
                faceId: row.face.id,
                userId,
                profileId,
                direction: 'recognize',
                state: 'new',
                dueAt: now,
              },
              {
                faceId: row.face.id,
                userId,
                profileId,
                direction: 'recall',
                state: 'new',
                dueAt: now,
              },
            ]),
          });
        }
        return created;
      },
      { timeout: CLONE_TRANSACTION_TIMEOUT_MS },
    );

    return toCollectionResponse(collection);
  }

  /** Thêm từ của deck mẫu vào bộ đã có; giữ nguyên từ trùng (bỏ qua). */
  async appendFromDeck(
    userId: bigint,
    collectionId: string,
    dto: AppendFromDeckDto,
  ): Promise<AppendFromDeckResult> {
    const collection = await this.findOwned(userId, collectionId);
    if (collection.archivedAt !== null) {
      throw new DomainException(
        'COLLECTION_NOT_FOUND',
        'Không tìm thấy bộ sưu tập',
        HttpStatus.NOT_FOUND,
      );
    }
    const deckId = parsePositivePostgresBigInt(dto.deck_id, 'deck_id');
    const deck = await this.deckRepo.findPublished(deckId);
    if (!deck || !deck.is_published) {
      throw new DomainException(
        'DECK_NOT_FOUND',
        'Không tìm thấy bộ từ',
        HttpStatus.NOT_FOUND,
      );
    }
    const deckItems = await this.deckRepo.findItems(deckId);
    if (deckItems.length === 0) {
      return {
        collection_id: collectionId,
        added: 0,
        skipped: 0,
        item_count: collection.itemCount,
      };
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
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
          deckItems.map((item) => item.sense_language_id),
        );

        const existingRows = await tx.collectionItem.findMany({
          where: { collectionId },
          select: { anchorSenseId: true },
        });
        const existing = new Set(
          existingRows.map((row) => row.anchorSenseId.toString()),
        );
        const fresh = deckItems.filter(
          (item) => !existing.has(item.anchor_sense_id.toString()),
        );
        if (fresh.length === 0) {
          return { added: 0, itemCount: collection.itemCount };
        }

        const aggregate = await tx.collectionItem.aggregate({
          where: { collectionId },
          _max: { position: true },
        });
        const start = aggregate._max.position ?? 0;
        if (start + fresh.length > MAX_POSITION) {
          throw new DomainException(
            'COLLECTION_POSITION_LIMIT_REACHED',
            'Bộ sưu tập đã đạt giới hạn vị trí của item',
            HttpStatus.CONFLICT,
          );
        }

        const now = new Date();
        const rows = fresh.map((deckItem, index) => {
          const itemId = uuidv7();
          const faceId = uuidv7();
          return {
            item: {
              id: itemId,
              collectionId,
              conceptId: deckItem.concept_id,
              anchorSenseId: deckItem.anchor_sense_id,
              meaningVi: deckItem.meaning_vi,
              meaningSource: deckItem.meaning_source,
              position: start + index + 1,
              addedFromDeckId: deckId,
            },
            face: {
              id: faceId,
              itemId,
              senseId: deckItem.anchor_sense_id,
              languageId: deckItem.sense_language_id,
              role: 'primary',
            },
          };
        });

        await tx.collectionItem.createMany({
          data: rows.map((row) => row.item),
        });
        await tx.collectionItemFace.createMany({
          data: rows.map((row) => row.face),
        });
        await tx.srsState.createMany({
          data: rows.flatMap((row) => [
            {
              faceId: row.face.id,
              userId,
              profileId: collection.profileId,
              direction: 'recognize',
              state: 'new',
              dueAt: now,
            },
            {
              faceId: row.face.id,
              userId,
              profileId: collection.profileId,
              direction: 'recall',
              state: 'new',
              dueAt: now,
            },
          ]),
        });
        const updated = await tx.collection.update({
          where: { id: collectionId },
          data: { itemCount: { increment: rows.length } },
        });
        return { added: rows.length, itemCount: updated.itemCount };
      },
      { timeout: CLONE_TRANSACTION_TIMEOUT_MS },
    );

    return {
      collection_id: collectionId,
      added: result.added,
      skipped: deckItems.length - result.added,
      item_count: result.itemCount,
    };
  }

  private async withVisibleCount(
    userId: bigint,
    row: CollectionRow,
  ): Promise<CollectionResponse> {
    const profile = await this.prisma.studyProfile.findFirst({
      where: { id: row.profileId, userId },
      select: { primaryLanguageId: true, secondaryLanguageId: true },
    });
    if (!profile)
      throw new DomainException(
        'PROFILE_NOT_FOUND',
        'Không tìm thấy hồ sơ học',
        HttpStatus.NOT_FOUND,
      );
    const visibleItemCount = await this.prisma.collectionItem.count({
      where: {
        collectionId: row.id,
        faces: {
          some: {
            languageId: {
              in: profileLanguageIds(
                profile.primaryLanguageId,
                profile.secondaryLanguageId,
              ),
            },
          },
        },
      },
    });
    return toCollectionResponse({ ...row, visibleItemCount });
  }

  private async findOwned(
    userId: bigint,
    collectionId: string,
  ): Promise<CollectionRow> {
    const row = await this.prisma.collection.findFirst({
      where: { id: collectionId, ownerId: userId },
    });
    if (!row) {
      throw new DomainException(
        'COLLECTION_NOT_FOUND',
        'Không tìm thấy bộ sưu tập',
        HttpStatus.NOT_FOUND,
      );
    }
    return row;
  }

  private async resolveProfileId(
    userId: bigint,
    profileId?: string,
  ): Promise<string> {
    if (profileId !== undefined) {
      await this.assertProfileOwned(userId, profileId);
      return profileId;
    }

    const settings = await this.prisma.userSettings.findUnique({
      where: { userId },
    });
    if (settings?.activeProfileId) {
      return settings.activeProfileId;
    }
    const fallback = await this.prisma.studyProfile.findFirst({
      where: { userId, isDefault: true },
      select: { id: true },
    });
    if (fallback) {
      return fallback.id;
    }
    throw new DomainException(
      'PROFILE_REQUIRED',
      'Hãy tạo hồ sơ học trước khi tạo bộ sưu tập',
      HttpStatus.CONFLICT,
    );
  }

  private async assertProfileOwned(
    userId: bigint,
    profileId: string,
  ): Promise<void> {
    const profile = await this.prisma.studyProfile.findFirst({
      where: { id: profileId, userId },
      select: { id: true },
    });
    if (!profile) {
      throw new DomainException(
        'PROFILE_NOT_FOUND',
        'Không tìm thấy hồ sơ học',
        HttpStatus.NOT_FOUND,
      );
    }
  }
}

function toCollectionResponse(row: CollectionRow): CollectionResponse {
  return {
    id: row.id,
    profile_id: row.profileId,
    owner_id: row.ownerId.toString(),
    name: row.name,
    description: row.description,
    kind: row.kind,
    cloned_from_deck_id: row.clonedFromDeckId?.toString() ?? null,
    cloned_from_collection_id: row.clonedFromCollectionId,
    is_public: row.isPublic,
    item_count: row.itemCount,
    visible_item_count: row.visibleItemCount ?? row.itemCount,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    archived_at: row.archivedAt?.toISOString() ?? null,
  };
}

function fromDbRow(row: CollectionDbRow): CollectionRow {
  return {
    id: row.id,
    profileId: row.profile_id,
    ownerId: row.owner_id,
    name: row.name,
    description: row.description,
    kind: row.kind,
    clonedFromDeckId: row.cloned_from_deck_id,
    clonedFromCollectionId: row.cloned_from_collection_id,
    isPublic: row.is_public,
    itemCount: row.item_count,
    visibleItemCount: row.visible_item_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    updatedAtCursor: row.updated_at_cursor,
  };
}
