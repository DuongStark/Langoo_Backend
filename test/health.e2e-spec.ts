import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /v1/health trả 200 và DB ok', async () => {
    const server = app.getHttpServer() as Server;
    const response = await request(server).get('/v1/health').expect(200);
    const body = response.body as {
      status: string;
      db: string;
      db_latency_ms: number;
      time: string;
    };

    expect(body).toMatchObject({ status: 'ok', db: 'ok' });
    expect(typeof body.db_latency_ms).toBe('number');
    expect(typeof body.time).toBe('string');
  });

  it('route không tồn tại trả 404 đúng format lỗi', async () => {
    const server = app.getHttpServer() as Server;
    const response = await request(server).get('/v1/khong-ton-tai').expect(404);
    const body = response.body as Record<string, unknown>;

    expect(body.code).toBe('NOT_FOUND');
    expect(typeof body.message).toBe('string');
  });
});
