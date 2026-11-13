import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import request from 'supertest';
import type { Server } from 'node:http';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';

describe('M12 feedback sync (HTTP + PostgreSQL)', () => {
  let app: INestApplication;
  let server: Server;
  let db: PrismaService;
  let token: string;
  let otherToken: string;
  let profileId: string;
  let collectionId: string;
  let secondCollectionId: string;
  let ja: string;
  let en: string;
  const runId = Date.now();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    server = app.getHttpServer() as Server;
    db = app.get(PrismaService);
    const a = await request(server)
      .post('/v1/auth/register')
      .send({
        email: `m12-a-${runId}@langoo.test`,
        password: 'm12-test-password',
      })
      .expect(201);
    const b = await request(server)
      .post('/v1/auth/register')
      .send({
        email: `m12-b-${runId}@langoo.test`,
        password: 'm12-test-password',
      })
      .expect(201);
    token = (a.body as { access_token: string }).access_token;
    otherToken = (b.body as { access_token: string }).access_token;
    const profile = await request(server)
      .post('/v1/profiles')
      .auth(token, { type: 'bearer' })
      .send({
        name: 'M12 bilingual',
        primary_language_id: 2,
        secondary_language_id: 1,
        support_language_id: 3,
      })
      .expect(201);
    profileId = (profile.body as { id: string }).id;
    for (let n = 0; n < 2; n++) {
      const collection = await request(server)
        .post('/v1/collections')
        .auth(token, { type: 'bearer' })
        .send({ name: `M12 ${n}` })
        .expect(201);
      if (n === 0) collectionId = (collection.body as { id: string }).id;
      else secondCollectionId = (collection.body as { id: string }).id;
    }
    const lexemes = await db.$queryRaw<{ id: bigint; language_id: number }[]>`
      INSERT INTO core.lexeme(language_id,lemma,pos,reading,romanization)
      VALUES (2,${`翻訳M12${runId}`},'noun','ほんやく',${"hon'yaku"}),
             (1,${`m12water${runId}`},'noun',NULL,NULL)
      RETURNING id,language_id
    `;
    for (const lexeme of lexemes) {
      const [sense] = await db.$queryRaw<
        { id: bigint }[]
      >`INSERT INTO core.sense(lexeme_id,sense_no,definition,is_primary) VALUES(${lexeme.id},1,'M12 fixture',true) RETURNING id`;
      if (lexeme.language_id === 2) ja = sense.id.toString();
      else en = sense.id.toString();
    }
    await db.$executeRaw`
      INSERT INTO core.sense_gloss(sense_id,language_id,rank,text,is_machine)
      VALUES (${BigInt(ja)},1,1,'translation',false),(${BigInt(ja)},3,1,'biên dịch',true)
    `;
    await db.$executeRaw`
      INSERT INTO core.translation_assertion(source_lexeme_id,target_language_id,target_text,sense_hint,scope,source_ordinal,source_key)
      VALUES (${lexemes.find((l) => l.language_id === 1)!.id},3,${`m12nước${runId}`},'water','entry',1,${`m12vi${runId}`}),
             (${lexemes.find((l) => l.language_id === 1)!.id},2,${`水${runId}`},'wrong','entry',1,${`m12ja1${runId}`}),
             (${lexemes.find((l) => l.language_id === 1)!.id},2,${`水${runId}`},'water','entry',2,${`m12ja2${runId}`})
    `;
    // Kanji data is shared fixture content, never user-entered translation.
    await db.$executeRaw`
      INSERT INTO core.kanji(literal,codepoint_ucs,readings,meanings)
      VALUES ('翻',32763,'{"groups":[[{"type":"vietnam","value":"phiên"}]]}'::jsonb,'{"groups":[[{"lang":"vi","value":"lật"}]]}'::jsonb)
      ON CONFLICT(literal) DO NOTHING
    `;
    for (const id of [collectionId, secondCollectionId]) {
      await request(server)
        .post(`/v1/collections/${id}/items`)
        .auth(token, { type: 'bearer' })
        .send({ sense_id: ja, meaning_vi: 'nghĩa do user nhập' })
        .expect(201);
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns owned membership with duplicate IDs normalized and no-store', async () => {
    const res = await request(server)
      .get('/v1/me/saved-senses')
      .auth(token, { type: 'bearer' })
      .query({ profile_id: profileId, sense_ids: `${ja},${en},${ja}` })
      .expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.body).toEqual({
      profile_id: profileId,
      data: [
        {
          sense_id: ja,
          saved_collection_ids: [collectionId, secondCollectionId].sort(),
        },
        { sense_id: en, saved_collection_ids: [] },
      ],
    });
  });

  it('rejects other users, missing auth and invalid/overflow/batch IDs', async () => {
    await request(server)
      .get('/v1/me/saved-senses')
      .auth(otherToken, { type: 'bearer' })
      .query({ profile_id: profileId, sense_ids: ja })
      .expect(404);
    await request(server)
      .get('/v1/me/saved-senses')
      .query({ profile_id: profileId, sense_ids: ja })
      .expect(401);
    for (const ids of [
      '',
      '0',
      '-1',
      '9223372036854775808',
      '1,,2',
      Array(51).fill('1').join(','),
    ]) {
      await request(server)
        .get('/v1/me/saved-senses')
        .auth(token, { type: 'bearer' })
        .query({ profile_id: profileId, sense_ids: ids })
        .expect(400);
    }
  });

  it('adds display only by opt-in, preserves meaning and batches Kanji data', async () => {
    const plain = await request(server)
      .get(`/v1/collections/${collectionId}/items`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    const rich = await request(server)
      .get(`/v1/collections/${collectionId}/items`)
      .auth(token, { type: 'bearer' })
      .query({ include: 'display' })
      .expect(200);
    const a = (plain.body as { data: Record<string, unknown>[] }).data[0];
    const b = (rich.body as { data: Record<string, unknown>[] }).data[0];
    expect(a).not.toHaveProperty('display');
    expect(b.meaning_vi).toBe('nghĩa do user nhập');
    expect(b.display).toMatchObject({
      sense_id: ja,
      lemma: `翻訳M12${runId}`,
      reading: 'ほんやく',
      gloss_en: 'translation',
      gloss_vi: 'biên dịch',
      gloss_vi_machine: true,
      gloss_vi_reviewed: false,
    });
    const detail = await request(server)
      .get(`/v1/senses/${ja}`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    for (const key of [
      'gloss_en',
      'gloss_vi',
      'gloss_vi_machine',
      'gloss_vi_reviewed',
    ])
      expect((b.display as Record<string, unknown>)[key]).toBe(
        (detail.body as { card: Record<string, unknown> }).card[key],
      );
    expect((b.display as { kanji: unknown[] }).kanji).toContainEqual({
      literal: '翻',
      readings_vi: ['phiên'],
      meanings_vi: ['lật'],
      meanings_vi_machine: false,
      meanings_vi_reviewed: false,
    });
    await request(server)
      .get(`/v1/collections/${collectionId}/items`)
      .auth(otherToken, { type: 'bearer' })
      .query({ include: 'display' })
      .expect(404);
    await request(server)
      .get(`/v1/collections/${collectionId}/items`)
      .auth(token, { type: 'bearer' })
      .query({ include: 'everything' })
      .expect(400);
  });

  it('backfills only untouched source gloss copies, aborts drift atomically and supports guarded rollback', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'm12-meaning-test-'));
    const run = async (args: string[]) => {
      const { stdout } = await promisify(execFile)(
        process.execPath,
        ['scripts/review/m12-meaning-vi-backfill.cjs', ...args],
        { env: process.env },
      );
      return JSON.parse(stdout) as {
        candidates?: number;
        rows?: number;
        sha256?: string;
        receipt_sha256?: string;
      };
    };
    const [target] = await db.$queryRaw<
      { name: string }[]
    >`SELECT current_database() AS name`;
    const ids: string[] = [];
    try {
      for (let n = 0; n < 5; n++) {
        const [lexeme] = await db.$queryRaw<
          { id: bigint }[]
        >`INSERT INTO core.lexeme(language_id,lemma,pos) VALUES(1,${`m12backfill${runId}-${n}`},'noun') RETURNING id`;
        const [sense] = await db.$queryRaw<
          { id: bigint }[]
        >`INSERT INTO core.sense(lexeme_id,sense_no,definition) VALUES(${lexeme.id},1,'legacy meaning') RETURNING id`;
        await db.$executeRaw`INSERT INTO core.sense_gloss(sense_id,language_id,rank,text,is_machine) VALUES(${sense.id},1,1,'legacy meaning',false),(${sense.id},3,1,'nghĩa Việt',true)`;
        const [item] = await db.$queryRaw<
          { id: string }[]
        >`INSERT INTO app.collection_item(collection_id,anchor_sense_id,meaning_vi,meaning_source,created_at,updated_at) VALUES(${collectionId}::uuid,${sense.id},${n === 3 ? 'custom meaning' : n === 4 ? ' legacy meaning' : 'legacy meaning'},${n === 1 ? 'user' : 'source'},'2026-01-01'::timestamptz,${n === 2 ? '2026-01-02' : '2026-01-01'}::timestamptz) RETURNING id`;
        ids.push(item.id);
      }
      const base = ['--database', target.name];
      const plan = join(directory, 'plan.json');
      const planned = await run(['plan', ...base, '--output', plan]);
      const manifest = JSON.parse(await readFile(plan, 'utf8')) as {
        rows: { id: string }[];
      };
      expect(manifest.rows.map((r) => r.id)).toContain(ids[0]);
      for (const id of ids.slice(1))
        expect(manifest.rows.map((r) => r.id)).not.toContain(id);
      const applyArgs = [
        'apply',
        ...base,
        '--manifest',
        plan,
        '--sha256',
        planned.sha256!,
        '--expected-count',
        String(planned.candidates),
      ];
      await expect(
        run([
          ...applyArgs,
          '--sha256',
          'invalid',
          '--output',
          join(directory, 'bad-hash.json'),
        ]),
      ).rejects.toThrow();
      await db.$executeRaw`UPDATE app.collection_item SET note='touched after planning' WHERE id=${ids[0]}::uuid`;
      await expect(
        run([...applyArgs, '--output', join(directory, 'stale.json')]),
      ).rejects.toThrow();
      expect(
        (await db.collectionItem.findUniqueOrThrow({ where: { id: ids[0] } }))
          .meaningVi,
      ).toBe('legacy meaning');
      // A new plan excludes the touched row. Add a fresh untouched candidate to exercise apply/rollback.
      const [fresh] = await db.$queryRaw<
        { id: string }[]
      >`INSERT INTO app.collection_item(collection_id,anchor_sense_id,meaning_vi,meaning_source) SELECT ${secondCollectionId}::uuid,anchor_sense_id,'legacy meaning','source' FROM app.collection_item WHERE id=${ids[0]}::uuid RETURNING id`;
      const newPlan = join(directory, 'plan2.json');
      const newPlanned = await run(['plan', ...base, '--output', newPlan]);
      const receipt = join(directory, 'receipt.json');
      const applied = await run([
        'apply',
        ...base,
        '--manifest',
        newPlan,
        '--sha256',
        newPlanned.sha256!,
        '--expected-count',
        String(newPlanned.candidates),
        '--output',
        receipt,
      ]);
      expect(
        await db.collectionItem.findUniqueOrThrow({ where: { id: fresh.id } }),
      ).toMatchObject({ meaningVi: 'nghĩa Việt', meaningSource: 'machine' });
      await run([
        'rollback',
        ...base,
        '--manifest',
        receipt,
        '--sha256',
        applied.receipt_sha256!,
        '--expected-count',
        String(applied.rows),
        '--output',
        join(directory, 'rollback.json'),
      ]);
      expect(
        await db.collectionItem.findUniqueOrThrow({ where: { id: fresh.id } }),
      ).toMatchObject({ meaningVi: 'legacy meaning', meaningSource: 'source' });
      await expect(
        run([
          'rollback',
          ...base,
          '--manifest',
          receipt,
          '--sha256',
          applied.receipt_sha256!,
          '--expected-count',
          String(applied.rows),
          '--output',
          join(directory, 'rollback-twice.json'),
        ]),
      ).rejects.toThrow();
      for (const id of ids.slice(1))
        expect(
          (await db.collectionItem.findUniqueOrThrow({ where: { id } }))
            .meaningVi,
        ).toBe(
          id === ids[3]
            ? 'custom meaning'
            : id === ids[4]
              ? ' legacy meaning'
              : 'legacy meaning',
        );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('uses both romaji readings in one scoped request and records one original history', async () => {
    const res = await request(server)
      .get('/v1/dictionary/search')
      .auth(token, { type: 'bearer' })
      .query({ q: 'honyaku', lang: 'ja' })
      .expect(200);
    expect(
      (res.body as { data: { lemma: string }[] }).data.some(
        (h) => h.lemma === `翻訳M12${runId}`,
      ),
    ).toBe(true);
    const history = await request(server)
      .get('/v1/me/search-history')
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(
      (history.body as { data: { raw_query: string }[] }).data.map(
        (h) => h.raw_query,
      ),
    ).toEqual(['honyaku']);
  });

  it('folds accents only on missing exact and returns the exact JA representative with aliases', async () => {
    const res = await request(server)
      .get('/v1/dictionary/reverse')
      .query({ q: `m12nuoc${runId}` })
      .expect(200);
    const body = res.body as {
      en: { lexeme_id: string; lexemeId: string }[];
      ja: { exact_sense: boolean; exactSense: boolean; sense_hint: string }[];
    };
    expect(body.en).toHaveLength(1);
    expect(body.en[0].lexeme_id).toBe(body.en[0].lexemeId);
    expect(body.ja).toHaveLength(1);
    expect(body.ja[0]).toMatchObject({
      exact_sense: true,
      exactSense: true,
      sense_hint: 'water',
    });
  });

  it('excludes archived collections but preserves saved paused/known items', async () => {
    await db.collectionItem.updateMany({
      where: { collectionId },
      data: { status: 'paused' },
    });
    await db.collectionItem.updateMany({
      where: { collectionId: secondCollectionId },
      data: { status: 'known' },
    });
    await db.collection.update({
      where: { id: secondCollectionId },
      data: { archivedAt: new Date() },
    });
    const res = await request(server)
      .get('/v1/me/saved-senses')
      .auth(token, { type: 'bearer' })
      .query({ profile_id: profileId, sense_ids: ja })
      .expect(200);
    expect(res.body).toMatchObject({
      data: [{ saved_collection_ids: [collectionId] }],
    });
  });

  it('removes romanization-only entries by explicit metadata, preserves Latin unknown entries', async () => {
    const stub = `honyaku-stub-${runId}`;
    const legitimate = `latin-entry-${runId}`;
    await db.$executeRaw`
      INSERT INTO core.lexeme(language_id,lemma,pos,attributes)
      VALUES (2,${stub},'unknown','{"wikt_pos":"romanization"}'::jsonb),
             (2,${legitimate},'unknown','{}'::jsonb)
    `;
    const hidden = await request(server)
      .get('/v1/dictionary/search')
      .query({ q: stub, lang: 'ja' })
      .expect(200);
    const shown = await request(server)
      .get('/v1/dictionary/search')
      .query({ q: legitimate, lang: 'ja' })
      .expect(200);
    expect((hidden.body as { data: unknown[] }).data).toEqual([]);
    expect(
      (shown.body as { data: { lemma: string }[] }).data.some(
        (hit) => hit.lemma === legitimate,
      ),
    ).toBe(true);
  });

  it('does not let romaji variants or saved membership escape profile languages', async () => {
    await db.studyProfile.update({
      where: { id: profileId },
      data: { primaryLanguageId: 1, secondaryLanguageId: null },
    });
    try {
      const found = await request(server)
        .get('/v1/dictionary/search')
        .auth(token, { type: 'bearer' })
        .query({ q: 'honyaku' })
        .expect(200);
      expect(
        (found.body as { data: { lang_code: string }[] }).data.every(
          (hit) => hit.lang_code === 'en',
        ),
      ).toBe(true);
      const saved = await request(server)
        .get('/v1/me/saved-senses')
        .auth(token, { type: 'bearer' })
        .query({ profile_id: profileId, sense_ids: ja })
        .expect(200);
      expect(saved.body).toMatchObject({
        data: [{ sense_id: ja, saved_collection_ids: [] }],
      });
    } finally {
      await db.studyProfile.update({
        where: { id: profileId },
        data: { primaryLanguageId: 2, secondaryLanguageId: 1 },
      });
    }
  });

  it('returns literal reverse prefixes for percent/underscore/backslash', async () => {
    for (const q of ['%', '_', '\\']) {
      const res = await request(server)
        .get('/v1/dictionary/suggestions/reverse')
        .query({ q })
        .expect(200);
      expect(res.body).toMatchObject({ matched: false, en: [], ja: [] });
    }
  });

  it('validates canonical/legacy reverse schemas and new nested display schema', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth().build(),
    );
    const schemas = document.components!.schemas!;
    expect(schemas.ReverseLookupEnHitDto).toMatchObject({
      properties: {
        lexeme_id: { type: 'string' },
        lexemeId: { type: 'string', deprecated: true },
        frequency_rank: { type: 'number', nullable: true },
        vi: { type: 'string', nullable: true },
      },
    });
    expect(schemas.ItemDisplayDto).toMatchObject({
      properties: {
        reading: { type: 'string', nullable: true },
        gloss_en: { type: 'string', nullable: true },
        gloss_vi: { type: 'string', nullable: true },
        gloss_vi_machine: { type: 'boolean' },
        gloss_vi_reviewed: { type: 'boolean' },
        kanji: { type: 'array' },
      },
    });
    expect(document.paths['/v1/me/saved-senses'].get).toBeDefined();
  });

  it('sanitizes framework 404 and never publicly caches errors', async () => {
    const res = await request(server).get('/v1/m12-no-such-route').expect(404);
    expect(res.body).toEqual({
      code: 'NOT_FOUND',
      message: 'Không tìm thấy tài nguyên',
    });
    expect(res.headers['cache-control']).toBe('private, no-store');
    const sources = await request(server).get('/v1/sources').expect(200);
    expect(sources.headers['cache-control']).toBe('public, max-age=300');
  });
});
