import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';

interface CollectionBody {
  id: string;
  profile_id: string;
  owner_id: string;
  name: string;
  kind: string;
  cloned_from_deck_id: string | null;
  item_count: number;
  archived_at: string | null;
}

interface ItemFaceBody {
  id: string;
  sense_id: string;
  language_id: number;
  role: string;
}

interface ItemBody {
  id: string;
  collection_id: string;
  anchor_sense_id: string;
  meaning_vi: string;
  meaning_source: string;
  note: string | null;
  status: string;
  position: number;
  faces: ItemFaceBody[];
  tag_ids: string[];
}

interface TagBody {
  id: string;
  name: string;
}

interface ListBody<T> {
  data: T[];
  next_cursor: string | null;
}

describe('Collections (e2e — langoo_test)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;

  const runId = Date.now();
  const emailA = `e2e-m5-a-${runId}@langoo.test`;
  const emailB = `e2e-m5-b-${runId}@langoo.test`;
  const password = 'matkhau-e2e-123';

  let tokenA = '';
  let tokenB = '';
  let userIdA = 0n;
  let collectionA: CollectionBody;
  let item1: ItemBody;

  async function registerUser(email: string): Promise<{
    accessToken: string;
    userId: bigint;
  }> {
    const res = await request(server)
      .post('/v1/auth/register')
      .send({ email, password })
      .expect(201);
    const body = res.body as { user: { id: string }; access_token: string };
    return { accessToken: body.access_token, userId: BigInt(body.user.id) };
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

    const a = await registerUser(emailA);
    const b = await registerUser(emailB);
    tokenA = a.accessToken;
    tokenB = b.accessToken;
    userIdA = a.userId;

    // User A tạo hồ sơ Nhật–Việt để có chỗ gắn collection
    await request(server)
      .post('/v1/profiles')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        name: 'Nhật–Việt',
        primary_language_id: 2,
        secondary_language_id: 1,
        support_language_id: 3,
      })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('collection CRUD', () => {
    it('tạo collection + danh sách + chi tiết', async () => {
      const created = await request(server)
        .post('/v1/collections')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Bộ của tôi' })
        .expect(201);
      collectionA = created.body as CollectionBody;

      expect(collectionA).toMatchObject({
        name: 'Bộ của tôi',
        kind: 'personal',
        item_count: 0,
        archived_at: null,
      });
      expect(collectionA.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(collectionA.owner_id).toBe(userIdA.toString());

      const list = await request(server)
        .get('/v1/collections')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(
        (list.body as ListBody<CollectionBody>).data.some(
          (c) => c.id === collectionA.id,
        ),
      ).toBe(true);

      const detail = await request(server)
        .get(`/v1/collections/${collectionA.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect((detail.body as CollectionBody).id).toBe(collectionA.id);
    });
  });

  describe('thêm từ: 走る + chọn thêm run', () => {
    it('tạo item 2 face và sinh đúng 2 srs_state', async () => {
      const res = await request(server)
        .post(`/v1/collections/${collectionA.id}/items`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ sense_id: '1', secondary_sense_id: '2', meaning_vi: 'chạy' })
        .expect(201);
      item1 = res.body as ItemBody;

      expect(item1.faces).toHaveLength(2);
      expect(item1.faces.find((f) => f.role === 'primary')).toMatchObject({
        sense_id: '1',
        language_id: 2,
      });
      expect(item1.faces.find((f) => f.role === 'secondary')).toMatchObject({
        sense_id: '2',
        language_id: 1,
      });
      expect(item1.meaning_vi).toBe('chạy');
      expect(item1.meaning_source).toBe('user');

      const srsCount = await prisma.srsState.count({
        where: { face: { itemId: item1.id } },
      });
      expect(srsCount).toBe(2);

      const collection = await prisma.collection.findUniqueOrThrow({
        where: { id: collectionA.id },
      });
      expect(collection.itemCount).toBe(1);
    });

    it('mặt phụ cùng ngôn ngữ → 400 COLLECTION_FACE_LANGUAGE_DUPLICATE', async () => {
      const res = await request(server)
        .post(`/v1/collections/${collectionA.id}/items`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ sense_id: '1', secondary_sense_id: '3', meaning_vi: 'chạy' })
        .expect(400);
      expect(res.body).toMatchObject({
        code: 'COLLECTION_FACE_LANGUAGE_DUPLICATE',
      });
    });

    it('trùng từ trong bộ → 409 ITEM_ALREADY_EXISTS', async () => {
      const res = await request(server)
        .post(`/v1/collections/${collectionA.id}/items`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ sense_id: '1', meaning_vi: 'chạy lần 2' })
        .expect(409);
      expect(res.body).toMatchObject({ code: 'ITEM_ALREADY_EXISTS' });
    });

    it('lọc theo ngôn ngữ + phân trang cursor', async () => {
      // thêm 3 từ nữa (mỗi từ 1 face ja)
      for (const senseId of ['5', '7', '9']) {
        await request(server)
          .post(`/v1/collections/${collectionA.id}/items`)
          .set('Authorization', `Bearer ${tokenA}`)
          .send({ sense_id: senseId, meaning_vi: `nghĩa ${senseId}` })
          .expect(201);
      }

      const byJa = await request(server)
        .get(`/v1/collections/${collectionA.id}/items`)
        .query({ language_id: 2 })
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect((byJa.body as ListBody<ItemBody>).data).toHaveLength(4);

      const byEn = await request(server)
        .get(`/v1/collections/${collectionA.id}/items`)
        .query({ language_id: 1 })
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect((byEn.body as ListBody<ItemBody>).data).toHaveLength(1);

      const invalidLang = await request(server)
        .get(`/v1/collections/${collectionA.id}/items`)
        .query({ language_id: 99 })
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(400);
      expect(invalidLang.body).toMatchObject({ code: 'LANGUAGE_NOT_FOUND' });

      const page1 = await request(server)
        .get(`/v1/collections/${collectionA.id}/items`)
        .query({ limit: 2 })
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const page1Body = page1.body as ListBody<ItemBody>;
      expect(page1Body.data).toHaveLength(2);
      expect(page1Body.next_cursor).not.toBeNull();

      const page2 = await request(server)
        .get(`/v1/collections/${collectionA.id}/items`)
        .query({ limit: 2, cursor: page1Body.next_cursor })
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const page2Body = page2.body as ListBody<ItemBody>;
      expect(page2Body.data).toHaveLength(2);

      const ids = [...page1Body.data, ...page2Body.data].map((i) => i.id);
      expect(new Set(ids).size).toBe(4);
    });
  });

  describe('sửa item + tag', () => {
    it('gắn tag + note, đọc lại đúng', async () => {
      const tagRes = await request(server)
        .post('/v1/tags')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: '#n5', color: '#4f46e5' })
        .expect(201);
      const tag = tagRes.body as TagBody;

      const duplicate = await request(server)
        .post('/v1/tags')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: '#N5' })
        .expect(409);
      expect(duplicate.body).toMatchObject({ code: 'TAG_ALREADY_EXISTS' });

      const updated = await request(server)
        .patch(`/v1/collections/${collectionA.id}/items/${item1.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ note: 'ôn trước khi ngủ', tag_ids: [tag.id] })
        .expect(200);
      const updatedBody = updated.body as ItemBody;
      expect(updatedBody.note).toBe('ôn trước khi ngủ');
      expect(updatedBody.tag_ids).toEqual([tag.id]);

      const tags = await request(server)
        .get('/v1/tags')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect((tags.body as ListBody<TagBody>).data).toHaveLength(1);
    });

    it('xoá item → cascade srs_state + giảm item_count', async () => {
      await request(server)
        .delete(`/v1/collections/${collectionA.id}/items/${item1.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      const srsCount = await prisma.srsState.count({
        where: { face: { itemId: item1.id } },
      });
      expect(srsCount).toBe(0);

      const collection = await prisma.collection.findUniqueOrThrow({
        where: { id: collectionA.id },
      });
      expect(collection.itemCount).toBe(3);
    });
  });

  describe('clone deck N5', () => {
    it('clone deck 1 → 11 item, 11 srs_state, nghĩa lấy từ gloss', async () => {
      const res = await request(server)
        .post('/v1/collections/from-deck')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ deck_id: '1' })
        .expect(201);
      const cloned = res.body as CollectionBody;

      expect(cloned).toMatchObject({
        kind: 'cloned',
        cloned_from_deck_id: '1',
        name: 'JLPT N5 (demo)',
        item_count: 11,
      });

      const srsCount = await prisma.srsState.count({
        where: { face: { item: { collectionId: cloned.id } }, userId: userIdA },
      });
      expect(srsCount).toBe(11);

      const items = await request(server)
        .get(`/v1/collections/${cloned.id}/items`)
        .query({ limit: 100 })
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const data = (items.body as ListBody<ItemBody>).data;
      expect(data).toHaveLength(11);

      const tsuku = data.find((i) => i.anchor_sense_id === '1');
      expect(tsuku).toMatchObject({
        meaning_vi: 'chạy',
        meaning_source: 'source',
        added_from_deck_id: '1',
      });
    });

    it('deck sai → 404 DECK_NOT_FOUND', async () => {
      const res = await request(server)
        .post('/v1/collections/from-deck')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ deck_id: '999' })
        .expect(404);
      expect(res.body).toMatchObject({ code: 'DECK_NOT_FOUND' });
    });
  });

  describe('cách ly user & xác thực', () => {
    it('user B chưa có hồ sơ → tạo collection 409 PROFILE_REQUIRED', async () => {
      const res = await request(server)
        .post('/v1/collections')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ name: 'Bộ của B' })
        .expect(409);
      expect(res.body).toMatchObject({ code: 'PROFILE_REQUIRED' });
    });

    it('user B đọc collection của A → 404', async () => {
      const res = await request(server)
        .get(`/v1/collections/${collectionA.id}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
      expect(res.body).toMatchObject({ code: 'COLLECTION_NOT_FOUND' });

      await request(server)
        .get(`/v1/collections/${collectionA.id}/items`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
    });

    it('không token → 401', async () => {
      const res = await request(server).get('/v1/collections').expect(401);
      expect(res.body).toMatchObject({ code: 'AUTH_TOKEN_MISSING' });
    });
  });
});
