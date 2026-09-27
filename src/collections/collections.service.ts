import { HttpStatus, Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { DomainException } from '../common/errors/domain.exception';
import { PrismaService } from '../db/prisma.service';
import { CloneFromDeckDto } from './dto/clone-from-deck.dto';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';
import { DeckRepository } from './repositories/deck.repository';
import {
  ArchivedResponse,
  CollectionListResult,
  CollectionResponse,
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
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

const CLONE_TRANSACTION_TIMEOUT_MS = 30_000;

@Injectable()
export class CollectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deckRepo: DeckRepository,
  ) {}

  async list(
    userId: bigint,
    profileId?: string,
  ): Promise<CollectionListResult> {
    if (profileId !== undefined) {
      await this.assertProfileOwned(userId, profileId);
    }
    const rows = await this.prisma.collection.findMany({
      where: {
        ownerId: userId,
        archivedAt: null,
        ...(profileId !== undefined ? { profileId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });
    return { data: rows.map(toCollectionResponse), next_cursor: null };
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
    return toCollectionResponse(row);
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
    return toCollectionResponse(row);
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
    const row = await this.prisma.collection.update({
      where: { id: collectionId },
      data: { archivedAt },
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
  async cloneFromDeck(
    userId: bigint,
    dto: CloneFromDeckDto,
  ): Promise<CollectionResponse> {
    const profileId = await this.resolveProfileId(userId, dto.profile_id);
    const deckId = BigInt(dto.deck_id);

    const deck = await this.deckRepo.findPublished(deckId);
    if (!deck || !deck.is_published) {
      throw new DomainException(
        'DECK_NOT_FOUND',
        'Không tìm thấy bộ từ',
        HttpStatus.NOT_FOUND,
      );
    }
    const deckItems = await this.deckRepo.findItems(deckId);

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
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    archived_at: row.archivedAt?.toISOString() ?? null,
  };
}
