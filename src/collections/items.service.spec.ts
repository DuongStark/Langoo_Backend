import { LanguageRepository } from '../db/repositories/language.repository';
import { PrismaService } from '../db/prisma.service';
import { encodeCursor } from '../common/pagination/cursor';
import { ItemsService } from './items.service';
import { SenseLookupRepository } from './repositories/sense-lookup.repository';

interface TxMock {
  collectionItem: {
    create: jest.Mock;
    aggregate: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    deleteMany: jest.Mock;
  };
  collectionItemFace: { create: jest.Mock };
  srsState: { createMany: jest.Mock };
  collectionItemTag: { deleteMany: jest.Mock; createMany: jest.Mock };
  collection: { update: jest.Mock };
  studyProfile: { findFirst: jest.Mock };
  $queryRaw: jest.Mock;
}

function firstArg<T>(mock: jest.Mock): T {
  const call = mock.mock.calls[0] as unknown[];
  return call[0] as T;
}

const NOW = new Date('2026-09-27T00:00:00.000Z');
const COLLECTION_ID = '01a0dc8a-718f-7acd-a588-2cf077898399';

function collectionRow() {
  return { id: COLLECTION_ID, profileId: 'profile-1', ownerId: 1n };
}

function itemRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '01a0dc8a-7191-7e18-93b0-32e8378986fe',
    collectionId: COLLECTION_ID,
    conceptId: 1n,
    anchorSenseId: 1n,
    meaningVi: 'chạy',
    meaningSource: 'user',
    note: null,
    status: 'learning',
    position: 1,
    addedFromDeckId: null,
    createdAt: NOW,
    updatedAt: NOW,
    faces: [
      { id: 'face-1', senseId: 1n, languageId: 2, role: 'primary' },
      { id: 'face-2', senseId: 2n, languageId: 1, role: 'secondary' },
    ],
    itemTags: [{ tagId: 5n }],
    ...overrides,
  };
}

function createSetup(): {
  service: ItemsService;
  prisma: {
    collection: { findFirst: jest.Mock };
    collectionItem: { findFirst: jest.Mock; findMany: jest.Mock };
    tag: { findMany: jest.Mock };
    studyProfile: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  tx: TxMock;
  senseLookup: {
    findManyByIds: jest.Mock;
    findCuratedPair: jest.Mock;
    hasCuratedConceptMapping: jest.Mock;
  };
  languages: { findExistingIds: jest.Mock };
} {
  const tx: TxMock = {
    collectionItem: {
      create: jest.fn(),
      aggregate: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    collectionItemFace: { create: jest.fn() },
    srsState: { createMany: jest.fn() },
    collectionItemTag: { deleteMany: jest.fn(), createMany: jest.fn() },
    collection: { update: jest.fn() },
    studyProfile: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'profile-1',
        primaryLanguageId: 2,
        secondaryLanguageId: 1,
      }),
    },
    $queryRaw: jest.fn(),
  };
  const prisma = {
    collection: { findFirst: jest.fn() },
    collectionItem: { findFirst: jest.fn(), findMany: jest.fn() },
    tag: { findMany: jest.fn() },
    studyProfile: tx.studyProfile,
    $transaction: jest.fn((fn: (client: TxMock) => Promise<unknown>) => fn(tx)),
  };
  const senseLookup = {
    findManyByIds: jest.fn(),
    findCuratedPair: jest.fn().mockResolvedValue({
      concept_id: 1n,
      confidence: 1,
    }),
    hasCuratedConceptMapping: jest.fn().mockResolvedValue(true),
  };
  const languages = { findExistingIds: jest.fn() };
  const service = new ItemsService(
    prisma as unknown as PrismaService,
    senseLookup as unknown as SenseLookupRepository,
    languages as unknown as LanguageRepository,
  );
  return { service, prisma, tx, senseLookup, languages };
}

describe('ItemsService', () => {
  describe('add', () => {
    it('EN add to JA-only rejects before item/face/SRS writes', async () => {
      const { service, prisma, tx, senseLookup } = createSetup();
      prisma.collection.findFirst.mockResolvedValue(collectionRow());
      tx.studyProfile.findFirst.mockResolvedValue({
        primaryLanguageId: 2,
        secondaryLanguageId: null,
      });
      senseLookup.findManyByIds.mockResolvedValue([
        { sense_id: 2n, language_id: 1, lemma: 'run', concept_id: null },
      ]);
      await expect(
        service.add(1n, COLLECTION_ID, { sense_id: '2', meaning_vi: 'chạy' }),
      ).rejects.toMatchObject({ code: 'COLLECTION_LANGUAGE_NOT_IN_PROFILE' });
      expect(tx.collectionItem.create).not.toHaveBeenCalled();
      expect(tx.collectionItemFace.create).not.toHaveBeenCalled();
      expect(tx.srsState.createMany).not.toHaveBeenCalled();
    });

    it('2 sense khác ngôn ngữ → 1 item + 2 face + 4 srs_state + item_count +1', async () => {
      const { service, prisma, tx, senseLookup } = createSetup();
      prisma.collection.findFirst.mockResolvedValue(collectionRow());
      senseLookup.findManyByIds.mockResolvedValue([
        { sense_id: 1n, language_id: 2, lemma: '走る', concept_id: 1n },
        { sense_id: 2n, language_id: 1, lemma: 'run', concept_id: 1n },
      ]);
      tx.collectionItem.aggregate.mockResolvedValue({
        _max: { position: 2 },
      });
      tx.collectionItem.create.mockResolvedValue(itemRow());
      tx.collectionItemFace.create.mockResolvedValue({ id: 'face-1' });
      tx.srsState.createMany.mockResolvedValue({ count: 4 });
      tx.collection.update.mockResolvedValue({ id: COLLECTION_ID });
      prisma.collectionItem.findFirst.mockResolvedValue(itemRow());

      const result = await service.add(1n, COLLECTION_ID, {
        sense_id: '1',
        secondary_sense_id: '2',
        meaning_vi: 'chạy',
      });

      const itemArgs = firstArg<{
        data: {
          anchorSenseId: bigint;
          conceptId: bigint | null;
          position: number;
          meaningVi: string;
        };
      }>(tx.collectionItem.create);
      expect(itemArgs.data).toMatchObject({
        anchorSenseId: 1n,
        conceptId: 1n,
        position: 3,
        meaningVi: 'chạy',
      });

      expect(tx.collectionItemFace.create).toHaveBeenCalledTimes(2);
      const secondFace = tx.collectionItemFace.create.mock
        .calls[1] as unknown[];
      expect((secondFace[0] as { data: { role: string } }).data.role).toBe(
        'secondary',
      );

      const srsArgs = firstArg<{
        data: {
          faceId: string;
          direction: string;
          state: string;
          userId: bigint;
          profileId: string;
        }[];
      }>(tx.srsState.createMany);
      expect(srsArgs.data).toHaveLength(4);
      expect(
        srsArgs.data.filter((row) => row.direction === 'recognize'),
      ).toHaveLength(2);
      expect(
        srsArgs.data.filter((row) => row.direction === 'recall'),
      ).toHaveLength(2);
      expect(srsArgs.data[0]).toMatchObject({
        state: 'new',
        userId: 1n,
        profileId: 'profile-1',
      });

      const countArgs = firstArg<{
        data: { itemCount: { increment: number } };
      }>(tx.collection.update);
      expect(countArgs.data.itemCount).toEqual({ increment: 1 });

      expect(result.faces).toHaveLength(2);
      expect(result.tag_ids).toEqual(['5']);
    });

    it('secondary cùng ngôn ngữ anchor → COLLECTION_FACE_LANGUAGE_DUPLICATE', async () => {
      const { service, prisma, senseLookup } = createSetup();
      prisma.collection.findFirst.mockResolvedValue(collectionRow());
      senseLookup.findManyByIds.mockResolvedValue([
        { sense_id: 1n, language_id: 2, lemma: '走る', concept_id: 1n },
        { sense_id: 3n, language_id: 2, lemma: '経営する', concept_id: 3n },
      ]);

      await expect(
        service.add(1n, COLLECTION_ID, {
          sense_id: '1',
          secondary_sense_id: '3',
          meaning_vi: 'chạy',
        }),
      ).rejects.toMatchObject({ code: 'COLLECTION_FACE_LANGUAGE_DUPLICATE' });
    });

    it('hai sense khác ngôn ngữ nhưng không cùng cặp curated → 400', async () => {
      const { service, prisma, senseLookup } = createSetup();
      prisma.collection.findFirst.mockResolvedValue(collectionRow());
      senseLookup.findManyByIds.mockResolvedValue([
        { sense_id: 1n, language_id: 2, lemma: '走る', concept_id: 1n },
        { sense_id: 6n, language_id: 1, lemma: 'eat', concept_id: 3n },
      ]);
      senseLookup.findCuratedPair.mockResolvedValue(null);

      await expect(
        service.add(1n, COLLECTION_ID, {
          sense_id: '1',
          secondary_sense_id: '6',
          meaning_vi: 'chạy',
        }),
      ).rejects.toMatchObject({ code: 'COLLECTION_SENSE_PAIR_INVALID' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('concept chỉ được dùng khi thuộc mapping curated của anchor', async () => {
      const { service, prisma, senseLookup } = createSetup();
      prisma.collection.findFirst.mockResolvedValue(collectionRow());
      senseLookup.findManyByIds.mockResolvedValue([
        { sense_id: 1n, language_id: 2, lemma: '走る', concept_id: 1n },
      ]);
      senseLookup.hasCuratedConceptMapping.mockResolvedValue(false);

      await expect(
        service.add(1n, COLLECTION_ID, {
          sense_id: '1',
          concept_id: '3',
          meaning_vi: 'chạy',
        }),
      ).rejects.toMatchObject({ code: 'COLLECTION_CONCEPT_INVALID' });
    });

    it('sense không tồn tại → 404 SENSE_NOT_FOUND', async () => {
      const { service, prisma, senseLookup } = createSetup();
      prisma.collection.findFirst.mockResolvedValue(collectionRow());
      senseLookup.findManyByIds.mockResolvedValue([]);

      await expect(
        service.add(1n, COLLECTION_ID, { sense_id: '999999', meaning_vi: 'x' }),
      ).rejects.toMatchObject({ code: 'SENSE_NOT_FOUND' });
    });

    it('tag không thuộc user → 404 TAG_NOT_FOUND', async () => {
      const { service, prisma, senseLookup } = createSetup();
      prisma.collection.findFirst.mockResolvedValue(collectionRow());
      senseLookup.findManyByIds.mockResolvedValue([
        { sense_id: 1n, language_id: 2, lemma: '走る', concept_id: 1n },
      ]);
      prisma.tag.findMany.mockResolvedValue([]);

      await expect(
        service.add(1n, COLLECTION_ID, {
          sense_id: '1',
          meaning_vi: 'chạy',
          tag_ids: ['99'],
        }),
      ).rejects.toMatchObject({ code: 'TAG_NOT_FOUND' });
    });

    it('trùng anchor sense (P2002) → 409 ITEM_ALREADY_EXISTS', async () => {
      const { service, prisma, tx, senseLookup } = createSetup();
      prisma.collection.findFirst.mockResolvedValue(collectionRow());
      senseLookup.findManyByIds.mockResolvedValue([
        { sense_id: 1n, language_id: 2, lemma: '走る', concept_id: 1n },
      ]);
      tx.collectionItem.aggregate.mockResolvedValue({ _max: { position: 0 } });
      tx.collectionItem.create.mockRejectedValue(
        Object.assign(new Error('unique'), { code: 'P2002' }),
      );

      await expect(
        service.add(1n, COLLECTION_ID, { sense_id: '1', meaning_vi: 'chạy' }),
      ).rejects.toMatchObject({ code: 'ITEM_ALREADY_EXISTS' });
    });
  });

  describe('list', () => {
    it('JA-only projects the secondary JA face when the preserved anchor is EN', async () => {
      const { service, prisma, tx } = createSetup();
      prisma.collection.findFirst.mockResolvedValue(collectionRow());
      tx.studyProfile.findFirst.mockResolvedValue({
        primaryLanguageId: 2,
        secondaryLanguageId: null,
      });
      prisma.collectionItem.findMany.mockResolvedValue([
        itemRow({
          anchorSenseId: 2n,
          faces: [
            { id: 'face-ja', senseId: 1n, languageId: 2, role: 'secondary' },
          ],
        }),
      ]);
      const result = await service.list(1n, COLLECTION_ID, { limit: 1 });
      expect(prisma.collectionItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            collectionId: COLLECTION_ID,
            faces: { some: { languageId: { in: [2] } } },
          },
          include: {
            faces: { where: { languageId: { in: [2] } } },
            itemTags: true,
          },
          take: 2,
        }),
      );
      expect(result.data[0]).toMatchObject({
        anchor_sense_id: '2',
        display_sense_id: '1',
        faces: [{ language_id: 2 }],
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('an explicit excluded language cannot override the profile scope', async () => {
      const { service, prisma, tx, languages } = createSetup();
      prisma.collection.findFirst.mockResolvedValue(collectionRow());
      tx.studyProfile.findFirst.mockResolvedValue({
        primaryLanguageId: 2,
        secondaryLanguageId: null,
      });
      languages.findExistingIds.mockResolvedValue(new Set([1, 2]));
      prisma.collectionItem.findMany.mockResolvedValue([]);
      expect(
        (await service.list(1n, COLLECTION_ID, { language_id: 1 })).data,
      ).toEqual([]);
      expect(prisma.collectionItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            collectionId: COLLECTION_ID,
            faces: { some: { languageId: { in: [] } } },
          },
        }),
      );
    });

    it('dùng cursor keyset (position, id) + limit+1 để biết còn trang sau', async () => {
      const { service, prisma } = createSetup();
      prisma.collection.findFirst.mockResolvedValue(collectionRow());
      const rows = [
        itemRow({ id: '01a0dc8a-7191-7e18-93b0-32e8378986fe', position: 3 }),
        itemRow({ id: '01a0dc8a-7192-7e18-93b0-32e8378986fe', position: 4 }),
        itemRow({ id: '01a0dc8a-7193-7e18-93b0-32e8378986fe', position: 5 }),
      ];
      prisma.collectionItem.findMany.mockResolvedValue(rows);

      const result = await service.list(1n, COLLECTION_ID, { limit: 2 });

      const args = firstArg<{
        where: { collectionId: string; OR?: unknown[] };
        take: number;
        orderBy: unknown[];
      }>(prisma.collectionItem.findMany);
      expect(args.take).toBe(3); // limit + 1
      expect(args.where.collectionId).toBe(COLLECTION_ID);
      expect(args.where.OR).toBeUndefined();

      expect(result.data).toHaveLength(2);
      expect(result.next_cursor).toBe(
        encodeCursor({
          position: 4,
          id: '01a0dc8a-7192-7e18-93b0-32e8378986fe',
        }),
      );
    });

    it('lists the highest positions first and carries a descending cursor', async () => {
      const { service, prisma } = createSetup();
      prisma.collection.findFirst.mockResolvedValue(collectionRow());
      const rows = [
        itemRow({ id: '01a0dc8a-7193-7e18-93b0-32e8378986fe', position: 101 }),
        itemRow({ id: '01a0dc8a-7192-7e18-93b0-32e8378986fe', position: 100 }),
        itemRow({ id: '01a0dc8a-7191-7e18-93b0-32e8378986fe', position: 100 }),
      ];
      prisma.collectionItem.findMany.mockResolvedValue(rows);
      const result = await service.list(1n, COLLECTION_ID, {
        order: 'desc',
        limit: 2,
      });
      const args = firstArg<{ orderBy: unknown[]; take: number }>(
        prisma.collectionItem.findMany,
      );
      expect(args.orderBy).toEqual([{ position: 'desc' }, { id: 'desc' }]);
      expect(args.take).toBe(3);
      expect(result.data.map((x) => x.position)).toEqual([101, 100]);
      expect(result.next_cursor).toBe(
        encodeCursor({ position: 100, id: rows[1].id, order: 'desc' }),
      );
    });

    it('descending continuation excludes the boundary including tied positions', async () => {
      const { service, prisma } = createSetup();
      prisma.collection.findFirst.mockResolvedValue(collectionRow());
      prisma.collectionItem.findMany.mockResolvedValue([
        itemRow({ position: 3 }),
      ]);
      const id = '01a0dc8a-7192-7e18-93b0-32e8378986fe';
      const cursor = Buffer.from(
        JSON.stringify({ p: 3, i: id, o: 'desc' }),
      ).toString('base64url');
      const result = await service.list(1n, COLLECTION_ID, {
        order: 'desc',
        cursor,
        limit: 2,
      });
      const args = firstArg<{ where: { OR: unknown[] } }>(
        prisma.collectionItem.findMany,
      );
      expect(args.where.OR).toEqual([
        { position: { lt: 3 } },
        { position: 3, id: { lt: id } },
      ]);
      expect(result.next_cursor).toBeNull();
    });

    it('rejects changing direction or passing a legacy ascending cursor to descending', async () => {
      const { service, prisma } = createSetup();
      prisma.collection.findFirst.mockResolvedValue(collectionRow());
      const id = '01a0dc8a-7192-7e18-93b0-32e8378986fe';
      const desc = Buffer.from(
        JSON.stringify({ p: 3, i: id, o: 'desc' }),
      ).toString('base64url');
      const asc = encodeCursor({ position: 3, id });
      await expect(
        service.list(1n, COLLECTION_ID, { cursor: desc }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(
        service.list(1n, COLLECTION_ID, { cursor: asc, order: 'desc' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(prisma.collectionItem.findMany).not.toHaveBeenCalled();
    });

    it('truyền cursor → điều kiện keyset; language không tồn tại → LANGUAGE_NOT_FOUND', async () => {
      const { service, prisma, languages } = createSetup();
      prisma.collection.findFirst.mockResolvedValue(collectionRow());
      prisma.collectionItem.findMany.mockResolvedValue([]);
      const cursor = encodeCursor({
        position: 2,
        id: '01a0dc8a-7192-7e18-93b0-32e8378986fe',
      });

      await service.list(1n, COLLECTION_ID, { cursor, limit: 20 });

      const args = firstArg<{ where: { OR?: unknown[] } }>(
        prisma.collectionItem.findMany,
      );
      expect(args.where.OR).toEqual([
        { position: { gt: 2 } },
        {
          position: 2,
          id: { gt: '01a0dc8a-7192-7e18-93b0-32e8378986fe' },
        },
      ]);

      languages.findExistingIds.mockResolvedValue(new Set<number>());
      await expect(
        service.list(1n, COLLECTION_ID, { language_id: 99 }),
      ).rejects.toMatchObject({ code: 'LANGUAGE_NOT_FOUND' });
    });
  });

  describe('update / remove', () => {
    it('item không thuộc collection → 404 ITEM_NOT_FOUND', async () => {
      const { service, prisma } = createSetup();
      prisma.collection.findFirst.mockResolvedValue(collectionRow());
      prisma.collectionItem.findFirst.mockResolvedValue(null);

      await expect(
        service.update(1n, COLLECTION_ID, 'item-x', { note: 'abc' }),
      ).rejects.toMatchObject({ code: 'ITEM_NOT_FOUND' });
    });

    it('update thay toàn bộ tag_ids (deleteMany + createMany)', async () => {
      const { service, prisma, tx } = createSetup();
      prisma.collection.findFirst.mockResolvedValue(collectionRow());
      prisma.collectionItem.findFirst
        .mockResolvedValueOnce({ id: 'item-1', collectionId: COLLECTION_ID })
        .mockResolvedValueOnce(itemRow());
      prisma.tag.findMany.mockResolvedValue([{ id: 5n }, { id: 6n }]);
      tx.collectionItem.update.mockResolvedValue({ id: 'item-1' });

      const result = await service.update(1n, COLLECTION_ID, 'item-1', {
        note: 'ghi chú',
        tag_ids: ['5', '6'],
      });

      expect(tx.collectionItemTag.deleteMany).toHaveBeenCalledWith({
        where: { itemId: 'item-1' },
      });
      const tagArgs = firstArg<{ data: { itemId: string; tagId: bigint }[] }>(
        tx.collectionItemTag.createMany,
      );
      expect(tagArgs.data).toEqual([
        { itemId: 'item-1', tagId: 5n },
        { itemId: 'item-1', tagId: 6n },
      ]);
      expect(result.id).toBe('01a0dc8a-7191-7e18-93b0-32e8378986fe');
    });

    it('remove xoá item + giảm item_count', async () => {
      const { service, prisma, tx } = createSetup();
      prisma.collection.findFirst.mockResolvedValue(collectionRow());
      prisma.collectionItem.findFirst.mockResolvedValue({
        id: 'item-1',
        collectionId: COLLECTION_ID,
      });
      tx.collectionItem.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.remove(1n, COLLECTION_ID, 'item-1');

      expect(tx.collectionItem.deleteMany).toHaveBeenCalledWith({
        where: { id: 'item-1', collectionId: COLLECTION_ID },
      });
      const countArgs = firstArg<{
        data: { itemCount: { decrement: number } };
      }>(tx.collection.update);
      expect(countArgs.data.itemCount).toEqual({ decrement: 1 });
      expect(result.id).toBe('item-1');
      expect(typeof result.deleted_at).toBe('string');
    });
  });
});
