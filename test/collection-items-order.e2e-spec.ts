import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';
interface Item {
  id: string;
  position: number;
}
interface Page {
  data: Item[];
  next_cursor: string | null;
}
describe('M5.2 collection item order (local test DB)', () => {
  let app: INestApplication,
    server: Server,
    prisma: PrismaService,
    userId = 0n,
    token = '',
    collectionId = '';
  let fixtures: Item[] = [];
  const list = (query: Record<string, unknown>) =>
    request(server)
      .get(`/v1/collections/${collectionId}/items`)
      .set('Authorization', `Bearer ${token}`)
      .query(query);
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    const auth = await request(server)
      .post('/v1/auth/register')
      .send({
        email: `e2e-m52-${Date.now()}@langoo.test`,
        password: 'matkhau-e2e-123',
      })
      .expect(201);
    const body = auth.body as { user: { id: string }; access_token: string };
    userId = BigInt(body.user.id);
    token = body.access_token;
    await request(server)
      .post('/v1/profiles')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'M5.2',
        primary_language_id: 2,
        secondary_language_id: 1,
        support_language_id: 3,
      })
      .expect(201);
    const collection = await request(server)
      .post('/v1/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'M5.2 ordering' })
      .expect(201);
    collectionId = (collection.body as { id: string }).id;
    for (const sense_id of ['1', '5', '7', '9']) {
      const added = await request(server)
        .post(`/v1/collections/${collectionId}/items`)
        .set('Authorization', `Bearer ${token}`)
        .send({ sense_id, meaning_vi: 'M5.2 test' })
        .expect(201);
      fixtures.push(added.body as Item);
    }
    for (let i = 0; i < fixtures.length; i++) {
      const position = [1, 2, 2, 101][i];
      await prisma.collectionItem.update({
        where: { id: fixtures[i].id },
        data: { position },
      });
      fixtures[i].position = position;
    }
    fixtures = fixtures.sort(
      (a, b) =>
        b.position - a.position || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
    );
  });
  afterAll(async () => {
    if (prisma && userId) await prisma.user.delete({ where: { id: userId } });
    if (app) await app.close();
  });
  it('starts from highest position and paginates tied positions without duplicates or omissions', async () => {
    const first = (
      await list({
        order: 'desc',
        limit: 2,
        language_id: 2,
        status: 'learning',
      }).expect(200)
    ).body as Page;
    expect(first.data.map((x) => x.id)).toEqual(
      fixtures.slice(0, 2).map((x) => x.id),
    );
    expect(first.next_cursor).not.toBeNull();
    const second = (
      await list({
        order: 'desc',
        limit: 2,
        language_id: 2,
        status: 'learning',
        cursor: first.next_cursor,
      }).expect(200)
    ).body as Page;
    expect(second.data.map((x) => x.id)).toEqual(
      fixtures.slice(2).map((x) => x.id),
    );
    expect(second.next_cursor).toBeNull();
    expect(new Set([...first.data, ...second.data].map((x) => x.id)).size).toBe(
      4,
    );
  });
  it('keeps default ascending and the existing maximum page size', async () => {
    const defaultPage = (await list({ limit: 100 }).expect(200)).body as Page;
    const ascending = (await list({ order: 'asc', limit: 100 }).expect(200))
      .body as Page;
    expect(defaultPage.data.map((x) => x.id)).toEqual(
      [...fixtures].reverse().map((x) => x.id),
    );
    expect(ascending).toEqual(defaultPage);
    await list({ order: 'desc', limit: 101 }).expect(400);
  });
  it('rejects invalid directions and cursors reused after changing direction', async () => {
    for (const order of ['DESC', '', 'newest'])
      await list({ order }).expect(400);
    const desc = (await list({ order: 'desc', limit: 2 }).expect(200))
      .body as Page;
    const asc = (await list({ limit: 2 }).expect(200)).body as Page;
    await list({ order: 'asc', cursor: desc.next_cursor }).expect(400);
    await list({ order: 'desc', cursor: asc.next_cursor }).expect(400);
  });
});
