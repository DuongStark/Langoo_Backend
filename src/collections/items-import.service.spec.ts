import { HttpStatus } from '@nestjs/common';
import { QuizBankRepository } from '../ai/quiz/bank/quiz-bank.repository';
import { DomainException } from '../common/errors/domain.exception';
import { PrismaService } from '../db/prisma.service';
import { CollectionsService } from './collections.service';
import { ItemsImportService } from './items-import.service';
import {
  ImportLexemeCandidate,
  ImportTopSenseRow,
  ItemImportLookupRepository,
} from './repositories/item-import-lookup.repository';
import { CollectionResponse } from './types/collections.types';

const COLLECTION_ID = '01a0dc8a-718f-7acd-a588-2cf077898399';
const PROFILE_ID = '01a0dc8a-718f-7acd-a588-2cf077898300';

function mockCollectionResponse(
  overrides: Partial<CollectionResponse> = {},
): CollectionResponse {
  return {
    id: COLLECTION_ID,
    profile_id: PROFILE_ID,
    owner_id: '1',
    name: 'Kanji Shit',
    description: null,
    kind: 'personal',
    cloned_from_deck_id: null,
    cloned_from_collection_id: null,
    is_public: false,
    item_count: 2,
    visible_item_count: 2,
    created_at: '2026-11-19T00:00:00.000Z',
    updated_at: '2026-11-19T00:00:00.000Z',
    archived_at: null,
    ...overrides,
  };
}

function candidate(
  overrides: Partial<ImportLexemeCandidate> = {},
): ImportLexemeCandidate {
  return {
    lexeme_id: 100n,
    language_id: 2,
    lemma: '性質',
    reading: 'せいしつ',
    pos: 'noun',
    frequency_rank: 2412,
    match_source: 1,
    matched_key: '性質',
    is_jmdict: true,
    has_vi_gloss: true,
    en_learner_rank: null,
    ...overrides,
  };
}

function topSense(
  overrides: Partial<ImportTopSenseRow> = {},
): ImportTopSenseRow {
  return {
    lexeme_id: 100n,
    sense_id: 149507n,
    language_id: 2,
    lemma: '性質',
    reading: 'せいしつ',
    pos: 'noun',
    concept_id: null,
    meaning_vi: 'tính chất, bản chất',
    meaning_source: 'machine',
    ...overrides,
  };
}

function createSetup(profileOverrides?: {
  primaryLanguageId?: number;
  secondaryLanguageId?: number | null;
}) {
  const profile = {
    id: PROFILE_ID,
    primaryLanguageId: profileOverrides?.primaryLanguageId ?? 2,
    secondaryLanguageId:
      profileOverrides?.secondaryLanguageId !== undefined
        ? profileOverrides.secondaryLanguageId
        : 1,
  };

  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    collection: {
      findFirst: jest.fn().mockResolvedValue({
        id: COLLECTION_ID,
        profileId: PROFILE_ID,
      }),
      create: jest.fn().mockResolvedValue({ id: COLLECTION_ID }),
      update: jest.fn().mockResolvedValue({ id: COLLECTION_ID, itemCount: 2 }),
    },
    studyProfile: {
      findFirst: jest.fn().mockResolvedValue(profile),
    },
    collectionItem: {
      findMany: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _max: { position: 0 } }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    collectionItemFace: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    srsState: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };

  const prisma = {
    collection: {
      findFirst: jest.fn().mockResolvedValue({
        id: COLLECTION_ID,
        profileId: PROFILE_ID,
        itemCount: 0,
      }),
    },
    studyProfile: {
      findFirst: jest.fn().mockResolvedValue(profile),
    },
    userSettings: {
      findUnique: jest.fn().mockResolvedValue({ activeProfileId: PROFILE_ID }),
    },
    $transaction: jest.fn((cb: (client: typeof tx) => unknown) =>
      Promise.resolve(cb(tx)),
    ),
  };

  const lookupRepo = {
    findLexemeCandidates: jest.fn().mockResolvedValue([]),
    findTopSensesByLexemeIds: jest.fn().mockResolvedValue([]),
    findExistingWordsInLanguages: jest.fn().mockResolvedValue(new Set()),
  };

  const collectionsService = {
    get: jest.fn().mockResolvedValue(mockCollectionResponse()),
  };

  const quizBankRepo = {
    enqueueBatchImportedSenses: jest.fn().mockResolvedValue(1),
  };

  const service = new ItemsImportService(
    prisma as unknown as PrismaService,
    lookupRepo as unknown as ItemImportLookupRepository,
    collectionsService as unknown as CollectionsService,
    quizBankRepo as unknown as QuizBankRepository,
  );

  return { service, prisma, tx, lookupRepo, collectionsService, quizBankRepo };
}

describe('ItemsImportService', () => {
  it('prefers exact POS match when multiple lexemes share the same word', async () => {
    const { service, lookupRepo, tx, quizBankRepo } = createSetup();
    lookupRepo.findLexemeCandidates.mockResolvedValue([
      candidate({
        lexeme_id: 10n,
        language_id: 1,
        lemma: 'go',
        reading: null,
        pos: 'verb',
        frequency_rank: 101,
        matched_key: 'go',
        is_jmdict: false,
        en_learner_rank: 1,
      }),
      candidate({
        lexeme_id: 11n,
        language_id: 1,
        lemma: 'go',
        reading: null,
        pos: 'noun',
        frequency_rank: 101,
        matched_key: 'go',
        is_jmdict: false,
        en_learner_rank: 3,
      }),
    ]);
    lookupRepo.findTopSensesByLexemeIds.mockResolvedValue([
      topSense({
        lexeme_id: 11n,
        sense_id: 5002n,
        language_id: 1,
        lemma: 'go',
        reading: null,
        pos: 'noun',
        meaning_vi: 'sự thử (làm gì)',
      }),
    ]);

    const res = await service.importIntoCollection(1n, COLLECTION_ID, {
      items: [{ word: 'go', pos: 'n' }],
    });

    expect(res.added_count).toBe(1);
    expect(res.added[0]).toMatchObject({
      word: 'go',
      sense_id: '5002',
      pos: 'noun',
      pos_matched: true,
    });
    expect(tx.srsState.createMany).toHaveBeenCalledTimes(1);
    expect(quizBankRepo.enqueueBatchImportedSenses).toHaveBeenCalledWith([
      { senseId: 5002n, languageId: 1 },
    ]);
  });

  it('falls back to best surface match when POS does not match any candidate', async () => {
    const { service, lookupRepo } = createSetup();
    lookupRepo.findLexemeCandidates.mockResolvedValue([
      candidate({
        lexeme_id: 194212n,
        lemma: '豪快',
        reading: 'ごうかい',
        pos: 'adjective',
        matched_key: '豪快',
      }),
    ]);
    lookupRepo.findTopSensesByLexemeIds.mockResolvedValue([
      topSense({
        lexeme_id: 194212n,
        sense_id: 143771n,
        lemma: '豪快',
        reading: 'ごうかい',
        pos: 'adjective',
        meaning_vi: 'hào sảng',
      }),
    ]);

    const res = await service.importIntoCollection(1n, COLLECTION_ID, {
      items: [{ word: '豪快', pos: 'noun' }],
    });

    expect(res.added_count).toBe(1);
    expect(res.added[0]).toMatchObject({
      sense_id: '143771',
      pos: 'adjective',
      pos_matched: false,
    });
    expect(res.not_found_count).toBe(0);
  });

  it('prioritizes first reading in Mazii multi-reading cell (支える: ささえる つかえる)', async () => {
    const { service, lookupRepo } = createSetup();
    lookupRepo.findLexemeCandidates.mockResolvedValue([
      candidate({
        lexeme_id: 206982n,
        lemma: '閊える',
        reading: 'つかえる',
        pos: 'verb',
        frequency_rank: 35238,
        match_source: 2,
        matched_key: '支える',
      }),
      candidate({
        lexeme_id: 127909n,
        lemma: '支える',
        reading: 'ささえる',
        pos: 'verb',
        frequency_rank: 1678,
        match_source: 1,
        matched_key: '支える',
      }),
    ]);
    lookupRepo.findTopSensesByLexemeIds.mockResolvedValue([
      topSense({
        lexeme_id: 127909n,
        sense_id: 18487n,
        lemma: '支える',
        reading: 'ささえる',
        pos: 'verb',
        meaning_vi: 'chống đỡ, đỡ',
      }),
    ]);

    const res = await service.importIntoCollection(1n, COLLECTION_ID, {
      items: [
        { word: '支える', reading: 'ささえる つかえる', source_type: 'word' },
      ],
    });

    expect(res.added_count).toBe(1);
    expect(res.added[0].sense_id).toBe('18487');
    expect(res.added[0].reading).toBe('ささえる');
  });

  it('deduplicates within request and against existing collection items, and reports not_found', async () => {
    const { service, lookupRepo, tx } = createSetup({
      primaryLanguageId: 2,
      secondaryLanguageId: null,
    });
    tx.collectionItem.findMany.mockResolvedValue([{ anchorSenseId: 13790n }]);
    lookupRepo.findLexemeCandidates.mockResolvedValue([
      candidate({
        lexeme_id: 119894n,
        lemma: '性質',
        reading: 'せいしつ',
        matched_key: '性質',
      }),
      candidate({
        lexeme_id: 128907n,
        lemma: '教員',
        reading: 'きょういん',
        matched_key: '教員',
      }),
    ]);
    lookupRepo.findTopSensesByLexemeIds.mockResolvedValue([
      topSense({
        lexeme_id: 119894n,
        sense_id: 149507n,
        lemma: '性質',
        reading: 'せいしつ',
      }),
      topSense({
        lexeme_id: 128907n,
        sense_id: 13790n,
        lemma: '教員',
        reading: 'きょういん',
      }),
    ]);
    lookupRepo.findExistingWordsInLanguages.mockResolvedValue(
      new Set(['bank']),
    );

    const res = await service.importIntoCollection(1n, COLLECTION_ID, {
      status: 'known',
      items: [
        { word: '性質' },
        { word: '性質' },
        { word: '教員' },
        { word: 'bank' },
        { word: '〜てはいけない', source_type: 'grammar' },
        { word: 'khongtontai123' },
      ],
    });

    expect(res.total_submitted).toBe(6);
    expect(res.added_count).toBe(1);
    expect(res.skipped_duplicate_count).toBe(2);
    expect(res.not_found_count).toBe(3);

    expect(res.skipped_duplicates).toEqual([
      {
        index: 1,
        word: '性質',
        sense_id: '149507',
        lemma: '性質',
        reason: 'duplicate_in_request',
      },
      {
        index: 2,
        word: '教員',
        sense_id: '13790',
        lemma: '教員',
        reason: 'already_in_collection',
      },
    ]);

    expect(res.not_found).toEqual([
      { index: 3, word: 'bank', pos: null, reason: 'language_not_in_profile' },
      {
        index: 4,
        word: '〜てはいけない',
        pos: null,
        reason: 'unsupported_type',
      },
      {
        index: 5,
        word: 'khongtontai123',
        pos: null,
        reason: 'not_in_dictionary',
      },
    ]);

    const createCall = tx.collectionItem.createMany.mock.calls[0] as unknown[];
    const itemPayload = createCall[0] as {
      data: { status: string; position: number }[];
    };
    expect(itemPayload.data[0].status).toBe('known');
    expect(itemPayload.data[0].position).toBe(1);
  });

  it('rejects createCollectionAndImport with 422 IMPORT_NO_MATCHED_ITEMS without creating an empty collection', async () => {
    const { service, tx } = createSetup();

    await expect(
      service.createCollectionAndImport(1n, {
        name: 'Empty Import',
        items: [{ word: 'khongtontai123' }],
      }),
    ).rejects.toMatchObject({
      code: 'IMPORT_NO_MATCHED_ITEMS',
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    });

    expect(tx.collection.create).not.toHaveBeenCalled();
  });

  it('creates a new collection and inserts matched items in one transaction', async () => {
    const { service, lookupRepo, tx, collectionsService } = createSetup();
    lookupRepo.findLexemeCandidates.mockResolvedValue([
      candidate({
        lexeme_id: 119894n,
        lemma: '性質',
        reading: 'せいしつ',
        matched_key: '性質',
      }),
    ]);
    lookupRepo.findTopSensesByLexemeIds.mockResolvedValue([
      topSense({
        lexeme_id: 119894n,
        sense_id: 149507n,
        lemma: '性質',
        reading: 'せいしつ',
      }),
    ]);

    const res = await service.createCollectionAndImport(1n, {
      name: 'Kanji Shit',
      items: [{ word: '性質', note: 'từ N2' }, { word: 'khongtontai' }],
    });

    expect(tx.collection.create).toHaveBeenCalledTimes(1);
    expect(tx.collectionItem.createMany).toHaveBeenCalledTimes(1);
    expect(tx.collectionItemFace.createMany).toHaveBeenCalledTimes(1);
    expect(tx.srsState.createMany).toHaveBeenCalledTimes(1);
    expect(collectionsService.get).toHaveBeenCalledTimes(1);
    expect(res.added_count).toBe(1);
    expect(res.not_found_count).toBe(1);
    expect(res.not_found[0]).toMatchObject({
      word: 'khongtontai',
      reason: 'not_in_dictionary',
    });
  });

  it('does not fail import when quiz bank pre-warm throws', async () => {
    const { service, lookupRepo, quizBankRepo } = createSetup();
    lookupRepo.findLexemeCandidates.mockResolvedValue([candidate()]);
    lookupRepo.findTopSensesByLexemeIds.mockResolvedValue([topSense()]);
    quizBankRepo.enqueueBatchImportedSenses.mockRejectedValue(
      new Error('db busy'),
    );

    const res = await service.importIntoCollection(1n, COLLECTION_ID, {
      items: [{ word: '性質' }],
    });

    expect(res.added_count).toBe(1);
  });

  it('throws COLLECTION_NOT_FOUND when collection is not owned', async () => {
    const { service, prisma } = createSetup();
    prisma.collection.findFirst.mockResolvedValue(null);

    await expect(
      service.importIntoCollection(1n, COLLECTION_ID, {
        items: [{ word: '性質' }],
      }),
    ).rejects.toBeInstanceOf(DomainException);
  });
});
