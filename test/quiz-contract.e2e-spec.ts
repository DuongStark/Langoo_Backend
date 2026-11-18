import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Server } from 'node:http';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';
import { Prisma } from '../src/generated/prisma/client';

/**
 * M11.5 OpenAPI & DTO contract regression suite (supersedes retired M11.3 /v1/quizzes/jobs* endpoints).
 */
describe('Quiz OpenAPI & Preflight Contract Regression (PostgreSQL local)', () => {
  let app: INestApplication;
  let server: Server;
  let db: PrismaService;
  let token: string;
  let collection: string;
  let language: number;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    server = app.getHttpServer() as Server;
    db = app.get(PrismaService);

    const languages = await db.$queryRaw<{ id: number }[]>(
      Prisma.sql`SELECT id FROM public.language WHERE code = 'en'`,
    );
    language = Number(languages[0].id);

    const senses = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`
      SELECT DISTINCT ON (lower(l.lemma)) s.id
      FROM core.sense s
      JOIN core.lexeme l ON l.id = s.lexeme_id
      WHERE l.language_id = ${language}::smallint
      ORDER BY lower(l.lemma), s.id
      LIMIT 4
    `);
    expect(senses).toHaveLength(4);

    const registered = await request(server)
      .post('/v1/auth/register')
      .send({
        email: `m11-openapi-${Date.now()}@langoo.test`,
        password: 'matkhau-e2e-123',
      })
      .expect(201);
    token = (registered.body as { access_token: string }).access_token;

    await request(server)
      .post('/v1/profiles')
      .set(auth())
      .send({
        name: 'Quiz Contract EN',
        primary_language_id: language,
        secondary_language_id: language === 1 ? 2 : 1,
        support_language_id: 3,
      })
      .expect(201);

    const created = await request(server)
      .post('/v1/collections')
      .set(auth())
      .send({ name: 'Quiz OpenAPI fixture' })
      .expect(201);
    collection = (created.body as { id: string }).id;

    for (let i = 0; i < senses.length; i++) {
      await request(server)
        .post(`/v1/collections/${collection}/items`)
        .set(auth())
        .send({
          sense_id: senses[i].id.toString(),
          meaning_vi: `nghĩa kiểm thử openapi ${i}`,
        })
        .expect(201);
    }
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('validates DTOs and rejects null collection_id instead of expanding scope', async () => {
    await request(server)
      .post('/v1/quizzes/eligibility')
      .set(auth())
      .send({
        collection_id: null,
        language_id: language,
        skills: ['meaning'],
        question_count: 2,
      })
      .expect(400);
  });

  it('publishes typed OpenAPI schemas for M11.5 synchronous endpoints and omits retired /v1/quizzes/jobs*', () => {
    const spec = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('M11.5 OpenAPI test').build(),
    );
    expect(spec.paths['/v1/quizzes/jobs']).toBeUndefined();
    expect(
      spec.paths['/v1/quizzes/eligibility']?.post?.responses['200'],
    ).toBeDefined();
    expect(spec.paths['/v1/quizzes']?.post?.responses['201']).toBeDefined();
    expect(
      spec.paths['/v1/quizzes/{quiz_id}/questions/{ordinal}/report']?.post
        ?.responses['202'],
    ).toBeDefined();
  });

  it('enforces profile language ownership on eligibility and synchronous create', async () => {
    await request(server)
      .post('/v1/quizzes/eligibility')
      .set(auth())
      .send({
        collection_id: collection,
        language_id: 3, // Vietnamese support language is not a study target language
        skills: ['meaning'],
        question_count: 2,
      })
      .expect(409);

    await request(server)
      .post('/v1/quizzes')
      .set(auth())
      .send({
        collection_id: collection,
        language_id: 3,
        skills: ['meaning'],
        question_count: 2,
        idempotency_key: uuidv7(),
      })
      .expect(409);
  });
});
