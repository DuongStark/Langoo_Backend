import { ConfigService } from '@nestjs/config';
import { Client } from 'pg';
import { Prisma } from '../src/generated/prisma/client';
import { PrismaService } from '../src/db/prisma.service';
import { DictionarySearchRepository } from '../src/dictionary/repositories/dictionary-search.repository';
import { DictionarySearchCursor } from '../src/dictionary/dictionary-search-cursor';

describe('M4.2 short dictionary search', () => {
  let db: PrismaService;
  let repo: DictionarySearchRepository;
  beforeAll(async () => {
    db = new PrismaService(new ConfigService(process.env));
    await db.onModuleInit();
    repo = new DictionarySearchRepository(db);
    await db.$executeRawUnsafe(`
      INSERT INTO core.lexeme(id,language_id,lemma,reading,pos,source_id,frequency_rank,attributes,homograph_no)
      VALUES (780001,1,'a',NULL,'noun',8,1,'{}',99),
             (780002,1,'apple',NULL,'noun',8,2,'{}',99),
             (780003,1,'cat',NULL,'noun',8,3,'{}',99),
             (780004,2,'猫','ねこ','noun',1,10,'{}',99),
             (780005,2,'山猫','やまねこ','noun',1,20,'{}',99),
             (780006,2,'猫舌','ねこじた','noun',1,30,'{}',99),
             (780007,2,'𠮷','よし','noun',1,40,'{}',99),
             (780008,2,'大𠮷','おおよし','noun',1,50,'{}',99),
             (780009,1,'%mark',NULL,'noun',8,60,'{}',99),
             (780010,2,'a','あ','noun',1,70,'{}',99),
             (780011,1,'z',NULL,'noun',8,1,'{}',99),
             (780012,1,'z',NULL,'verb',8,2,'{}',99),
             (780013,1,'zebra',NULL,'noun',8,3,'{}',99),
             (780014,1,'zero',NULL,'noun',8,4,'{}',99),
             (780015,2,'am42-canonical',NULL,'noun',8,1,'{}',99),
             (780016,2,'am42-canonical','あい','noun',1,2,'{}',100),
             (780017,1,'acorn',NULL,'noun',8,40,'{}',99),
             (780018,1,'apricot',NULL,'noun',8,50,'{}',99),
             (780019,1,'arrow',NULL,'noun',8,60,'{}',99),
             (780020,1,'alpha',NULL,'noun',8,NULL,'{}',99);
      INSERT INTO core.lexeme_form(lexeme_id,kind,form_text,form_order)
      VALUES (780004,'kanji','猫',1),(780005,'kanji','山猫',1),
             (780005,'kanji','猫山',2);
      INSERT INTO core.lexeme(id,language_id,lemma,pos,source_id,frequency_rank,homograph_no)
      SELECT 780100+i,1,'a','noun',8,100+i,100+i FROM generate_series(1,30) i;
      INSERT INTO core.lexeme(id,language_id,lemma,pos,source_id,frequency_rank)
      SELECT 790000+i,1,'am42-prefix-'||i,'noun',8,10000+i FROM generate_series(1,5000) i;
      UPDATE core.lexeme SET romanization='a' WHERE id IN (780015,780020);
      INSERT INTO core.sense(id,lexeme_id,sense_no)
      SELECT id,id,1 FROM core.lexeme
      WHERE id BETWEEN 780001 AND 780200 OR id BETWEEN 790001 AND 795000;
      INSERT INTO core.sense_gloss(sense_id,language_id,text)
      SELECT id,3,'nghĩa Việt fixture M4.2' FROM core.sense
      WHERE id BETWEEN 780001 AND 780200 OR id BETWEEN 790001 AND 795000;
      INSERT INTO core.lexeme(id,language_id,lemma,pos,source_id,frequency_rank,homograph_no)
      VALUES (780021,1,'a-hidden-untranslated','noun',8,1,99);
      ANALYZE core.lexeme;
    `);
  });
  afterAll(async () => {
    if (db) {
      await db.$executeRawUnsafe(
        'DELETE FROM core.sense_gloss WHERE sense_id BETWEEN 780001 AND 780200 OR sense_id BETWEEN 790001 AND 795000',
      );
      await db.$executeRawUnsafe(
        'DELETE FROM core.sense WHERE id BETWEEN 780001 AND 780200 OR id BETWEEN 790001 AND 795000',
      );
      await db.$executeRawUnsafe(
        'DELETE FROM core.lexeme_form WHERE lexeme_id BETWEEN 780001 AND 780010',
      );
      await db.$executeRawUnsafe(
        'DELETE FROM core.lexeme WHERE id BETWEEN 780001 AND 780200 OR id BETWEEN 790001 AND 795000',
      );
      await db.onModuleDestroy();
    }
  });

  const search = (query: string, lang: string, extra = {}) =>
    repo.search({
      queries: [query],
      patterns: [query.replace(/[\\%_]/g, '\\$&')],
      lang,
      cursor: null,
      limit: 100,
      ...extra,
    });

  it('one Latin letter returns exact and prefix, not unrelated infixes', async () => {
    const rows = await search('a', 'en');
    expect(rows.map((r) => r.surface)).toContain('a');
    expect(rows.map((r) => r.surface)).toContain('apple');
    expect(rows.map((r) => r.surface)).not.toContain('cat');
    expect(rows[0].surface).toBe('a');
  });

  it('retains production EN visibility: untranslated entries stay hidden', async () => {
    const rows = await search('a-hidden-untranslated', 'en');
    expect(rows).toEqual([]);
  });

  it('does not evaluate thousands of prefix candidates when exact results fill the page', async () => {
    const client = new Client({ connectionString: process.env.DIRECT_URL });
    await client.connect();
    let largestIntermediateResult = 0;
    const inspect = (node: Record<string, unknown>) => {
      largestIntermediateResult = Math.max(
        largestIntermediateResult,
        node['Node Type'] === 'CTE Scan' && node['CTE Name'] === 'hits'
          ? Number(node['Actual Rows'] ?? 0)
          : 0,
      );
      for (const child of (node.Plans ?? []) as Record<string, unknown>[])
        inspect(child);
    };
    const tx = {
      $executeRawUnsafe: (sql: string) => client.query(sql),
      $queryRaw: async (sql: Prisma.Sql) => {
        const plan = await client.query(
          'EXPLAIN (ANALYZE, FORMAT JSON) ' + sql.text,
          sql.values,
        );
        inspect(
          (
            plan.rows[0] as {
              'QUERY PLAN': { Plan: Record<string, unknown> }[];
            }
          )['QUERY PLAN'][0].Plan,
        );
        const rows = await client.query(sql.text, sql.values);
        return rows.rows.map((row: Record<string, unknown>) => ({
          ...row,
          lexeme_id: BigInt(String(row.lexeme_id)),
        }));
      },
    };
    const measured = new DictionarySearchRepository({
      $transaction: async (work: (session: typeof tx) => Promise<unknown>) => {
        await client.query('BEGIN READ ONLY');
        try {
          return await work(tx);
        } finally {
          await client.query('ROLLBACK');
        }
      },
    } as unknown as PrismaService);
    try {
      const rows = await measured.search({
        queries: ['a'],
        patterns: ['a'],
        lang: 'en',
        limit: 5,
        cursor: null,
      });
      expect(rows).toHaveLength(5);
      expect(rows.every((row) => row.is_exact)).toBe(true);
      // Thirty exact fixtures suffice; the 5,000 prefix fixtures must not enter ranking.
      expect(largestIntermediateResult).toBeGreaterThan(0);
      expect(largestIntermediateResult).toBeLessThan(64);
      largestIntermediateResult = 0;
      const suggestions = await measured.search({
        queries: ['a'],
        patterns: ['a'],
        lang: 'en',
        limit: 5,
        cursor: null,
        deduplicateSurface: true,
      });
      const full = await search('a', 'en', { deduplicateSurface: true });
      expect(suggestions.map((row) => row.lexeme_id)).toEqual(
        full.slice(0, 5).map((row) => row.lexeme_id),
      );
      // Exact through romaji, even without frequency, precedes every prefix hit.
      expect(suggestions.map((row) => row.lexeme_id)).toContain(780020n);
      expect(suggestions).toHaveLength(5);
      expect(largestIntermediateResult).toBeGreaterThan(0);
      expect(largestIntermediateResult).toBeLessThan(64);
    } finally {
      await client.end();
    }
  });

  it('exact tier keeps canonical source visibility from the full match set', async () => {
    const full = await search('a', 'ja');
    const first = await search('a', 'ja', { limit: 1 });
    expect(full.map((row) => row.lexeme_id)).not.toContain(780015n);
    expect(first.map((row) => row.lexeme_id)).toEqual(
      full.slice(0, 1).map((row) => row.lexeme_id),
    );
  });

  it('pagination crosses the exact/prefix boundary without skipping a lexeme', async () => {
    const expected = await search('z', 'en');
    const ids: bigint[] = [];
    let cursor: DictionarySearchCursor | null = null;
    for (let page = 0; page < 10; page++) {
      const rows = await search('z', 'en', { limit: 1, cursor });
      if (!rows.length) break;
      const row = rows[0];
      ids.push(row.lexeme_id);
      cursor = {
        version: 6,
        query: 'z',
        lang: 'en',
        exactRank: row.exact_rank,
        prefixRank: row.prefix_rank,
        jaSourceRank: row.ja_source_rank,
        viTranslationRank: row.vi_translation_rank,
        frequencyNullRank: row.frequency_null_rank,
        frequencyRank: row.frequency_sort,
        surfaceLength: row.surface_length,
        lexemeId: String(row.lexeme_id),
        surfaceKind: row.surface_kind,
        surface: row.surface,
      };
    }
    expect(expected.some((row) => !row.is_exact)).toBe(true);
    expect(ids).toEqual(expected.map((row) => row.lexeme_id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('one Kanji keeps compounds containing it at any position', async () => {
    const rows = await search('猫', 'ja');
    expect(rows.map((r) => r.lexeme_id)).toEqual(
      expect.arrayContaining([780004n, 780005n, 780006n]),
    );
    expect(rows[0].surface).toBe('猫');
    expect(rows.filter((r) => r.lexeme_id === 780005n)).toHaveLength(1);
  });

  it('handles a supplementary Unicode Kanji as one character', async () => {
    const rows = await search('𠮷', 'ja');
    expect(rows.map((r) => r.lexeme_id)).toEqual([780007n, 780008n]);
  });

  it('literal LIKE wildcard remains literal', async () => {
    const rows = await search('%', 'en');
    expect(rows.map((r) => r.surface)).toEqual(['%mark']);
  });

  it('language scope is enforced on all short-search branches', async () => {
    expect(await search('a', 'en', { allowedLanguageIds: [2] })).toEqual([]);
    expect(await search('猫', 'ja', { allowedLanguageIds: [] })).toEqual([]);
  });

  it('cursor returns every Kanji lexeme once across multiple faces', async () => {
    const expected = await search('猫', 'ja');
    const ids: bigint[] = [];
    let cursor: DictionarySearchCursor | null = null;
    for (let page = 0; page < 10; page++) {
      const rows = await search('猫', 'ja', { limit: 1, cursor });
      if (!rows.length) break;
      const row = rows[0];
      ids.push(row.lexeme_id);
      cursor = {
        version: 6,
        query: '猫',
        lang: 'ja',
        exactRank: row.exact_rank,
        prefixRank: row.prefix_rank,
        jaSourceRank: row.ja_source_rank,
        viTranslationRank: row.vi_translation_rank,
        frequencyNullRank: row.frequency_null_rank,
        frequencyRank: row.frequency_sort,
        surfaceLength: row.surface_length,
        lexemeId: String(row.lexeme_id),
        surfaceKind: row.surface_kind,
        surface: row.surface,
      };
    }
    expect(ids).toEqual(expected.map((r) => r.lexeme_id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
