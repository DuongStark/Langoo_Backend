import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ChatService } from '../src/ai/chat/chat.service';
import {
  AI_CHAT_PROVIDER,
  AiChatDeltaHandler,
  AiChatRequest,
  AiProviderError,
} from '../src/ai/providers/ai-chat.provider';
import { StubChatProvider } from '../src/ai/providers/stub-chat.provider';
import { AiUsageService } from '../src/ai/usage/ai-usage.service';
import { PrismaService } from '../src/db/prisma.service';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function reply() {
  return {
    content: 'answer',
    model: 'actual-model',
    tokensIn: 3,
    tokensOut: 2,
    costUsd: 0,
  };
}

describe('M10.1 stream regressions (local DB)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let config: ConfigService;
  const emails: string[] = [];
  const runId = `${Date.now()}-${process.pid}`;
  const stub = new StubChatProvider();
  const stream = jest.fn((input: AiChatRequest, delta: AiChatDeltaHandler) =>
    stub.chatStream(input, delta),
  );
  const chat = jest.fn((input: AiChatRequest) => stub.chat(input));
  const provider = { name: 'stub', chat, chatStream: stream };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_CHAT_PROVIDER)
      .useValue(provider)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    config = app.get(ConfigService);
  });

  beforeEach(() => {
    stream
      .mockReset()
      .mockImplementation((input, delta) => stub.chatStream(input, delta));
    chat.mockReset().mockImplementation((input) => stub.chat(input));
    config.set('AI_CHAT_MODEL', 'stub-v1');
    config.set('AI_DAILY_REQUEST_LIMIT', 20);
  });

  afterAll(async () => {
    if (prisma)
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
    if (app) await app.close();
  });

  async function fixture() {
    const email = `e2e-m10-stream-${emails.length}-${runId}@langoo.test`;
    emails.push(email);
    const registered = await request(server)
      .post('/v1/auth/register')
      .send({ email, password: 'test-stream-password-123' })
      .expect(201);
    const token = (registered.body as { access_token: string }).access_token;
    const created = await request(server)
      .post('/v1/chat/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({ language_id: 2 })
      .expect(201);
    const id = (created.body as { id: string }).id;
    const userId = (await prisma.user.findFirstOrThrow({ where: { email } }))
      .id;
    return { id, token, userId };
  }

  function send(f: { id: string; token: string }) {
    return request(server)
      .post(`/v1/chat/sessions/${f.id}/messages/stream`)
      .set('Authorization', `Bearer ${f.token}`)
      .send({ content: 'hi' })
      .timeout(5000);
  }

  async function expectFailedTurn(f: { id: string; userId: bigint }) {
    const session = await prisma.chatSession.findUniqueOrThrow({
      where: { id: f.id },
    });
    expect(session.messageCount).toBe(0);
    expect(session.lastMessageAt).toBeNull();
    expect(session.pendingRequestId).toBeNull();
    expect(await prisma.chatMessage.count({ where: { sessionId: f.id } })).toBe(
      0,
    );
    const rows = await prisma.aiUsage.findMany({
      where: { userId: f.userId, feature: 'chat' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      requestCount: 1,
      tokensIn: 0n,
      tokensOut: 0n,
    });
  }

  it('early provider failure returns JSON 503 with no SSE start', async () => {
    const f = await fixture();
    stream.mockRejectedValueOnce(new Error('private provider message'));
    const result = await send(f)
      .expect(503)
      .expect('Content-Type', /application\/json/);
    expect(result.body).toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE' });
    expect(result.text).not.toMatch(/event: start|private provider message/);
    await expectFailedTurn(f);
  });

  it('429 before any content retries once without double quota or save', async () => {
    const f = await fixture();
    stream.mockRejectedValueOnce(new AiProviderError('rate limited', 429));
    const result = await send(f).expect(200);
    expect(stream).toHaveBeenCalledTimes(2);
    expect(result.text.match(/event: start/g)).toHaveLength(1);
    expect(result.text.match(/event: done/g)).toHaveLength(1);
    expect(await prisma.chatMessage.count({ where: { sessionId: f.id } })).toBe(
      2,
    );
    const rows = await prisma.aiUsage.findMany({
      where: { userId: f.userId, feature: 'chat' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].requestCount).toBe(1);
  });

  it('provider failure after delta produces an error without retry or partial save', async () => {
    const f = await fixture();
    stream.mockImplementationOnce((_input, delta) => {
      delta('partial');
      return Promise.reject(
        new AiProviderError('private provider details', 503),
      );
    });
    const result = await send(f).expect(200);
    expect(result.text).toContain('event: delta');
    expect(result.text.match(/event: error/g)).toHaveLength(1);
    expect(result.text).not.toMatch(/event: done|private provider details/);
    expect(stream).toHaveBeenCalledTimes(1);
    await expectFailedTurn(f);
    await send(f).expect(200);
  });

  it('real DB failure after delta rolls back the pair/counters/usage and emits error', async () => {
    const f = await fixture();
    stream.mockImplementationOnce((_input, delta) => {
      delta('answer');
      // Violates a DB CHECK after session update and user INSERT.
      return Promise.resolve({ ...reply(), tokensOut: -1 });
    });
    const result = await send(f).expect(200);
    expect(result.text).toContain('"code":"CHAT_STREAM_FAILED"');
    expect(result.text.match(/event: error/g)).toHaveLength(1);
    expect(result.text).not.toMatch(/event: done|CHECK|chat_message/);
    await expectFailedTurn(f);
  });

  it.each(['archive', 'expire'])(
    '%s during generation yields one domain error and no save',
    async (mode) => {
      const f = await fixture();
      const started = deferred();
      const release = deferred();
      stream.mockImplementationOnce(async (_input, delta) => {
        delta('answer');
        started.resolve();
        await release.promise;
        return reply();
      });
      const pending = send(f).then((result) => result);
      try {
        await started.promise;
        if (mode === 'archive') {
          await request(server)
            .delete(`/v1/chat/sessions/${f.id}`)
            .set('Authorization', `Bearer ${f.token}`)
            .expect(200);
        } else {
          await prisma.chatSession.update({
            where: { id: f.id },
            data: { pendingRequestExpiresAt: new Date(0) },
          });
        }
      } finally {
        release.resolve();
      }
      const result = await pending;
      expect(result.status).toBe(200);
      expect(result.text).toContain(
        `"code":"${mode === 'archive' ? 'CHAT_SESSION_ARCHIVED' : 'CHAT_REQUEST_EXPIRED'}"`,
      );
      expect(result.text.match(/event: error/g)).toHaveLength(1);
      expect(result.text).not.toContain('event: done');
      await expectFailedTurn(f);
    },
  );

  it('quota and ownership are rejected before provider/headers', async () => {
    const f = await fixture();
    const other = await fixture();
    const forbidden = await send({ id: f.id, token: other.token }).expect(404);
    expect(forbidden.body).toMatchObject({ code: 'CHAT_SESSION_NOT_FOUND' });
    config.set('AI_DAILY_REQUEST_LIMIT', 1);
    const period = (await app.get(ChatService).getUsage(f.userId)).period;
    await app
      .get(AiUsageService)
      .reserveDailyRequest(
        prisma,
        f.userId,
        new Date(`${period}T00:00:00.000Z`),
        'chat',
        1,
      );
    const quota = await send(f).expect(429);
    expect(quota.body).toMatchObject({ code: 'AI_QUOTA_EXCEEDED' });
    expect(stream).not.toHaveBeenCalled();
    expect(
      (await prisma.chatSession.findUniqueOrThrow({ where: { id: f.id } }))
        .pendingRequestId,
    ).toBeNull();
  });

  it('client disconnect after a delta cancels upstream and releases DB lease', async () => {
    const f = await fixture();
    const aborted = deferred();
    let upstreamSignal: AbortSignal | undefined;
    stream.mockImplementationOnce((input, delta) => {
      upstreamSignal = input.signal;
      delta('partial');
      return new Promise((_resolve, reject) => {
        const cancel = () => {
          aborted.resolve();
          reject(new DOMException('client disconnected', 'AbortError'));
        };
        if (input.signal?.aborted) cancel();
        else input.signal?.addEventListener('abort', cancel, { once: true });
      });
    });
    const abort = new AbortController();
    const result = await fetch(
      `${await app.getUrl()}/v1/chat/sessions/${f.id}/messages/stream`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${f.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: 'hi' }),
        signal: abort.signal,
      },
    );
    const reader = result.body!.getReader();
    try {
      const chunk = await reader.read();
      expect(new TextDecoder().decode(chunk.value)).toContain('event: delta');
      abort.abort();
      await aborted.promise;
    } finally {
      abort.abort();
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    expect(upstreamSignal?.aborted).toBe(true);
    // Await service cleanup using the same session: BUSY is the only transient outcome.
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const row = await prisma.chatSession.findUniqueOrThrow({
        where: { id: f.id },
      });
      if (row.pendingRequestId === null) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await expectFailedTurn(f);
    await send(f).expect(200);
  });

  it('one streaming turn blocks both endpoints without extra quota', async () => {
    const f = await fixture();
    const started = deferred();
    const release = deferred();
    stream.mockImplementationOnce(async (_input, delta) => {
      delta('answer');
      started.resolve();
      await release.promise;
      return reply();
    });
    const pending = send(f).then((result) => result);
    try {
      await started.promise;
      const streamBusy = await send(f)
        .expect(409)
        .expect('Content-Type', /application\/json/);
      expect(streamBusy.body).toMatchObject({ code: 'CHAT_SESSION_BUSY' });
      const regularBusy = await request(server)
        .post(`/v1/chat/sessions/${f.id}/messages`)
        .set('Authorization', `Bearer ${f.token}`)
        .send({ content: 'hi' })
        .expect(409);
      expect(regularBusy.body).toMatchObject({ code: 'CHAT_SESSION_BUSY' });
      expect(stream).toHaveBeenCalledTimes(1);
    } finally {
      release.resolve();
    }
    const result = await pending;
    expect(result.text).toContain('event: done');
    expect((await app.get(ChatService).getUsage(f.userId)).request_count).toBe(
      1,
    );
  });

  it('abort observed during a real transaction rolls back both messages and usage', async () => {
    const f = await fixture();
    const abort = new AbortController();
    const usage = app.get(AiUsageService);
    const originalAddUsage = usage.addUsage.bind(usage);
    const spy = jest
      .spyOn(usage, 'addUsage')
      .mockImplementationOnce(async (...args) => {
        await originalAddUsage(...args);
        abort.abort();
      });
    try {
      await expect(
        app
          .get(ChatService)
          .sendMessageStream(
            f.userId,
            f.id,
            { content: 'hi' },
            () => undefined,
            abort.signal,
          ),
      ).rejects.toMatchObject({ name: 'AbortError' });
      await expectFailedTurn(f);
    } finally {
      spy.mockRestore();
    }
  });
});
