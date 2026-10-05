import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ChatService } from '../src/ai/chat/chat.service';
import {
  AI_CHAT_PROVIDER,
  AiChatRequest,
} from '../src/ai/providers/ai-chat.provider';
import { StubChatProvider } from '../src/ai/providers/stub-chat.provider';
import { AiUsageService } from '../src/ai/usage/ai-usage.service';
import { PrismaService } from '../src/db/prisma.service';
import { LanguageRepository } from '../src/db/repositories/language.repository';
import { DictionaryService } from '../src/dictionary/dictionary.service';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function reply(input: AiChatRequest) {
  return {
    content: `answer ${input.messages.at(-1)?.content ?? ''}`,
    model: 'upstream-canonical-model',
    tokensIn: 3,
    tokensOut: 2,
    costUsd: 0,
  };
}

describe('M10 fixes (e2e — local test DB)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let config: ConfigService;
  let independentService: ChatService;
  const emails: string[] = [];
  const runId = `${Date.now()}-${process.pid}`;
  const stub = new StubChatProvider();
  const providerChat = jest.fn((input: AiChatRequest) => stub.chat(input));
  const provider = { name: 'stub', chat: providerChat };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_CHAT_PROVIDER)
      .useValue(provider)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    config = app.get(ConfigService);
    config.set('AI_DAILY_REQUEST_LIMIT', 3);
    config.set('AI_CHAT_MODEL', 'stub-v1');
    // Separate service object: coordination must come from DB, not local memory.
    independentService = new ChatService(
      prisma,
      config,
      app.get(LanguageRepository),
      app.get(DictionaryService),
      app.get(AiUsageService),
      provider,
    );
  });

  beforeEach(() => {
    providerChat.mockReset().mockImplementation((input) => stub.chat(input));
    config.set('AI_CHAT_MODEL', 'stub-v1');
  });

  afterAll(async () => {
    if (prisma)
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
    if (app) await app.close();
  });

  function auth(token: string) {
    return { Authorization: `Bearer ${token}` };
  }
  async function fixture() {
    const email = `e2e-m10-fix-${emails.length}-${runId}@langoo.test`;
    emails.push(email);
    const registered = await request(server)
      .post('/v1/auth/register')
      .send({ email, password: 'm10-fixes-password-123' })
      .expect(201);
    const token = (registered.body as { access_token: string }).access_token;
    const created = await request(server)
      .post('/v1/chat/sessions')
      .set(auth(token))
      .send({ language_id: 2 })
      .expect(201);
    const id = (created.body as { id: string }).id;
    const userId = (await prisma.user.findFirstOrThrow({ where: { email } }))
      .id;
    return { id, token, userId };
  }
  function send(f: { id: string; token: string }, content: string) {
    return request(server)
      .post(`/v1/chat/sessions/${f.id}/messages`)
      .set(auth(f.token))
      .send({ content });
  }
  async function usage(f: { token: string }) {
    const response = await request(server)
      .get('/v1/chat/usage')
      .set(auth(f.token))
      .expect(200);
    return (response.body as { request_count: number }).request_count;
  }

  it('null trong optional fields → 400, không thay đổi phiên/quota', async () => {
    const f = await fixture();
    for (const field of ['title', 'scenario', 'profile_id']) {
      const response = await request(server)
        .post('/v1/chat/sessions')
        .set(auth(f.token))
        .send({ language_id: 2, [field]: null })
        .expect(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    for (const field of ['title', 'scenario']) {
      const response = await request(server)
        .patch(`/v1/chat/sessions/${f.id}`)
        .set(auth(f.token))
        .send({ [field]: null })
        .expect(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    await request(server)
      .post(`/v1/chat/sessions/${f.id}/messages`)
      .set(auth(f.token))
      .send({ content: 'hi', ref_sense_id: null })
      .expect(400);
    expect(
      (await prisma.chatSession.findUniqueOrThrow({ where: { id: f.id } }))
        .scenario,
    ).toBe('general');
    expect(await usage(f)).toBe(0);
  });

  it('PATCH rỗng là no-op; sửa title/scenario hợp lệ và chặn khi archive', async () => {
    const f = await fixture();
    await request(server)
      .patch(`/v1/chat/sessions/${f.id}`)
      .set(auth(f.token))
      .send({})
      .expect(200);
    const updated = await request(server)
      .patch(`/v1/chat/sessions/${f.id}`)
      .set(auth(f.token))
      .send({ title: '  updated  ', scenario: 'grammar' })
      .expect(200);
    expect(updated.body).toMatchObject({
      title: 'updated',
      scenario: 'grammar',
    });
    await request(server)
      .delete(`/v1/chat/sessions/${f.id}`)
      .set(auth(f.token))
      .expect(200);
    const rejected = await request(server)
      .patch(`/v1/chat/sessions/${f.id}`)
      .set(auth(f.token))
      .send({ title: 'changed' })
      .expect(409);
    expect(rejected.body).toMatchObject({ code: 'CHAT_SESSION_ARCHIVED' });
  });

  it('cursor ngày sai/không tồn tại → 400 cho cả phiên và lịch sử tin', async () => {
    const f = await fixture();
    for (const t of ['2026-99-99T00:00:00.000Z', '2026-02-30T00:00:00.000Z']) {
      for (const [route, id] of [
        ['/v1/chat/sessions', f.id],
        [`/v1/chat/sessions/${f.id}/messages`, '1'],
      ]) {
        const cursor = Buffer.from(JSON.stringify({ v: 1, t, i: id })).toString(
          'base64url',
        );
        const response = await request(server)
          .get(route)
          .set(auth(f.token))
          .query({ cursor })
          .expect(400);
        expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      }
    }
  });

  it('phiên demo cũ và metadata upstream vẫn dùng alias cấu hình qua hai lượt', async () => {
    const f = await fixture();
    config.set('AI_CHAT_MODEL', 'space-bunny-free');
    providerChat.mockImplementation((input) => {
      if (input.model !== 'space-bunny-free')
        throw new Error('unknown gateway model');
      return Promise.resolve(reply(input));
    });
    for (const content of ['first', 'second']) {
      const response = await send(f, content).expect(200);
      expect(response.body).toMatchObject({
        assistant_message: { model: 'upstream-canonical-model' },
      });
    }
    expect(providerChat.mock.calls.map(([input]) => input.model)).toEqual([
      'space-bunny-free',
      'space-bunny-free',
    ]);
    expect(
      (await prisma.chatSession.findUniqueOrThrow({ where: { id: f.id } }))
        .model,
    ).toBe('space-bunny-free');
  });

  it('service thứ hai bị chặn trước quota; retry thấy đầy đủ lượt trước', async () => {
    const f = await fixture();
    const started = deferred();
    const release = deferred();
    providerChat.mockImplementationOnce(async (input) => {
      started.resolve();
      await release.promise;
      return reply(input);
    });
    const pending = send(f, 'A').then((response) => response);
    try {
      await started.promise;
      await expect(
        independentService.sendMessage(f.userId, f.id, { content: 'B' }),
      ).rejects.toMatchObject({ code: 'CHAT_SESSION_BUSY' });
      expect(providerChat).toHaveBeenCalledTimes(1);
      expect(await usage(f)).toBe(1);
    } finally {
      release.resolve();
    }
    expect((await pending).status).toBe(200);
    await send(f, 'B').expect(200);
    expect(providerChat.mock.calls[1][0].messages).toEqual(
      expect.arrayContaining([
        { role: 'user', content: 'A' },
        { role: 'assistant', content: 'answer A' },
        { role: 'user', content: 'B' },
      ]),
    );
    expect(await usage(f)).toBe(2);
  });

  it('archive khi provider đang chạy → 409, không lưu tin/counter', async () => {
    const f = await fixture();
    const started = deferred();
    const release = deferred();
    providerChat.mockImplementationOnce(async (input) => {
      started.resolve();
      await release.promise;
      return reply(input);
    });
    const pending = send(f, 'in flight').then((response) => response);
    try {
      await started.promise;
      await request(server)
        .delete(`/v1/chat/sessions/${f.id}`)
        .set(auth(f.token))
        .expect(200);
    } finally {
      release.resolve();
    }
    const response = await pending;
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'CHAT_SESSION_ARCHIVED' });
    const row = await prisma.chatSession.findUniqueOrThrow({
      where: { id: f.id },
    });
    expect(row.archivedAt).not.toBeNull();
    expect(row.messageCount).toBe(0);
    expect(row.pendingRequestId).toBeNull();
    expect(await prisma.chatMessage.count({ where: { sessionId: f.id } })).toBe(
      0,
    );
    expect(await usage(f)).toBe(1);
  });

  it('provider lỗi giải phóng lease để gửi tiếp, vẫn tính lượt đã gọi', async () => {
    const f = await fixture();
    providerChat.mockRejectedValueOnce(new Error('provider timeout'));
    await send(f, 'fails').expect(503);
    expect(
      (await prisma.chatSession.findUniqueOrThrow({ where: { id: f.id } }))
        .pendingRequestId,
    ).toBeNull();
    expect(await prisma.chatMessage.count({ where: { sessionId: f.id } })).toBe(
      0,
    );
    await send(f, 'retry').expect(200);
    expect(await usage(f)).toBe(2);
  });

  it('lỗi lưu assistant rollback cả user/counter/token và giải phóng lease', async () => {
    const f = await fixture();
    // Fail the database CHECK after the session update and user INSERT.
    providerChat.mockImplementationOnce((input) =>
      Promise.resolve({ ...reply(input), content: '   ' }),
    );
    await send(f, 'rollback').expect(500);
    const row = await prisma.chatSession.findUniqueOrThrow({
      where: { id: f.id },
    });
    expect(row.messageCount).toBe(0);
    expect(row.lastMessageAt).toBeNull();
    expect(row.pendingRequestId).toBeNull();
    expect(await prisma.chatMessage.count({ where: { sessionId: f.id } })).toBe(
      0,
    );
    const usages = await prisma.aiUsage.findMany({
      where: { userId: f.userId, feature: 'chat' },
    });
    expect(usages).toHaveLength(1);
    expect(usages[0].requestCount).toBe(1);
    expect(usages[0].tokensIn).toBe(0n);
    expect(usages[0].tokensOut).toBe(0n);
    await send(f, 'retry').expect(200);
    expect(
      (await prisma.chatSession.findUniqueOrThrow({ where: { id: f.id } }))
        .messageCount,
    ).toBe(2);
  });

  it('lease bị bỏ lại hết hạn phục hồi được; kết quả quá hạn không được lưu', async () => {
    const f = await fixture();
    await prisma.chatSession.update({
      where: { id: f.id },
      data: {
        pendingRequestId: '01900000-0000-7000-8000-000000000001',
        pendingRequestExpiresAt: new Date(0),
      },
    });
    const started = deferred();
    const release = deferred();
    providerChat.mockImplementationOnce(async (input) => {
      started.resolve();
      await release.promise;
      return reply(input);
    });
    const pending = send(f, 'expires').then((response) => response);
    try {
      await started.promise;
      await prisma.chatSession.update({
        where: { id: f.id },
        data: { pendingRequestExpiresAt: new Date(0) },
      });
    } finally {
      release.resolve();
    }
    const response = await pending;
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'CHAT_REQUEST_EXPIRED' });
    expect(await prisma.chatMessage.count({ where: { sessionId: f.id } })).toBe(
      0,
    );
    await send(f, 'retry').expect(200);
    expect(await usage(f)).toBe(2);
  });

  it('kết quả cũ không ghi tin hoặc giải phóng lease của request mới', async () => {
    const f = await fixture();
    const aStarted = deferred();
    const aRelease = deferred();
    const bStarted = deferred();
    const bRelease = deferred();
    providerChat.mockImplementation(async (input) => {
      if (input.messages.at(-1)?.content === 'A') {
        aStarted.resolve();
        await aRelease.promise;
      } else {
        bStarted.resolve();
        await bRelease.promise;
      }
      return reply(input);
    });
    const pendingA = send(f, 'A').then((response) => response);
    await aStarted.promise;
    await prisma.chatSession.update({
      where: { id: f.id },
      data: { pendingRequestExpiresAt: new Date(0) },
    });
    const pendingB = send(f, 'B').then((response) => response);
    try {
      await bStarted.promise;
      const bToken = (
        await prisma.chatSession.findUniqueOrThrow({ where: { id: f.id } })
      ).pendingRequestId;
      aRelease.resolve();
      expect((await pendingA).status).toBe(409);
      expect(
        (await prisma.chatSession.findUniqueOrThrow({ where: { id: f.id } }))
          .pendingRequestId,
      ).toBe(bToken);
      const blocked = await send(f, 'C').expect(409);
      expect(blocked.body).toMatchObject({ code: 'CHAT_SESSION_BUSY' });
      expect(await usage(f)).toBe(2);
    } finally {
      aRelease.resolve();
      bRelease.resolve();
    }
    expect((await pendingB).status).toBe(200);
    const messages = await prisma.chatMessage.findMany({
      where: { sessionId: f.id },
      orderBy: { id: 'asc' },
    });
    expect(messages.map((m) => m.content)).toEqual(['B', 'answer B']);
  });

  it('archive đồng thời giữ nguyên timestamp idempotent', async () => {
    const f = await fixture();
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        request(server)
          .delete(`/v1/chat/sessions/${f.id}`)
          .set(auth(f.token))
          .expect(200),
      ),
    );
    expect(
      new Set(
        responses.map((r) => (r.body as { archived_at: string }).archived_at),
      ).size,
    ).toBe(1);
  });

  it('quota nguyên tử giữa các phiên: 6 request với 3 lượt chỉ có 3 thành công', async () => {
    const f = await fixture();
    const ids = [f.id];
    for (let index = 1; index < 6; index++) {
      const created = await request(server)
        .post('/v1/chat/sessions')
        .set(auth(f.token))
        .send({ language_id: 2 })
        .expect(201);
      ids.push((created.body as { id: string }).id);
    }
    const responses = await Promise.all(
      ids.map((id, index) => send({ ...f, id }, `quota ${index}`)),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([
      200, 200, 200, 429, 429, 429,
    ]);
    expect(await usage(f)).toBe(3);
  });
});
