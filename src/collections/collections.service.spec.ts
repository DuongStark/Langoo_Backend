import { PrismaService } from '../db/prisma.service';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { CollectionsService } from './collections.service';
import { DeckRepository, DeckRow } from './repositories/deck.repository';

interface TxMock {
  collection: { create: jest.Mock; update: jest.Mock };
  collectionItem: { createMany: jest.Mock };
  collectionItemFace: { createMany: jest.Mock };
  srsState: { createMany: jest.Mock };
  studyProfile: { findFirst: jest.Mock };
  $queryRaw: jest.Mock;
}

function firstArg<T>(mock: jest.Mock): T {
  const call = mock.mock.calls[0] as unknown[];
  return call[0] as T;
}

const NOW = new Date('2026-09-27T00:00:00.000Z');

function collectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '01a0dc8a-7191-7e18-93b0-32e8378986fe',
    profileId: '01a0dc8a-718f-7acd-a588-2cf077898399',
    ownerId: 1n,
    name: 'Bộ của tôi',
    description: null,
    kind: 'personal',
    clonedFromDeckId: null,
    clonedFromCollectionId: null,
    isPublic: false,
    itemCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    ...overrides,
  };
}

function createSetup(): {
  service: CollectionsService;
  prisma: {
    collection: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    collectionItem: { count: jest.Mock };
    userSettings: { findUnique: jest.Mock };
    studyProfile: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  tx: TxMock;
  deck: {
    findPublished: jest.Mock;
    findPublishedList: jest.Mock;
    findItems: jest.Mock;
    hasCuratedConceptMapping: jest.Mock;
  };
} {
  const tx: TxMock = {
    collection: { create: jest.fn(), update: jest.fn() },
    collectionItem: { createMany: jest.fn() },
    collectionItemFace: { createMany: jest.fn() },
    srsState: { createMany: jest.fn() },
    studyProfile: {
      findFirst: jest.fn().mockResolvedValue({
        id: '01a0dc8a-718f-7acd-a588-2cf077898399',
        primaryLanguageId: 2,
        secondaryLanguageId: 1,
      }),
    },
    $queryRaw: jest.fn(),
  };
  const prisma = {
    collection: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    collectionItem: { count: jest.fn().mockResolvedValue(0) },
    userSettings: { findUnique: jest.fn() },
    studyProfile: { findFirst: jest.fn() },
    $transaction: jest.fn((...args: unknown[]) => {
      const run = args[0] as (client: TxMock) => Promise<unknown>;
      return run(tx);
    }),
  };
  const deck = {
    findPublished: jest.fn(),
    findPublishedList: jest.fn(),
    findItems: jest.fn(),
    hasCuratedConceptMapping: jest.fn().mockResolvedValue(true),
  };
  const service = new CollectionsService(
    prisma as unknown as PrismaService,
    deck as unknown as DeckRepository,
  );
  return { service, prisma, tx, deck };
}

function createDto(
  overrides: Partial<CreateCollectionDto> = {},
): CreateCollectionDto {
  return { name: 'Bộ của tôi', ...overrides };
}

describe('CollectionsService', () => {
  describe('profile resolution', () => {
    it('không truyền profile → dùng active_profile_id', async () => {
      const { service, prisma } = createSetup();
      const profileId = '01a0dc8a-718f-7acd-a588-2cf077898399';
      prisma.userSettings.findUnique.mockResolvedValue({
        activeProfileId: profileId,
      });
      prisma.collection.create.mockResolvedValue(collectionRow({ profileId }));

      await service.create(1n, createDto());

      const args = firstArg<{ data: { profileId: string; ownerId: bigint } }>(
        prisma.collection.create,
      );
      expect(args.data).toMatchObject({ profileId, ownerId: 1n });
    });

    it('chưa có profile nào → 409 PROFILE_REQUIRED', async () => {
      const { service, prisma } = createSetup();
      prisma.userSettings.findUnique.mockResolvedValue({
        activeProfileId: null,
      });
      prisma.studyProfile.findFirst.mockResolvedValue(null);

      await expect(service.create(1n, createDto())).rejects.toMatchObject({
        code: 'PROFILE_REQUIRED',
      });
      expect(prisma.collection.create).not.toHaveBeenCalled();
    });

    it('profile_id không thuộc user → 404 PROFILE_NOT_FOUND', async () => {
      const { service, prisma } = createSetup();
      prisma.studyProfile.findFirst.mockResolvedValue(null);

      await expect(
        service.create(
          1n,
          createDto({ profile_id: '01a0dc8a-7191-7e18-93b0-32e8378986fe' }),
        ),
      ).rejects.toMatchObject({ code: 'PROFILE_NOT_FOUND' });
    });
  });

  describe('get / archive', () => {
    it('reports visible count separately from retained total after removing a language', async () => {
      const { service, prisma } = createSetup();
      prisma.collection.findFirst.mockResolvedValue(
        collectionRow({ itemCount: 2 }),
      );
      prisma.studyProfile.findFirst.mockResolvedValue({
        primaryLanguageId: 2,
        secondaryLanguageId: null,
      });
      prisma.collectionItem.count.mockResolvedValue(1);
      const result = await service.get(1n, collectionRow().id);
      expect(result).toMatchObject({ item_count: 2, visible_item_count: 1 });
      expect(prisma.collectionItem.count).toHaveBeenCalledWith({
        where: {
          collectionId: collectionRow().id,
          faces: { some: { languageId: { in: [2] } } },
        },
      });
      expect(prisma.collection.update).not.toHaveBeenCalled();
    });

    it('không thuộc user → 404 COLLECTION_NOT_FOUND', async () => {
      const { service, prisma } = createSetup();
      prisma.collection.findFirst.mockResolvedValue(null);

      await expect(
        service.get(1n, '01a0dc8a-7191-7e18-93b0-32e8378986fe'),
      ).rejects.toMatchObject({ code: 'COLLECTION_NOT_FOUND' });
    });

    it('archive mềm: set archived_at và trả resource', async () => {
      const { service, prisma, tx } = createSetup();
      prisma.collection.findFirst.mockResolvedValue(collectionRow());
      tx.collection.update.mockResolvedValue(
        collectionRow({ archivedAt: NOW }),
      );

      const result = await service.archive(
        1n,
        '01a0dc8a-7191-7e18-93b0-32e8378986fe',
      );

      const args = firstArg<{ data: { archivedAt: Date } }>(
        tx.collection.update,
      );
      expect(args.data.archivedAt).toBeInstanceOf(Date);
      expect(result.archived_at).toBe(NOW.toISOString());
    });

    it('đã archive rồi → idempotent, không update lại', async () => {
      const { service, prisma } = createSetup();
      prisma.collection.findFirst.mockResolvedValue(
        collectionRow({ archivedAt: NOW }),
      );

      const result = await service.archive(
        1n,
        '01a0dc8a-7191-7e18-93b0-32e8378986fe',
      );

      expect(prisma.collection.update).not.toHaveBeenCalled();
      expect(result.archived_at).toBe(NOW.toISOString());
    });
  });

  describe('listDecks', () => {
    it('trả deck đã publish với id dạng string', async () => {
      const { service, deck } = createSetup();
      deck.findPublishedList.mockResolvedValue([
        {
          id: 6n,
          slug: 'starter-100',
          title: '100 từ tiếng Nhật đầu tiên',
          description: null,
          language_id: 2,
          level_label: 'N5',
          item_count: 100,
        },
      ]);

      await expect(service.listDecks()).resolves.toEqual({
        data: [
          {
            id: '6',
            slug: 'starter-100',
            title: '100 từ tiếng Nhật đầu tiên',
            description: null,
            language_id: 2,
            level_label: 'N5',
            item_count: 100,
          },
        ],
      });
    });
  });

  describe('cloneFromDeck', () => {
    const deckRow: DeckRow = {
      id: 1n,
      title: 'JLPT N5 (demo)',
      description: null,
      language_id: 2,
      item_count: 2,
      is_published: true,
    };

    it('deck không tồn tại/chưa publish → 404 DECK_NOT_FOUND', async () => {
      const { service, prisma, deck } = createSetup();
      prisma.userSettings.findUnique.mockResolvedValue({
        activeProfileId: '01a0dc8a-718f-7acd-a588-2cf077898399',
      });
      deck.findPublished.mockResolvedValue(null);

      await expect(
        service.cloneFromDeck(1n, { deck_id: '999' }),
      ).rejects.toMatchObject({ code: 'DECK_NOT_FOUND' });
    });

    it('concept deck chưa curated → 409 DECK_CONCEPT_INVALID trước transaction', async () => {
      const { service, prisma, tx, deck } = createSetup();
      prisma.userSettings.findUnique.mockResolvedValue({
        activeProfileId: '01a0dc8a-718f-7acd-a588-2cf077898399',
      });
      deck.findPublished.mockResolvedValue(deckRow);
      deck.findItems.mockResolvedValue([
        {
          anchor_sense_id: 1n,
          concept_id: 99n,
          position: 1,
          sense_language_id: 2,
          meaning_vi: 'chạy',
          meaning_source: 'source',
        },
      ]);
      deck.hasCuratedConceptMapping.mockResolvedValue(false);

      await expect(
        service.cloneFromDeck(1n, { deck_id: '1' }),
      ).rejects.toMatchObject({ code: 'DECK_CONCEPT_INVALID' });
      expect(tx.collection.create).not.toHaveBeenCalled();
    });

    it('tạo collection cloned + items/faces/srs_state qua createMany', async () => {
      const { service, prisma, tx, deck } = createSetup();
      prisma.userSettings.findUnique.mockResolvedValue({
        activeProfileId: '01a0dc8a-718f-7acd-a588-2cf077898399',
      });
      deck.findPublished.mockResolvedValue(deckRow);
      deck.findItems.mockResolvedValue([
        {
          anchor_sense_id: 1n,
          concept_id: 1n,
          position: 1,
          sense_language_id: 2,
          meaning_vi: 'chạy',
          meaning_source: 'source',
        },
        {
          anchor_sense_id: 5n,
          concept_id: 5n,
          position: 2,
          sense_language_id: 2,
          meaning_vi: 'ăn',
          meaning_source: 'source',
        },
      ]);
      tx.collection.create.mockImplementation(
        (args: { data: Record<string, unknown> }) =>
          Promise.resolve(collectionRow({ ...args.data })),
      );

      const result = await service.cloneFromDeck(1n, { deck_id: '1' });

      const collectionArgs = firstArg<{
        data: {
          kind: string;
          clonedFromDeckId: bigint;
          itemCount: number;
          name: string;
        };
      }>(tx.collection.create);
      expect(collectionArgs.data).toMatchObject({
        kind: 'cloned',
        clonedFromDeckId: 1n,
        itemCount: 2,
        name: 'JLPT N5 (demo)',
      });

      const itemsArgs = firstArg<{ data: unknown[] }>(
        tx.collectionItem.createMany,
      );
      expect(itemsArgs.data).toHaveLength(2);
      expect(itemsArgs.data[0]).toMatchObject({
        anchorSenseId: 1n,
        meaningVi: 'chạy',
        addedFromDeckId: 1n,
      });

      const facesArgs = firstArg<{ data: unknown[] }>(
        tx.collectionItemFace.createMany,
      );
      expect(facesArgs.data).toHaveLength(2);
      expect(facesArgs.data[0]).toMatchObject({
        senseId: 1n,
        languageId: 2,
        role: 'primary',
      });

      const srsArgs = firstArg<{ data: unknown[] }>(tx.srsState.createMany);
      expect(srsArgs.data).toHaveLength(4); // 2 item × 1 face × 2 chiều
      expect(srsArgs.data[0]).toMatchObject({
        direction: 'recognize',
        state: 'new',
      });
      expect(
        srsArgs.data.filter(
          (row) => (row as { direction: string }).direction === 'recall',
        ),
      ).toHaveLength(2);

      expect(result).toMatchObject({
        kind: 'cloned',
        item_count: 2,
      });
    });

    it('transaction nhận timeout dài cho deck lớn', async () => {
      const { service, prisma, tx, deck } = createSetup();
      prisma.userSettings.findUnique.mockResolvedValue({
        activeProfileId: '01a0dc8a-718f-7acd-a588-2cf077898399',
      });
      deck.findPublished.mockResolvedValue(deckRow);
      deck.findItems.mockResolvedValue([]);
      tx.collection.create.mockResolvedValue(
        collectionRow({ itemCount: 0, kind: 'cloned' }),
      );

      await service.cloneFromDeck(1n, { deck_id: '1' });

      const call = prisma.$transaction.mock.calls[0] as unknown[];
      const options = call[1] as { timeout?: number } | undefined;
      expect(options?.timeout).toBeGreaterThanOrEqual(20000);
    });
  });
});
