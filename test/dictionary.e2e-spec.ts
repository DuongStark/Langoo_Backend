import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';

interface SearchHitBody {
  lexeme_id: string;
  language_id: number;
  lang_code: string;
  surface: string;
  surface_kind: string;
  is_exact: boolean;
}

interface SenseDetailBody {
  card: {
    sense_id: string;
    lemma: string;
    gloss_vi: string | null;
    gloss_en: string | null;
  };
  glosses: { language_id: number; text: string }[];
  examples: { translation: Record<string, string> }[];
  pronunciations: { ipa: string | null; audio_key: string | null }[];
  forms: { kind: string; form_text: string }[];
}

interface HistoryItemBody {
  raw_query: string;
  language_id: number | null;
  result_count: number | null;
}

describe('Dictionary (e2e — langoo_test)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;

  const runId = Date.now();
  const email = `e2e-m4-${runId}@langoo.test`;
  const password = 'matkhau-e2e-123';
  let token = '';
  let userId = 0n;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);

    const res = await request(server)
      .post('/v1/auth/register')
      .send({ email, password })
      .expect(201);
    const body = res.body as { user: { id: string }; access_token: string };
    token = body.access_token;
    userId = BigInt(body.user.id);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('search', () => {
    it('tìm 走る không cần đăng nhập', async () => {
      const res = await request(server)
        .get('/v1/dictionary/search')
        .query({ q: '走る' })
        .expect(200);
      const body = res.body as { data: SearchHitBody[] };

      expect(body.data.some((h) => h.surface === '走る')).toBe(true);
      const hit = body.data.find((h) => h.surface === '走る')!;
      expect(hit.lang_code).toBe('ja');
      expect(hit.is_exact).toBe(true);
      expect(typeof hit.lexeme_id).toBe('string');
    });

    it('tìm run (en) — khớp chính xác lên đầu', async () => {
      const res = await request(server)
        .get('/v1/dictionary/search')
        .query({ q: 'run' })
        .expect(200);
      const body = res.body as { data: SearchHitBody[] };

      expect(body.data[0]).toMatchObject({
        surface: 'run',
        lang_code: 'en',
        is_exact: true,
      });
    });

    it('lang không tồn tại → 400 LANGUAGE_NOT_FOUND', async () => {
      const res = await request(server)
        .get('/v1/dictionary/search')
        .query({ q: 'run', lang: 'xx' })
        .expect(400);
      expect(res.body).toMatchObject({ code: 'LANGUAGE_NOT_FOUND' });
    });

    it('q rỗng → 400 VALIDATION_FAILED', async () => {
      const res = await request(server)
        .get('/v1/dictionary/search')
        .query({ q: '' })
        .expect(400);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('q chỉ có khoảng trắng → 400 VALIDATION_FAILED', async () => {
      const res = await request(server)
        .get('/v1/dictionary/search')
        .query({ q: '   ' })
        .expect(400);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('romaji hashiru → tìm được 走る qua kana', async () => {
      const res = await request(server)
        .get('/v1/dictionary/search')
        .query({ q: 'hashiru', lang: 'ja' })
        .expect(200);
      const body = res.body as { data: SearchHitBody[] };

      expect(body.data.some((hit) => hit.surface === '走る')).toBe(true);
      expect(
        body.data.some((hit) => hit.surface === '走る' && hit.is_exact),
      ).toBe(true);
    });

    it('search dùng cursor không lặp ID và không bỏ lexeme', async () => {
      const all = await request(server)
        .get('/v1/dictionary/search')
        .query({ q: 'る', lang: 'ja', limit: 100 })
        .expect(200);
      const expected = (all.body as { data: SearchHitBody[] }).data.map(
        (h) => h.lexeme_id,
      );
      expect(expected.length).toBeGreaterThan(1);
      const ids: string[] = [];
      let cursor: string | null = null;
      let firstCursor: string | null = null;
      for (let page = 0; page < 20; page++) {
        const result = await request(server)
          .get('/v1/dictionary/search')
          .query({
            q: 'る',
            lang: 'ja',
            limit: 1,
            ...(cursor ? { cursor } : {}),
          })
          .expect(200);
        const body = result.body as {
          data: SearchHitBody[];
          next_cursor: string | null;
        };
        ids.push(...body.data.map((h) => h.lexeme_id));
        cursor = body.next_cursor;
        if (page === 0) firstCursor = cursor;
        if (cursor === null) break;
      }
      expect(cursor).toBeNull();
      expect(ids).toEqual(expected);
      expect(new Set(ids).size).toBe(ids.length);
      expect(firstCursor).toEqual(expect.any(String));
      const invalid = await request(server)
        .get('/v1/dictionary/search')
        .query({ q: 'run', cursor: firstCursor! })
        .expect(400);
      expect(invalid.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('một lexeme lemma/kanji trả đúng một hit và không tạo trang giả', async () => {
      const result = await request(server)
        .get('/v1/dictionary/search')
        .query({ q: '走', lang: 'ja', limit: 1 })
        .expect(200);
      expect(
        (result.body as { data: SearchHitBody[]; next_cursor: string | null })
          .next_cursor,
      ).toBeNull();
    });

    it('search không token → không ghi lịch sử', async () => {
      await request(server)
        .get('/v1/dictionary/search')
        .query({ q: 'みず' })
        .expect(200);

      const history = await request(server)
        .get('/v1/me/search-history')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const data = (history.body as { data: HistoryItemBody[] }).data;
      expect(data.some((h) => h.raw_query === 'みず')).toBe(false);
    });

    it('search có token → ghi lịch sử (đọc lại thấy)', async () => {
      await request(server)
        .get('/v1/dictionary/search')
        .query({ q: 'run', lang: 'en' })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const history = await request(server)
        .get('/v1/me/search-history')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const data = (history.body as { data: HistoryItemBody[] }).data;
      const entry = data.find((h) => h.raw_query === 'run');

      expect(entry).toBeDefined();
      expect(entry!.language_id).toBe(1);
      expect(entry!.result_count).toBeGreaterThanOrEqual(1);
    });
  });

  describe('sense detail', () => {
    it('走る: card + gloss vi/en + ví dụ + phát âm + forms', async () => {
      const res = await request(server).get('/v1/senses/1').expect(200);
      const body = res.body as SenseDetailBody;

      expect(body.card).toMatchObject({
        sense_id: '1',
        lemma: '走る',
        gloss_vi: 'chạy',
        gloss_en: 'to run',
      });
      expect(body.glosses).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ language_id: 3, text: 'chạy' }),
        ]),
      );
      expect(
        body.examples.some((e) =>
          e.translation.en?.includes('run in the park'),
        ),
      ).toBe(true);
      expect(
        body.pronunciations.some((p) => p.audio_key?.includes('はしる.mp3')),
      ).toBe(true);
      expect(
        body.forms.some((f) => f.kind === 'kanji' && f.form_text === '走る'),
      ).toBe(true);
    });

    it('sense không tồn tại → 404 SENSE_NOT_FOUND', async () => {
      const res = await request(server).get('/v1/senses/999999').expect(404);
      expect(res.body).toMatchObject({ code: 'SENSE_NOT_FOUND' });
    });

    it('id vượt bigint hoặc không dương → 400 VALIDATION_FAILED', async () => {
      const overflow = await request(server)
        .get('/v1/senses/9223372036854775808')
        .expect(400);
      expect(overflow.body).toMatchObject({ code: 'VALIDATION_FAILED' });

      const zero = await request(server).get('/v1/senses/0').expect(400);
      expect(zero.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });

  describe('lexeme → senses', () => {
    it('eat lexeme 5 trả sense 6, không dùng lexeme id như sense id', async () => {
      const res = await request(server).get('/v1/lexemes/5/senses').expect(200);
      const body = res.body as {
        data: { sense_id: string; lexeme_id: string; lemma: string }[];
      };

      expect(body.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sense_id: '6',
            lexeme_id: '5',
            lemma: 'eat',
          }),
        ]),
      );
    });

    it('lexeme không tồn tại → 404 LEXEME_NOT_FOUND', async () => {
      const res = await request(server)
        .get('/v1/lexemes/999999/senses')
        .expect(404);
      expect(res.body).toMatchObject({ code: 'LEXEME_NOT_FOUND' });
    });
  });

  describe('cặp song ngữ (sense_pair)', () => {
    it('sense 走る → gợi ý run', async () => {
      const res = await request(server).get('/v1/senses/1/links').expect(200);
      const data = (
        res.body as {
          data: {
            sense_id: string;
            language_id: number;
            lemma: string;
            confidence: number;
          }[];
        }
      ).data;

      const run = data.find((l) => l.lemma === 'run');
      expect(run).toBeDefined();
      expect(run!.language_id).toBe(1);
      expect(run!.confidence).toBeGreaterThanOrEqual(0.7);
      expect(run!.sense_id).toBe('2');
      expect(data.filter((link) => link.sense_id === '2')).toHaveLength(1);
    });

    it('sense không tồn tại → 404 SENSE_NOT_FOUND', async () => {
      const res = await request(server)
        .get('/v1/senses/999999/links')
        .expect(404);
      expect(res.body).toMatchObject({ code: 'SENSE_NOT_FOUND' });
    });
  });

  describe('kanji', () => {
    it('chi tiết chữ 走', async () => {
      const res = await request(server).get('/v1/kanji/走').expect(200);
      const body = res.body as {
        literal: string;
        stroke_count: number | null;
        used_in_forms: number;
      };

      expect(body.literal).toBe('走');
      expect(typeof body.stroke_count).toBe('number');
      expect(typeof body.used_in_forms).toBe('number');
    });

    it('chữ không có trong dữ liệu → 404 KANJI_NOT_FOUND', async () => {
      const res = await request(server).get('/v1/kanji/X').expect(404);
      expect(res.body).toMatchObject({ code: 'KANJI_NOT_FOUND' });
    });
  });

  describe('báo lỗi gloss', () => {
    it('tạo dòng trong app.gloss_report', async () => {
      const res = await request(server)
        .post('/v1/gloss-reports')
        .set('Authorization', `Bearer ${token}`)
        .send({
          target_kind: 'sense_gloss',
          target_id: '2',
          language_id: 3,
          issue: 'wrong',
          comment: 'Nghĩa chưa đúng ngữ cảnh',
        })
        .expect(201);
      const body = res.body as { id: string; status: string };

      expect(body.status).toBe('open');
      expect(typeof body.id).toBe('string');

      const count = await prisma.glossReport.count({
        where: { userId, targetId: '2' },
      });
      expect(count).toBe(1);
    });

    it('không token → 401; issue sai → 400', async () => {
      const unauth = await request(server)
        .post('/v1/gloss-reports')
        .send({
          target_kind: 'sense_gloss',
          target_id: '2',
          issue: 'wrong',
        })
        .expect(401);
      expect(unauth.body).toMatchObject({ code: 'AUTH_TOKEN_MISSING' });

      const invalid = await request(server)
        .post('/v1/gloss-reports')
        .set('Authorization', `Bearer ${token}`)
        .send({
          target_kind: 'sense_gloss',
          target_id: '2',
          issue: 'khong-hop-le',
        })
        .expect(400);
      expect(invalid.body).toMatchObject({ code: 'VALIDATION_FAILED' });

      const blankTarget = await request(server)
        .post('/v1/gloss-reports')
        .set('Authorization', `Bearer ${token}`)
        .send({
          target_kind: 'sense_gloss',
          target_id: '   ',
          issue: 'wrong',
        })
        .expect(400);
      expect(blankTarget.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });
});
