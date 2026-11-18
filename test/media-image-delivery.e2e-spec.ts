import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';
import { SenseImageService } from '../src/media/sense-image.service';
import { ImageContract } from '../src/media/types/image.types';

interface Detail {
  image: ImageContract | null;
}
describe('M14.3 image delivery HTTP and DB', () => {
  let app: INestApplication, server: Server, db: PrismaService;
  let userId: string | undefined, token: string;
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
    await db.$executeRawUnsafe(`INSERT INTO core.lexeme(id,language_id,lemma,pos,source_id) VALUES
      (910001,1,'m143coffee','noun',1),(910002,1,'m143source','noun',1),
      (910003,1,'mreviewstir','verb',1),(910004,1,'mreviewstirred','verb',1),
      (910005,1,'m143book','noun',1),(910006,2,'m143foreign','noun',1)`);
    await db.$executeRawUnsafe(`INSERT INTO core.sense(id,lexeme_id,sense_no,definition,definition_language_id) VALUES
      (910011,910001,1,'a hot drink',1),(910012,910002,1,'a source meaning',1),
      (910013,910003,1,'move food with a spoon',1),(910014,910004,1,'simple past of mreviewstir',1),
      (910015,910005,1,'a book containing grammatical rules',1),(910016,910006,1,'a foreign noun',1)`);
    await db.$executeRawUnsafe(
      `INSERT INTO core.concept(id,pos,gloss_en,status) VALUES (910021,'noun','a hot drink','curated'),(910022,'verb','move food with a spoon','curated')`,
    );
    await db.$executeRawUnsafe(
      `INSERT INTO core.sense_concept(sense_id,concept_id,relation,confidence,method,verified) VALUES (910011,910021,'exact',1,'m143-test',true),(910013,910022,'exact',1,'m143-test',true)`,
    );
    await db.$executeRawUnsafe(`INSERT INTO core.media_asset(id,kind,object_key,mime,bytes,sha256,metadata) VALUES
      (910031,'concept_image','illustrations/m143coffee.png','image/png',123,repeat('a',64),'{"width":"99999999999999999999","height":512,"source_sense_id":"910012","source_definition":"a source meaning"}'),
      (910032,'concept_image','illustrations/mreviewstir.png','image/png',123,repeat('a',64),'{"width":512,"height":512}')`);
    await db.$executeRawUnsafe(
      `INSERT INTO core.concept_media(concept_id,asset_id,anchor_sense_id,status,is_primary,reviewed_at,reviewed_by_label) VALUES (910021,910031,910011,'approved',true,now(),'test'),(910022,910032,910013,'approved',true,now(),'test')`,
    );
  });
  afterAll(async () => {
    if (userId)
      await db.$executeRaw`DELETE FROM app.users WHERE id=${BigInt(userId)}`;
    if (db) {
      await db.$executeRawUnsafe(
        'DELETE FROM core.concept_media WHERE asset_id IN(910031,910032)',
      );
      await db.$executeRawUnsafe(
        'DELETE FROM core.media_asset WHERE id IN(910031,910032)',
      );
      await db.$executeRawUnsafe(
        'DELETE FROM core.sense_relation WHERE source_sense_id=910014',
      );
      await db.$executeRawUnsafe(
        'DELETE FROM core.sense_concept WHERE concept_id IN(910021,910022)',
      );
      await db.$executeRawUnsafe(
        'DELETE FROM core.concept WHERE id IN(910021,910022)',
      );
      await db.$executeRawUnsafe(
        'DELETE FROM app.quiz_bank_generation_job WHERE sense_id BETWEEN 910011 AND 910017',
      );
      await db.$executeRawUnsafe(
        'DELETE FROM core.sense WHERE id BETWEEN 910011 AND 910017',
      );
      await db.$executeRawUnsafe(
        'DELETE FROM core.lexeme WHERE id BETWEEN 910001 AND 910006',
      );
    }
    await app?.close();
  });
  it('documents the shared nullable image contract on both APIs', () => {
    const schemas = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    ).components?.schemas;
    for (const name of ['SenseDetailDto', 'DueCardDto']) {
      expect(schemas?.[name]).toHaveProperty('properties.image.nullable', true);
    }
  });
  it('returns a real approved image and sanitizes overflowing dimensions', async () => {
    const r = await request(server).get('/v1/senses/910011').expect(200);
    expect((r.body as Detail).image).toEqual({
      url: 'https://media.langoo.org/illustrations/m143coffee.png',
      mime: 'image/png',
      width: null,
      height: 512,
    });
  });
  it('uses source provenance only while the original definition remains current', async () => {
    const r = await request(server).get('/v1/senses/910012').expect(200);
    expect((r.body as Detail).image?.url).toContain('m143coffee.png');
    await db.$executeRawUnsafe(
      "UPDATE core.sense SET definition='a changed meaning' WHERE id=910012",
    );
    const stale = await request(server).get('/v1/senses/910012').expect(200);
    expect((stale.body as Detail).image).toBeNull();
  });
  it('revoked approval immediately hides the image', async () => {
    await db.$executeRawUnsafe(
      "UPDATE core.concept_media SET status='rejected',is_primary=false WHERE asset_id=910031",
    );
    const r = await request(server).get('/v1/senses/910011').expect(200);
    expect((r.body as Detail).image).toBeNull();
    await db.$executeRawUnsafe(
      "UPDATE core.concept_media SET status='approved',is_primary=true WHERE asset_id=910031",
    );
  });
  it('fallback counts all root senses before checking images and validates relation targets', async () => {
    const images = app.get(SenseImageService);
    expect((await images.resolveMany([910014n])).get('910014')?.url).toContain(
      'mreviewstir.png',
    );
    await db.$executeRawUnsafe(
      "INSERT INTO core.sense(id,lexeme_id,sense_no,definition,definition_language_id) VALUES (910017,910003,2,'a different root meaning',1)",
    );
    expect((await images.resolveMany([910014n])).get('910014')).toBeNull();
    await db.$executeRawUnsafe(
      "INSERT INTO core.sense_relation(source_sense_id,target_sense_id,relation,confidence,verified,method) VALUES (910014,910016,'equivalent',1,true,'inflection_root_verified_v1')",
    );
    expect((await images.resolveMany([910014n])).get('910014')).toBeNull();
    await db.$executeRawUnsafe(
      'UPDATE core.sense_relation SET target_sense_id=910011 WHERE source_sense_id=910014',
    );
    expect((await images.resolveMany([910014n])).get('910014')).toBeNull();
    await db.$executeRawUnsafe(
      'UPDATE core.sense_relation SET target_sense_id=910013 WHERE source_sense_id=910014',
    );
    expect((await images.resolveMany([910014n])).get('910014')?.url).toContain(
      'mreviewstir.png',
    );
    await db.$executeRawUnsafe(
      'DELETE FROM core.sense_relation WHERE source_sense_id=910014',
    );
    await db.$executeRawUnsafe('DELETE FROM core.sense WHERE id=910017');
  });
  it('a valid sense with no illustration returns image:null, missing sense stays 404', async () => {
    const r = await request(server).get('/v1/senses/910015').expect(200);
    expect((r.body as Detail).image).toBeNull();
    await request(server).get('/v1/senses/9223372036854775807').expect(404);
  });
  it('SRS keeps IDs/order/counts/cursor when image approval changes', async () => {
    const auth = await request(server)
      .post('/v1/auth/register')
      .send({
        email: `m143-${Date.now()}@langoo.test`,
        password: 'matkhau-e2e-123',
      })
      .expect(201);
    const a = auth.body as { user: { id: string }; access_token: string };
    userId = a.user.id;
    token = a.access_token;
    await request(server)
      .post('/v1/profiles')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'M14.3', primary_language_id: 1, support_language_id: 3 })
      .expect(201);
    const c = await request(server)
      .post('/v1/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'M14.3' })
      .expect(201);
    const id = (c.body as { id: string }).id;
    await request(server)
      .post(`/v1/collections/${id}/items`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sense_id: '910011', meaning_vi: 'cà phê' })
      .expect(201);
    type Due = {
      data: { srs_id: string; image: ImageContract | null }[];
      counts: unknown;
      next_cursor: string | null;
    };
    await request(server)
      .post(`/v1/collections/${id}/items`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sense_id: '910013', meaning_vi: 'khuấy' })
      .expect(201);
    const get = () =>
      request(server)
        .get('/v1/srs/due')
        .query({ limit: 1 })
        .set('Authorization', `Bearer ${token}`);
    const first = (await get().expect(200)).body as Due;
    expect(first.data).toHaveLength(1);
    expect(first.next_cursor).not.toBeNull();
    expect(first.data[0].image?.url).toContain('m143coffee.png');
    await db.$executeRawUnsafe(
      "UPDATE core.concept_media SET status='rejected',is_primary=false WHERE asset_id=910031",
    );
    const next = (await get().expect(200)).body as Due;
    expect(next.data.map((x) => x.srs_id)).toEqual(
      first.data.map((x) => x.srs_id),
    );
    expect(new Set(next.data.map((x) => x.srs_id)).size).toBe(next.data.length);
    expect(next.counts).toEqual(first.counts);
    expect(next.next_cursor).toEqual(first.next_cursor);
    expect(next.data.every((x) => x.image === null)).toBe(true);
    await db.$executeRawUnsafe(
      "UPDATE core.concept_media SET status='approved',is_primary=true WHERE asset_id=910031",
    );
  });
});
