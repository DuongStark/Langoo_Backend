import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';

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
    await createItem('9', '10', 'nước'); // 水 + water
  });

  afterAll(async () => {
    await app.close();
  });

  describe('flashcard (review, chấm bằng rating)', () => {
    let session: SessionDetailBody;

    it('tạo phiên review: snapshot 16 thẻ (4 mục × 2 mặt × 2 chiều), đáp án bị ẩn', async () => {
      session = await createSession('flashcard', 'review');
      expect(session.session).toMatchObject({
        kind: 'review',
        mode: 'flashcard',
        status: 'in_progress',
        item_count: 16,
        answered_count: 0,
      });
      expect(session.items).toHaveLength(16);
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
      const xp = await prisma.xpEvent.count({ where: { userId } });
      expect(logs).toBe(1);
      expect(xp).toBe(1);

      const replay = await answer(session.session.id, {
        ordinal: 1,
        rating: 1,
      });
      expect(replay.item.rating).toBe(3); // giữ kết quả cũ
      expect(replay.xp.amount).toBe(1);
      expect(await prisma.reviewLog.count({ where: { userId } })).toBe(1);
      expect(await prisma.xpEvent.count({ where: { userId } })).toBe(1);
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
      const enAnswer = (await dbItem(session.session.id, enRecall.ordinal))
        .correctAnswer;
      const en = await answer(session.session.id, {
        ordinal: enRecall.ordinal,
        answer_text: (enAnswer.accepted as string[])[0].toUpperCase(),
      });
      expect(en.item.is_correct).toBe(true);
    });
  });

  describe('vòng đời phiên', () => {
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
});
