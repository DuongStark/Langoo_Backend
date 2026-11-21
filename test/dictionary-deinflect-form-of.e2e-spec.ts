import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';
import { ImportItemsResponseDto } from '../src/collections/dto/import-items.dto';

interface Hit {
  lexeme_id: string;
  lemma: string;
  deinflected_from: string | null;
}

/**
 * M4.9 (21/11): mục Wiktionary "dạng chia" có gloss VI máy (`読みます` = "polite form of 読む")
 * không được chặn deinflect; mục Wiktionary không phải dạng chia và từ katakana thuần giữ nguyên.
 * Fixture riêng (id 7200xx, source 1 = jmdict, 8 = wiktextract), xoá ở afterAll.
 */
describe('M4.9 Wiktionary form-of deinflection (e2e — langoo_test)', () => {
  let app: INestApplication, server: Server, db: PrismaService;
  const base = 720000n;
  let token = '';

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();
    server = app.getHttpServer() as Server;
    db = app.get(PrismaService);

    await db.$executeRawUnsafe(`INSERT INTO core.lexeme(id,language_id,lemma,pos,reading,homograph_no,source_id,attributes)
      VALUES (720001,2,'試読む','verb','しよむ',1,1,'{}'),
             (720002,2,'試読みます','verb',NULL,1,8,'{"wikt_pos":"verb"}'),
             (720003,2,'試踊る','verb','しおどる',1,1,'{}'),
             (720004,2,'試踊ります','verb',NULL,1,8,'{"wikt_pos":"verb"}'),
             (720005,2,'てすとる','verb','てすとる',1,1,'{}')`);
    await db.$executeRawUnsafe(`INSERT INTO core.sense(id,lexeme_id,sense_no,definition,definition_language_id,source_id,is_primary)
      VALUES (720011,720001,1,'to test-read',1,1,true),
             (720012,720002,1,'polite form of 試読む (shiyomu)',1,8,true),
             (720013,720003,1,'to test-dance',1,1,true),
             (720014,720004,1,'a test song title',1,8,true),
             (720015,720005,1,'to test',1,1,true)`);
    await db.$executeRawUnsafe(`INSERT INTO core.sense_gloss(sense_id,language_id,text,rank,source_id,is_machine)
      VALUES (720011,3,'thử đọc',1,1,false),
             (720012,3,'dạng lịch sự của 試読む',1,8,true),
             (720013,3,'thử nhảy',1,1,false),
             (720014,3,'tên bài hát thử',1,8,true),
             (720015,3,'thử',1,1,false)`);

    const email = `e2e-m49-form-of-${Date.now()}@langoo.test`;
    const reg = await request(server)
      .post('/v1/auth/register')
      .send({ email, password: 'matkhau-e2e-123' })
      .expect(201);
    token = (reg.body as { access_token: string }).access_token;
    await request(server)
      .post('/v1/profiles')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Nhật–Việt (M4.9)',
        primary_language_id: 2,
        support_language_id: 3,
      })
      .expect(201);
  });

  afterAll(async () => {
    if (db) {
      await db.$executeRaw`DELETE FROM app.srs_state WHERE face_id IN (
        SELECT f.id FROM app.collection_item_face f
        WHERE f.sense_id > ${base} AND f.sense_id < ${base + 100n})`;
      await db.$executeRaw`DELETE FROM app.collection_item_face WHERE sense_id > ${base} AND sense_id < ${base + 100n}`;
      await db.$executeRaw`DELETE FROM app.collection_item WHERE anchor_sense_id > ${base} AND anchor_sense_id < ${base + 100n}`;
      await db.$executeRaw`DELETE FROM app.quiz_bank_generation_job WHERE sense_id > ${base} AND sense_id < ${base + 100n}`;
      await db.$executeRaw`DELETE FROM core.sense_gloss WHERE sense_id > ${base} AND sense_id < ${base + 100n}`;
      await db.$executeRaw`DELETE FROM core.sense WHERE id > ${base} AND id < ${base + 100n}`;
      await db.$executeRaw`DELETE FROM core.lexeme WHERE id > ${base} AND id < ${base + 100n}`;
    }
    await app?.close();
  });

  const lookup = async (path: string, q: string) => {
    const res = await request(server)
      .get(`/v1/dictionary/${path}`)
      .query({ q, lang: 'ja' })
      .expect(200);
    return (res.body as { data: Hit[] }).data;
  };

  it.each(['search', 'suggestions'])(
    '%s: Wiktionary form-of entry with machine VI gloss deinflects to JMdict base',
    async (path) => {
      const hits = await lookup(path, '試読みます');
      expect(hits[0]).toMatchObject({
        lexeme_id: '720001',
        lemma: '試読む',
        deinflected_from: '試読みます',
      });
      expect(hits.map((h) => h.lexeme_id)).toContain('720002');
    },
  );

  it('search: Wiktionary entry that is not a form-of keeps its exact match', async () => {
    const hits = await lookup('search', '試踊ります');
    expect(hits[0]).toMatchObject({
      lexeme_id: '720004',
      deinflected_from: null,
    });
    expect(hits.some((h) => h.deinflected_from !== null)).toBe(false);
  });

  it('search: katakana-only input is not deinflected into unrelated verbs', async () => {
    const hits = await lookup('search', 'テストマス');
    expect(hits.some((h) => h.lexeme_id === '720005')).toBe(false);
  });

  it('import: saves JMdict base for form-of entries, keeps other Wiktionary entries', async () => {
    const res = await request(server)
      .post('/v1/collections/import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'M4.9 form-of',
        items: [{ word: '試読みます' }, { word: '試踊ります' }],
      })
      .expect(201);
    const body = res.body as ImportItemsResponseDto;
    expect(
      body.added.map((a) => [a.word, a.lemma, a.deinflected_from]),
    ).toEqual([
      ['試読みます', '試読む', '試読みます'],
      ['試踊ります', '試踊ります', null],
    ]);
  });
});
