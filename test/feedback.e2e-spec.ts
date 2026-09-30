import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';

// Thư mục upload riêng cho e2e (dọn sau khi chạy) — không đụng `uploads/` của dev.
process.env.STORAGE_PROVIDER = 'local';
process.env.STORAGE_DIR = '/tmp/opencode/m13-uploads-e2e';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

interface FeedbackBody {
  id: string;
  category: string;
  content: string;
  status: string;
  admin_note: string | null;
  attachments: { id: string; mime: string; size_bytes: number }[];
}

describe('Feedback (e2e — langoo_test)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;

  const runId = Date.now();
  const password = 'matkhau-e2e-123';
  let token = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);

    const registered = await request(server)
      .post('/v1/auth/register')
      .send({ email: `e2e-feedback-${runId}@langoo.test`, password })
      .expect(201);
    token = (registered.body as { access_token: string }).access_token;
  });

  afterAll(async () => {
    await app.close();
    await rm(process.env.STORAGE_DIR!, { recursive: true, force: true });
  });

  function auth(): { Authorization: string } {
    return { Authorization: `Bearer ${token}` };
  }

  it('gửi feedback text (không ảnh) → 201 và xem lại trong /me/feedback', async () => {
    const created = await request(server)
      .post('/v1/feedback')
      .set(auth())
      .field('category', 'bug')
      .field('content', 'Nút ôn tập bị lệch trên màn hình nhỏ')
      .expect(201);
    const body = created.body as FeedbackBody;
    expect(body).toMatchObject({
      category: 'bug',
      status: 'new',
      attachments: [],
    });

    const mine = await request(server)
      .get('/v1/me/feedback')
      .set(auth())
      .expect(200);
    const list = mine.body as { data: FeedbackBody[] };
    expect(list.data.map((row) => row.id)).toContain(body.id);
  });

  it('gửi kèm ảnh PNG hợp lệ → lưu storage + metadata đúng', async () => {
    const created = await request(server)
      .post('/v1/feedback')
      .set(auth())
      .field('category', 'content')
      .field('content', 'Ảnh minh hoạ lỗi hiển thị kanji')
      .attach('files', PNG, 'screenshot.png')
      .expect(201);
    const body = created.body as FeedbackBody;

    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0]).toMatchObject({
      mime: 'image/png',
      size_bytes: PNG.length,
    });

    const user = await prisma.user.findFirstOrThrow({
      where: { email: `e2e-feedback-${runId}@langoo.test` },
      select: { id: true },
    });
    const attachment = await prisma.feedbackAttachment.findFirstOrThrow({
      where: { feedbackId: body.id },
    });
    expect(attachment.storageKey).toBe(
      `feedback/${user.id.toString()}/${attachment.id}.png`,
    );
  });

  it('tệp không phải ảnh (giả đuôi .png) → 400 ATTACHMENT_INVALID', async () => {
    const res = await request(server)
      .post('/v1/feedback')
      .set(auth())
      .field('category', 'other')
      .field('content', 'Tệp này không phải ảnh thật')
      .attach('files', Buffer.from('khong-phai-anh'), 'fake.png')
      .expect(400);
    expect(res.body).toMatchObject({ code: 'ATTACHMENT_INVALID' });
  });

  it('validate biên: content ngắn/category sai → 400', async () => {
    const short = await request(server)
      .post('/v1/feedback')
      .set(auth())
      .field('category', 'bug')
      .field('content', 'ngắn')
      .expect(400);
    expect(short.body).toMatchObject({ code: 'VALIDATION_FAILED' });

    const badCategory = await request(server)
      .post('/v1/feedback')
      .set(auth())
      .field('category', 'khong-co')
      .field('content', 'Nội dung đủ dài cho hợp lệ')
      .expect(400);
    expect(badCategory.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
