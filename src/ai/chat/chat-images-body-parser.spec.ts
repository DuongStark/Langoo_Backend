import express from 'express';
import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureChatImageBodyParser } from './chat-images-body-parser';

describe('M10.3 scoped body parser', () => {
  const app = express();
  configureChatImageBodyParser(app as unknown as NestExpressApplication);
  app.use(express.json());
  app.post(/.*/, (_req, res) => res.json({ ok: true }));
  it.each(['', '/stream'])(
    'accepts chat images above default 100kb (%s)',
    async (suffix) => {
      await request(app)
        .post('/v1/chat/sessions/id/messages' + suffix)
        .send({ images: ['x'.repeat(200000)] })
        .expect(200);
    },
  );
  it('keeps default parser limit on unrelated endpoints', async () => {
    await request(app)
      .post('/v1/auth/login')
      .send({ content: 'x'.repeat(200000) })
      .expect(413);
  });
  it('rejects oversized chat JSON with sanitized 413', async () => {
    const res = await request(app)
      .post('/v1/chat/sessions/id/messages')
      .send({ images: ['x'.repeat(9 * 1024 * 1024)] })
      .expect(413);
    expect(res.body).toEqual({
      code: 'CHAT_BODY_TOO_LARGE',
      message: 'Nội dung chat vượt giới hạn 9 MiB',
    });
  });
  it('sanitizes malformed JSON without returning data', async () => {
    const res = await request(app)
      .post('/v1/chat/sessions/id/messages/stream')
      .set('Content-Type', 'application/json')
      .send('{"images":["PRIVATE"')
      .expect(400);
    expect(JSON.stringify(res.body)).not.toContain('PRIVATE');
  });
});
