import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import request from 'supertest';
import { inventoryDuplicates } from '../scripts/dictionary/duplicate-inventory';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';
import {
  exportProjection,
  mutateProjection,
} from '../scripts/dictionary/source-projection';

interface Card {
  sense_id: string;
  definition: string | null;
  gloss_en: string | null;
  gloss_en_context: string[];
}
interface Hit {
  lexeme_id: string;
  pos: string;
  reading: string | null;
  surface: string;
}
interface Page {
  data: Hit[];
  next_cursor: string | null;
}

describe('M4.2 / DB4-D0.2 dictionary dedup and source projection', () => {
  let app: INestApplication, server: Server, db: PrismaService, client: Client;
  const work = mkdtempSync(join(tmpdir(), 'langoo-dictionary-d0-'));
  const target = 'fixture';
  let journalNo = 0;
  const journal = () => join(work, `journal-${journalNo++}.json`);
  const base = 710000n;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    server = app.getHttpServer() as Server;
    db = app.get(PrismaService);
    client = new Client({ connectionString: process.env.DIRECT_URL });
    await client.connect();
    // Same lemma from two sources + different POS, reading and etymology.
    await db.$executeRawUnsafe(`INSERT INTO core.lexeme(id,language_id,lemma,pos,reading,homograph_no,source_id,attributes)
      VALUES (710001,2,'試験猫','noun','しけんねこ',1,1,'{}'),
             (710002,2,'試験猫','noun','しけんねこま',2,1,'{}'),
             (710003,2,'試験猫','noun',NULL,3,8,'{"etymology_number":1}'),
             (710004,2,'試験猫','noun',NULL,4,8,'{"etymology_number":2}'),
             (710005,2,'試験猫','verb',NULL,1,5,'{}'),
             (710006,1,'dedup-eat','verb',NULL,1,8,'{}'),
             (710007,2,'試験同義','noun','しけんどうぎ',1,1,'{}')`);
    await db.$executeRawUnsafe(`INSERT INTO core.lexeme_form(lexeme_id,kind,form_text,form_order)
      VALUES (710001,'kanji','試験猫',1),(710001,'kana','しけんねこ',1),(710001,'kanji','試験猫別',2)`);
    await db.$executeRawUnsafe(`INSERT INTO core.sense(id,lexeme_id,sense_no,definition,definition_language_id,source_id,attributes)
      VALUES (710011,710006,1,'To ingest.',1,8,'{"tags":["ambitransitive"]}'),
             (710012,710006,2,'To ingest.',1,8,'{"tags":["intransitive"]}'),
             (710013,710006,3,'To ingest.',1,8,'{}'),
             (710014,710006,4,'Custom definition',1,8,'{}'),
             (710015,710006,5,'To ingest.',1,8,'{}'),
             (710016,710006,6,'To ingest.',1,8,'{}'),
             (710017,710006,7,'To ingest.',1,8,'{}'),
             (710018,710007,1,NULL,NULL,1,'{}')`);
    await db.$executeRawUnsafe(`INSERT INTO core.sense_gloss(sense_id,language_id,text,rank,source_id,is_machine)
      VALUES (710011,1,'To ingest.',1,8,false),(710011,1,'To swallow food.',2,8,false),
             (710012,1,'To ingest.',1,8,false),(710012,1,'To consume a meal.',2,8,false),
             (710013,1,'To ingest.',1,8,false),(710013,1,'Diet.',2,8,false),(710013,1,'To be well-fed or underfed.',3,8,false),
             (710014,1,'To ingest.',1,8,false),(710014,1,'Custom leaf.',2,8,false),
             (710015,1,'To ingest.',1,8,false),(710015,1,'Reviewed gloss.',2,8,false),
             (710016,1,'To ingest.',1,8,false),(710016,1,'Machine gloss.',2,8,true),
             (710017,1,'To ingest.',1,8,false),(710017,1,'Missing rank two.',3,8,false),
             (710018,1,'one meaning',1,1,false),(710018,1,'another phrasing',2,1,false)`);
    await db.$executeRawUnsafe(
      `UPDATE core.sense_gloss SET reviewed_by=1,reviewed_at=now() WHERE sense_id=710015 AND rank=2`,
    );
    await db.$executeRawUnsafe(`INSERT INTO core.sense(id,lexeme_id,sense_no,definition,definition_language_id,source_id)
      VALUES (710019,710006,8,'To ingest.',1,8),(710020,710006,9,'To ingest.',1,8),
             (710025,710006,10,'To ingest.',3,8),(710026,710006,11,NULL,NULL,8)`);
    await db.$executeRawUnsafe(`INSERT INTO core.sense_gloss(sense_id,language_id,text,rank,source_id)
      VALUES (710019,1,'To ingest.',1,8),(710019,1,'Foreign source.',2,1),
             (710020,1,'To ingest.',1,8),(710020,1,'Different batch.',2,8),
             (710025,1,'To ingest.',1,8),(710025,1,'Foreign definition language.',2,8),
             (710026,1,'To ingest.',1,8),(710026,1,'Previously missing definition.',2,8)`);
    await db.$executeRawUnsafe(
      `UPDATE core.sense_gloss SET batch_id=(SELECT id FROM staging.import_batch LIMIT 1) WHERE sense_id=710020 AND rank=2`,
    );
    await db.$executeRawUnsafe(`INSERT INTO core.lexeme(id,language_id,lemma,pos,homograph_no,source_id,attributes)
      VALUES (710021,1,'d0-wordnet-same','noun',1,5,'{"lexicon":"fixture-oewn"}'),
             (710022,1,'d0-wordnet-same','noun',2,7,'{"lexicon":"fixture-omw"}'),
             (710023,1,'d0-wordnet-conflict','noun',1,5,'{"lexicon":"fixture-oewn"}'),
             (710024,1,'d0-wordnet-conflict','noun',2,7,'{"lexicon":"fixture-omw"}')`);
    await db.$executeRawUnsafe(`INSERT INTO core.sense(id,lexeme_id,sense_no,definition,definition_language_id,source_id,attributes)
      VALUES (710031,710021,1,'an animal',1,5,'{"lexicon":"fixture-oewn","synset_id":"d0-a"}'),
             (710032,710022,1,'an animal',1,7,'{"lexicon":"fixture-omw","synset_id":"d0-b"}'),
             (710033,710023,1,'an animal',1,5,'{"lexicon":"fixture-oewn","synset_id":"d0-a","tags":["archaic"]}'),
             (710034,710024,1,'an animal',1,7,'{"lexicon":"fixture-omw","synset_id":"d0-b"}')`);
    await db.$executeRawUnsafe(`INSERT INTO core.wordnet_synset(lexicon,synset_id,concept_id,source_id,batch_id)
      VALUES ('fixture-oewn','d0-a',1,5,(SELECT id FROM staging.import_batch LIMIT 1)),
             ('fixture-omw','d0-b',1,7,(SELECT id FROM staging.import_batch LIMIT 1))`);
    await db.$executeRawUnsafe(`INSERT INTO core.sense_concept(sense_id,concept_id,method,relation,verified)
      VALUES (710031,1,'wordnet_synset','exact',true),(710032,1,'wordnet_synset','exact',true),
             (710033,1,'wordnet_synset','exact',true),(710034,1,'wordnet_synset','exact',true)`);
  });
  afterAll(async () => {
    await db.$executeRaw`DELETE FROM core.sense_concept WHERE sense_id > ${base} AND sense_id < ${base + 100n}`;
    await db.$executeRawUnsafe(
      `DELETE FROM core.wordnet_synset WHERE lexicon IN ('fixture-oewn','fixture-omw')`,
    );
    await db.$executeRaw`DELETE FROM core.sense_gloss WHERE sense_id > ${base} AND sense_id < ${base + 100n}`;
    await db.$executeRaw`DELETE FROM core.sense WHERE id > ${base} AND id < ${base + 100n}`;
    await db.$executeRaw`DELETE FROM core.lexeme_form WHERE lexeme_id > ${base} AND lexeme_id < ${base + 100n}`;
    await db.$executeRaw`DELETE FROM core.lexeme WHERE id > ${base} AND id < ${base + 100n}`;
    await client.end();
    await app.close();
    rmSync(work, { recursive: true });
  });

  it('keeps all sources/POS/readings and returns each lexeme once over limit=1 pages', async () => {
    let cursor: string | null = null;
    const hits: Hit[] = [];
    for (let i = 0; i < 10; i++) {
      const res = await request(server)
        .get('/v1/dictionary/search')
        .query({
          q: '試験猫',
          lang: 'ja',
          limit: 1,
          ...(cursor ? { cursor } : {}),
        })
        .expect(200);
      const page = res.body as Page;
      hits.push(...page.data);
      cursor = page.next_cursor;
      if (!cursor) break;
    }
    expect(cursor).toBeNull();
    expect(hits).toHaveLength(5);
    expect(new Set(hits.map((h) => h.lexeme_id)).size).toBe(5);
    expect(hits.some((h) => h.pos === 'verb')).toBe(true);
    expect(hits.filter((h) => h.reading === null)).toHaveLength(3);
    expect(hits.find((h) => h.lexeme_id === '710001')?.surface).toBe('試験猫');
  });

  it('kana/romaji matching does not return multiple surfaces for one ID', async () => {
    const res = await request(server)
      .get('/v1/dictionary/search')
      .query({ q: 'shikenneko', lang: 'ja', limit: 100 })
      .expect(200);
    const ids = (res.body as Page).data.map((h) => h.lexeme_id);
    expect(ids).toContain('710001');
    expect(ids.filter((id) => id === '710001')).toHaveLength(1);
    expect(
      (res.body as Page).data.find((h) => h.lexeme_id === '710001')?.surface,
    ).toBe('試験猫');
    const kana = await request(server)
      .get('/v1/dictionary/search')
      .query({ q: 'しけんねこ', lang: 'ja', limit: 100 })
      .expect(200);
    expect(
      (kana.body as Page).data.find((h) => h.lexeme_id === '710001')?.surface,
    ).toBe('しけんねこ');
  });

  it('first and later senses use the same source meaning in list/detail, retaining full context', async () => {
    const res = await request(server)
      .get('/v1/lexemes/710006/senses')
      .expect(200);
    const cards = (res.body as { data: Card[] }).data;
    for (const [id, leaf, chain] of [
      ['710011', 'To swallow food.', ['To ingest.', 'To swallow food.']],
      ['710012', 'To consume a meal.', ['To ingest.', 'To consume a meal.']],
      [
        '710013',
        'To be well-fed or underfed.',
        ['To ingest.', 'Diet.', 'To be well-fed or underfed.'],
      ],
    ] as const) {
      const detail = await request(server)
        .get('/v1/senses/' + id)
        .expect(200);
      expect(cards.find((c) => c.sense_id === id)).toEqual(
        (detail.body as { card: Card }).card,
      );
      expect((detail.body as { card: Card }).card).toMatchObject({
        definition: leaf,
        gloss_en: leaf,
        gloss_en_context: [...chain],
      });
    }
  });

  it('preserves custom definition, reviewed override, machine/gapped ranks and JMdict alternatives', async () => {
    const get = async (id: string) =>
      (
        await request(server)
          .get('/v1/senses/' + id)
          .expect(200)
      ).body as { card: Card };
    expect((await get('710014')).card.definition).toBe('Custom definition');
    expect((await get('710015')).card.gloss_en).toBe('Reviewed gloss.');
    expect((await get('710016')).card.gloss_en).toBe('To ingest.');
    expect((await get('710017')).card.definition).toBe('To ingest.');
    expect((await get('710019')).card.definition).toBe('To ingest.');
    expect((await get('710020')).card.definition).toBe('To ingest.');
    expect((await get('710025')).card.definition).toBe('To ingest.');
    expect((await get('710026')).card.definition).toBe(
      'Previously missing definition.',
    );
    expect((await get('710018')).card).toMatchObject({
      definition: null,
      gloss_en: 'one meaning',
      gloss_en_context: ['one meaning', 'another phrasing'],
    });
  });

  it('exports guarded decisions, applies once, resumes and rolls back with IDs/context unchanged', async () => {
    const m = await exportProjection(client, target, 500, '710000');
    expect(
      m.records.filter((r) => r.decision === 'eligible').map((r) => r.senseId),
    ).toEqual(['710011', '710012', '710013', '710026']);
    expect(m.records.filter((r) => r.decision === 'blocked')).toHaveLength(7);
    const j = journal();
    expect(await mutateProjection(client, m, target, j, 'apply')).toEqual({
      changed: 4,
      unchanged: 0,
    });
    expect(
      (JSON.parse(readFileSync(j, 'utf8')) as { manifest: unknown }).manifest,
    ).toEqual(m);
    expect(
      await mutateProjection(client, m, target, journal(), 'apply'),
    ).toEqual({ changed: 0, unchanged: 4 });
    expect(
      await mutateProjection(client, m, target, journal(), 'rollback'),
    ).toEqual({ changed: 4, unchanged: 0 });
    expect(
      await mutateProjection(client, m, target, journal(), 'rollback'),
    ).toEqual({ changed: 0, unchanged: 4 });
  });

  it('rejects target mismatch, tampering and source drift; a later conflict rolls back earlier writes', async () => {
    const m = await exportProjection(client, target, 500, '710000');
    await expect(
      mutateProjection(client, m, 'different-db', journal(), 'apply'),
    ).rejects.toThrow('target mismatch');
    await expect(
      mutateProjection(
        client,
        { ...m, digest: '0'.repeat(64) },
        target,
        journal(),
        'apply',
      ),
    ).rejects.toThrow('integrity');
    await db.$executeRawUnsafe(
      `UPDATE core.sense_gloss SET text='Changed context' WHERE sense_id=710012 AND rank=2`,
    );
    await expect(
      mutateProjection(client, m, target, journal(), 'apply'),
    ).rejects.toThrow('Source drift');
    const rows = await db.$queryRaw<
      { definition: string }[]
    >`SELECT definition FROM core.sense WHERE id=710011`;
    expect(rows[0].definition).toBe('To ingest.');
    await db.$executeRawUnsafe(
      `UPDATE core.sense_gloss SET text='To consume a meal.' WHERE sense_id=710012 AND rank=2`,
    );
  });
  it('inventories full-scope WordNet pairs, detects qualifiers and counts FK without deleting', async () => {
    const report = await inventoryDuplicates(client, target, 500, '710000');
    expect(report.counts).toMatchObject({
      pairs: 2,
      sameScopeCandidates: 1,
      contextConflicts: 1,
      directlyDeletable: 0,
    });
    const same = report.records.find((r) => r.keep_sense_id === '710031')!;
    expect(same.otherReferences['core.sense_concept.sense_id']).toBe(1);
    expect(same.directlyDeletable).toBe(false);
    const rows = await db.$queryRaw<
      { n: bigint }[]
    >`SELECT count(*) AS n FROM core.sense WHERE id IN (710031,710032,710033,710034)`;
    expect(rows[0].n).toBe(4n);
  });
});
