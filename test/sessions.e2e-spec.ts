import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';
import { Prisma } from '../src/generated/prisma/client';
import { SessionSourceRepository } from '../src/sessions/repositories/session-source.repository';
import { SrsService } from '../src/srs/srs.service';
import { safeTestTimezone } from './safe-timezone';

interface SessionBody {
  id: string;
  kind: string;
  mode: string;
  status: string;
  item_count: number;
  answered_count: number;
  correct_count: number;
  score: number | null;
  xp_awarded: number;
}

interface ItemBody {
  id: string;
  ordinal: number;
  face_id: string | null;
  prompt: {
    kind: string;
    direction: string;
    language: { code: string };
    options?: { index: number; text: string }[];
  };
  correct_answer?: { index?: number; text?: string; accepted?: string[] };
  is_correct: boolean | null;
  rating: number | null;
  answered_at: string | null;
}

interface SessionDetailBody {
  session: SessionBody;
  items: ItemBody[];
}

interface AnswerResultBody {
  item: ItemBody;
  srs: { state: string; due_at: string; interval_days: number };
  xp: { amount: number };
  session: SessionBody;
}

describe('Sessions (e2e — langoo_test)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;

  const runId = Date.now();
  const password = 'matkhau-e2e-123';
  let token = '';
  let tokenOther = '';
  let userId = 0n;
  let faceJa = '';
  let waterFaceJa = '';
  let waterFaceEn = '';

  async function registerUser(
    email: string,
  ): Promise<{ token: string; userId: bigint }> {
    const res = await request(server)
      .post('/v1/auth/register')
      .send({ email, password })
      .expect(201);
    const body = res.body as { user: { id: string }; access_token: string };
    return { token: body.access_token, userId: BigInt(body.user.id) };
  }

  async function createItem(
    senseId: string,
    secondarySenseId: string,
    meaning: string,
  ): Promise<{ faceJa: string; faceEn: string }> {
    const item = await request(server)
      .post(`/v1/collections/${collectionId}/items`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        sense_id: senseId,
        secondary_sense_id: secondarySenseId,
        meaning_vi: meaning,
      })
      .expect(201);
    const faces = (
      item.body as { faces: { id: string; language_id: number }[] }
    ).faces;
    return {
      faceJa: faces.find((face) => face.language_id === 2)!.id,
      faceEn: faces.find((face) => face.language_id === 1)!.id,
    };
  }

  let collectionId = '';

  async function createSession(
    mode: string,
    kind = 'practice',
    limit?: number,
  ): Promise<SessionDetailBody> {
    const res = await request(server)
      .post('/v1/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        kind,
        mode,
        collection_id: collectionId,
        ...(limit !== undefined ? { limit } : {}),
      })
      .expect(201);
    return res.body as SessionDetailBody;
  }

  async function answer(
    sessionId: string,
    body: Record<string, unknown>,
    expectStatus = 200,
  ): Promise<AnswerResultBody> {
    const res = await request(server)
      .post(`/v1/sessions/${sessionId}/answers`)
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(expectStatus);
    return res.body as AnswerResultBody;
  }

  async function dbItem(
    sessionId: string,
    ordinal: number,
  ): Promise<{ correctAnswer: Record<string, unknown> }> {
    const row = await prisma.studySessionItem.findFirstOrThrow({
      where: { sessionId, ordinal },
      select: { correctAnswer: true },
    });
    return { correctAnswer: row.correctAnswer as Record<string, unknown> };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);

    const main = await registerUser(`e2e-m7-${runId}@langoo.test`);
    const other = await registerUser(`e2e-m7-other-${runId}@langoo.test`);
    token = main.token;
    userId = main.userId;
    tokenOther = other.token;

    await request(server)
      .post('/v1/profiles')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Nhật–Việt',
        primary_language_id: 2,
        secondary_language_id: 1,
        support_language_id: 3,
      })
      .expect(201);
    // Giữ giờ địa phương ~12:00 để mốc "hết ngày" không cắt ngang test.
    await request(server)
      .patch('/v1/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ timezone: safeTestTimezone() })
      .expect(200);
    const collection = await request(server)
      .post('/v1/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bộ M7' })
      .expect(201);
    collectionId = (collection.body as { id: string }).id;

    const first = await createItem('1', '2', 'chạy'); // 走る + run
    faceJa = first.faceJa;
    await createItem('5', '6', 'ăn'); // 食べる + eat
    await createItem('7', '8', 'đi'); // 行く + go
    const water = await createItem('9', '10', 'nước'); // 水 + water
    waterFaceJa = water.faceJa;
    waterFaceEn = water.faceEn;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('flashcard (review, chấm bằng rating)', () => {
    let session: SessionDetailBody;

    it('tạo phiên review: snapshot 4 đại diện (4 mục × 1 sibling), đáp án bị ẩn', async () => {
      session = await createSession('flashcard', 'review');
      // M6.2: practice/review chọn một đại diện new/review mỗi item trước
      // limit; sibling còn lại sẽ bị bury sau lượt trả lời đầu nên không tạo
      // đề cho chúng. 4 item → 4 thẻ, không còn 4 mục × 2 mặt × 2 chiều = 16.
      expect(session.session).toMatchObject({
        kind: 'review',
        mode: 'flashcard',
        status: 'in_progress',
        item_count: 4,
        answered_count: 0,
      });
      expect(session.items).toHaveLength(4);
      expect(session.items[0].correct_answer).toBeUndefined();
      expect(session.items[0].prompt.kind).toBe('flashcard');
    });

    it('trả lời bằng rating; replay không cộng đôi', async () => {
      const result = await answer(session.session.id, {
        ordinal: 1,
        rating: 3,
        elapsed_ms: 2500,
      });
      expect(result.item).toMatchObject({ is_correct: true, rating: 3 });
      expect(result.item.correct_answer).toBeDefined();
      expect(result.srs.state).toBe('learning');
      expect(result.xp.amount).toBe(1);
      expect(result.session.answered_count).toBe(1);

      const logs = await prisma.reviewLog.count({ where: { userId } });
      const xp = await prisma.xpEvent.count({
        where: { userId, source: 'review' },
      });
      expect(logs).toBe(1);
      expect(xp).toBe(1);

      const replay = await answer(session.session.id, {
        ordinal: 1,
        rating: 3,
        elapsed_ms: 2500,
      });
      expect(replay).toEqual(result); // giữ nguyên toàn bộ response lần đầu
      expect(replay.xp.amount).toBe(1);
      expect(await prisma.reviewLog.count({ where: { userId } })).toBe(1);
      expect(
        await prisma.xpEvent.count({ where: { userId, source: 'review' } }),
      ).toBe(1);

      const conflict = await request(server)
        .post(`/v1/sessions/${session.session.id}/answers`)
        .set('Authorization', `Bearer ${token}`)
        .send({ ordinal: 1, rating: 1 })
        .expect(409);
      expect(conflict.body).toMatchObject({
        code: 'SESSION_IDEMPOTENCY_CONFLICT',
      });
    });

    it('thiếu rating → 400 SESSION_ANSWER_INVALID', async () => {
      const res = await request(server)
        .post(`/v1/sessions/${session.session.id}/answers`)
        .set('Authorization', `Bearer ${token}`)
        .send({ ordinal: 2 })
        .expect(400);
      expect(res.body).toMatchObject({ code: 'SESSION_ANSWER_INVALID' });
    });
  });

  describe('multiple_choice (server chấm)', () => {
    let session: SessionDetailBody;

    it('tạo phiên practice; chấm đúng/sai theo đáp án trong DB; màn câu sai', async () => {
      session = await createSession('multiple_choice');
      expect(session.items[0].prompt.kind).toBe('multiple_choice');
      expect(session.items[0].prompt.options).toHaveLength(4);

      const firstAnswer = (await dbItem(session.session.id, 1)).correctAnswer;
      const correct = await answer(session.session.id, {
        ordinal: 1,
        option_index: firstAnswer.index,
      });
      expect(correct.item.is_correct).toBe(true);
      // thẻ có thể đang learning (lên bước) hoặc vừa tốt nghiệp review
      expect(['learning', 'review']).toContain(correct.srs.state);
      expect(correct.session.correct_count).toBe(1);

      const secondAnswer = (await dbItem(session.session.id, 2)).correctAnswer;
      const optionsCount = session.items[1].prompt.options!.length;
      const wrongIndex = ((secondAnswer.index as number) + 1) % optionsCount;
      const wrong = await answer(session.session.id, {
        ordinal: 2,
        option_index: wrongIndex,
      });
      expect(wrong.item.is_correct).toBe(false);
      expect(wrong.item.rating).toBe(1);
      // Again: thẻ mới/learning quay về learning, thẻ review → relearning
      expect(['learning', 'relearning']).toContain(wrong.srs.state);

      const wrongItemsRes = await request(server)
        .get(`/v1/sessions/${session.session.id}/items`)
        .query({ is_correct: false })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const wrongItems = wrongItemsRes.body as ItemBody[];
      expect(wrongItems).toHaveLength(1);
      expect(wrongItems[0].ordinal).toBe(2);
      expect(wrongItems[0].correct_answer).toBeDefined();
    });

    it('từ chối option_index ngoài snapshot mà không ghi review hoặc SRS', async () => {
      for (const mode of ['multiple_choice', 'matching']) {
        const session = await createSession(mode, 'practice', 1);
        const row = await prisma.studySessionItem.findFirstOrThrow({
          where: { sessionId: session.session.id, ordinal: 1 },
          select: { srsId: true, prompt: true },
        });
        const optionCount = (row.prompt as { options: { index: number }[] })
          .options.length;
        const beforeState = await prisma.srsState.findUniqueOrThrow({
          where: { id: row.srsId! },
          select: { reps: true, state: true, dueAt: true },
        });
        const beforeLogs = await prisma.reviewLog.count({ where: { userId } });
        const beforeXp = await prisma.xpEvent.count({ where: { userId } });

        for (const [optionIndex, expectedCode] of [
          [-1, 'VALIDATION_FAILED'],
          [optionCount, 'SESSION_ANSWER_INVALID'],
          [999, 'SESSION_ANSWER_INVALID'],
        ] as const) {
          const invalid = await request(server)
            .post(`/v1/sessions/${session.session.id}/answers`)
            .set('Authorization', `Bearer ${token}`)
            .send({ ordinal: 1, option_index: optionIndex })
            .expect(400);
          expect(invalid.body).toMatchObject({ code: expectedCode });

          const afterState = await prisma.srsState.findUniqueOrThrow({
            where: { id: row.srsId! },
            select: { reps: true, state: true, dueAt: true },
          });
          const afterItem = await prisma.studySessionItem.findFirstOrThrow({
            where: { sessionId: session.session.id, ordinal: 1 },
            select: { answeredAt: true },
          });
          expect(afterState).toEqual(beforeState);
          expect(afterItem.answeredAt).toBeNull();
          expect(await prisma.reviewLog.count({ where: { userId } })).toBe(
            beforeLogs,
          );
          expect(await prisma.xpEvent.count({ where: { userId } })).toBe(
            beforeXp,
          );
        }
      }
    });
  });

  describe('matching', () => {
    it('chấm theo lựa chọn như MCQ (kind = matching)', async () => {
      const session = await createSession('matching');
      expect(session.items[0].prompt.kind).toBe('matching');
      const answerData = (await dbItem(session.session.id, 1)).correctAnswer;
      const result = await answer(session.session.id, {
        ordinal: 1,
        option_index: answerData.index,
      });
      expect(result.item.is_correct).toBe(true);
    });
  });

  describe('typing', () => {
    it('đúng/sai + chấp nhận nhiều dạng (trim, hoa thường, kana)', async () => {
      // M6.2: practice chỉ giữ một đại diện new/review mỗi item. Tạm suspend 3
      // sibling của mục 水/water để chiều EN recall là đại diện, giữ coverage
      // nhập đáp án EN viết HOA (chuẩn hoá hoa/thường).
      const suspendSiblings = {
        userId,
        OR: [
          { faceId: waterFaceJa },
          { faceId: waterFaceEn, direction: 'recognize' as const },
        ],
      };
      await prisma.srsState.updateMany({
        where: suspendSiblings,
        data: { suspended: true },
      });
      try {
        const session = await createSession('typing');

        // Gõ đáp án đúng của câu 1 kèm khoảng trắng thừa → chuẩn hoá trim
        const firstAnswer = (await dbItem(session.session.id, 1)).correctAnswer;
        const ja = await answer(session.session.id, {
          ordinal: 1,
          answer_text: ` ${(firstAnswer.accepted as string[])[0]} `,
        });
        expect(ja.item.is_correct).toBe(true);

        const wrong = await answer(session.session.id, {
          ordinal: 2,
          answer_text: 'あるく',
        });
        expect(wrong.item.is_correct).toBe(false);

        // thẻ en (recall) nhập đáp án viết HOA vẫn đúng nhờ chuẩn hoá
        const enRecall = session.items.find(
          (item) =>
            item.prompt.direction === 'recall' &&
            item.prompt.language.code === 'en',
        )!;
        expect(enRecall).toBeDefined();
        const enAnswer = (await dbItem(session.session.id, enRecall.ordinal))
          .correctAnswer;
        const en = await answer(session.session.id, {
          ordinal: enRecall.ordinal,
          answer_text: (enAnswer.accepted as string[])[0].toUpperCase(),
        });
        expect(en.item.is_correct).toBe(true);
      } finally {
        await prisma.srsState.updateMany({
          where: suspendSiblings,
          data: { suspended: false },
        });
      }
    });
  });

  describe('vòng đời phiên', () => {
    it('replay giữ nguyên SRS snapshot sau khi session khác thay đổi thẻ', async () => {
      const collection = await request(server)
        .post('/v1/collections')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: `Bộ replay ${runId}` })
        .expect(201);
      const isolatedCollectionId = (collection.body as { id: string }).id;
      await request(server)
        .post(`/v1/collections/${isolatedCollectionId}/items`)
        .set('Authorization', `Bearer ${token}`)
        .send({ sense_id: '1', secondary_sense_id: '2', meaning_vi: 'chạy' })
        .expect(201);

      const firstSessionRes = await request(server)
        .post('/v1/sessions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          kind: 'practice',
          mode: 'typing',
          collection_id: isolatedCollectionId,
          limit: 1,
        })
        .expect(201);
      const firstSession = firstSessionRes.body as SessionDetailBody;
      const firstAnswer = await prisma.studySessionItem.findFirstOrThrow({
        where: { sessionId: firstSession.session.id, ordinal: 1 },
        select: { correctAnswer: true, srsId: true },
      });
      const accepted = (firstAnswer.correctAnswer as { accepted: string[] })
        .accepted[0];
      const original = await answer(firstSession.session.id, {
        ordinal: 1,
        answer_text: accepted,
      });

      const secondSessionRes = await request(server)
        .post('/v1/sessions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          kind: 'practice',
          mode: 'typing',
          collection_id: isolatedCollectionId,
          limit: 1,
        })
        .expect(201);
      const secondSession = secondSessionRes.body as SessionDetailBody;
      const secondAnswer = await prisma.studySessionItem.findFirstOrThrow({
        where: { sessionId: secondSession.session.id, ordinal: 1 },
        select: { srsId: true },
      });
      expect(secondAnswer.srsId).toBe(firstAnswer.srsId);
      await answer(secondSession.session.id, {
        ordinal: 1,
        answer_text: '__incorrect__',
      });

      const replay = await answer(firstSession.session.id, {
        ordinal: 1,
        answer_text: accepted,
      });
      expect(replay).toEqual(original);
    });

    it('replay giữ snapshot response khi session đã tiến sang câu kế tiếp', async () => {
      const session = await createSession('typing', 'practice', 2);
      const firstAnswer = await dbItem(session.session.id, 1);
      const accepted = (firstAnswer.correctAnswer.accepted as string[])[0];
      const original = await answer(session.session.id, {
        ordinal: 1,
        answer_text: accepted,
      });
      await answer(session.session.id, {
        ordinal: 2,
        answer_text: '__incorrect__',
      });

      const replay = await answer(session.session.id, {
        ordinal: 1,
        answer_text: accepted,
      });
      expect(original.session.answered_count).toBe(1);
      expect(replay).toEqual(original);
    });

    it('answered legacy row không receipt trả SESSION_REPLAY_UNAVAILABLE', async () => {
      const session = await createSession('typing', 'practice', 1);
      const row = await prisma.studySessionItem.findFirstOrThrow({
        where: { sessionId: session.session.id, ordinal: 1 },
        select: { id: true, correctAnswer: true },
      });
      const accepted = (row.correctAnswer as { accepted: string[] })
        .accepted[0];
      await answer(session.session.id, {
        ordinal: 1,
        answer_text: accepted,
      });
      const originalReceipt = await prisma.studySessionItem.findUniqueOrThrow({
        where: { id: row.id },
        select: { answerReceipt: true },
      });
      await prisma.$executeRaw`UPDATE app.study_session_item SET answer_receipt = NULL WHERE id = ${row.id}`;

      try {
        const replay = await request(server)
          .post(`/v1/sessions/${session.session.id}/answers`)
          .set('Authorization', `Bearer ${token}`)
          .send({ ordinal: 1, answer_text: accepted })
          .expect(409);
        expect(replay.body).toMatchObject({
          code: 'SESSION_REPLAY_UNAVAILABLE',
        });
      } finally {
        await prisma.studySessionItem.update({
          where: { id: row.id },
          data: {
            answerReceipt:
              originalReceipt.answerReceipt as unknown as Prisma.InputJsonValue,
          },
        });
      }
    });

    it('hai answer đồng thời cùng ordinal chỉ ghi một lượt và cùng response', async () => {
      const session = await createSession('typing', 'practice', 1);
      const item = await dbItem(session.session.id, 1);
      const accepted = (item.correctAnswer.accepted as string[])[0];
      const body = { ordinal: 1, answer_text: accepted };
      const logCount = await prisma.reviewLog.count({ where: { userId } });

      const [first, second] = await Promise.all([
        answer(session.session.id, body),
        answer(session.session.id, body),
      ]);

      expect(second).toEqual(first);
      expect(await prisma.reviewLog.count({ where: { userId } })).toBe(
        logCount + 1,
      );
      expect(
        await prisma.xpEvent.count({
          where: {
            userId,
            idempotencyKey: `session:${session.session.id}:1`,
          },
        }),
      ).toBe(1);
    });

    it('finish sớm → abandoned; trả lời tiếp → 409 SESSION_CLOSED', async () => {
      const session = await createSession('typing', 'practice', 4);
      await answer(session.session.id, { ordinal: 1, answer_text: '走る' });

      const finish = await request(server)
        .post(`/v1/sessions/${session.session.id}/finish`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(finish.body).toMatchObject({
        status: 'abandoned',
        score: null,
        answered_count: 1,
      });

      const closed = await request(server)
        .post(`/v1/sessions/${session.session.id}/answers`)
        .set('Authorization', `Bearer ${token}`)
        .send({ ordinal: 2, answer_text: 'x' })
        .expect(409);
      expect(closed.body).toMatchObject({ code: 'SESSION_CLOSED' });
    });

    it('trả lời hết → tự completed + score 100', async () => {
      const session = await createSession('typing', 'practice', 2);
      for (const item of session.items) {
        const correct = (await dbItem(session.session.id, item.ordinal))
          .correctAnswer;
        const text = (correct.accepted as string[])[0];
        await answer(session.session.id, {
          ordinal: item.ordinal,
          answer_text: text,
        });
      }
      const detail = await request(server)
        .get(`/v1/sessions/${session.session.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect((detail.body as SessionDetailBody).session).toMatchObject({
        status: 'completed',
        score: 100,
        answered_count: 2,
        correct_count: 2,
      });
    });
  });

  describe('suspend thẻ', () => {
    it('suspend → biến khỏi hàng đợi/phiên practice; unsuspend → trở lại', async () => {
      await request(server)
        .patch('/v1/srs/cards')
        .set('Authorization', `Bearer ${token}`)
        .send({ face_id: faceJa, direction: 'recognize', suspended: true })
        .expect(200);

      const suspended = await prisma.srsState.findFirstOrThrow({
        where: { userId, faceId: faceJa, direction: 'recognize' },
      });
      expect(suspended.suspended).toBe(true);

      const session = await createSession('flashcard');
      expect(
        session.items.some(
          (item) =>
            item.face_id === faceJa && item.prompt.direction === 'recognize',
        ),
      ).toBe(false);

      await request(server)
        .patch('/v1/srs/cards')
        .set('Authorization', `Bearer ${token}`)
        .send({ face_id: faceJa, direction: 'recognize', suspended: false })
        .expect(200);
      const unsuspended = await prisma.srsState.findFirstOrThrow({
        where: { userId, faceId: faceJa, direction: 'recognize' },
      });
      expect(unsuspended.suspended).toBe(false);
    });
  });

  describe('bảo mật & biên', () => {
    it('phiên của user khác → 404; ordinal sai → 404', async () => {
      const session = await createSession('flashcard', 'practice', 2);

      const other = await request(server)
        .get(`/v1/sessions/${session.session.id}`)
        .set('Authorization', `Bearer ${tokenOther}`)
        .expect(404);
      expect(other.body).toMatchObject({ code: 'SESSION_NOT_FOUND' });

      const badOrdinal = await request(server)
        .post(`/v1/sessions/${session.session.id}/answers`)
        .set('Authorization', `Bearer ${token}`)
        .send({ ordinal: 999, rating: 3 })
        .expect(404);
      expect(badOrdinal.body).toMatchObject({ code: 'SESSION_ITEM_NOT_FOUND' });
    });

    it('client gửi is_correct → 400 VALIDATION_FAILED (đáp án chỉ server chấm)', async () => {
      const session = await createSession('multiple_choice', 'practice', 2);
      const res = await request(server)
        .post(`/v1/sessions/${session.session.id}/answers`)
        .set('Authorization', `Bearer ${token}`)
        .send({ ordinal: 1, option_index: 0, is_correct: true })
        .expect(400);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('mode listening chưa hỗ trợ → 400; không token → 401', async () => {
      const listening = await request(server)
        .post('/v1/sessions')
        .set('Authorization', `Bearer ${token}`)
        .send({ kind: 'practice', mode: 'listening' })
        .expect(400);
      expect(listening.body).toMatchObject({ code: 'VALIDATION_FAILED' });

      const noToken = await request(server).get('/v1/sessions/x').expect(401);
      expect(noToken.body).toMatchObject({ code: 'AUTH_TOKEN_MISSING' });
    });

    it('không còn thẻ (review) → 409 SESSION_NO_CARDS', async () => {
      // user B chưa có profile → 409 PROFILE_REQUIRED trước; tạo profile rỗng rồi thử
      await request(server)
        .post('/v1/profiles')
        .set('Authorization', `Bearer ${tokenOther}`)
        .send({
          name: 'Trống',
          primary_language_id: 2,
          support_language_id: 3,
        })
        .expect(201);
      const res = await request(server)
        .post('/v1/sessions')
        .set('Authorization', `Bearer ${tokenOther}`)
        .send({ kind: 'review', mode: 'flashcard' })
        .expect(409);
      expect(res.body).toMatchObject({ code: 'SESSION_NO_CARDS' });
    });
  });

  describe('profile & distractor (M7.2)', () => {
    async function createProfile(
      tokenValue: string,
      name: string,
      primary: number,
      secondary: number | null,
    ): Promise<string> {
      const res = await request(server)
        .post('/v1/profiles')
        .set('Authorization', `Bearer ${tokenValue}`)
        .send({
          name,
          primary_language_id: primary,
          ...(secondary === null ? {} : { secondary_language_id: secondary }),
          support_language_id: 3,
        })
        .expect(201);
      return (res.body as { id: string }).id;
    }

    async function createCollectionNamed(
      tokenValue: string,
      name: string,
    ): Promise<string> {
      const res = await request(server)
        .post('/v1/collections')
        .set('Authorization', `Bearer ${tokenValue}`)
        .send({ name })
        .expect(201);
      return (res.body as { id: string }).id;
    }

    async function addItem(
      tokenValue: string,
      collectionIdValue: string,
      senseId: string,
      meaning: string,
    ): Promise<void> {
      await request(server)
        .post(`/v1/collections/${collectionIdValue}/items`)
        .set('Authorization', `Bearer ${tokenValue}`)
        .send({ sense_id: senseId, meaning_vi: meaning })
        .expect(201);
    }

    it('session review giữ đúng một profileId dù active profile đổi', async () => {
      const user = await registerUser(`e2e-m7-profile-${runId}@langoo.test`);
      const profileA = await createProfile(user.token, 'A ja', 2, 1);
      const collectionA = await createCollectionNamed(user.token, 'A');
      await addItem(user.token, collectionA, '1', 'chạy');
      await addItem(user.token, collectionA, '5', 'ăn');

      const profileB = await createProfile(user.token, 'B en', 1, 2);
      await request(server)
        .patch('/v1/me/settings')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ active_profile_id: profileB, timezone: safeTestTimezone() })
        .expect(200);

      // DB active = B, nhưng luồng tạo session resolve ra A (mô phỏng đổi profile
      // xen giữa hai lần đọc trước đây). Mọi thẻ phải thuộc A, không lẫn B.
      const srs = app.get(SrsService);
      const spy = jest.spyOn(srs, 'getProfileContext').mockResolvedValue({
        id: profileA,
        primaryLanguageId: 2,
        secondaryLanguageId: 1,
        timezone: safeTestTimezone(),
        srsNewPerDay: 20,
        srsReviewPerDay: 200,
      });
      try {
        const res = await request(server)
          .post('/v1/sessions')
          .set('Authorization', `Bearer ${user.token}`)
          .send({ kind: 'review', mode: 'flashcard' })
          .expect(201);
        const sessionId = (res.body as SessionDetailBody).session.id;

        const sessionRow = await prisma.studySession.findUniqueOrThrow({
          where: { id: sessionId },
        });
        expect(sessionRow.profileId).toBe(profileA);

        const items = await prisma.studySessionItem.findMany({
          where: { sessionId },
          select: { srs: { select: { profileId: true } } },
        });
        expect(items.length).toBeGreaterThan(0);
        expect(items.every((row) => row.srs?.profileId === profileA)).toBe(
          true,
        );
      } finally {
        spy.mockRestore();
      }
    });

    it('distractor chỉ trong profile session và ưu tiên collection trước LIMIT', async () => {
      const user = await registerUser(`e2e-m7-distract-${runId}@langoo.test`);
      const profileA = await createProfile(user.token, 'A ja', 2, 1);
      const colPreferred = await createCollectionNamed(user.token, 'A ưu tiên');
      const colOther = await createCollectionNamed(user.token, 'A khác');
      await addItem(user.token, colPreferred, '1', 'chạy');
      await addItem(user.token, colOther, '5', 'ăn');
      await addItem(user.token, colOther, '7', 'đi');

      const profileB = await createProfile(user.token, 'B ja', 2, 1);
      await request(server)
        .patch('/v1/me/settings')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ active_profile_id: profileB })
        .expect(200);
      const colB = await createCollectionNamed(user.token, 'B');
      await addItem(user.token, colB, '9', 'nước');

      const repo = app.get(SessionSourceRepository);

      // limit=1 + preferred: SQL phải ưu tiên collection đang học TRƯỚC LIMIT.
      const top = await repo.findDistractors({
        userId: user.userId,
        profileId: profileA,
        languageId: 2,
        excludeSenseIds: [],
        preferredCollectionIds: [colPreferred],
        limit: 1,
      });
      expect(top).toHaveLength(1);
      expect(top[0].collection_id).toBe(colPreferred);

      // Không giới hạn preferred: không được lẫn collection của profile B.
      const all = await repo.findDistractors({
        userId: user.userId,
        profileId: profileA,
        languageId: 2,
        excludeSenseIds: [],
        preferredCollectionIds: [],
        limit: 50,
      });
      const collectionIds = [...new Set(all.map((row) => row.collection_id))];
      const collections = await prisma.collection.findMany({
        where: { id: { in: collectionIds } },
        select: { profileId: true },
      });
      expect(collections.every((row) => row.profileId === profileA)).toBe(true);
      expect(all.some((row) => row.collection_id === colB)).toBe(false);
    });
  });
});
