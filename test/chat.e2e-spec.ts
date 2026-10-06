import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';

// Quota nhỏ để test 429 nhanh (mỗi user một quota theo ngày).
process.env.AI_DAILY_REQUEST_LIMIT = '3';

interface SessionBody {
  id: string;
  language_id: number;
  scenario: string | null;
  model: string | null;
  prompt_version: string | null;
  message_count: number;
  last_message_at: string | null;
  archived_at: string | null;
}

interface MessageBody {
  id: string;
  role: string;
  content: string;
  ref_sense_id: string | null;
}

interface SendBody {
  user_message: MessageBody;
  assistant_message: MessageBody;
  usage: { request_count: number; limit: number };
}

describe('Chat AI (e2e — langoo_test)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;

  const runId = Date.now();
  const password = 'matkhau-e2e-123';

  let userToken = '';
  let sessionId = '';
  let otherToken = '';

  async function register(email: string): Promise<string> {
    const res = await request(server)
      .post('/v1/auth/register')
      .send({ email, password })
      .expect(201);
    return (res.body as { access_token: string }).access_token;
  }

  function auth(token: string): { Authorization: string } {
    return { Authorization: `Bearer ${token}` };
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

    userToken = await register(`e2e-chat-a-${runId}@langoo.test`);
    otherToken = await register(`e2e-chat-b-${runId}@langoo.test`);
  });

  afterAll(async () => {
    await app.close();
  });

  it('tạo phiên + gửi tin: lưu 2 tin, counter, usage 1/3', async () => {
    const created = await request(server)
      .post('/v1/chat/sessions')
      .set(auth(userToken))
      .send({ language_id: 2, title: 'Học từ vựng N5' })
      .expect(201);
    const session = created.body as SessionBody;
    sessionId = session.id;

    expect(session).toMatchObject({
      language_id: 2,
      scenario: 'general',
      model: 'stub-v1',
      prompt_version: 'm10-v2',
      message_count: 0,
      last_message_at: null,
      archived_at: null,
    });

    const sent = await request(server)
      .post(`/v1/chat/sessions/${sessionId}/messages`)
      .set(auth(userToken))
      .send({ content: '  Xin chào  ' })
      .expect(200);
    const body = sent.body as SendBody;

    expect(body.user_message).toMatchObject({
      role: 'user',
      content: 'Xin chào',
      ref_sense_id: null,
    });
    expect(body.assistant_message.role).toBe('assistant');
    expect(body.assistant_message.content).toContain('[stub]');
    expect(body.usage).toEqual({ request_count: 1, limit: 3 });

    const detail = await request(server)
      .get(`/v1/chat/sessions/${sessionId}`)
      .set(auth(userToken))
      .expect(200);
    const detailBody = detail.body as SessionBody;
    expect(detailBody.message_count).toBe(2);
    expect(detailBody.last_message_at).not.toBeNull();

    const messages = await request(server)
      .get(`/v1/chat/sessions/${sessionId}/messages`)
      .set(auth(userToken))
      .expect(200);
    const messageList = (messages.body as { data: MessageBody[] }).data;
    expect(messageList.map((m) => m.role)).toEqual(['user', 'assistant']);

    const usageRes = await request(server)
      .get('/v1/chat/usage')
      .set(auth(userToken))
      .expect(200);
    const usageBody = usageRes.body as {
      period: string;
      request_count: number;
    };
    expect(usageBody.request_count).toBe(1);

    const userRow = await prisma.user.findFirst({
      where: { email: `e2e-chat-a-${runId}@langoo.test` },
      select: { id: true },
    });
    const usageRow = await prisma.aiUsage.findUnique({
      where: {
        userId_period_feature: {
          userId: userRow!.id,
          period: new Date(`${usageBody.period}T00:00:00.000Z`),
          feature: 'chat',
        },
      },
    });
    expect(usageRow?.requestCount).toBe(1);
    expect(Number(usageRow?.tokensIn ?? 0)).toBeGreaterThan(0);
  });

  it('ref_sense_id hợp lệ → trả lời kèm gloss tiếng Việt và không lộ quota lần trước', async () => {
    const sent = await request(server)
      .post(`/v1/chat/sessions/${sessionId}/messages`)
      .set(auth(userToken))
      .send({ content: '走る nghĩa là gì?', ref_sense_id: '1' })
      .expect(200);
    const body = sent.body as SendBody;

    expect(body.user_message.ref_sense_id).toBe('1');
    expect(body.assistant_message.content).toContain('chạy');
    expect(body.usage.request_count).toBe(2);
  });

  it('ref_sense_id sai → 404 SENSE_NOT_FOUND, không tiêu quota', async () => {
    const res = await request(server)
      .post(`/v1/chat/sessions/${sessionId}/messages`)
      .set(auth(userToken))
      .send({ content: 'hi', ref_sense_id: '999999' })
      .expect(404);
    expect(res.body).toMatchObject({ code: 'SENSE_NOT_FOUND' });

    const usage = await request(server)
      .get('/v1/chat/usage')
      .set(auth(userToken))
      .expect(200);
    expect((usage.body as { request_count: number }).request_count).toBe(2);
  });

  it('quota: user mới gửi 3 tin OK, tin thứ 4 → 429 và không lưu', async () => {
    const created = await request(server)
      .post('/v1/chat/sessions')
      .set(auth(otherToken))
      .send({ language_id: 2 })
      .expect(201);
    const otherSessionId = (created.body as SessionBody).id;

    for (let index = 0; index < 3; index += 1) {
      await request(server)
        .post(`/v1/chat/sessions/${otherSessionId}/messages`)
        .set(auth(otherToken))
        .send({ content: `tin ${index}` })
        .expect(200);
    }

    const blocked = await request(server)
      .post(`/v1/chat/sessions/${otherSessionId}/messages`)
      .set(auth(otherToken))
      .send({ content: 'tin 4' })
      .expect(429);
    expect(blocked.body).toMatchObject({ code: 'AI_QUOTA_EXCEEDED' });

    const messages = await request(server)
      .get(`/v1/chat/sessions/${otherSessionId}/messages`)
      .set(auth(otherToken))
      .expect(200);
    expect((messages.body as { data: MessageBody[] }).data).toHaveLength(6);
  });

  it('archive: lưu trữ idempotent, gửi tin 409, list ẩn phiên', async () => {
    const first = await request(server)
      .delete(`/v1/chat/sessions/${sessionId}`)
      .set(auth(userToken))
      .expect(200);
    const archivedAt = (first.body as SessionBody).archived_at;
    expect(archivedAt).not.toBeNull();

    const second = await request(server)
      .delete(`/v1/chat/sessions/${sessionId}`)
      .set(auth(userToken))
      .expect(200);
    expect((second.body as SessionBody).archived_at).toBe(archivedAt);

    const blocked = await request(server)
      .post(`/v1/chat/sessions/${sessionId}/messages`)
      .set(auth(userToken))
      .send({ content: 'hi' })
      .expect(409);
    expect(blocked.body).toMatchObject({ code: 'CHAT_SESSION_ARCHIVED' });

    const list = await request(server)
      .get('/v1/chat/sessions')
      .set(auth(userToken))
      .expect(200);
    const ids = (list.body as { data: SessionBody[] }).data.map((s) => s.id);
    expect(ids).not.toContain(sessionId);
  });

  it('cách ly user: phiên của người khác → 404', async () => {
    const res = await request(server)
      .get(`/v1/chat/sessions/${sessionId}`)
      .set(auth(otherToken))
      .expect(404);
    expect(res.body).toMatchObject({ code: 'CHAT_SESSION_NOT_FOUND' });

    const send = await request(server)
      .post(`/v1/chat/sessions/${sessionId}/messages`)
      .set(auth(otherToken))
      .send({ content: 'hi' })
      .expect(404);
    expect(send.body).toMatchObject({ code: 'CHAT_SESSION_NOT_FOUND' });
  });

  it('validation biên: nội dung/kịch bản/ngôn ngữ/ref id sai → 400', async () => {
    const cases: { body: Record<string, unknown>; path?: string }[] = [
      { body: { language_id: 99 } },
      { body: { language_id: 2, scenario: 'khong-co' } },
    ];
    for (const item of cases) {
      await request(server)
        .post('/v1/chat/sessions')
        .set(auth(otherToken))
        .send(item.body)
        .expect(400);
    }

    const created = await request(server)
      .post('/v1/chat/sessions')
      .set(auth(otherToken))
      .send({ language_id: 2 })
      .expect(201);
    const id = (created.body as SessionBody).id;

    for (const content of ['   ', 'a'.repeat(2001)]) {
      await request(server)
        .post(`/v1/chat/sessions/${id}/messages`)
        .set(auth(otherToken))
        .send({ content })
        .expect(400);
    }
    await request(server)
      .post(`/v1/chat/sessions/${id}/messages`)
      .set(auth(otherToken))
      .send({ content: 'hi', ref_sense_id: 'abc' })
      .expect(400);
  });

  it('usage endpoint trả quota hôm nay theo timezone user', async () => {
    const res = await request(server)
      .get('/v1/chat/usage')
      .set(auth(userToken))
      .expect(200);
    expect(res.body).toMatchObject({
      feature: 'chat',
      request_count: 2,
      limit: 3,
    });
    expect((res.body as { period: string }).period).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });
});
