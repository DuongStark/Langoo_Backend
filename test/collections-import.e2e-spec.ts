import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';
import {
  IMPORT_MAX_ITEMS,
  ImportItemsResponseDto,
} from '../src/collections/dto/import-items.dto';

interface SampleLexemeRow {
  lemma: string;
  reading: string | null;
  pos: string;
}

describe('Collections Auto Import List M5.3 (e2e — langoo_test)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;

  const runId = Date.now();
  const emailA = `e2e-m53-a-${runId}@langoo.test`;
  const emailB = `e2e-m53-b-${runId}@langoo.test`;
  const password = 'matkhau-e2e-123';

  let tokenA = '';
  let tokenB = '';
  let userIdA = 0n;
  let profileIdA = '';
  let createdCollectionId = '';
  let jaSamples: SampleLexemeRow[] = [];
  let enSample: SampleLexemeRow = { lemma: 'run', reading: null, pos: 'verb' };

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

    // User A tạo hồ sơ Nhật-only để testทั้ง khớp JA và language_not_in_profile với EN
    const profileRes = await request(server)
      .post('/v1/profiles')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        name: 'Nhật–Việt (M5.3)',
        primary_language_id: 2,
        support_language_id: 3,
      })
      .expect(201);
    profileIdA = (profileRes.body as { id: string }).id;

    jaSamples = await prisma.$queryRaw<SampleLexemeRow[]>`
      SELECT DISTINCT ON (l.lemma)
        l.lemma,
        l.reading,
        COALESCE(l.pos, 'noun') AS pos
      FROM core.lexeme l
      WHERE l.language_id = 2
        AND l.reading IS NOT NULL
        AND EXISTS (SELECT 1 FROM core.sense s WHERE s.lexeme_id = l.id)
      ORDER BY l.lemma ASC, l.id ASC
      LIMIT 4
    `;

    const enRows = await prisma.$queryRaw<SampleLexemeRow[]>`
      SELECT
        l.lemma,
        l.reading,
        COALESCE(l.pos, 'verb') AS pos
      FROM core.lexeme l
      WHERE l.language_id = 1
        AND EXISTS (SELECT 1 FROM core.sense s WHERE s.lexeme_id = l.id)
      ORDER BY l.id ASC
      LIMIT 1
    `;
    if (enRows[0]) enSample = enRows[0];
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /v1/collections/import — 409 PROFILE_REQUIRED khi user chưa tạo hồ sơ học', async () => {
    await request(server)
      .post('/v1/collections/import')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        name: 'Chưa có profile',
        items: [{ word: jaSamples[0].lemma }],
      })
      .expect(409);
  });

  it('POST /v1/collections/import — 422 khi 0 từ khớp và không tạo collection rỗng', async () => {
    const beforeCount = await prisma.collection.count({
      where: { ownerId: userIdA },
    });

    const res = await request(server)
      .post('/v1/collections/import')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        name: 'Bộ rỗng không được tạo',
        items: [
          { word: 'khongtontaitrongtudien99999' },
          { word: '〜てはいけない', type: 'grammar' },
        ],
      })
      .expect(422);

    const body = res.body as {
      code: string;
      details: { not_found_count: number; not_found: { reason: string }[] };
    };
    expect(body.code).toBe('IMPORT_NO_MATCHED_ITEMS');
    expect(body.details.not_found_count).toBe(2);
    expect(body.details.not_found.map((n) => n.reason)).toEqual([
      'not_in_dictionary',
      'unsupported_type',
    ]);

    const afterCount = await prisma.collection.count({
      where: { ownerId: userIdA },
    });
    expect(afterCount).toBe(beforeCount);
  });

  it('POST /v1/collections/import — tạo bộ mới với payload Mazii (phonetic, mean, type), inline reading/POS và báo đủ not_found', async () => {
    const sample1 = jaSamples[0];
    const sample2 = jaSamples[1];

    const res = await request(server)
      .post('/v1/collections/import')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        name: 'Mazii Import Test',
        description: 'Bộ từ import từ Mazii',
        items: [
          // 1. Định dạng Mazii đủ cột phonetic, mean, note, type
          {
            word: sample1.lemma,
            phonetic: sample1.reading ?? undefined,
            mean: 'nghĩa từ file Mazii (bỏ qua, lấy nghĩa chuẩn từ điển)',
            note: 'từ mẫu 1',
            type: 'word',
          },
          // 2. Trùng ngay trong cùng request (kèm chú thích kana trong ngoặc)
          {
            word: sample1.reading
              ? `${sample1.lemma}（${sample1.reading}）`
              : sample1.lemma,
          },
          // 3. Từ thứ 2 gửi kèm POS trong ngoặc
          {
            word: `${sample2.lemma} (${sample2.pos})`,
          },
          // 4. Từ tiếng Anh trong hồ sơ Nhật-only -> language_not_in_profile
          { word: enSample.lemma },
          // 5. Dòng ngữ pháp Mazii -> unsupported_type
          { word: '〜てはいけない', type: 'grammar' },
          // 6. Từ không có trong từ điển -> not_in_dictionary
          { word: 'khongtontaitrongtudien88888' },
        ],
      })
      .expect(201);

    const body = res.body as ImportItemsResponseDto;
    createdCollectionId = body.collection.id;

    expect(body.total_submitted).toBe(6);
    expect(body.added_count).toBe(2);
    expect(body.skipped_duplicate_count).toBe(1);
    expect(body.not_found_count).toBe(3);
    expect(body.collection.name).toBe('Mazii Import Test');
    expect(body.collection.item_count).toBe(2);
    expect(body.collection.visible_item_count).toBe(2);
    expect(body.added[0].pos_matched).toBe(true);
    expect(body.added[1].pos_matched).toBe(true);
    expect(body.skipped_duplicates[0].reason).toBe('duplicate_in_request');
    expect(body.not_found.map((n) => n.reason)).toEqual([
      'language_not_in_profile',
      'unsupported_type',
      'not_in_dictionary',
    ]);

    const srsCount = await prisma.srsState.count({
      where: {
        userId: userIdA,
        face: { item: { collectionId: createdCollectionId } },
      },
    });
    expect(srsCount).toBe(2);
  });

  it('POST /v1/collections/:id/items/import — fallback khi lệch POS, khớp bằng kana reading, bỏ qua từ đã có và nối tiếp position', async () => {
    const sample1 = jaSamples[0];
    const sample3 = jaSamples[2];
    const sample4 = jaSamples[3];
    const mismatchedPos = sample3.pos === 'noun' ? 'verb' : 'noun';

    const res = await request(server)
      .post(`/v1/collections/${createdCollectionId}/items/import`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        status: 'known',
        items: [
          // Đã có trong bộ ở bước trên
          { word: sample1.lemma },
          // Lệch POS -> vẫn khớp nhờ fallback theo mặt chữ (pos_matched = false)
          { word: sample3.lemma, pos: mismatchedPos, note: 'fallback pos' },
          // Gõ bằng kana reading (nếu sample4 có reading khác lemma)
          { word: sample4.reading ?? sample4.lemma },
          // Từ không tồn tại
          { word: 'khongtontaitrongtudien77777' },
        ],
      })
      .expect(201);

    const body = res.body as ImportItemsResponseDto;
    expect(body.added_count).toBeGreaterThanOrEqual(1);
    expect(body.skipped_duplicate_count).toBeGreaterThanOrEqual(1);
    expect(
      body.skipped_duplicates.some((d) => d.reason === 'already_in_collection'),
    ).toBe(true);

    const fallbackItem = body.added.find((a) => a.word === sample3.lemma);
    expect(fallbackItem).toBeDefined();
    expect(fallbackItem?.pos_matched).toBe(false);
    expect(body.not_found).toEqual([
      {
        index: 3,
        word: 'khongtontaitrongtudien77777',
        pos: null,
        reason: 'not_in_dictionary',
      },
    ]);
  });

  it('GET /v1/collections/:id/items?include=display & GET /v1/me/saved-senses — đồng bộ hoàn toàn với các từ vừa import', async () => {
    const listRes = await request(server)
      .get(
        `/v1/collections/${createdCollectionId}/items?include=display&limit=20`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const listBody = listRes.body as {
      data: {
        id: string;
        anchor_sense_id: string;
        meaning_vi: string;
        status: string;
        position: number;
        display: { lemma: string } | null;
      }[];
    };
    expect(listBody.data.length).toBeGreaterThanOrEqual(3);
    expect(listBody.data.map((i) => i.position)).toEqual(
      listBody.data.map((_, idx) => idx + 1),
    );
    expect(listBody.data[0].display?.lemma).toBeDefined();

    const firstSenseId = listBody.data[0].anchor_sense_id;
    const savedRes = await request(server)
      .get(
        `/v1/me/saved-senses?profile_id=${profileIdA}&sense_ids=${firstSenseId}`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const savedBody = savedRes.body as {
      data: { sense_id: string; saved_collection_ids: string[] }[];
    };
    expect(savedBody.data[0].saved_collection_ids).toContain(
      createdCollectionId,
    );
  });

  it('kiểm tra quyền sở hữu (404) và validation (400 cho rỗng, >500 dòng, status sai, word trắng)', async () => {
    // User B không thể import vào collection của User A
    await request(server)
      .post(`/v1/collections/${createdCollectionId}/items/import`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ items: [{ word: jaSamples[0].lemma }] })
      .expect(404);

    // items rỗng
    await request(server)
      .post(`/v1/collections/${createdCollectionId}/items/import`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ items: [] })
      .expect(400);

    // word chỉ có khoảng trắng
    await request(server)
      .post(`/v1/collections/${createdCollectionId}/items/import`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ items: [{ word: '   ' }] })
      .expect(400);

    // status không hợp lệ
    await request(server)
      .post(`/v1/collections/${createdCollectionId}/items/import`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ items: [{ word: jaSamples[0].lemma }], status: 'invalid' })
      .expect(400);

    // vượt quá 500 phần tử
    const tooMany = Array.from({ length: IMPORT_MAX_ITEMS + 1 }, (_, i) => ({
      word: `word-${i}`,
    }));
    await request(server)
      .post(`/v1/collections/${createdCollectionId}/items/import`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ items: tooMany })
      .expect(400);
  });
});
