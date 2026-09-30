import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';

interface AuthBody {
  user: { id: string; email: string };
  access_token: string;
}

describe('Admin (e2e — langoo_test)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;

  const runId = Date.now();
  const password = 'matkhau-e2e-123';

  let userToken = '';
  let userEmail = '';
  let adminToken = '';
  let adminEmail = '';
  let adminId = 0n;
  let targetId = 0n;
  let targetEmail = '';
  let feedbackId = '';

  async function register(email: string): Promise<AuthBody> {
    const res = await request(server)
      .post('/v1/auth/register')
      .send({ email, password })
      .expect(201);
    return res.body as AuthBody;
  }

  function auth(token: string): { Authorization: string } {
    return { Authorization: `Bearer ${token}` };
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

    userEmail = `e2e-admin-user-${runId}@langoo.test`;
    const user = await register(userEmail);
    userToken = user.access_token;

    adminEmail = `e2e-admin-${runId}@langoo.test`;
    const admin = await register(adminEmail);
    adminToken = admin.access_token;
    adminId = BigInt(admin.user.id);
    await prisma.user.update({
      where: { id: adminId },
      data: { role: 'admin' },
    });

    targetEmail = `e2e-admin-target-${runId}@langoo.test`;
    const target = await register(targetEmail);
    targetId = BigInt(target.user.id);
  });

  afterAll(async () => {
    await app.close();
  });

  it('user thường bị chặn khỏi mọi endpoint admin → 403 ADMIN_REQUIRED', async () => {
    for (const path of [
      '/v1/admin/stats',
      '/v1/admin/stats/timeseries?metric=signups',
      '/v1/admin/feedback',
      '/v1/admin/gloss-reports',
      '/v1/admin/audit-log',
    ]) {
      const res = await request(server)
        .get(path)
        .set(auth(userToken))
        .expect(403);
      expect(res.body).toMatchObject({ code: 'ADMIN_REQUIRED' });
    }

    await request(server)
      .patch(`/v1/admin/users/${targetId.toString()}`)
      .set(auth(userToken))
      .send({ status: 'locked' })
      .expect(403);
  });

  it('thống kê tổng hợp: overview + timeseries, không lộ dữ liệu cá nhân', async () => {
    const overview = await request(server)
      .get('/v1/admin/stats')
      .set(auth(adminToken))
      .expect(200);
    const body = overview.body as {
      users: Record<string, number>;
      learning: { streak_distribution: unknown[] };
      content: Record<string, unknown>;
      ai: Record<string, unknown>;
    };
    expect(typeof body.users.total).toBe('number');
    expect(body.users.total).toBeGreaterThanOrEqual(3);
    expect(typeof body.users.signups_7d).toBe('number');
    expect(body.learning.streak_distribution).toBeDefined();
    expect(body.content.concepts_by_status).toBeDefined();
    expect(body.ai.window_days).toBe(30);
    // aggregate-only: không chứa email người dùng
    expect(JSON.stringify(body)).not.toContain(userEmail);

    const series = await request(server)
      .get('/v1/admin/stats/timeseries?metric=signups&days=7')
      .set(auth(adminToken))
      .expect(200);
    const points = (series.body as { points: unknown[] }).points;
    expect(points).toHaveLength(7);

    await request(server)
      .get('/v1/admin/stats/timeseries?metric=khong-co')
      .set(auth(adminToken))
      .expect(400);
  });

  it('feedback: user gửi → admin xử lý → audit ghi nhận', async () => {
    const created = await request(server)
      .post('/v1/feedback')
      .set(auth(userToken))
      .send({ category: 'feature', content: 'Mong có chế độ nghe chọn đáp án' })
      .expect(201);
    feedbackId = (created.body as { id: string }).id;

    const queue = await request(server)
      .get('/v1/admin/feedback?status=new')
      .set(auth(adminToken))
      .expect(200);
    const rows = (
      queue.body as { data: { id: string; user: { email: string } }[] }
    ).data;
    const row = rows.find((entry) => entry.id === feedbackId);
    expect(row).toBeDefined();
    expect(row?.user.email).toBe(userEmail);

    await request(server)
      .patch(`/v1/admin/feedback/${feedbackId}`)
      .set(auth(adminToken))
      .send({ status: 'in_progress', admin_note: 'Đang xem xét' })
      .expect(200);

    const mine = await request(server)
      .get('/v1/me/feedback')
      .set(auth(userToken))
      .expect(200);
    const mineRow = (
      mine.body as {
        data: { id: string; status: string; admin_note: string }[];
      }
    ).data.find((entry) => entry.id === feedbackId);
    expect(mineRow).toMatchObject({
      status: 'in_progress',
      admin_note: 'Đang xem xét',
    });

    const audit = await request(server)
      .get('/v1/admin/audit-log')
      .set(auth(adminToken))
      .expect(200);
    expect(
      (audit.body as { data: { action: string; target_id: string }[] }).data,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'feedback.update',
          target_id: feedbackId,
        }),
      ]),
    );
  });

  it('gloss report: xử lý fixed → resolved_at + audit', async () => {
    const created = await request(server)
      .post('/v1/gloss-reports')
      .set(auth(userToken))
      .send({
        target_kind: 'sense_gloss',
        target_id: '4',
        issue: 'wrong',
        comment: 'Nghĩa này chưa sát ngữ cảnh',
      })
      .expect(201);
    const reportId = (created.body as { id: string }).id;

    const queue = await request(server)
      .get('/v1/admin/gloss-reports?status=open&issue=wrong')
      .set(auth(adminToken))
      .expect(200);
    expect(
      (queue.body as { data: { id: string }[] }).data.map((row) => row.id),
    ).toContain(reportId);

    const updated = await request(server)
      .patch(`/v1/admin/gloss-reports/${reportId}`)
      .set(auth(adminToken))
      .send({ status: 'fixed' })
      .expect(200);
    expect(
      (updated.body as { resolved_at: string | null }).resolved_at,
    ).not.toBeNull();

    const audit = await request(server)
      .get('/v1/admin/audit-log')
      .set(auth(adminToken))
      .expect(200);
    expect(
      (audit.body as { data: { target_id: string }[] }).data.map(
        (row) => row.target_id,
      ),
    ).toContain(reportId);
  });

  it('khoá/mở user: lock → login 403, unlock → login lại được; tự khoá bị chặn', async () => {
    const locked = await request(server)
      .patch(`/v1/admin/users/${targetId.toString()}`)
      .set(auth(adminToken))
      .send({ status: 'locked' })
      .expect(200);
    expect(locked.body).toMatchObject({ status: 'locked' });

    const loginBlocked = await request(server)
      .post('/v1/auth/login')
      .send({ email: targetEmail, password })
      .expect(403);
    expect(loginBlocked.body).toMatchObject({ code: 'AUTH_ACCOUNT_LOCKED' });

    await request(server)
      .patch(`/v1/admin/users/${targetId.toString()}`)
      .set(auth(adminToken))
      .send({ status: 'active' })
      .expect(200);
    await request(server)
      .post('/v1/auth/login')
      .send({ email: targetEmail, password })
      .expect(200);

    const selfLock = await request(server)
      .patch(`/v1/admin/users/${adminId.toString()}`)
      .set(auth(adminToken))
      .send({ status: 'locked' })
      .expect(409);
    expect(selfLock.body).toMatchObject({ code: 'USER_STATUS_INVALID' });
  });
});
