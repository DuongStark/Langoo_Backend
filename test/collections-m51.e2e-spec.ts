import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';

interface AuthBody {
  user: { id: string };
  access_token: string;
}

interface IdBody {
  id: string;
}

interface PageBody<T> {
  data: T[];
  next_cursor: string | null;
}

interface ItemBody {
  id: string;
  anchor_sense_id: string;
  tag_ids: string[];
  meaning_source: string;
}

interface CollectionBody {
  id: string;
}

describe('Collections M5.1 regressions (e2e — langoo_test)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let userId = 0n;
  let token = '';
  let collectionId = '';

  async function api(
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    body?: unknown,
  ): Promise<request.Response> {
    const call = request(server)
      [method](`/v1${path}`)
      .set('Authorization', `Bearer ${token}`);
    return body === undefined ? call : call.send(body as object);
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

    const runId = Date.now();
    const registered = await request(server)
      .post('/v1/auth/register')
      .send({
        email: `e2e-m51-${runId}@langoo.test`,
        password: 'matkhau-e2e-123',
      })
      .expect(201);
    const auth = registered.body as AuthBody;
    userId = BigInt(auth.user.id);
    token = auth.access_token;

    const profile = await api('post', '/profiles', {
      name: 'M5.1 regression',
      primary_language_id: 2,
      secondary_language_id: 1,
      support_language_id: 3,
    });
    expect(profile.status).toBe(201);

    const collection = await api('post', '/collections', {
      name: 'M5.1 regression collection',
    });
    expect(collection.status).toBe(201);
    collectionId = (collection.body as IdBody).id;
  });

  afterAll(async () => {
    if (prisma && userId !== 0n) {
      await prisma.user.delete({ where: { id: userId } });
    }
    await app.close();
  });

  it('rejects unrelated bilingual senses and mismatched concepts before writing', async () => {
    const pair = await api('post', `/collections/${collectionId}/items`, {
      sense_id: '1',
      secondary_sense_id: '6',
      meaning_vi: 'chạy',
    });
    expect(pair.status).toBe(400);
    expect(pair.body).toMatchObject({ code: 'COLLECTION_SENSE_PAIR_INVALID' });

    const concept = await api('post', `/collections/${collectionId}/items`, {
      sense_id: '1',
      concept_id: '3',
      meaning_vi: 'chạy',
    });
    expect(concept.status).toBe(400);
    expect(concept.body).toMatchObject({ code: 'COLLECTION_CONCEPT_INVALID' });

    expect(await prisma.collectionItem.count({ where: { collectionId } })).toBe(
      0,
    );
  });

  it('turns invalid UUID, null, whitespace and bigint inputs into 4xx', async () => {
    const cases = [
      api('get', '/collections/not-a-uuid'),
      api('post', '/collections', { name: '   ' }),
      api('post', '/collections', { name: null }),
      api('post', '/collections/from-deck', {
        deck_id: '9223372036854775808',
      }),
      api('post', `/collections/${collectionId}/items`, {
        sense_id: '9223372036854775808',
        meaning_vi: 'x',
      }),
      api('post', `/collections/${collectionId}/items`, {
        sense_id: '5',
        meaning_vi: '   ',
      }),
      api('get', `/collections/${collectionId}/items?language_id=99999`),
      api('post', '/tags', { name: '   ' }),
      api('post', '/tags', { name: null }),
      api('get', '/tags/abc'),
    ];
    const responses = await Promise.all(cases);
    expect(responses.every((response) => response.status >= 400)).toBe(true);
    expect(responses.some((response) => response.status >= 500)).toBe(false);
  });

  it('paginates collections and tags with stable cursors', async () => {
    for (let index = 0; index < 21; index += 1) {
      expect(
        (
          await api('post', '/collections', {
            name: `M5.1 page collection ${index}`,
          })
        ).status,
      ).toBe(201);
    }
    const firstCollections = await api('get', '/collections?limit=20');
    expect(firstCollections.status).toBe(200);
    const firstCollectionsBody =
      firstCollections.body as PageBody<CollectionBody>;
    expect(firstCollectionsBody.data).toHaveLength(20);
    expect(typeof firstCollectionsBody.next_cursor).toBe('string');

    const secondCollections = await api(
      'get',
      `/collections?limit=20&cursor=${encodeURIComponent(firstCollectionsBody.next_cursor as string)}`,
    );
    expect(secondCollections.status).toBe(200);
    expect(
      (secondCollections.body as PageBody<CollectionBody>).data,
    ).toHaveLength(2);
    expect(
      (secondCollections.body as PageBody<CollectionBody>).next_cursor,
    ).toBeNull();

    for (let index = 0; index < 21; index += 1) {
      expect(
        (await api('post', '/tags', { name: `M5.1 page tag ${index}` })).status,
      ).toBe(201);
    }
    const firstTags = await api('get', '/tags?limit=20');
    expect(firstTags.status).toBe(200);
    const firstTagsBody = firstTags.body as PageBody<IdBody & { name: string }>;
    expect(firstTagsBody.data).toHaveLength(20);
    expect(typeof firstTagsBody.next_cursor).toBe('string');

    const secondTags = await api(
      'get',
      `/tags?limit=20&cursor=${encodeURIComponent(firstTagsBody.next_cursor as string)}`,
    );
    expect(secondTags.status).toBe(200);
    expect(
      (secondTags.body as PageBody<IdBody & { name: string }>).data,
    ).toHaveLength(1);
    expect(
      (secondTags.body as PageBody<IdBody & { name: string }>).next_cursor,
    ).toBeNull();
  });

  it('deduplicates tags and marks an edited meaning as user-owned', async () => {
    const tag = await api('post', '/tags', { name: 'M5.1 duplicate tag' });
    expect(tag.status).toBe(201);
    const tagBody = tag.body as IdBody;

    const item = await api('post', `/collections/${collectionId}/items`, {
      sense_id: '5',
      meaning_vi: 'ăn',
      tag_ids: [tagBody.id, tagBody.id],
    });
    expect(item.status).toBe(201);
    const itemBody = item.body as ItemBody;
    expect(itemBody.tag_ids).toEqual([tagBody.id]);

    const retagged = await api(
      'patch',
      `/collections/${collectionId}/items/${itemBody.id}`,
      { tag_ids: [tagBody.id, tagBody.id] },
    );
    expect(retagged.status).toBe(200);
    expect((retagged.body as ItemBody).tag_ids).toEqual([tagBody.id]);

    const clone = await api('post', '/collections/from-deck', {
      deck_id: '1',
    });
    expect(clone.status).toBe(201);
    const clonedItems = await api(
      'get',
      `/collections/${(clone.body as IdBody).id}/items?limit=100`,
    );
    const clonedItem = (clonedItems.body as PageBody<ItemBody>).data.find(
      (row: { anchor_sense_id: string }) => row.anchor_sense_id === '1',
    );
    expect(clonedItem).toBeDefined();
    const edited = await api(
      'patch',
      `/collections/${(clone.body as IdBody).id}/items/${(clonedItem as ItemBody).id}`,
      { meaning_vi: 'nghĩa do người dùng sửa' },
    );
    expect(edited.status).toBe(200);
    expect((edited.body as ItemBody).meaning_source).toBe('user');
  });

  it('handles maximum position and concurrent deletes without 500', async () => {
    const positionCollection = await api('post', '/collections', {
      name: 'M5.1 position limit',
    });
    const positioned = await api(
      'post',
      `/collections/${(positionCollection.body as IdBody).id}/items`,
      { sense_id: '7', meaning_vi: 'position' },
    );
    await api(
      'patch',
      `/collections/${(positionCollection.body as IdBody).id}/items/${(positioned.body as IdBody).id}`,
      { position: 2147483647 },
    );
    const overflow = await api(
      'post',
      `/collections/${(positionCollection.body as IdBody).id}/items`,
      { sense_id: '9', meaning_vi: 'overflow' },
    );
    expect(overflow.status).toBe(409);
    expect(overflow.body).toMatchObject({
      code: 'COLLECTION_POSITION_LIMIT_REACHED',
    });

    const deletable = await api('post', `/collections/${collectionId}/items`, {
      sense_id: '7',
      meaning_vi: 'xóa đồng thời',
    });
    const itemDeletes = await Promise.all(
      Array.from({ length: 3 }, () =>
        api(
          'delete',
          `/collections/${collectionId}/items/${(deletable.body as IdBody).id}`,
        ),
      ),
    );
    expect(itemDeletes.map((response) => response.status).sort()).toEqual([
      200, 404, 404,
    ]);

    const raceTag = await api('post', '/tags', { name: 'M5.1 delete race' });
    const tagDeletes = await Promise.all(
      Array.from({ length: 3 }, () =>
        api('delete', `/tags/${(raceTag.body as IdBody).id}`),
      ),
    );
    expect(tagDeletes.map((response) => response.status).sort()).toEqual([
      200, 404, 404,
    ]);
  });
});
