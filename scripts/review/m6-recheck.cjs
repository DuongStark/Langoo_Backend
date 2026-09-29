// M6/M6.1 audit, 2026-09-29. Run with Node 22 after `npm run build`.
// Uses only TEST_DATABASE_URL (localhost, *_test), creates isolated fixtures,
// and deletes its users in finally. Exit 1 means an expected contract failed.
// Optional argv[2] selects the JSON evidence path; default is /tmp.
const { createRequire } = require('node:module');
const { writeFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const root = require('node:path').resolve(__dirname, '../..');
const req = createRequire(root + '/package.json');
req('dotenv').config({ path: root + '/.env' });
const url = new URL(process.env.TEST_DATABASE_URL || '');
if (
  !['localhost', '127.0.0.1', '::1'].includes(url.hostname) ||
  !url.pathname.endsWith('_test')
)
  throw Error('Unsafe audit database');
process.env.DATABASE_URL = req(
  root + '/dist/db/connection-url',
).withUtcTimezone(url.toString());
process.env.DIRECT_URL = process.env.DATABASE_URL;
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
req('reflect-metadata');
const { Test } = req('@nestjs/testing');
const { JwtService } = req('@nestjs/jwt');
const request = req('supertest');
const { v7: uuid } = req('uuid');
const { AppModule } = req(root + '/dist/app.module');
const { PrismaService } = req(root + '/dist/db/prisma.service');
const { SrsService } = req(root + '/dist/srs/srs.service');
const { AnkiScheduler } = req(root + '/dist/srs/scheduler/anki-scheduler');
const { fuzzReviewInterval } = req(root + '/dist/srs/scheduler/fuzz');
const { nextDayStartUtc, startOfDayUtc } = req(
  root + '/dist/common/time/timezone',
);
let app, prisma, server, jwt, srs;
const users = [],
  results = [];
const safeOffset = Math.max(
  -12,
  Math.min(14, Math.round(12 - new Date().getUTCHours())),
);
const timezone =
  safeOffset === 0
    ? 'UTC'
    : `Etc/GMT${safeOffset > 0 ? '-' : '+'}${Math.abs(safeOffset)}`;
async function fixture(settings = {}) {
  const user = await prisma.user.create({
    data: { email: `audit-m6-${uuid()}@langoo.test` },
  });
  users.push(user.id);
  const profile = await prisma.studyProfile.create({
    data: {
      id: uuid(),
      userId: user.id,
      name: 'M6 audit',
      primaryLanguageId: 2,
      secondaryLanguageId: 1,
      supportLanguageId: 3,
      isDefault: true,
    },
  });
  await prisma.userSettings.create({
    data: {
      userId: user.id,
      activeProfileId: profile.id,
      timezone,
      ...settings,
    },
  });
  const token = await jwt.signAsync({
    sub: String(user.id),
    sid: uuid(),
    typ: 'access',
  });
  return { userId: user.id, profileId: profile.id, token };
}
async function card(f, data = {}, sameItem) {
  let collectionId, itemId, faceId;
  if (sameItem) ({ collectionId, itemId, faceId } = sameItem);
  else {
    collectionId = uuid();
    itemId = uuid();
    faceId = uuid();
    await prisma.collection.create({
      data: {
        id: collectionId,
        ownerId: f.userId,
        profileId: f.profileId,
        name: 'M6 audit',
      },
    });
    await prisma.collectionItem.create({
      data: {
        id: itemId,
        collectionId,
        anchorSenseId: 1n,
        meaningVi: 'chạy',
        position: 1,
      },
    });
    await prisma.collectionItemFace.create({
      data: { id: faceId, itemId, senseId: 1n, languageId: 2 },
    });
  }
  const row = await prisma.srsState.create({
    data: {
      userId: f.userId,
      profileId: f.profileId,
      faceId,
      direction: 'recognize',
      dueAt: new Date(Date.now() - 60000),
      ...data,
    },
  });
  return { ...row, collectionId, itemId };
}
const get = (f, q = {}) =>
  request(server)
    .get('/v1/srs/due')
    .query(q)
    .set('Authorization', `Bearer ${f.token}`);
const review = (f, c, body = {}) =>
  request(server)
    .post('/v1/srs/reviews')
    .set('Authorization', `Bearer ${f.token}`)
    .send({ face_id: c.faceId, direction: c.direction, rating: 3, ...body });
async function run(name, fn) {
  try {
    const evidence = await fn();
    results.push({ name, status: 'PASS', evidence });
  } catch (e) {
    results.push({ name, status: 'FAIL', evidence: e.message });
  }
  console.log(JSON.stringify(results.at(-1)));
}
async function main() {
  const mod = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = mod.createNestApplication();
  app.setGlobalPrefix('v1');
  await app.init();
  server = app.getHttpServer();
  prisma = app.get(PrismaService);
  jwt = app.get(JwtService);
  srs = app.get(SrsService);
  await run('ENV-01: UTC, literal bind, ease column', async () => {
    const rows = await prisma.$queryRawUnsafe(
      "SELECT current_setting('TimeZone') AS tz, $1::timestamptz = TIMESTAMPTZ '2026-09-27 00:00:00+00' AS equal, (SELECT data_type FROM information_schema.columns WHERE table_schema='app' AND table_name='srs_state' AND column_name='ease_factor') AS type",
      new Date('2026-09-27T00:00:00Z'),
    );
    assert.deepEqual(rows[0], {
      tz: 'UTC',
      equal: true,
      type: 'double precision',
    });
    return rows[0];
  });
  await run('M6-01: review at ease 1.3', async () => {
    const f = await fixture(),
      c = await card(f, { state: 'review', easeFactor: 1.3, scheduledDays: 1 });
    const a = await review(f, c, { rating: 2 });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(a.body.srs.ease_factor, 1.3);
    await prisma.srsState.update({
      where: { id: c.id },
      data: { dueAt: new Date(Date.now() - 60000) },
    });
    const b = await review(f, c, { rating: 1 });
    assert.equal(b.status, 200, JSON.stringify(b.body));
    return [a.status, b.status];
  });
  await run('M6-02: concurrent sibling answers serialized', async () => {
    const f = await fixture(),
      a = await card(f),
      b = await card(f, { direction: 'recall' }, a);
    const out = await Promise.all([review(f, a), review(f, b)]);
    assert.deepEqual(out.map((r) => r.status).sort(), [200, 409]);
    assert.equal(
      await prisma.reviewLog.count({ where: { userId: f.userId } }),
      1,
    );
    return out.map((r) => ({ status: r.status, code: r.body.code }));
  });
  await run('M6-03: null rejected, omitted key does not replay', async () => {
    const f = await fixture(),
      a = await card(f),
      b = await card(f);
    const n = await review(f, a, { client_review_id: null });
    assert.equal(n.status, 400);
    assert.equal((await review(f, a)).status, 200);
    assert.equal((await review(f, b)).status, 200);
    assert.equal(
      await prisma.reviewLog.count({ where: { userId: f.userId } }),
      2,
    );
    return '400 null; two independent logs without key';
  });
  for (const kind of ['paused', 'archived', 'buried', 'suspended'])
    await run(`M6-04: ${kind} GET/POST eligibility`, async () => {
      const f = await fixture(),
        c = await card(f);
      if (kind === 'paused')
        await prisma.collectionItem.update({
          where: { id: c.itemId },
          data: { status: 'paused' },
        });
      if (kind === 'archived')
        await prisma.collection.update({
          where: { id: c.collectionId },
          data: { archivedAt: new Date() },
        });
      if (kind === 'buried')
        await prisma.srsState.update({
          where: { id: c.id },
          data: { buriedUntil: new Date(Date.now() + 3600000) },
        });
      if (kind === 'suspended')
        await prisma.srsState.update({
          where: { id: c.id },
          data: { suspended: true },
        });
      const due = await get(f);
      assert.equal(due.status, 200);
      assert.equal(due.body.data.length, 0);
      const out = await review(f, c);
      assert.equal(out.status, 409, JSON.stringify(out.body));
      assert.equal(
        await prisma.reviewLog.count({ where: { userId: f.userId } }),
        0,
      );
      return { status: out.status, code: out.body.code };
    });
  await run(
    'M6-05: >1000 candidates, full pagination, late collection filter',
    async () => {
      const f = await fixture(),
        N = 1002,
        collections = [],
        items = [],
        faces = [],
        states = [];
      for (let i = 0; i < N; i++) {
        const collectionId = uuid(),
          itemId = uuid(),
          faceId = uuid();
        collections.push({
          id: collectionId,
          profileId: f.profileId,
          ownerId: f.userId,
          name: 'bulk audit',
        });
        items.push({
          id: itemId,
          collectionId,
          anchorSenseId: 1n,
          meaningVi: 'chạy',
          position: 1,
        });
        faces.push({ id: faceId, itemId, senseId: 1n, languageId: 2 });
        states.push({
          faceId,
          userId: f.userId,
          profileId: f.profileId,
          direction: 'recognize',
          state: 'learning',
          learningStep: 0,
          dueAt: new Date(Date.now() - N * 1000 + i * 1000),
        });
      }
      await prisma.collection.createMany({ data: collections });
      await prisma.collectionItem.createMany({ data: items });
      await prisma.collectionItemFace.createMany({ data: faces });
      await prisma.srsState.createMany({ data: states });
      let cursor,
        ids = [];
      for (let i = 0; i < 15; i++) {
        const r = await get(f, { limit: 100, ...(cursor ? { cursor } : {}) });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.counts.learning, N);
        ids.push(...r.body.data.map((c) => c.srs_id));
        cursor = r.body.next_cursor;
        if (!cursor) break;
      }
      assert.equal(ids.length, N);
      assert.equal(new Set(ids).size, N);
      const filtered = await get(f, { collection_id: collections[N - 1].id });
      assert.equal(filtered.body.data.length, 1);
      return {
        total: ids.length,
        unique: new Set(ids).size,
        lateCollection: filtered.body.data.length,
      };
    },
  );
  await run('M6-06: microsecond cursor neither repeats nor skips', async () => {
    const f = await fixture(),
      a = await card(f, { state: 'review', scheduledDays: 3 }),
      b = await card(f, { state: 'review', scheduledDays: 3 });
    await prisma.$executeRawUnsafe(
      "UPDATE app.srs_state SET due_at = date_trunc('day', now()) - interval '1 day' + interval '0.123456 seconds' WHERE id=$1",
      b.id,
    );
    await prisma.$executeRawUnsafe(
      "UPDATE app.srs_state SET due_at = date_trunc('day', now()) - interval '1 day' + interval '0.123457 seconds' WHERE id=$1",
      a.id,
    );
    const p1 = await get(f, { limit: 1 }),
      p2 = await get(f, { limit: 1, cursor: p1.body.next_cursor });
    assert.deepEqual(
      [p1.body.data[0]?.srs_id, p2.body.data[0]?.srs_id],
      [String(b.id), String(a.id)],
    );
    assert.equal(p2.body.next_cursor, null);
    return 'reverse IDs, 123456/123457 microseconds, both visited once';
  });
  await run(
    'M6-07: intraday exempt, interday consumes shared review quota',
    async () => {
      const f = await fixture({ srsReviewPerDay: 1 }),
        a = await card(f, { state: 'learning', learningStep: 1 }),
        b = await card(f, {
          state: 'learning',
          learningStep: 1,
          learningIsInterday: true,
        }),
        c = await card(f, { state: 'review', scheduledDays: 3 });
      assert.equal((await review(f, a)).status, 200);
      assert.equal((await review(f, b)).status, 200);
      const r = await review(f, c);
      assert.equal(r.status, 409);
      assert.equal(r.body.code, 'SRS_DAILY_LIMIT_REACHED');
      const stats = await srs.stats(f.userId);
      assert.equal(stats.reviews_today, 1);
      return { reviews_today: stats.reviews_today, blocked: r.body.code };
    },
  );
  await run(
    'M6-07: new quota serializes concurrent separate items',
    async () => {
      const f = await fixture({ srsNewPerDay: 1 }),
        a = await card(f),
        b = await card(f);
      const out = await Promise.all([review(f, a), review(f, b)]);
      assert.deepEqual(out.map((r) => r.status).sort(), [200, 409]);
      assert.equal(
        await prisma.reviewLog.count({ where: { userId: f.userId } }),
        1,
      );
      return out.map((r) => ({ status: r.status, code: r.body.code }));
    },
  );
  await run(
    'M6-07: quota scoped to profile, shared across collections',
    async () => {
      const f = await fixture({ srsNewPerDay: 1 }),
        a = await card(f),
        b = await card(f);
      assert.equal(
        (await review(f, a, { collection_id: a.collectionId })).status,
        200,
      );
      assert.equal(
        (await review(f, b, { collection_id: b.collectionId })).body.code,
        'SRS_DAILY_LIMIT_REACHED',
      );
      const p = await prisma.studyProfile.create({
        data: {
          id: uuid(),
          userId: f.userId,
          name: 'second',
          primaryLanguageId: 2,
          secondaryLanguageId: 1,
          supportLanguageId: 3,
        },
      });
      await prisma.userSettings.update({
        where: { userId: f.userId },
        data: { activeProfileId: p.id },
      });
      const c = await card({ ...f, profileId: p.id });
      assert.equal((await review(f, c)).status, 200);
      return 'collection filter cannot bypass cap; second profile has independent cap';
    },
  );
  await run(
    'M6-02/07: session and direct review share lock/quota',
    async () => {
      const f = await fixture({ srsNewPerDay: 1 }),
        a = await card(f),
        b = await card(f);
      const created = await request(server)
        .post('/v1/sessions')
        .set('Authorization', `Bearer ${f.token}`)
        .send({
          kind: 'review',
          mode: 'flashcard',
          collection_id: a.collectionId,
          limit: 1,
        });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const sessionId = created.body.session.id;
      const out = await Promise.all([
        review(f, b),
        request(server)
          .post(`/v1/sessions/${sessionId}/answers`)
          .set('Authorization', `Bearer ${f.token}`)
          .send({ ordinal: 1, rating: 3 }),
      ]);
      assert.deepEqual(out.map((r) => r.status).sort(), [200, 409]);
      assert.equal(
        await prisma.reviewLog.count({ where: { userId: f.userId } }),
        1,
      );
      return out.map((r) => ({ status: r.status, code: r.body.code }));
    },
  );
  await run('M6-04/M7: practice still rejects paused snapshot', async () => {
    const f = await fixture(),
      c = await card(f, {
        state: 'review',
        scheduledDays: 3,
        dueAt: new Date(Date.now() + 86400000),
      });
    const created = await request(server)
      .post('/v1/sessions')
      .set('Authorization', `Bearer ${f.token}`)
      .send({
        kind: 'practice',
        mode: 'flashcard',
        collection_id: c.collectionId,
        limit: 1,
      });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    await prisma.collectionItem.update({
      where: { id: c.itemId },
      data: { status: 'paused' },
    });
    const r = await request(server)
      .post(`/v1/sessions/${created.body.session.id}/answers`)
      .set('Authorization', `Bearer ${f.token}`)
      .send({ ordinal: 1, rating: 3 });
    assert.equal(r.status, 409);
    assert.equal(
      await prisma.reviewLog.count({ where: { userId: f.userId } }),
      0,
    );
    return { status: r.status, code: r.body.code };
  });
  await run(
    'M6 transaction: late XP failure rolls back log/state/bury/receipt',
    async () => {
      const f = await fixture(),
        a = await card(f),
        b = await card(f, { direction: 'recall' }, a),
        key = uuid();
      const { GamificationService } = req(
        root + '/dist/gamification/gamification.service',
      );
      const gamification = app.get(GamificationService),
        original = gamification.applyActivity;
      try {
        gamification.applyActivity = async () => {
          throw Error('M6 audit induced XP failure');
        };
        await assert.rejects(() =>
          srs.review(f.userId, {
            face_id: a.faceId,
            direction: a.direction,
            rating: 3,
            client_review_id: key,
          }),
        );
      } finally {
        gamification.applyActivity = original;
      }
      assert.equal(
        await prisma.reviewLog.count({ where: { userId: f.userId } }),
        0,
      );
      assert.equal(
        await prisma.srsReviewReceipt.count({ where: { userId: f.userId } }),
        0,
      );
      assert.equal(
        (await prisma.srsState.findUnique({ where: { id: a.id } })).state,
        'new',
      );
      assert.equal(
        (await prisma.srsState.findUnique({ where: { id: b.id } })).buriedUntil,
        null,
      );
      return 'all writes rolled back on induced late failure';
    },
  );
  await run(
    'M6-08: GET excludes ahead while regular cards remain',
    async () => {
      const f = await fixture(),
        a = await card(f, { state: 'review', scheduledDays: 3 }),
        b = await card(f, {
          state: 'learning',
          learningStep: 0,
          dueAt: new Date(Date.now() + 600000),
        });
      const due = await get(f, { limit: 50 });
      const r = await review(f, b);
      assert.equal(
        due.body.data.some((c) => c.srs_id === String(b.id)),
        false,
        `GET returned states=${due.body.data.map((c) => c.state)} while POST ahead=${r.status}/${r.body.code}`,
      );
      return { normal: String(a.id), aheadPOST: r.status };
    },
  );
  await run('M6-08: ahead-only accepted, outside 20min rejected', async () => {
    const f = await fixture(),
      a = await card(f, {
        state: 'learning',
        learningStep: 0,
        dueAt: new Date(Date.now() + 600000),
      });
    const due = await get(f);
    assert.equal(due.body.data.length, 1);
    assert.equal((await review(f, a)).status, 200);
    await prisma.srsState.update({
      where: { id: a.id },
      data: { dueAt: new Date(Date.now() + 1800000) },
    });
    const r = await review(f, a);
    assert.equal(r.status, 422);
    return [200, r.status];
  });
  await run(
    'M6-08: counts stay invariant across regular/ahead cursor pages',
    async () => {
      const f = await fixture();
      await card(f, { state: 'review', scheduledDays: 3 });
      for (let i = 0; i < 4; i++)
        await card(f, {
          state: 'learning',
          learningStep: 0,
          dueAt: new Date(Date.now() + 600000 + i * 1000),
        });
      const p1 = await get(f, { limit: 2 }),
        p2 = await get(f, { limit: 2, cursor: p1.body.next_cursor });
      assert.deepEqual(
        p2.body.counts,
        p1.body.counts,
        `page1=${JSON.stringify(p1.body.counts)}, page2=${JSON.stringify(p2.body.counts)}`,
      );
      return p1.body.counts;
    },
  );
  await run(
    'M6-09: replay preserves snapshot after state changed; payload conflict',
    async () => {
      const f = await fixture(),
        c = await card(f),
        key = uuid();
      const payload = { rating: 3, client_review_id: key };
      const first = await review(f, c, payload);
      assert.equal(first.status, 200);
      await prisma.srsState.update({
        where: { id: c.id },
        data: { dueAt: new Date(Date.now() - 60000) },
      });
      assert.equal((await review(f, c, { rating: 4 })).status, 200);
      const replay = await review(f, c, payload);
      assert.equal(replay.status, 200);
      assert.deepEqual(replay.body, first.body);
      const conflict = await review(f, c, { ...payload, rating: 1 });
      assert.equal(conflict.status, 409);
      assert.equal(
        await prisma.reviewLog.count({ where: { userId: f.userId } }),
        2,
      );
      return 'snapshot unchanged; different rating 409';
    },
  );
  await run(
    'M6-09: legacy log key without receipt must reject replay',
    async () => {
      const f = await fixture(),
        c = await card(f),
        key = uuid();
      await prisma.reviewLog.create({
        data: {
          srsId: c.id,
          userId: f.userId,
          faceId: c.faceId,
          rating: 3,
          clientReviewId: key,
          prevState: 'new',
        },
      });
      const r = await review(f, c, { rating: 3, client_review_id: key });
      const count = await prisma.reviewLog.count({
        where: { userId: f.userId },
      });
      assert.equal(
        r.status,
        409,
        `status=${r.status}; logs=${count}; expected SRS_REPLAY_UNAVAILABLE and logs=1`,
      );
      assert.equal(r.body.code, 'SRS_REPLAY_UNAVAILABLE');
      assert.equal(count, 1);
      return r.body.code;
    },
  );
  await run(
    'M6-09: UUID case normalization for same replay payload',
    async () => {
      const f = await fixture(),
        c = await card(f),
        key = uuid();
      assert.equal((await review(f, c, { client_review_id: key })).status, 200);
      const r = await review(
        f,
        { ...c, faceId: c.faceId.toUpperCase() },
        { client_review_id: key.toUpperCase() },
      );
      assert.equal(r.status, 200, `${r.status}/${r.body.code}`);
      return 'canonical UUIDs';
    },
  );
  await run('M6-10: review30 Again→Easy graduates at 2 days', async () => {
    const scheduler = new AnkiScheduler({ next: () => 0.5 }),
      now = new Date();
    const a = scheduler.schedule(
      {
        state: 'review',
        easeFactor: 2.5,
        learningStep: null,
        intervalDays: 30,
        dueAt: now,
      },
      1,
      now,
    );
    const e = scheduler.schedule({ ...a }, 4, a.dueAt);
    assert.equal(
      e.intervalDays,
      2,
      `Again stores ${a.intervalDays}; Easy returns ${e.intervalDays}, pinned Anki default lapse interval=1, Easy=2`,
    );
    return e.intervalDays;
  });
  await run(
    'M6-10: relearning Hard preserves reduced lapse interval',
    async () => {
      const scheduler = new AnkiScheduler({ next: () => 0.5 }),
        now = new Date();
      const h = scheduler.schedule(
        {
          state: 'relearning',
          easeFactor: 2.3,
          learningStep: 0,
          intervalDays: 1,
          dueAt: now,
        },
        2,
        now,
      );
      const e = scheduler.schedule({ ...h }, 4, h.dueAt);
      assert.equal(
        h.intervalDays,
        1,
        `Hard stores ${h.intervalDays}; subsequent Easy returns ${e.intervalDays}`,
      );
      assert.equal(e.intervalDays, 2);
      return e.intervalDays;
    },
  );
  await run(
    'M6-10: pinned Anki fuzz bounds at 17 days are 14..20',
    async () => {
      const low = fuzzReviewInterval(17, { next: () => 0 }),
        high = fuzzReviewInterval(17, { next: () => 0.9999 });
      assert.deepEqual([low, high], [14, 20]);
      return [low, high];
    },
  );
  await run('M6-11: DST days 23/25h', async () => {
    const tz = 'America/New_York';
    const h = (d) => (nextDayStartUtc(d, tz) - startOfDayUtc(d, tz)) / 3600000;
    assert.equal(h(new Date('2026-03-08T12:00:00Z')), 23);
    assert.equal(h(new Date('2026-11-01T12:00:00Z')), 25);
    return [23, 25];
  });
  await run('M6-12: new queue respects item position', async () => {
    const f = await fixture(),
      a = await card(f);
    await prisma.collectionItem.update({
      where: { id: a.itemId },
      data: { position: 20 },
    });
    const itemId = uuid(),
      faceId = uuid();
    await prisma.collectionItem.create({
      data: {
        id: itemId,
        collectionId: a.collectionId,
        anchorSenseId: 5n,
        meaningVi: 'ăn',
        position: 1,
      },
    });
    await prisma.collectionItemFace.create({
      data: { id: faceId, itemId, senseId: 5n, languageId: 2 },
    });
    const b = await prisma.srsState.create({
      data: {
        faceId,
        userId: f.userId,
        profileId: f.profileId,
        direction: 'recognize',
        dueAt: new Date(Date.now() - 30000),
      },
    });
    const p1 = await get(f, { limit: 1 }),
      p2 = await get(f, { limit: 1, cursor: p1.body.next_cursor });
    assert.deepEqual(
      [p1.body.data[0]?.srs_id, p2.body.data[0]?.srs_id],
      [String(b.id), String(a.id)],
    );
    return 'position 1 before position 20 even with later dueAt/id';
  });
  await run(
    'M6-12: new sibling cursor follows SQL dueAt/id ordering',
    async () => {
      const f = await fixture(),
        a = await card(f),
        b = await card(
          f,
          { direction: 'recall', dueAt: new Date(Date.now() - 120000) },
          a,
        );
      const p1 = await get(f, { limit: 1 });
      assert.equal(p1.body.data[0].srs_id, String(b.id));
      const p2 = await get(f, { limit: 1, cursor: p1.body.next_cursor });
      assert.equal(
        p2.body.data[0]?.srs_id,
        String(a.id),
        `page1=${String(b.id)}; page2=${JSON.stringify(p2.body.data.map((c) => c.srs_id))}; missing=${String(a.id)}`,
      );
      return [String(b.id), String(a.id)];
    },
  );
  await run(
    'M6-13: client reviewed_at rejected, server timestamp retained',
    async () => {
      const f = await fixture(),
        c = await card(f);
      const r = await review(f, c, { reviewed_at: '2026-09-01T00:00:00Z' });
      assert.equal(r.status, 400);
      const t = Date.now(),
        good = await review(f, c);
      assert.equal(good.status, 200);
      assert.ok(new Date(good.body.review_log.reviewed_at).getTime() >= t);
      return [r.status, good.status];
    },
  );
  await run('M6-14: machine provenance on card and meaning', async () => {
    const f = await fixture(),
      c = await card(f);
    await prisma.collectionItem.update({
      where: { id: c.itemId },
      data: { meaningSource: 'machine' },
    });
    const r = await get(f),
      row = r.body.data[0];
    assert.equal(row.meaning_source, 'machine');
    assert.equal(row.is_machine_generated, true);
    assert.equal(row.answer.meaning_source, 'machine');
    assert.equal(row.answer.is_machine_generated, true);
    return 'machine/true at both levels';
  });
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 2;
  })
  .finally(async () => {
    if (prisma && users.length)
      await prisma.user.deleteMany({ where: { id: { in: users } } });
    if (app) await app.close();
    writeFileSync(
      process.argv[2] || '/tmp/langoo-m6-recheck-results.json',
      JSON.stringify({ createdAt: new Date().toISOString(), results }, null, 2),
    );
    console.log(
      JSON.stringify({
        pass: results.filter((r) => r.status === 'PASS').length,
        fail: results.filter((r) => r.status === 'FAIL').length,
        cleanedAuditUsers: users.length,
      }),
    );
    if (results.some((r) => r.status === 'FAIL')) process.exitCode = 1;
  });
