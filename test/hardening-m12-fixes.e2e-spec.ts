import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Request, Response, NextFunction } from 'express';
import type { Server } from 'node:http';
import { Client } from 'pg';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { AppModule } from '../src/app.module';
import {
  AI_CHAT_PROVIDER,
  AiChatProvider,
} from '../src/ai/providers/ai-chat.provider';
import { ChatRetentionJob } from '../src/common/scheduler/jobs/chat-retention.job';
import { PartitionEnsureJob } from '../src/common/scheduler/jobs/partition-ensure.job';
import { configureHttpProxy } from '../src/config/http-proxy';
import { withUtcTimezone } from '../src/db/connection-url';
import { PrismaService } from '../src/db/prisma.service';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('M12 hardening regressions (local *_test)', () => {
  let app: NestExpressApplication;
  let server: Server;
  let prisma: PrismaService;
  let config: ConfigService;
  let peerIp: string | undefined;
  let chat: AiChatProvider['chat'];
  const runId = Date.now();
  const emails: string[] = [];
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const rollback = new Error('rollback test transaction');

  async function fixture(label: string) {
    const email = `e2e-m12-fix-${runId}-${label}@langoo.test`;
    emails.push(email);
    const registered = await request(server)
      .post('/v1/auth/register')
      .send({ email, password: 'matkhau-regression-123' })
      .expect(201);
    const token = (registered.body as { access_token: string }).access_token;
    await request(server)
      .post('/v1/profiles')
      .set(auth(token))
      .send({
        name: label,
        primary_language_id: 2,
        secondary_language_id: 1,
        support_language_id: 3,
      })
      .expect(201);
    const user = await prisma.user.findFirstOrThrow({
      where: { email },
      select: { id: true },
    });
    return { token, userId: user.id };
  }
  async function newChat(token: string) {
    return (
      await request(server)
        .post('/v1/chat/sessions')
        .set(auth(token))
        .send({ language_id: 2 })
        .expect(201)
    ).body as { id: string };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_CHAT_PROVIDER)
      .useValue({
        name: 'stub',
        chat: (input) => chat(input),
      } satisfies AiChatProvider)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureHttpProxy(app);
    // Simulate an untrusted TCP peer without depending on the runner's NICs.
    // Express itself still resolves req.ip from the socket/header trust chain.
    app.use((req: Request, _res: Response, next: NextFunction) => {
      if (peerIp !== undefined)
        Object.defineProperty(req.socket, 'remoteAddress', {
          value: peerIp,
          configurable: true,
        });
      next();
    });
    app.setGlobalPrefix('v1');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    config = app.get(ConfigService);
  });
  beforeEach(() => {
    config.set('RATE_LIMIT_ENABLED', false);
    peerIp = undefined;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await app.close();
  });

  it('different client IPs through the trusted loopback proxy get separate register buckets', async () => {
    config.set('RATE_LIMIT_ENABLED', true);
    for (let i = 1; i <= 6; i++) {
      await request(server)
        .post('/v1/auth/register')
        .set('X-Forwarded-For', `198.51.100.${i}`)
        .send({})
        .expect(400);
    }
  });

  it('the same forwarded client IP still gets register 5/hour and Retry-After', async () => {
    config.set('RATE_LIMIT_ENABLED', true);
    for (let i = 0; i < 5; i++) {
      await request(server)
        .post('/v1/auth/register')
        .set('X-Forwarded-For', '198.51.100.40')
        .send({})
        .expect(400);
    }
    const blocked = await request(server)
      .post('/v1/auth/register')
      .set('X-Forwarded-For', '198.51.100.40')
      .send({})
      .expect(429);
    expect(blocked.body).toMatchObject({ code: 'RATE_LIMITED' });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('a spoofed prefix before the nearest untrusted proxy cannot rotate the bucket', async () => {
    config.set('RATE_LIMIT_ENABLED', true);
    for (let i = 1; i <= 6; i++) {
      await request(server)
        .post('/v1/auth/register')
        .set('X-Forwarded-For', `198.51.100.${i}, 203.0.113.20`)
        .send({})
        .expect(i <= 5 ? 400 : 429);
    }
  });

  it('a direct non-loopback peer cannot rotate buckets using forwarded headers', async () => {
    config.set('RATE_LIMIT_ENABLED', true);
    peerIp = '203.0.113.30';
    try {
      for (let i = 1; i <= 6; i++) {
        await request(server)
          .post('/v1/auth/register')
          .set('X-Forwarded-For', `198.51.100.${i}`)
          .send({})
          .expect(i <= 5 ? 400 : 429);
      }
    } finally {
      peerIp = undefined;
    }
  });

  it('partition job creates the next two months across a year boundary, is idempotent and rolls back DDL', async () => {
    const names = ['review_log_2091_01', 'review_log_2091_02'];
    const before = await prisma.$queryRaw<
      { name: string | null }[]
    >`SELECT to_regclass('app.review_log_2091_01')::text AS name UNION ALL SELECT to_regclass('app.review_log_2091_02')::text`;
    expect(before.map((row) => row.name)).toEqual([null, null]);
    await expect(
      prisma.$transaction(
        async (tx) => {
          const job = new PartitionEnsureJob();
          const now = new Date('2090-12-15T12:00:00.000Z');
          const first = await job.run(tx, now),
            second = await job.run(tx, now);
          expect(first).toEqual({ note: `partitions: ${names.join(', ')}` });
          expect(second).toEqual(first);
          const partitions = await tx.$queryRaw<
            { name: string }[]
          >`SELECT child.relname AS name FROM pg_inherits i JOIN pg_class child ON child.oid=i.inhrelid WHERE i.inhparent='app.review_log'::regclass AND child.relname IN ('review_log_2091_01','review_log_2091_02') ORDER BY child.relname`;
          expect(partitions.map((row) => row.name)).toEqual(names);
          throw rollback;
        },
        { timeout: 15000 },
      ),
    ).rejects.toBe(rollback);
    const after = await prisma.$queryRaw<
      { name: string | null }[]
    >`SELECT to_regclass('app.review_log_2091_01')::text AS name UNION ALL SELECT to_regclass('app.review_log_2091_02')::text`;
    expect(after.map((row) => row.name)).toEqual([null, null]);
  });

  it('retention keeps a chat with an active AI request and the answer can commit', async () => {
    const f = await fixture('inflight'),
      session = await newChat(f.token);
    await prisma.chatSession.update({
      where: { id: session.id },
      data: {
        createdAt: new Date(Date.now() - 181 * 86400000),
        lastMessageAt: null,
      },
    });
    const entered = deferred(),
      release = deferred();
    chat = async (input) => {
      entered.resolve();
      await release.promise;
      return {
        content: 'retention-safe answer',
        model: input.model,
        tokensIn: 1,
        tokensOut: 1,
        costUsd: 0,
      };
    };
    const pending = request(server)
      .post(`/v1/chat/sessions/${session.id}/messages`)
      .set(auth(f.token))
      .send({ content: 'I am using this chat now' })
      .then((r) => r);
    try {
      await entered.promise;
      await expect(
        prisma.$transaction(async (tx) => {
          await new ChatRetentionJob(config).run(tx);
          const current = await tx.chatSession.findUnique({
            where: { id: session.id },
          });
          expect(current).not.toBeNull();
          expect(current!.pendingRequestExpiresAt!.getTime()).toBeGreaterThan(
            Date.now(),
          );
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    } finally {
      release.resolve();
      await pending;
    }
    const answer = await pending;
    expect(answer.status).toBe(200);
    expect(
      await prisma.chatMessage.count({ where: { sessionId: session.id } }),
    ).toBe(2);
    expect(
      await prisma.chatSession.findUnique({ where: { id: session.id } }),
    ).toMatchObject({ messageCount: 2, pendingRequestId: null });
    expect(
      await prisma.aiUsage.findFirst({
        where: { userId: f.userId, feature: 'chat' },
      }),
    ).toMatchObject({ requestCount: 1 });
  });

  it('retention still deletes old sessions with no lease or an expired lease and keeps recent activity', async () => {
    const f = await fixture('leases');
    const sessions: { id: string }[] = [];
    for (let i = 0; i < 4; i++) sessions.push(await newChat(f.token));
    const old = new Date(Date.now() - 181 * 86400000);
    await prisma.chatSession.updateMany({
      where: { id: { in: sessions.map((s) => s.id) } },
      data: { createdAt: old, lastMessageAt: null },
    });
    await prisma.chatSession.update({
      where: { id: sessions[1].id },
      data: {
        pendingRequestId: uuidv7(),
        pendingRequestExpiresAt: new Date(Date.now() - 1000),
      },
    });
    await prisma.chatSession.update({
      where: { id: sessions[2].id },
      data: {
        pendingRequestId: uuidv7(),
        pendingRequestExpiresAt: new Date(Date.now() + 60000),
      },
    });
    await prisma.chatSession.update({
      where: { id: sessions[3].id },
      data: { lastMessageAt: new Date() },
    });
    await prisma.chatMessage.create({
      data: { sessionId: sessions[0].id, role: 'user', content: 'old history' },
    });
    await expect(
      prisma.$transaction(async (tx) => {
        await new ChatRetentionJob(config).run(tx);
        const remaining = await tx.chatSession.findMany({
          where: { userId: f.userId },
          select: { id: true },
        });
        expect(remaining.map((row) => row.id).sort()).toEqual(
          [sessions[2].id, sessions[3].id].sort(),
        );
        expect(
          await tx.chatMessage.count({ where: { sessionId: sessions[0].id } }),
        ).toBe(0);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });

  it('CHAT_RETENTION_DAYS=0 leaves even old sessions intact', async () => {
    const f = await fixture('disabled'),
      session = await newChat(f.token);
    await prisma.chatSession.update({
      where: { id: session.id },
      data: { createdAt: new Date(Date.now() - 181 * 86400000) },
    });
    const disabled = new ConfigService({ CHAT_RETENTION_DAYS: 0 });
    expect(
      await prisma.$transaction((tx) => new ChatRetentionJob(disabled).run(tx)),
    ).toEqual({ note: 'disabled (CHAT_RETENTION_DAYS=0)' });
    expect(
      await prisma.chatSession.findUnique({ where: { id: session.id } }),
    ).not.toBeNull();
  });

  it('UTC wins over later conflicting timezone flags on a real connection', async () => {
    // setup-env already refuses a remote DB or a name without the _test suffix.
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set(
      'options',
      '-c timezone=UTC -c timezone=Asia/Bangkok -c timezone=Europe/Paris -c statement_timeout=5000',
    );
    const normalized = withUtcTimezone(url.toString());
    expect(withUtcTimezone(normalized)).toBe(normalized);
    const client = new Client({ connectionString: normalized });
    try {
      await client.connect();
      const result = await client.query<{
        timezone: string;
        statement_timeout: string;
      }>(
        "SELECT current_setting('TimeZone') AS timezone, current_setting('statement_timeout') AS statement_timeout",
      );
      expect(result.rows[0]).toEqual({
        timezone: 'UTC',
        statement_timeout: '5s',
      });
    } finally {
      await client.end();
    }
  });
});
