import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { AppModule } from '../src/app.module';
import { AdminAuditService } from '../src/admin/admin-audit.service';
import { AdminStatsService } from '../src/admin/admin-stats.service';
import { localDateString } from '../src/common/time/timezone';
import { configureHttpProxy } from '../src/config/http-proxy';
import { PrismaService } from '../src/db/prisma.service';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

interface Page {
  data: { id: string; content?: string }[];
  next_cursor: string | null;
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('M13 fixes (local *_test)', () => {
  let app: NestExpressApplication;
  let server: Server;
  let prisma: PrismaService;
  let config: ConfigService;
  let admin: { id: bigint; token: string };
  const emails: string[] = [];
  const runId = Date.now();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function fixture(label: string) {
    const email = `e2e-m13-fix-${runId}-${label}@langoo.test`;
    emails.push(email);
    const res = await request(server)
      .post('/v1/auth/register')
      .send({ email, password: 'matkhau-regression-123' })
      .expect(201);
    const body = res.body as { user: { id: string }; access_token: string };
    return { id: BigInt(body.user.id), token: body.access_token };
  }
  async function feedback(token: string, category = 'bug') {
    const res = await request(server)
      .post('/v1/feedback')
      .set(auth(token))
      .send({ category, content: 'M13 regression feedback content' })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mod.createNestApplication<NestExpressApplication>();
    configureHttpProxy(app);
    app.setGlobalPrefix('v1');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    config = app.get(ConfigService);
    admin = await fixture('admin');
    await prisma.user.update({
      where: { id: admin.id },
      data: { role: 'admin' },
    });
  });
  beforeEach(() => config.set('RATE_LIMIT_ENABLED', false));
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await app.close();
  });

  it('10/hour is per authenticated user across IPs, and different users on one IP remain independent', async () => {
    const a = await fixture('rate-a'),
      b = await fixture('rate-b');
    config.set('RATE_LIMIT_ENABLED', true);
    await request(server)
      .post('/v1/feedback')
      .set('X-Forwarded-For', '198.51.100.80')
      .send({ category: 'bug', content: 'Unauthenticated quota attempt' })
      .expect(401);
    for (let i = 0; i < 10; i++) {
      await request(server)
        .post('/v1/feedback')
        .set(auth(a.token))
        .set('X-Forwarded-For', `198.51.100.${80 + i}`)
        .send({ category: 'bug', content: 'Same user through different IPs' })
        .expect(201);
    }
    // A second token for the same user also belongs to the same bucket.
    const loggedIn = await request(server)
      .post('/v1/auth/login')
      .send({
        email: emails.find((e) => e.includes('-rate-a@'))!,
        password: 'matkhau-regression-123',
      })
      .expect(200);
    const blocked = await request(server)
      .post('/v1/feedback')
      .set(auth((loggedIn.body as { access_token: string }).access_token))
      .set('X-Forwarded-For', '198.51.100.100')
      .send({ category: 'bug', content: 'Same user another token and IP' })
      .expect(429);
    expect(blocked.body).toMatchObject({ code: 'RATE_LIMITED' });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.headers['x-ratelimit-remaining-feedback']).toBe('0');
    await request(server)
      .post('/v1/feedback')
      .set(auth(b.token))
      .set('X-Forwarded-For', '198.51.100.80')
      .send({ category: 'bug', content: 'Another user shares the first IP' })
      .expect(201);
    expect(await prisma.feedback.count({ where: { userId: a.id } })).toBe(10);
    expect(await prisma.feedback.count({ where: { userId: b.id } })).toBe(1);
  });

  it.each(['mine', 'feedback', 'gloss', 'audit'] as const)(
    '%s pagination traverses all rows with microseconds and equal timestamps',
    async (kind) => {
      const f = await fixture(`page-${kind}`);
      const times = [
        '2070-01-02T12:00:00.123900Z',
        '2070-01-02T12:00:00.123456Z',
        '2070-01-02T12:00:00.123456Z',
        '2070-01-02T12:00:00.123001Z',
      ];
      const createdIds: string[] = [];
      for (const time of times) {
        if (kind === 'mine' || kind === 'feedback') {
          const id = uuidv7();
          await prisma.$executeRaw`INSERT INTO app.feedback(id,user_id,category,content,status,created_at) VALUES(${id}::uuid,${f.id},'other','microsecond feedback','resolved',${time}::timestamptz)`;
          createdIds.push(id);
        } else if (kind === 'gloss') {
          const [row] = await prisma.$queryRaw<
            { id: bigint }[]
          >`INSERT INTO app.gloss_report(user_id,target_kind,target_id,issue,status,created_at) VALUES(${f.id},'sense_gloss','4','wrong','open',${time}::timestamptz) RETURNING id`;
          createdIds.push(row.id.toString());
        } else {
          const [row] = await prisma.$queryRaw<
            { id: bigint }[]
          >`INSERT INTO app.admin_audit_log(admin_user_id,action,target_kind,target_id,created_at) VALUES(${admin.id},'m13.pagination','review',${f.id.toString()},${time}::timestamptz) RETURNING id`;
          createdIds.push(row.id.toString());
        }
      }
      const expected = [
        createdIds[0],
        ...createdIds.slice(1, 3).sort((a, b) => {
          const left = kind === 'gloss' || kind === 'audit' ? BigInt(a) : a;
          const right = kind === 'gloss' || kind === 'audit' ? BigInt(b) : b;
          return left > right ? -1 : left < right ? 1 : 0;
        }),
        createdIds[3],
      ];
      const route =
        kind === 'mine'
          ? '/v1/me/feedback'
          : kind === 'feedback'
            ? '/v1/admin/feedback?category=other&status=resolved'
            : kind === 'gloss'
              ? '/v1/admin/gloss-reports?status=open&issue=wrong&target_kind=sense_gloss'
              : '/v1/admin/audit-log';
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < expected.length; i++) {
        const res = await request(server)
          .get(
            route +
              (route.includes('?') ? '&' : '?') +
              'limit=1' +
              (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
          )
          .set(auth(kind === 'mine' ? f.token : admin.token))
          .expect(200);
        const body = res.body as Page;
        expect(body.data).toHaveLength(1);
        seen.push(body.data[0].id);
        cursor = body.next_cursor;
        if (i < expected.length - 1) {
          expect(cursor).not.toBeNull();
          const decoded = JSON.parse(
            Buffer.from(cursor!, 'base64url').toString('utf8'),
          ) as { t: string };
          expect(decoded.t).toMatch(/\.\d{6}Z$/);
        }
      }
      expect(seen).toEqual(expected);
      expect(new Set(seen).size).toBe(4);
      if (kind === 'mine') {
        const other = await request(server)
          .get('/v1/me/feedback')
          .set(auth(admin.token))
          .expect(200);
        expect((other.body as Page).data.map((r) => r.id)).not.toEqual(
          expect.arrayContaining(createdIds),
        );
      }
      // Clear future fixtures so each subsequent queue test starts with normal dates.
      if (kind === 'audit')
        await prisma.adminAuditLog.deleteMany({
          where: {
            adminUserId: admin.id,
            action: 'm13.pagination',
            targetId: f.id.toString(),
          },
        });
      else if (kind === 'gloss')
        await prisma.glossReport.deleteMany({ where: { userId: f.id } });
      else await prisma.feedback.deleteMany({ where: { userId: f.id } });
    },
  );

  it.each(['role', 'deleted'] as const)(
    'a concurrent %s change is committed before eligibility is checked under row lock',
    async (change) => {
      const target = await fixture(`race-${change}`);
      if (change === 'deleted')
        await prisma.user.update({
          where: { id: target.id },
          data: { status: 'locked' },
        });
      const entered = deferred(),
        release = deferred();
      let blockerPid = 0;
      const writer = prisma.$transaction(
        async (tx) => {
          const [backend] = await tx.$queryRaw<
            { pid: number }[]
          >`SELECT pg_backend_pid() AS pid`;
          blockerPid = backend.pid;
          await tx.user.update({
            where: { id: target.id },
            data:
              change === 'role'
                ? { role: 'admin' }
                : { status: 'deleted', deletedAt: new Date() },
          });
          entered.resolve();
          await release.promise;
        },
        { timeout: 15000 },
      );
      await entered.promise;
      const pending = request(server)
        .patch(`/v1/admin/users/${target.id}`)
        .set(auth(admin.token))
        .send({ status: change === 'role' ? 'locked' : 'active' })
        .then((r) => r);
      try {
        let waiting = false;
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          const rows = await prisma.$queryRaw<
            { waiting: boolean }[]
          >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${blockerPid} = ANY(pg_blocking_pids(pid)) AND query LIKE '%FROM app.users%FOR UPDATE%') AS waiting`;
          if (rows[0].waiting) {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(waiting).toBe(true);
      } finally {
        release.resolve();
        await writer;
        await pending;
      }
      const response = await pending;
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: 'USER_STATUS_INVALID' });
      const final = await prisma.user.findUniqueOrThrow({
        where: { id: target.id },
      });
      expect(final.status).toBe(change === 'role' ? 'active' : 'deleted');
      expect(final.role).toBe(change === 'role' ? 'admin' : 'user');
      expect(
        await prisma.adminAuditLog.count({
          where: { targetKind: 'user', targetId: target.id.toString() },
        }),
      ).toBe(0);
    },
  );

  it('quota uses each user local day, ignores other days and counts chat+quiz users once', async () => {
    const f = await fixture('quota'),
      stale = await fixture('quota-stale');
    const utc = new Date().toISOString().slice(0, 10);
    const timezone = ['Pacific/Honolulu', 'Pacific/Kiritimati'].find(
      (tz) => localDateString(new Date(), tz) !== utc,
    )!;
    const local = localDateString(new Date(), timezone);
    const period = new Date(local + 'T00:00:00.000Z');
    for (const userId of [f.id, stale.id])
      await prisma.userSettings.update({
        where: { userId },
        data: { timezone },
      });
    const baseline = (await app.get(AdminStatsService).overview()).ai
      .users_at_quota_today;
    const chatLimit = Number(
      config.get<number | string>('AI_DAILY_REQUEST_LIMIT') ?? 50,
    );
    const quizLimit = Number(
      config.get<number | string>('AI_QUIZ_DAILY_LIMIT') ?? 15,
    );
    await prisma.aiUsage.createMany({
      data: [
        { userId: f.id, period, feature: 'chat', requestCount: chatLimit },
        { userId: f.id, period, feature: 'quiz', requestCount: quizLimit },
        {
          userId: stale.id,
          period: new Date(utc + 'T00:00:00.000Z'),
          feature: 'chat',
          requestCount: chatLimit,
        },
      ],
    });
    const usage = await request(server)
      .get('/v1/chat/usage')
      .set(auth(f.token))
      .expect(200);
    expect(usage.body).toMatchObject({
      period: local,
      request_count: chatLimit,
      limit: chatLimit,
    });
    const after = await request(server)
      .get('/v1/admin/stats')
      .set(auth(admin.token))
      .expect(200);
    expect(
      (after.body as { ai: { users_at_quota_today: number } }).ai
        .users_at_quota_today,
    ).toBe(baseline + 1);
  });

  it('SRS backlog excludes buried/paused/archived states and includes expired bury again', async () => {
    const f = await fixture('backlog');
    const read = async () =>
      (await app.get(AdminStatsService).overview()).learning.srs_due_now;
    const baseline = await read();
    await request(server)
      .post('/v1/profiles')
      .set(auth(f.token))
      .send({
        name: 'M13 backlog',
        primary_language_id: 2,
        secondary_language_id: 1,
        support_language_id: 3,
      })
      .expect(201);
    const col = await request(server)
      .post('/v1/collections')
      .set(auth(f.token))
      .send({ name: 'M13 collection' })
      .expect(201);
    const cid = (col.body as { id: string }).id;
    const item = await request(server)
      .post(`/v1/collections/${cid}/items`)
      .set(auth(f.token))
      .send({ sense_id: '1', meaning_vi: 'chạy' })
      .expect(201);
    const iid = (item.body as { id: string }).id;
    // M6.3: một state/face và item không có secondary sense chỉ tạo 1 face.
    expect(await read()).toBe(baseline + 1);
    await prisma.srsState.updateMany({
      where: { userId: f.id },
      data: { buriedUntil: new Date(Date.now() + 3600000) },
    });
    expect(await read()).toBe(baseline);
    await prisma.srsState.updateMany({
      where: { userId: f.id },
      data: { buriedUntil: new Date(Date.now() - 1000) },
    });
    expect(await read()).toBe(baseline + 1);
    await request(server)
      .patch(`/v1/collections/${cid}/items/${iid}`)
      .set(auth(f.token))
      .send({ status: 'paused' })
      .expect(200);
    expect(await read()).toBe(baseline);
    await request(server)
      .patch(`/v1/collections/${cid}/items/${iid}`)
      .set(auth(f.token))
      .send({ status: 'learning' })
      .expect(200);
    expect(await read()).toBe(baseline + 1);
    await request(server)
      .delete(`/v1/collections/${cid}`)
      .set(auth(f.token))
      .expect(200);
    expect(await read()).toBe(baseline);
  });

  it('audit records successive notes and clearing a note, and an audit failure rolls back the mutation', async () => {
    const f = await fixture('audit-notes'),
      id = await feedback(f.token);
    for (const note of ['first note', 'second note', '']) {
      await request(server)
        .patch(`/v1/admin/feedback/${id}`)
        .set(auth(admin.token))
        .send({ status: 'in_progress', admin_note: note })
        .expect(200);
    }
    const logs = await prisma.adminAuditLog.findMany({
      where: { targetKind: 'feedback', targetId: id },
      orderBy: { id: 'asc' },
    });
    expect(logs.map((l) => l.payload)).toEqual([
      {
        status: 'in_progress',
        before: { status: 'new', admin_note: null },
        after: { status: 'in_progress', admin_note: 'first note' },
      },
      {
        status: 'in_progress',
        before: { status: 'in_progress', admin_note: 'first note' },
        after: { status: 'in_progress', admin_note: 'second note' },
      },
      {
        status: 'in_progress',
        before: { status: 'in_progress', admin_note: 'second note' },
        after: { status: 'in_progress', admin_note: null },
      },
    ]);
    const spy = jest
      .spyOn(app.get(AdminAuditService), 'record')
      .mockRejectedValueOnce(new Error('audit write failure'));
    try {
      await request(server)
        .patch(`/v1/admin/feedback/${id}`)
        .set(auth(admin.token))
        .send({ status: 'resolved', admin_note: 'must roll back' })
        .expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(await prisma.feedback.findUnique({ where: { id } })).toMatchObject({
      status: 'in_progress',
      adminNote: null,
    });
    expect(await prisma.adminAuditLog.count({ where: { targetId: id } })).toBe(
      3,
    );
  });

  it('multipart oversize and extra files return documented error codes without storing feedback', async () => {
    const f = await fixture('uploads');
    const huge = Buffer.alloc(5 * 1024 * 1024 + 1);
    PNG.copy(huge);
    const tooLarge = await request(server)
      .post('/v1/feedback')
      .set(auth(f.token))
      .field('category', 'bug')
      .field('content', 'Oversize image regression')
      .attach('files', huge, 'large.png')
      .expect(413);
    expect(tooLarge.body).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    let multi = request(server)
      .post('/v1/feedback')
      .set(auth(f.token))
      .field('category', 'bug')
      .field('content', 'Four images regression');
    for (let i = 0; i < 4; i++) multi = multi.attach('files', PNG, `x${i}.png`);
    const tooMany = await multi.expect(400);
    expect(tooMany.body).toMatchObject({ code: 'ATTACHMENT_INVALID' });
    const wrongField = await request(server)
      .post('/v1/feedback')
      .set(auth(f.token))
      .field('category', 'bug')
      .field('content', 'Wrong image field regression')
      .attach('unexpected', PNG, 'x.png')
      .expect(400);
    expect(wrongField.body).toMatchObject({ code: 'ATTACHMENT_INVALID' });
    expect(await prisma.feedback.count({ where: { userId: f.id } })).toBe(0);
  });
});
