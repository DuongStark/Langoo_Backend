import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import type { Server } from 'node:http';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';

interface Hit {
  text?: string;
  lexeme_id: string | null;
  sense_id?: string | null;
  via_lexeme_id?: string;
  via_lemma?: string;
  preview: {
    sense_id: string;
    lexeme_id: string;
    gloss_vi: string | null;
    gloss_vi_machine: boolean | null;
    gloss_vi_reviewed: boolean | null;
  } | null;
}
interface Result {
  en: Hit[];
  ja: Hit[];
}

describe('M12-A06.1/A12 A3F0C7 reverse preview HTTP/DB', () => {
  let app: INestApplication, server: Server, db: PrismaService;
  let token: string,
    profile: string,
    enWord: bigint,
    enSense: bigint,
    jaWord: bigint,
    jaSense: bigint,
    ambiguousWord: bigint,
    acceptedSense: bigint,
    assertion: bigint;
  const run = Date.now();
  const query = `câyA3${run}`;
  const japanese = `植物A3${run}`;
  const ambiguous = `曖昧A3${run}`;
  const unknown = `未登録A3${run}`;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    server = app.getHttpServer() as Server;
    db = app.get(PrismaService);
    const registered = await request(server)
      .post('/v1/auth/register')
      .send({
        email: `a3f0c7-${run}@langoo.test`,
        password: 'reverse-preview-test',
      })
      .expect(201);
    token = (registered.body as { access_token: string }).access_token;
    const p = await request(server)
      .post('/v1/profiles')
      .auth(token, { type: 'bearer' })
      .send({
        name: 'A3F0C7',
        primary_language_id: 2,
        secondary_language_id: 1,
        support_language_id: 3,
      })
      .expect(201);
    profile = (p.body as { id: string }).id;
    const [source] = await db.$queryRaw<
      { id: number }[]
    >`SELECT id FROM public.source WHERE code='jmdict'`;
    const createWord = async (language: number, lemma: string) => {
      const [row] = await db.$queryRaw<
        { id: bigint }[]
      >`INSERT INTO core.lexeme(language_id,lemma,pos,source_id) VALUES(${language},${lemma},'noun',${language === 2 ? source.id : null}) RETURNING id`;
      return row.id;
    };
    const createSense = async (
      word: bigint,
      n: number,
      definition: string,
      vi: string,
    ) => {
      const [row] = await db.$queryRaw<
        { id: bigint }[]
      >`INSERT INTO core.sense(lexeme_id,sense_no,definition,definition_language_id) VALUES(${word},${n},${definition},1) RETURNING id`;
      await db.$executeRaw`INSERT INTO core.sense_gloss(sense_id,language_id,rank,text,is_machine) VALUES(${row.id},1,1,${definition},false),(${row.id},3,1,${vi},true)`;
      return row.id;
    };
    enWord = await createWord(1, `plantA3${run}`);
    await createSense(enWord, 1, 'industrial factory', 'nhà máy');
    enSense = await createSense(
      enWord,
      2,
      'organism capable of photosynthesis',
      'thực vật',
    );
    jaWord = await createWord(2, japanese);
    await createSense(jaWord, 1, 'industrial factory', 'nhà máy');
    jaSense = await createSense(
      jaWord,
      2,
      'organism capable of photosynthesis',
      'cây, thực vật',
    );
    ambiguousWord = await createWord(2, ambiguous);
    const pendingSense = await createSense(
      ambiguousWord,
      1,
      'unrelated first meaning',
      'nghĩa đầu',
    );
    acceptedSense = await createSense(
      ambiguousWord,
      2,
      'unrelated second meaning',
      'nghĩa hai',
    );
    await db.$executeRaw`INSERT INTO core.translation_assertion(source_lexeme_id,source_sense_id,target_language_id,target_text,sense_hint,scope,source_ordinal,source_key) VALUES(${enWord},${enSense},3,${query},'organism capable of photosynthesis','sense',1,${`a3-vi-${run}`})`;
    for (const [i, text] of [japanese, ambiguous, unknown].entries()) {
      const [row] = await db.$queryRaw<
        { id: bigint }[]
      >`INSERT INTO core.translation_assertion(source_lexeme_id,source_sense_id,target_language_id,target_text,sense_hint,scope,source_ordinal,source_key) VALUES(${enWord},${enSense},2,${text},'organism capable of photosynthesis','sense',${i + 1},${`a3-ja-${run}-${i}`}) RETURNING id`;
      if (text === ambiguous) {
        assertion = row.id;
        await db.$executeRaw`INSERT INTO core.translation_target_candidate(assertion_id,target_lexeme_id,target_sense_id,score,match_method,decision) VALUES(${row.id},${ambiguousWord},${pendingSense},0.55,'exact_form','pending')`;
      }
    }
  });
  afterAll(async () => {
    await app?.close();
  });

  it.each(['/v1/dictionary/reverse', '/v1/dictionary/suggestions/reverse'])(
    '%s selects the matched nonfirst EN/JA sense and preserves aliases',
    async (route) => {
      const response = await request(server)
        .get(route)
        .auth(token, { type: 'bearer' })
        .query({ q: query })
        .expect(200);
      const body = response.body as Result;
      expect(
        body.en.find((h) => h.lexeme_id === enWord.toString())?.preview,
      ).toMatchObject({ sense_id: enSense.toString(), gloss_vi: 'thực vật' });
      expect(body.ja.find((h) => h.text === japanese)).toMatchObject({
        lexeme_id: jaWord.toString(),
        sense_id: jaSense.toString(),
        via_lexeme_id: enWord.toString(),
        exact_sense: true,
        exactSense: true,
        preview: {
          sense_id: jaSense.toString(),
          gloss_vi: 'cây, thực vật',
          gloss_vi_machine: true,
          gloss_vi_reviewed: false,
        },
      });
      expect(response.headers['cache-control']).toBe('private, no-store');
    },
  );

  it('keeps missing identities and ambiguous senses null, ignoring pending target candidates', async () => {
    const r = await request(server)
      .get('/v1/dictionary/reverse')
      .query({ q: query })
      .expect(200);
    const body = r.body as Result;
    expect(body.ja.find((h) => h.text === unknown)).toMatchObject({
      lexeme_id: null,
      sense_id: null,
      preview: null,
    });
    expect(body.ja.find((h) => h.text === ambiguous)).toMatchObject({
      lexeme_id: ambiguousWord.toString(),
      sense_id: null,
      preview: null,
    });
  });

  it('uses an explicitly accepted target sense without falling back to the first one', async () => {
    await db.$executeRaw`UPDATE core.translation_target_candidate SET decision='accepted',target_sense_id=${acceptedSense} WHERE assertion_id=${assertion}`;
    try {
      const r = await request(server)
        .get('/v1/dictionary/reverse')
        .query({ q: query })
        .expect(200);
      expect(
        (r.body as Result).ja.find((h) => h.text === ambiguous),
      ).toMatchObject({
        sense_id: acceptedSense.toString(),
        preview: { sense_id: acceptedSense.toString(), gloss_vi: 'nghĩa hai' },
      });
    } finally {
      await db.$executeRaw`UPDATE core.translation_target_candidate SET decision='pending' WHERE assertion_id=${assertion}`;
    }
  });

  it('uses live exact curated mappings and rejects the same mapping after downgrade', async () => {
    const [concept] = await db.$queryRaw<
      { id: bigint }[]
    >`INSERT INTO core.concept(pos,status) VALUES('noun','curated') RETURNING id`;
    await db.$executeRaw`INSERT INTO core.sense_concept(sense_id,concept_id,relation,confidence,method,verified) VALUES(${enSense},${concept.id},'exact',1,'a3-test',true),(${acceptedSense},${concept.id},'exact',1,'a3-test',true)`;
    try {
      const good = await request(server)
        .get('/v1/dictionary/reverse')
        .query({ q: query })
        .expect(200);
      expect(
        (good.body as Result).ja.find((h) => h.text === ambiguous)?.sense_id,
      ).toBe(acceptedSense.toString());
      await db.$executeRaw`UPDATE core.concept SET status='draft' WHERE id=${concept.id}`;
      const bad = await request(server)
        .get('/v1/dictionary/reverse')
        .query({ q: query })
        .expect(200);
      expect(
        (bad.body as Result).ja.find((h) => h.text === ambiguous)?.sense_id,
      ).toBeNull();
    } finally {
      await db.$executeRaw`DELETE FROM core.sense_concept WHERE concept_id=${concept.id}`;
      await db.$executeRaw`DELETE FROM core.concept WHERE id=${concept.id}`;
    }
  });

  it('respects Japanese sense/form restrictions before attaching a matching gloss', async () => {
    const forms = await db.$queryRaw<
      { id: bigint; form_text: string }[]
    >`INSERT INTO core.lexeme_form(lexeme_id,kind,form_text,form_order) VALUES(${jaWord},'kanji',${`別表記A3${run}`},99),(${jaWord},'kanji',${japanese},100) RETURNING id,form_text`;
    const other = forms.find((f) => f.form_text !== japanese)!.id;
    const own = forms.find((f) => f.form_text === japanese)!.id;
    await db.$executeRaw`INSERT INTO core.sense_form(sense_id,form_id) VALUES(${jaSense},${other})`;
    try {
      const blocked = await request(server)
        .get('/v1/dictionary/reverse')
        .query({ q: query })
        .expect(200);
      expect(
        (blocked.body as Result).ja.find((h) => h.text === japanese)?.sense_id,
      ).toBeNull();
      await db.$executeRaw`INSERT INTO core.sense_form(sense_id,form_id) VALUES(${jaSense},${own})`;
      const good = await request(server)
        .get('/v1/dictionary/reverse')
        .query({ q: query })
        .expect(200);
      expect(
        (good.body as Result).ja.find((h) => h.text === japanese)?.sense_id,
      ).toBe(jaSense.toString());
    } finally {
      await db.$executeRaw`DELETE FROM core.sense_form WHERE sense_id=${jaSense}`;
      await db.$executeRaw`DELETE FROM core.lexeme_form WHERE id IN (${other},${own})`;
    }
  });

  it('does not expose an English preview or lemma outside a JA-only profile', async () => {
    await db.studyProfile.update({
      where: { id: profile },
      data: { secondaryLanguageId: null },
    });
    try {
      const r = await request(server)
        .get('/v1/dictionary/reverse')
        .auth(token, { type: 'bearer' })
        .query({ q: query })
        .expect(200);
      const body = r.body as Result;
      expect(body.en).toEqual([]);
      expect(body.ja.find((h) => h.text === japanese)).toMatchObject({
        lexeme_id: jaWord.toString(),
        sense_id: jaSense.toString(),
        via_lemma: '',
        preview: { lexeme_id: jaWord.toString() },
      });
    } finally {
      await db.studyProfile.update({
        where: { id: profile },
        data: { secondaryLanguageId: 1 },
      });
    }
  });

  it('documents nullable IDs and the shared sense preview schema', () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    const schemas = doc.components!.schemas!;
    expect(schemas.ReverseLookupJaHitDto).toMatchObject({
      properties: {
        lexeme_id: { type: 'string', nullable: true },
        sense_id: { type: 'string', nullable: true },
        preview: { nullable: true },
      },
    });
    expect(JSON.stringify(schemas.ReverseLookupJaHitDto)).toContain(
      '#/components/schemas/SenseCardDto',
    );
    expect(JSON.stringify(schemas.ReverseLookupEnHitDto)).toContain(
      '#/components/schemas/SenseCardDto',
    );
  });
});
