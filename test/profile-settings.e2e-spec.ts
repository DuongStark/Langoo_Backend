import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';

interface ProfileBody {
  id: string;
  name: string;
  primary_language_id: number;
  secondary_language_id: number | null;
  support_language_id: number;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

interface SettingsBody {
  timezone: string;
  ui_language_id: number | null;
  daily_goal: number;
  notify: Record<string, unknown>;
  active_profile_id: string | null;
  updated_at: string | null;
}

describe('Profile & Settings (e2e — langoo_test)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;

  const runId = Date.now();
  const emailA = `e2e-m3-a-${runId}@langoo.test`;
  const emailB = `e2e-m3-b-${runId}@langoo.test`;
  const password = 'matkhau-e2e-123';

  let tokenA = '';
  let tokenB = '';
  let userIdA = 0n;
  let profile1: ProfileBody;
  let profile2: ProfileBody;

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
  });

  afterAll(async () => {
    await app.close();
  });

  describe('chuẩn bị & mặc định', () => {
    it('đăng ký 2 user', async () => {
      const a = await registerUser(emailA);
      const b = await registerUser(emailB);
      tokenA = a.accessToken;
      tokenB = b.accessToken;
      userIdA = a.userId;
      expect(tokenA).toBeTruthy();
      expect(tokenB).toBeTruthy();
    });

    it('settings mặc định đúng sau khi đăng ký', async () => {
      const res = await request(server)
        .get('/v1/me/settings')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const body = res.body as SettingsBody;

      expect(body).toMatchObject({
        timezone: 'Asia/Ho_Chi_Minh',
        daily_goal: 20,
        notify: {},
        ui_language_id: null,
        active_profile_id: null,
      });
      expect(typeof body.updated_at).toBe('string');
    });

    it('user cũ thiếu row settings → trả mặc định (updated_at null)', async () => {
      await prisma.userSettings.delete({ where: { userId: userIdA } });

      const res = await request(server)
        .get('/v1/me/settings')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const body = res.body as SettingsBody;

      expect(body).toMatchObject({
        timezone: 'Asia/Ho_Chi_Minh',
        daily_goal: 20,
        active_profile_id: null,
        updated_at: null,
      });

      // PATCH rỗng sẽ tái tạo row với mặc định
      const patched = await request(server)
        .patch('/v1/me/settings')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({})
        .expect(200);
      expect((patched.body as SettingsBody).daily_goal).toBe(20);
    });

    it('danh sách hồ sơ ban đầu rỗng', async () => {
      const res = await request(server)
        .get('/v1/profiles')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(res.body).toEqual({ data: [] });
    });
  });

  describe('CRUD profile', () => {
    it('tạo hồ sơ đầu tiên → tự động default + set active_profile_id', async () => {
      const res = await request(server)
        .post('/v1/profiles')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Nhật–Việt',
          primary_language_id: 2,
          secondary_language_id: 1,
          support_language_id: 3,
        })
        .expect(201);
      profile1 = res.body as ProfileBody;

      expect(profile1).toMatchObject({
        name: 'Nhật–Việt',
        primary_language_id: 2,
        secondary_language_id: 1,
        support_language_id: 3,
        is_default: true,
      });
      expect(profile1.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );

      const settings = await request(server)
        .get('/v1/me/settings')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect((settings.body as SettingsBody).active_profile_id).toBe(
        profile1.id,
      );
    });

    it('tạo hồ sơ thứ hai (is_default=true) → hạ default của hồ sơ cũ', async () => {
      const res = await request(server)
        .post('/v1/profiles')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Anh–Việt',
          primary_language_id: 1,
          support_language_id: 3,
          is_default: true,
        })
        .expect(201);
      profile2 = res.body as ProfileBody;

      expect(profile2.is_default).toBe(true);

      const list = await request(server)
        .get('/v1/profiles')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const data = (list.body as { data: ProfileBody[] }).data;
      expect(data).toHaveLength(2);
      expect(data.find((p) => p.id === profile1.id)?.is_default).toBe(false);
      expect(data.find((p) => p.id === profile2.id)?.is_default).toBe(true);

      const settings = await request(server)
        .get('/v1/me/settings')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect((settings.body as SettingsBody).active_profile_id).toBe(
        profile2.id,
      );
    });

    it('đổi tên + đặt lại default cho hồ sơ 1', async () => {
      const res = await request(server)
        .patch(`/v1/profiles/${profile1.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Nhật–Việt (chính)', is_default: true })
        .expect(200);
      const body = res.body as ProfileBody;

      expect(body.name).toBe('Nhật–Việt (chính)');
      expect(body.is_default).toBe(true);

      const settings = await request(server)
        .get('/v1/me/settings')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect((settings.body as SettingsBody).active_profile_id).toBe(
        profile1.id,
      );
    });

    it('xoá hồ sơ đang default → 409 PROFILE_IS_DEFAULT', async () => {
      const res = await request(server)
        .delete(`/v1/profiles/${profile1.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(409);
      expect(res.body).toMatchObject({ code: 'PROFILE_IS_DEFAULT' });
    });

    it('xoá hồ sơ không-default thành công', async () => {
      const res = await request(server)
        .delete(`/v1/profiles/${profile2.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(res.body).toMatchObject({ id: profile2.id });

      const list = await request(server)
        .get('/v1/profiles')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect((list.body as { data: ProfileBody[] }).data).toHaveLength(1);
    });

    it('xoá hồ sơ duy nhất → 409 PROFILE_LAST_CANNOT_DELETE', async () => {
      const res = await request(server)
        .delete(`/v1/profiles/${profile1.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(409);
      expect(res.body).toMatchObject({ code: 'PROFILE_LAST_CANNOT_DELETE' });
    });

    it('hồ sơ của user khác → 404', async () => {
      const res = await request(server)
        .get(`/v1/profiles/${profile1.id}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
      expect(res.body).toMatchObject({ code: 'PROFILE_NOT_FOUND' });
    });

    it('validate ngôn ngữ', async () => {
      const conflict = await request(server)
        .post('/v1/profiles')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Trùng',
          primary_language_id: 2,
          secondary_language_id: 2,
          support_language_id: 3,
        })
        .expect(400);
      expect(conflict.body).toMatchObject({
        code: 'PROFILE_LANGUAGES_CONFLICT',
      });

      const missing = await request(server)
        .post('/v1/profiles')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Lạ', primary_language_id: 99, support_language_id: 3 })
        .expect(400);
      expect(missing.body).toMatchObject({ code: 'LANGUAGE_NOT_FOUND' });
    });
  });

  describe('settings', () => {
    it('PATCH rồi GET lưu/đọc đúng', async () => {
      const patched = await request(server)
        .patch('/v1/me/settings')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          timezone: 'Asia/Tokyo',
          ui_language_id: 3,
          daily_goal: 30,
          notify: { review_reminder: true },
        })
        .expect(200);
      expect(patched.body).toMatchObject({
        timezone: 'Asia/Tokyo',
        ui_language_id: 3,
        daily_goal: 30,
        notify: { review_reminder: true },
      });

      const read = await request(server)
        .get('/v1/me/settings')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(read.body).toMatchObject({
        timezone: 'Asia/Tokyo',
        ui_language_id: 3,
        daily_goal: 30,
        notify: { review_reminder: true },
      });
    });

    it('múi giờ sai → 400 SETTINGS_TIMEZONE_INVALID', async () => {
      const res = await request(server)
        .patch('/v1/me/settings')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ timezone: 'Sai/Mui' })
        .expect(400);
      expect(res.body).toMatchObject({ code: 'SETTINGS_TIMEZONE_INVALID' });
    });

    it('active_profile_id của user khác → 400 SETTINGS_ACTIVE_PROFILE_INVALID', async () => {
      const res = await request(server)
        .patch('/v1/me/settings')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ active_profile_id: profile1.id })
        .expect(400);
      expect(res.body).toMatchObject({
        code: 'SETTINGS_ACTIVE_PROFILE_INVALID',
      });
    });
  });

  it('không có token → 401 AUTH_TOKEN_MISSING', async () => {
    const res = await request(server).get('/v1/profiles').expect(401);
    expect(res.body).toMatchObject({ code: 'AUTH_TOKEN_MISSING' });
  });
});
