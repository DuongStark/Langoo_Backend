import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import type { Server } from 'node:http';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';
import { AI_CHAT_PROVIDER } from '../src/ai/providers/ai-chat.provider';
import { PrivacyService } from '../src/privacy/privacy.service';

interface Account {
  token: string;
  id: bigint;
}
describe('M12.1 privacy HTTP/DB', () => {
  let app: INestApplication;
  let server: Server;
  let db: PrismaService;
  let config: ConfigService;
  let owner: Account;
  let other: Account;
  let admin: Account;
  let version: string;
  const users: bigint[] = [];
  const chat = jest.fn().mockResolvedValue({
    content: 'hello',
    model: 'test',
    tokensIn: 1,
    tokensOut: 1,
    costUsd: 0,
  });
  async function account(label: string): Promise<Account> {
    const r = await request(server)
      .post('/v1/auth/register')
      .send({
        email: `m121-${Date.now()}-${label}@langoo.test`,
        password: 'm121-test-password',
      })
      .expect(201);
    const b = r.body as { access_token: string; user: { id: string } };
    const a = { token: b.access_token, id: BigInt(b.user.id) };
    users.push(a.id);
    return a;
  }
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_CHAT_PROVIDER)
      .useValue({ name: 'openai', chat })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    server = app.getHttpServer() as Server;
    db = app.get(PrismaService);
    config = app.get(ConfigService);
    config.set('PRIVACY_AI_CONSENT_REQUIRED', true);
    owner = await account('owner');
    other = await account('other');
    admin = await account('admin');
    await db.user.update({ where: { id: admin.id }, data: { role: 'admin' } });
    version = app.get(PrivacyService).manifest().notice_version;
  });
  afterAll(async () => {
    if (db) await db.user.deleteMany({ where: { id: { in: users } } });
    await app?.close();
  });
  function auth(a: Account) {
    return { Authorization: `Bearer ${a.token}` };
  }
  const event = (notice: string, action = 'grant', id = uuidv7()) => ({
    purpose_id: 'ai_assistance',
    action,
    notice_version: notice,
    request_id: id,
  });
  it('publishes no minimum age and typed Swagger contract for the new routes', async () => {
    const r = await request(server).get('/v1/legal/manifest').expect(200);
    expect((r.body as { age_policy: unknown }).age_policy).toEqual({
      minimum_age: null,
      representative_verification: 'not_implemented',
    });
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth().build(),
    );
    expect(
      doc.paths['/v1/me/privacy/requests'].post?.responses['202'],
    ).toBeDefined();
    expect(doc.components?.schemas?.PrivacyRequestResponse).toHaveProperty(
      'properties.resolution_reference.type',
      'string',
    );
  });
  it('requires auth and rejects unknown purpose, old version, extra fields and null', async () => {
    await request(server).get('/v1/me/privacy').expect(401);
    await request(server)
      .post('/v1/me/privacy/events')
      .set(auth(owner))
      .send(event('', 'withdraw'))
      .expect(400);
    await request(server)
      .post('/v1/me/privacy/events')
      .set(auth(owner))
      .send({ ...event(version), purpose_id: 'all' })
      .expect(400);
    await request(server)
      .post('/v1/me/privacy/events')
      .set(auth(owner))
      .send(event('old'))
      .expect(409);
    await request(server)
      .post('/v1/me/privacy/events')
      .set(auth(owner))
      .send({ ...event(version), user_id: String(other.id) })
      .expect(400);
    await request(server)
      .post('/v1/me/privacy/events')
      .set(auth(owner))
      .send({ ...event(version), action: null })
      .expect(400);
  });
  it('deduplicates concurrent retries and preserves a later withdrawal against replay', async () => {
    const payload = event(version);
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        request(server)
          .post('/v1/me/privacy/events')
          .set(auth(owner))
          .send(payload)
          .expect(201),
      ),
    );
    expect(
      new Set(results.map((r) => (r.body as { id: string }).id)).size,
    ).toBe(1);
    expect(
      await db.privacyEvent.count({
        where: { userId: owner.id, requestId: payload.request_id },
      }),
    ).toBe(1);
    await request(server)
      .post('/v1/me/privacy/events')
      .set(auth(owner))
      .send({ ...payload, action: 'withdraw' })
      .expect(409);
    await request(server)
      .post('/v1/me/privacy/events')
      .set(auth(owner))
      .send(event('old-version', 'withdraw'))
      .expect(201);
    await request(server)
      .post('/v1/me/privacy/events')
      .set(auth(owner))
      .send(payload)
      .expect(201);
    const state = await request(server)
      .get('/v1/me/privacy')
      .set(auth(owner))
      .expect(200);
    expect(state.body).toHaveProperty(
      'choices',
      expect.arrayContaining([
        { purpose_id: 'ai_assistance', state: 'withdrawn' },
      ]),
    );
    const isolated = await request(server)
      .get('/v1/me/privacy')
      .set(auth(other))
      .expect(200);
    expect(isolated.body).toHaveProperty(
      'choices',
      expect.arrayContaining([
        { purpose_id: 'ai_assistance', state: 'needs_action' },
      ]),
    );
  });
  it('tracks a rights request without claiming erasure and enforces owner/admin scope', async () => {
    const payload = { kind: 'erasure', request_id: uuidv7() };
    const r = await request(server)
      .post('/v1/me/privacy/requests')
      .set(auth(owner))
      .send(payload)
      .expect(202);
    const body = r.body as {
      id: string;
      status: string;
      received_at: string;
      target_at: string;
    };
    expect(body.status).toBe('received');
    expect(
      new Date(body.target_at).getTime() - new Date(body.received_at).getTime(),
    ).toBe(20 * 86400000);
    const retry = await request(server)
      .post('/v1/me/privacy/requests')
      .set(auth(owner))
      .send(payload)
      .expect(202);
    expect(retry.body).toHaveProperty('id', body.id);
    await request(server)
      .get(`/v1/me/privacy/requests/${body.id}`)
      .set(auth(other))
      .expect(404);
    await request(server)
      .get('/v1/admin/privacy/requests')
      .set(auth(owner))
      .expect(403);
    await request(server)
      .patch(`/v1/admin/privacy/requests/${body.id}`)
      .set(auth(admin))
      .send({ status: 'completed' })
      .expect(400);
    await request(server)
      .patch(`/v1/admin/privacy/requests/${body.id}`)
      .set(auth(admin))
      .send({ status: 'in_progress' })
      .expect(200);
    const queue = await request(server)
      .get('/v1/admin/privacy/requests')
      .set(auth(admin))
      .expect(200);
    expect(queue.body).toHaveProperty(
      'data',
      expect.arrayContaining([
        expect.objectContaining({ id: body.id, user_id: String(owner.id) }),
      ]),
    );
    expect(
      await db.adminAuditLog.count({
        where: { adminUserId: admin.id, targetId: body.id },
      }),
    ).toBe(1);
    expect(
      await db.user.findUnique({ where: { id: owner.id } }),
    ).not.toBeNull();
  });
  it('blocks normal/stream AI before calling provider and honors withdrawal with rollout off', async () => {
    await request(server)
      .post('/v1/profiles')
      .set(auth(other))
      .send({ name: 'test', primary_language_id: 1, support_language_id: 3 })
      .expect(201);
    const r = await request(server)
      .post('/v1/chat/sessions')
      .set(auth(other))
      .send({ language_id: 1 })
      .expect(201);
    const id = (r.body as { id: string }).id;
    for (const suffix of ['messages', 'messages/stream']) {
      await request(server)
        .post(`/v1/chat/sessions/${id}/${suffix}`)
        .set(auth(other))
        .send({ content: 'hello' })
        .expect(403);
    }
    expect(chat).not.toHaveBeenCalled();
    expect(await db.aiUsage.count({ where: { userId: other.id } })).toBe(0);
    await request(server)
      .post('/v1/me/privacy/events')
      .set(auth(other))
      .send(event(version))
      .expect(201);
    await request(server)
      .post(`/v1/chat/sessions/${id}/messages`)
      .set(auth(other))
      .send({ content: 'hello' })
      .expect(200);
    expect(chat).toHaveBeenCalledTimes(1);
    await request(server)
      .post('/v1/me/privacy/events')
      .set(auth(other))
      .send(event(version, 'withdraw'))
      .expect(201);
    config.set('PRIVACY_AI_CONSENT_REQUIRED', false);
    await request(server)
      .post(`/v1/chat/sessions/${id}/messages`)
      .set(auth(other))
      .send({ content: 'hello' })
      .expect(403);
    expect(chat).toHaveBeenCalledTimes(1);
  });
  it('records terms idempotently without granting optional services and scopes state', async () => {
    const initial = await request(server)
      .get('/v1/me/legal/terms')
      .set(auth(other))
      .expect(200);
    expect(initial.body).toMatchObject({
      terms_version: '2026-11-04-v1',
      status: 'needs_action',
      latest_acceptance: null,
    });
    const before = await request(server)
      .get('/v1/me/privacy')
      .set(auth(owner))
      .expect(200);
    const body = { terms_version: '2026-11-04-v1', request_id: uuidv7() };
    const receipts = await Promise.all(
      [1, 2, 3].map(() =>
        request(server)
          .post('/v1/me/legal/terms')
          .set(auth(owner))
          .send(body)
          .expect(201),
      ),
    );
    expect(
      new Set(receipts.map((r) => (r.body as { id: string }).id)).size,
    ).toBe(1);
    expect(receipts[0].body).toMatchObject(body);
    const rows = await db.$queryRaw<
      Array<{ count: bigint }>
    >`SELECT count(*) AS count FROM app.terms_acceptance WHERE user_id=${owner.id} AND request_id=${body.request_id}::uuid`;
    expect(rows[0].count).toBe(1n);
    const after = await request(server)
      .get('/v1/me/privacy')
      .set(auth(owner))
      .expect(200);
    expect(after.body).toEqual(before.body);
    const state = await request(server)
      .get('/v1/me/legal/terms')
      .set(auth(owner))
      .expect(200);
    expect(state.body).toMatchObject({
      status: 'accepted',
      latest_acceptance: { id: (receipts[0].body as { id: string }).id },
    });
    const otherState = await request(server)
      .get('/v1/me/legal/terms')
      .set(auth(other))
      .expect(200);
    expect(otherState.body).toMatchObject({
      status: 'needs_action',
      latest_acceptance: null,
    });
    await request(server)
      .post('/v1/me/legal/terms')
      .set(auth(other))
      .send(body)
      .expect(201);
  });
  it('validates terms consent input, auth and versions without writing invalid receipts', async () => {
    const route = '/v1/me/legal/terms';
    await request(server).get(route).expect(401);
    const body = { terms_version: '2026-11-04-v1', request_id: uuidv7() };
    await request(server).post(route).send(body).expect(401);
    for (const invalid of [
      { ...body, terms_version: '' },
      { ...body, terms_version: null },
      { ...body, request_id: 'invalid' },
      { ...body, user_id: String(other.id) },
      { ...body, accept_all: true },
    ]) {
      await request(server)
        .post(route)
        .set(auth(owner))
        .send(invalid)
        .expect(400);
    }
    const old = await request(server)
      .post(route)
      .set(auth(owner))
      .send({ ...body, terms_version: 'old' })
      .expect(409);
    expect(old.body).toMatchObject({ code: 'TERMS_VERSION_OUTDATED' });
    await request(server).post(route).set(auth(owner)).send(body).expect(201);
    const conflict = await request(server)
      .post(route)
      .set(auth(owner))
      .send({ ...body, terms_version: 'old' })
      .expect(409);
    expect(conflict.body).toMatchObject({ code: 'TERMS_REQUEST_CONFLICT' });
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    expect(doc.paths['/v1/me/legal/terms'].get?.responses['200']).toBeDefined();
    expect(
      doc.paths['/v1/me/legal/terms'].post?.responses['201'],
    ).toBeDefined();
  });
});
