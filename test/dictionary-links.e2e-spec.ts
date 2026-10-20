import { validate } from 'class-validator';
import { SearchQueryDto } from '../src/dictionary/dto/search-query.dto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/db/prisma.service';
import { LanguageRepository } from '../src/db/repositories/language.repository';
import { DictionaryService } from '../src/dictionary/dictionary.service';
import { DictionarySearchRepository } from '../src/dictionary/repositories/dictionary-search.repository';
import { SensePairRepository } from '../src/dictionary/repositories/sense-pair.repository';
import { SenseCardRepository } from '../src/dictionary/repositories/sense-card.repository';
import { SenseContentRepository } from '../src/dictionary/repositories/sense-content.repository';
import { EnglishPriorityRepository } from '../src/dictionary/repositories/english-priority.repository';
import { JapanesePriorityRepository } from '../src/dictionary/repositories/japanese-priority.repository';
import { KanjiRepository } from '../src/dictionary/repositories/kanji.repository';
import { SearchHistoryRepository } from '../src/dictionary/repositories/search-history.repository';
import { ReverseLookupRepository } from '../src/dictionary/repositories/reverse-lookup.repository';
import { StudyLanguageScopeService } from '../src/users/study-language-scope.service';

describe('M4.3 searchable bilingual links (real DB)', () => {
  let db: PrismaService;
  let service: DictionaryService;
  let pairs: SensePairRepository;

  beforeAll(async () => {
    db = new PrismaService(new ConfigService(process.env));
    await db.onModuleInit();
    pairs = new SensePairRepository(db);
    const unusedStorage = (): Promise<never> =>
      Promise.reject(new Error('Links must not access file storage'));
    service = new DictionaryService(
      new DictionarySearchRepository(db),
      new SenseCardRepository(db),
      new SenseContentRepository(db),
      pairs,
      new KanjiRepository(db),
      new SearchHistoryRepository(db),
      new LanguageRepository(db),
      { get: unusedStorage, put: unusedStorage, delete: unusedStorage },
      new JapanesePriorityRepository(db),
      new ReverseLookupRepository(db),
      new StudyLanguageScopeService(db),
      new EnglishPriorityRepository(db),
    );
    await db.$executeRawUnsafe(`
      INSERT INTO core.concept(id,status) VALUES
        (860001,'curated'),(860002,'curated'),(860003,'curated');
      INSERT INTO core.lexeme(id,language_id,lemma,reading,pos,source_id,frequency_rank,homograph_no) VALUES
        (860001,1,'m43agony',NULL,'noun',8,5,99),
        (860002,2,'検証苦痛','けんしょうくつう','noun',1,100,99),
        (860003,2,'検証苦痛','けんしょうくつうに','noun',1,101,100),
        (860004,2,'検証悲痛','けんしょうひつう','noun',1,200,99),
        (860005,2,'検証激痛','けんしょうげきつう','noun',1,300,99),
        (860006,2,'検証重苦','けんしょうじゅうく','noun',1,400,99),
        (860007,2,'検証隠痛',NULL,'noun',6,1,99),
        (860008,2,'検証隠痛','けんしょういんつう','noun',1,2,100),
        (860009,2,'検証未訳','けんしょうみやく','noun',1,1,99),
        (860010,2,'検証関連','けんしょうかんれん','noun',1,1,99),
        (860011,2,'検証低信','けんしょうていしん','noun',1,1,99),
        (860012,2,'検証撤回','けんしょうてっかい','noun',1,1,99),
        (860013,2,'検証未承認','けんしょうみしょうにん','noun',1,1,99),
        (860014,2,'検証読無',NULL,'noun',1,1,99),
        (860020,1,'m43torment',NULL,'noun',8,10,99),
        (860021,1,'m43anguish',NULL,'noun',8,20,99),
        (860022,1,'M43Agony',NULL,'noun',8,6,99),
        (860023,1,'m43untranslated',NULL,'noun',8,1,99),
        (860024,1,'m43sourcefree',NULL,'noun',NULL,1,99),
        (860025,1,'m43'||repeat('long',26),NULL,'noun',8,1,99),
        (860030,1,'m43only',NULL,'noun',8,5,99),
        (860031,2,'検証多義','けんしょうたぎ','noun',1,10000,99);
      INSERT INTO core.lexeme(id,language_id,lemma,reading,pos,source_id,frequency_rank,homograph_no)
        SELECT 860100+i,2,'検証多義','けんしょうたぎ'||i,'noun',1,i,i
        FROM generate_series(1,25) i;
      INSERT INTO core.sense(id,lexeme_id,sense_no,definition)
        SELECT id,id,1,'Fixture meaning' FROM core.lexeme WHERE id BETWEEN 860001 AND 860200;
      INSERT INTO core.sense(id,lexeme_id,sense_no,definition) VALUES
        (861002,860002,2,'Second equivalent sense'),
        (861009,860009,2,'Only this other sense has Vietnamese');
      INSERT INTO core.sense_gloss(sense_id,language_id,text)
        SELECT id,3,'Nghĩa Việt của fixture' FROM core.sense
        WHERE id BETWEEN 860001 AND 861009 AND id NOT IN (860009,860023);
      INSERT INTO core.sense_concept(sense_id,concept_id,relation,confidence,method)
        SELECT id,860001,'exact',1,'m43-test' FROM core.sense
        WHERE id BETWEEN 860001 AND 860025 AND id NOT IN (860008,860013);
      INSERT INTO core.sense_concept(sense_id,concept_id,relation,confidence,method) VALUES
        (861002,860001,'exact',1,'m43-test'),
        (860001,860003,'exact',1,'m43-test'),
        (860013,860003,'exact',1,'m43-test'),
        (860030,860002,'exact',1,'m43-test'),
        (860031,860002,'exact',1,'m43-test');
      -- Publish first, then change the live mapping: stale matview rows must be rejected.
      REFRESH MATERIALIZED VIEW serve.sense_pair;
      UPDATE core.sense_concept SET confidence=0.9 WHERE sense_id IN (860002,861002);
      UPDATE core.sense_concept SET confidence=0.8 WHERE sense_id=860004;
      UPDATE core.sense_concept SET confidence=0.7 WHERE sense_id=860006;
      UPDATE core.sense_concept SET relation='related' WHERE sense_id=860010;
      UPDATE core.sense_concept SET confidence=0.6 WHERE sense_id=860011;
      DELETE FROM core.sense_concept WHERE sense_id=860012;
      UPDATE core.concept SET status='draft' WHERE id=860003;
      INSERT INTO core.dictionary_priority_run(
        id,policy,language_id,source_code,source_version,source_sha256,
        artifact_sha256,target_identity,active)
      VALUES ('00000000-0000-0000-0000-000000000043','ja-bccwj-v1',2,
        'm43-test','v1',repeat('a',64),repeat('b',64),'m43-test',true);
      INSERT INTO core.lexeme_learner_priority(run_id,lexeme_id,input_hash,corpus_rank,evidence)
      VALUES ('00000000-0000-0000-0000-000000000043',860004,
        core.japanese_priority_input_hash(860004),50,'{}');
    `);
  });

  afterAll(async () => {
    if (!db) return;
    await db.$executeRawUnsafe(`
      DELETE FROM core.lexeme_learner_priority WHERE run_id='00000000-0000-0000-0000-000000000043';
      DELETE FROM core.dictionary_priority_run WHERE id='00000000-0000-0000-0000-000000000043';
      DELETE FROM core.sense_concept WHERE sense_id BETWEEN 860001 AND 861009;
      DELETE FROM core.sense_gloss WHERE sense_id BETWEEN 860001 AND 861009;
      DELETE FROM core.sense WHERE id BETWEEN 860001 AND 861009;
      DELETE FROM core.lexeme WHERE id BETWEEN 860001 AND 860200;
      DELETE FROM core.concept WHERE id BETWEEN 860001 AND 860003;
      REFRESH MATERIALIZED VIEW serve.sense_pair;
    `);
    await db.onModuleDestroy();
  });

  it('EN → JA chooses three different, searchable words with VI on the mapped sense', async () => {
    const links = (await service.getSenseLinks(860001n)).data;
    expect(links.map((x) => x.sense_id)).toEqual([
      '860004',
      '860002',
      '860005',
    ]);
    for (const link of links) {
      const detail = await service.getSenseDetail(BigInt(link.sense_id));
      expect(detail.card.gloss_vi).toBeTruthy();
      const hits = await service.search({ q: link.lemma, lang: 'ja' });
      expect(hits.data.map((x) => x.lexeme_id)).toContain(
        detail.card.lexeme_id,
      );
      const senses = await service.getLexemeSenses(
        BigInt(detail.card.lexeme_id),
        'flat',
      );
      expect(senses.data.map((x) => x.sense_id)).toContain(link.sense_id);
    }
  });

  it('JA → EN collapses capitalization and keeps three distinct translated words', async () => {
    const links = (await service.getSenseLinks(860002n)).data;
    expect(links.map((x) => x.lemma)).toEqual([
      'm43sourcefree',
      'm43agony',
      'm43torment',
    ]);
    for (const link of links) {
      const detail = await service.getSenseDetail(BigInt(link.sense_id));
      const hits = await service.search({ q: link.lemma, lang: 'en' });
      expect(detail.card.gloss_vi).toBeTruthy();
      expect(hits.data.map((x) => x.lexeme_id)).toContain(
        detail.card.lexeme_id,
      );
    }
  });

  it('omits labels rejected by public search validation', async () => {
    const invalid = Object.assign(new SearchQueryDto(), {
      q: 'm43' + 'long'.repeat(26),
      lang: 'en',
    });
    expect(
      (await validate(invalid)).some((error) => error.property === 'q'),
    ).toBe(true);
    const links = (await service.getSenseLinks(860002n)).data;
    expect(links.map((link) => link.lemma)).not.toContain(invalid.q);
    for (const link of links) {
      const query = Object.assign(new SearchQueryDto(), {
        q: link.lemma,
        lang: 'en',
      });
      expect(await validate(query)).toEqual([]);
    }
  });

  it('rejects stale nonexact, low confidence, revoked and no-longer-curated pairs', async () => {
    const links = await pairs.findLinks(860001n);
    const ids = links.map((x) => x.sense_id);
    expect(ids).toContain(860006n); // real 0.7 is the inclusive policy boundary.
    for (const bad of [860009n, 860010n, 860011n, 860012n, 860013n, 860014n])
      expect(ids).not.toContain(bad);
  });

  it('applies profile language scope to both ends before selecting targets', async () => {
    expect(await pairs.findLinks(860001n, [1])).toEqual([]);
    expect(await pairs.findLinks(860001n, [2])).toEqual([]);
    expect(await pairs.findLinks(860001n, [])).toEqual([]);
    expect((await pairs.findLinks(860001n, [1, 2])).length).toBeGreaterThan(0);
  });

  it('does not link a mapped exact lemma outside the first default search page', async () => {
    const search = await service.search({ q: '検証多義', lang: 'ja' });
    expect(search.data).toHaveLength(20);
    expect(search.data.map((x) => x.lexeme_id)).not.toContain('860031');
    expect((await service.getSenseLinks(860030n)).data).toEqual([]);
  });
});
