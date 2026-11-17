import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../common/errors/domain.exception';
import { PrismaService } from '../db/prisma.service';
import { GamificationService } from '../gamification/gamification.service';
import { DueRepository } from '../srs/repositories/due.repository';
import { ReviewEngine } from '../srs/review-engine.service';
import { SrsService } from '../srs/srs.service';
import { SessionSourceRepository } from './repositories/session-source.repository';
import { SessionsService } from './sessions.service';

interface TxMock {
  studySession: {
    findFirst: jest.Mock;
    update: jest.Mock;
  };
  studySessionItem: {
    findUniqueOrThrow: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
    deleteMany: jest.Mock;
  };
  collectionItemFace: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
  };
  collectionItem: {
    delete: jest.Mock;
  };
  collection: {
    update: jest.Mock;
  };
  $queryRaw: jest.Mock;
}

const NOW = new Date('2026-10-28T00:00:00.000Z');
const SESSION_ID = '01a18014-bdee-72d8-9891-b3fefa8ec160';
const COLLECTION_ID = '01a18014-bdef-70dc-b9fd-0ab4c6937100';
const ITEM_ID = '01a18014-bdef-70dc-b9fd-0ab4c6937199';
const FACE_1_ID = '01a18014-bdef-70dc-b9fd-0ab4c6937201';
const FACE_2_ID = '01a18014-bdef-70dc-b9fd-0ab4c6937202';
const USER_ID = 100n;

function createSetup() {
  const tx: TxMock = {
    studySession: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    studySessionItem: {
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      deleteMany: jest.fn(),
    },
    collectionItemFace: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    collectionItem: {
      delete: jest.fn(),
    },
    collection: {
      update: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };

  const prisma = {
    studySession: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn((...args: unknown[]) => {
      const run = args[0] as (client: TxMock) => Promise<unknown>;
      return run(tx);
    }),
  };

  const srs = {} as unknown as SrsService;
  const dueRepo = {} as unknown as DueRepository;
  const sourceRepo = {} as unknown as SessionSourceRepository;
  const reviewEngine = {} as unknown as ReviewEngine;
  const gamification = {} as unknown as GamificationService;

  const service = new SessionsService(
    prisma as unknown as PrismaService,
    srs,
    dueRepo,
    sourceRepo,
    reviewEngine,
    gamification,
  );

  return { service, tx, prisma };
}

describe('SessionsService — removeWord (M7.3)', () => {
  it('M11.3 returns a pending conflict for the next unpublished ordinal', async () => {
    const { service, tx } = createSetup();
    tx.studySession.findFirst.mockResolvedValue({
      id: SESSION_ID,
      userId: USER_ID,
      kind: 'quiz',
      status: 'in_progress',
      itemCount: 3,
      settings: { quiz_version: 'm11.3-v3', generation_pending: true },
      items: [],
    });
    await expect(
      service.answer(USER_ID, SESSION_ID, { ordinal: 2, option_index: 0 }),
    ).rejects.toMatchObject({ code: 'QUIZ_QUESTION_PENDING' });
  });

  it('M11.3 blocks manual completion while generation is pending', async () => {
    const { service, tx } = createSetup();
    tx.studySession.findFirst.mockResolvedValue({
      id: SESSION_ID,
      userId: USER_ID,
      kind: 'quiz',
      status: 'in_progress',
      itemCount: 3,
      settings: { quiz_version: 'm11.3-v3', generation_pending: true },
      items: [],
    });
    await expect(service.finish(USER_ID, SESSION_ID)).rejects.toMatchObject({
      code: 'QUIZ_GENERATION_PENDING',
    });
    expect(tx.studySession.update).not.toHaveBeenCalled();
  });

  it('M11.3 hides answer, correctness, partial credit and totals until the attempt ends', async () => {
    const { service, prisma } = createSetup();
    prisma.studySession.findFirst.mockResolvedValue({
      id: SESSION_ID,
      userId: USER_ID,
      kind: 'quiz',
      mode: 'multiple_choice',
      profileId: 'profile-1',
      collectionId: COLLECTION_ID,
      quizId: 'q',
      status: 'in_progress',
      itemCount: 2,
      correctCount: 1,
      score: 100,
      xpAwarded: 0,
      settings: { quiz_version: 'm11.3-v3' },
      startedAt: NOW,
      finishedAt: null,
      items: [
        {
          id: 10n,
          ordinal: 1,
          srsId: null,
          faceId: null,
          prompt: { skill: 'context_cloze' },
          userAnswer: {
            option_index: 0,
            _quiz_credit: { earned: 1, possible: 1 },
          },
          correctAnswer: { index: 0, text: 'secret' },
          isCorrect: true,
          rating: 3,
          elapsedMs: 1,
          answeredAt: NOW,
        },
      ],
    });
    const response = await service.get(USER_ID, SESSION_ID);
    expect(response.session.correct_count).toBe(0);
    expect(response.session.score).toBeNull();
    expect(response.items[0].is_correct).toBeNull();
    expect(response.items[0].rating).toBeNull();
    expect(response.items[0]).not.toHaveProperty('correct_answer');
    expect(JSON.stringify(response)).not.toContain('_quiz_credit');
    await expect(
      service.listItems(USER_ID, SESSION_ID, { isCorrect: true }),
    ).rejects.toMatchObject({ code: 'QUIZ_FEEDBACK_DEFERRED' });
  });
  it('xoá từ và 1 thẻ thành công khỏi phiên flashcard đang học', async () => {
    const { service, tx } = createSetup();

    tx.studySession.findFirst.mockResolvedValue({
      id: SESSION_ID,
      userId: USER_ID,
      kind: 'review',
      mode: 'flashcard',
      profileId: 'profile-1',
      collectionId: COLLECTION_ID,
      quizId: null,
      status: 'in_progress',
      itemCount: 2,
      correctCount: 0,
      score: null,
      xpAwarded: 0,
      settings: {},
      startedAt: NOW,
      finishedAt: null,
      items: [
        {
          id: 10n,
          ordinal: 1,
          faceId: FACE_1_ID,
          answeredAt: null,
          isCorrect: null,
        },
        {
          id: 11n,
          ordinal: 2,
          faceId: 'face-other',
          answeredAt: null,
          isCorrect: null,
        },
      ],
    });

    tx.collectionItemFace.findUnique.mockResolvedValue({
      id: FACE_1_ID,
      item: {
        id: ITEM_ID,
        collectionId: COLLECTION_ID,
        collection: { ownerId: USER_ID },
      },
    });

    tx.collectionItemFace.findMany.mockResolvedValue([{ id: FACE_1_ID }]);
    tx.studySessionItem.count.mockResolvedValue(0);

    tx.studySession.update.mockResolvedValue({
      id: SESSION_ID,
      userId: USER_ID,
      kind: 'review',
      mode: 'flashcard',
      profileId: 'profile-1',
      collectionId: COLLECTION_ID,
      quizId: null,
      status: 'in_progress',
      itemCount: 1,
      correctCount: 0,
      score: null,
      xpAwarded: 0,
      settings: {},
      startedAt: NOW,
      finishedAt: null,
    });

    const result = await service.removeWord(USER_ID, SESSION_ID, 1);

    expect(result.item_id).toBe(ITEM_ID);
    expect(result.collection_id).toBe(COLLECTION_ID);
    expect(result.removed_ordinals).toEqual([1]);
    expect(result.session.item_count).toBe(1);
    expect(result.session.status).toBe('in_progress');

    expect(tx.collectionItem.delete).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
    });
    expect(tx.collection.update).toHaveBeenCalledWith({
      where: { id: COLLECTION_ID },
      data: { itemCount: { decrement: 1 } },
    });
    expect(tx.studySessionItem.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: [10n] } },
    });
    expect(tx.studySession.update).toHaveBeenCalledWith({
      where: { id: SESSION_ID },
      data: {
        itemCount: 1,
        correctCount: 0,
        status: 'in_progress',
        finishedAt: null,
        score: null,
      },
    });
  });

  it('xoá từ có nhiều thẻ (recognize + recall) trong cùng 1 phiên', async () => {
    const { service, tx } = createSetup();

    tx.studySession.findFirst.mockResolvedValue({
      id: SESSION_ID,
      userId: USER_ID,
      kind: 'practice',
      mode: 'flashcard',
      profileId: 'profile-1',
      collectionId: COLLECTION_ID,
      quizId: null,
      status: 'in_progress',
      itemCount: 3,
      correctCount: 0,
      score: null,
      xpAwarded: 0,
      settings: {},
      startedAt: NOW,
      finishedAt: null,
      items: [
        {
          id: 10n,
          ordinal: 1,
          faceId: FACE_1_ID,
          answeredAt: null,
          isCorrect: null,
        },
        {
          id: 11n,
          ordinal: 2,
          faceId: 'face-other',
          answeredAt: null,
          isCorrect: null,
        },
        {
          id: 12n,
          ordinal: 3,
          faceId: FACE_2_ID,
          answeredAt: null,
          isCorrect: null,
        },
      ],
    });

    tx.collectionItemFace.findUnique.mockResolvedValue({
      id: FACE_1_ID,
      item: {
        id: ITEM_ID,
        collectionId: COLLECTION_ID,
        collection: { ownerId: USER_ID },
      },
    });

    tx.collectionItemFace.findMany.mockResolvedValue([
      { id: FACE_1_ID },
      { id: FACE_2_ID },
    ]);
    tx.studySessionItem.count.mockResolvedValue(0);

    tx.studySession.update.mockResolvedValue({
      id: SESSION_ID,
      userId: USER_ID,
      kind: 'practice',
      mode: 'flashcard',
      profileId: 'profile-1',
      collectionId: COLLECTION_ID,
      quizId: null,
      status: 'in_progress',
      itemCount: 1,
      correctCount: 0,
      score: null,
      xpAwarded: 0,
      settings: {},
      startedAt: NOW,
      finishedAt: null,
    });

    const result = await service.removeWord(USER_ID, SESSION_ID, 1);

    expect(result.removed_ordinals).toEqual([1, 3]);
    expect(tx.studySessionItem.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: [10n, 12n] } },
    });
    expect(tx.studySession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ itemCount: 1 }) as unknown,
      }),
    );
  });

  it('hoàn thành phiên nếu xoá thẻ cuối cùng', async () => {
    const { service, tx } = createSetup();

    tx.studySession.findFirst.mockResolvedValue({
      id: SESSION_ID,
      userId: USER_ID,
      kind: 'review',
      mode: 'flashcard',
      profileId: 'profile-1',
      collectionId: COLLECTION_ID,
      quizId: null,
      status: 'in_progress',
      itemCount: 1,
      correctCount: 0,
      score: null,
      xpAwarded: 0,
      settings: {},
      startedAt: NOW,
      finishedAt: null,
      items: [
        {
          id: 10n,
          ordinal: 1,
          faceId: FACE_1_ID,
          answeredAt: null,
          isCorrect: null,
        },
      ],
    });

    tx.collectionItemFace.findUnique.mockResolvedValue({
      id: FACE_1_ID,
      item: {
        id: ITEM_ID,
        collectionId: COLLECTION_ID,
        collection: { ownerId: USER_ID },
      },
    });

    tx.collectionItemFace.findMany.mockResolvedValue([{ id: FACE_1_ID }]);
    tx.studySessionItem.count.mockResolvedValue(0);

    tx.studySession.update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({
        id: SESSION_ID,
        userId: USER_ID,
        kind: 'review',
        mode: 'flashcard',
        profileId: 'profile-1',
        collectionId: COLLECTION_ID,
        quizId: null,
        status: data.status,
        itemCount: data.itemCount,
        correctCount: data.correctCount,
        score: data.score,
        xpAwarded: 0,
        settings: {},
        startedAt: NOW,
        finishedAt: data.finishedAt,
      }),
    );

    const result = await service.removeWord(USER_ID, SESSION_ID, 1);

    expect(result.session.status).toBe('completed');
    expect(result.session.item_count).toBe(0);
    expect(result.session.score).toBe(100);
  });

  it('điều chỉnh correctCount nếu từ đã trả lời đúng trước đó bị xoá', async () => {
    const { service, tx } = createSetup();

    tx.studySession.findFirst.mockResolvedValue({
      id: SESSION_ID,
      userId: USER_ID,
      kind: 'review',
      mode: 'flashcard',
      profileId: 'profile-1',
      collectionId: COLLECTION_ID,
      quizId: null,
      status: 'in_progress',
      itemCount: 2,
      correctCount: 1,
      score: null,
      xpAwarded: 10,
      settings: {},
      startedAt: NOW,
      finishedAt: null,
      items: [
        {
          id: 10n,
          ordinal: 1,
          faceId: FACE_1_ID,
          answeredAt: NOW,
          isCorrect: true,
        },
        {
          id: 11n,
          ordinal: 2,
          faceId: 'face-other',
          answeredAt: null,
          isCorrect: null,
        },
      ],
    });

    tx.collectionItemFace.findUnique.mockResolvedValue({
      id: FACE_1_ID,
      item: {
        id: ITEM_ID,
        collectionId: COLLECTION_ID,
        collection: { ownerId: USER_ID },
      },
    });

    tx.collectionItemFace.findMany.mockResolvedValue([{ id: FACE_1_ID }]);
    tx.studySessionItem.count.mockResolvedValue(0);

    tx.studySession.update.mockResolvedValue({
      id: SESSION_ID,
      userId: USER_ID,
      kind: 'review',
      mode: 'flashcard',
      profileId: 'profile-1',
      collectionId: COLLECTION_ID,
      quizId: null,
      status: 'in_progress',
      itemCount: 1,
      correctCount: 0,
      score: null,
      xpAwarded: 10,
      settings: {},
      startedAt: NOW,
      finishedAt: null,
    });

    const result = await service.removeWord(USER_ID, SESSION_ID, 1);

    expect(result.session.correct_count).toBe(0);
    expect(tx.studySession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          correctCount: 0,
          itemCount: 1,
        }) as unknown,
      }),
    );
  });

  it('ném SESSION_NOT_FOUND nếu không tìm thấy phiên', async () => {
    const { service, tx } = createSetup();
    tx.studySession.findFirst.mockResolvedValue(null);

    await expect(service.removeWord(USER_ID, SESSION_ID, 1)).rejects.toThrow(
      new DomainException(
        'SESSION_NOT_FOUND',
        'Không tìm thấy phiên ôn',
        HttpStatus.NOT_FOUND,
      ),
    );
  });

  it('ném SESSION_CLOSED nếu phiên đã hoàn tất hoặc bị huỷ', async () => {
    const { service, tx } = createSetup();
    tx.studySession.findFirst.mockResolvedValue({
      id: SESSION_ID,
      userId: USER_ID,
      status: 'completed',
      items: [],
    });

    await expect(service.removeWord(USER_ID, SESSION_ID, 1)).rejects.toThrow(
      new DomainException(
        'SESSION_CLOSED',
        'Phiên đã kết thúc',
        HttpStatus.CONFLICT,
      ),
    );
  });

  it('ném SESSION_ACTION_UNSUPPORTED nếu phiên là quiz', async () => {
    const { service, tx } = createSetup();
    tx.studySession.findFirst.mockResolvedValue({
      id: SESSION_ID,
      userId: USER_ID,
      kind: 'quiz',
      status: 'in_progress',
      items: [],
    });

    await expect(service.removeWord(USER_ID, SESSION_ID, 1)).rejects.toThrow(
      new DomainException(
        'SESSION_ACTION_UNSUPPORTED',
        'Không thể xoá từ trong phiên quiz',
        HttpStatus.BAD_REQUEST,
      ),
    );
  });

  it('ném SESSION_ITEM_NOT_FOUND nếu ordinal không tồn tại', async () => {
    const { service, tx } = createSetup();
    tx.studySession.findFirst.mockResolvedValue({
      id: SESSION_ID,
      userId: USER_ID,
      kind: 'review',
      status: 'in_progress',
      items: [{ id: 10n, ordinal: 1, faceId: FACE_1_ID }],
    });

    await expect(service.removeWord(USER_ID, SESSION_ID, 99)).rejects.toThrow(
      new DomainException(
        'SESSION_ITEM_NOT_FOUND',
        'Không tìm thấy câu hỏi trong phiên',
        HttpStatus.NOT_FOUND,
      ),
    );
  });

  it('ném COLLECTION_FORBIDDEN nếu bộ sưu tập không thuộc về user', async () => {
    const { service, tx } = createSetup();
    tx.studySession.findFirst.mockResolvedValue({
      id: SESSION_ID,
      userId: USER_ID,
      kind: 'review',
      status: 'in_progress',
      items: [{ id: 10n, ordinal: 1, faceId: FACE_1_ID }],
    });

    tx.collectionItemFace.findUnique.mockResolvedValue({
      id: FACE_1_ID,
      item: {
        id: ITEM_ID,
        collectionId: COLLECTION_ID,
        collection: { ownerId: 999n },
      },
    });

    await expect(service.removeWord(USER_ID, SESSION_ID, 1)).rejects.toThrow(
      new DomainException(
        'COLLECTION_FORBIDDEN',
        'Bạn không có quyền xoá từ khỏi bộ sưu tập này',
        HttpStatus.FORBIDDEN,
      ),
    );
  });
});
