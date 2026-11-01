import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';
interface Hit {
  lexeme_id: string;
  lemma: string;
  surface: string;
  is_exact: boolean;
}
describe('M4.7 canonical lemma without changing matched surface', () => {
  let app: INestApplication, server: Server, db: PrismaService;
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
    await db.$executeRawUnsafe(
      "INSERT INTO core.lexeme(id,language_id,lemma,reading,pos,source_id) VALUES (910101,2,'試験折り紙','しけんおりがみ','noun',1)",
    );
    await db.$executeRawUnsafe(
      "INSERT INTO core.lexeme_form(lexeme_id,kind,form_text,form_order) VALUES (910101,'kanji','試験折り紙',1),(910101,'kanji','試験折紙',2),(910101,'kana','しけんおりがみ',3)",
    );
    await db.$executeRawUnsafe(
      "INSERT INTO core.sense(id,lexeme_id,sense_no,definition,definition_language_id,source_id) VALUES(910111,910101,1,'paper folding',1,1)",
    );
  });
  afterAll(async () => {
    if (db) {
      await db.$executeRawUnsafe('DELETE FROM core.sense WHERE id=910111');
      await db.$executeRawUnsafe(
        'DELETE FROM core.lexeme_form WHERE lexeme_id=910101',
      );
      await db.$executeRawUnsafe('DELETE FROM core.lexeme WHERE id=910101');
    }
    await app?.close();
  });
  it('documents lemma as a required string', () => {
    const schema = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    ).components?.schemas?.SearchHitDto;
    expect(schema).toHaveProperty('properties.lemma.type', 'string');
    expect(schema).toHaveProperty(
      'required',
      expect.arrayContaining(['lemma']),
    );
  });
  it.each(['search', 'suggestions'])(
    '%s returns canonical lemma and preserves exact spelling match',
    async (path) => {
      for (const q of ['試験折紙', '試験折り紙', 'しけんおりがみ']) {
        const r = await request(server)
          .get(`/v1/dictionary/${path}`)
          .query({ q, lang: 'ja' })
          .expect(200);
        const hits = (r.body as { data: Hit[] }).data;
        const hit = hits.find((x) => x.lexeme_id === '910101');
        expect(hit).toBeDefined();
        expect(hit?.lemma).toBe('試験折り紙');
        expect(hit?.is_exact).toBe(true);
        if (q !== 'しけんおりがみ') expect(hit?.surface).toBe(q);
      }
    },
  );
});
