import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';

interface DonePayload {
  assistant_message: { content: string };
  user_message: { content: string };
}

/**
 * M10.1 — streaming SSE: provider stub phát nhiều delta, kết thúc bằng done,
 * và lưu đủ 2 tin nhắn (không double-save).
 */
describe('Chat streaming (e2e — langoo_test)', () => {
  let app: INestApplication;
  let server: Server;

  const runId = Date.now();
  let token = '';
  let sessionId = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    server = app.getHttpServer() as Server;

    const registered = await request(server)
      .post('/v1/auth/register')
      .send({
        email: `e2e-chat-stream-${runId}@langoo.test`,
        password: 'matkhau-e2e-123',
      })
      .expect(201);
    token = (registered.body as { access_token: string }).access_token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('stream trả start/delta/done và lưu đủ 2 tin nhắn', async () => {
    const created = await request(server)
      .post('/v1/chat/sessions')
      .set({ Authorization: `Bearer ${token}` })
      .send({ language_id: 2 })
      .expect(201);
    sessionId = (created.body as { id: string }).id;

    const streamed = await request(server)
      .post(`/v1/chat/sessions/${sessionId}/messages/stream`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ content: 'Chào bạn' })
      .expect(200)
      .expect('Content-Type', /text\/event-stream/);

    const body = streamed.text;
    expect(body).toContain('event: start');
    expect(body).toContain('event: delta');
    expect(body).toContain('event: done');

    const doneBlock = body
      .split('\n\n')
      .find((block) => block.startsWith('event: done'));
    expect(doneBlock).toBeDefined();
    const dataLine = (doneBlock as string)
      .split('\n')
      .find((line) => line.startsWith('data: '));
    expect(dataLine).toBeDefined();
    const payload = JSON.parse((dataLine as string).slice(6)) as DonePayload;
    expect(payload.user_message.content).toBe('Chào bạn');
    expect(payload.assistant_message.content).toContain('[stub]');

    const messages = await request(server)
      .get(`/v1/chat/sessions/${sessionId}/messages`)
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);
    expect((messages.body as { data: unknown[] }).data).toHaveLength(2);
  });
});
