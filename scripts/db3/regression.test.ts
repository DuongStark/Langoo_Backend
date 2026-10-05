import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Client, QueryResultRow } from 'pg';
import {
  assertTestDatabase,
  databaseUrlWithName,
  loadScriptEnv,
  resolveTestDirectUrl,
} from '../db/_shared';
import { applyPendingMigrations } from '../db/migrations';
import { main as decks } from './decks';
import { main as kanjivg } from './kanjivg';
import { main as radicals, validateRadicals, loadRadicals } from './radicals';
import {
  applyWithJournal,
  changesOf,
  Journal,
  rollbackWithJournal,
  saveJournal,
  snapshot,
} from './_mutations';
import { parseCli, RunManifest } from './_shared';

type Entry = (args: string[]) => Promise<void>;
const fixtureDir = path.join(__dirname, 'fixtures');

void test('DB3 regression trên DB local riêng (không reset DB của phiên)', async (t) => {
  loadScriptEnv();
  const base = resolveTestDirectUrl();
  assertTestDatabase(base);
  const name = `langoo_db3_${randomUUID().replaceAll('-', '')}_test`;
  const url = databaseUrlWithName(base, name);
  const maintenance = databaseUrlWithName(base, 'postgres');
  const admin = new Client({ connectionString: maintenance });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  const client = new Client({ connectionString: url });
  await client.connect();
  const query = async <T extends QueryResultRow = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ) => client.query<T>(sql, values);
  await query("SET TIME ZONE 'UTC'");
  const temporary = mkdtempSync(
    path.join(os.tmpdir(), 'langoo-db3-regression-'),
  );
  const saved = {
    DIRECT_URL: process.env.DIRECT_URL,
    DATABASE_URL: process.env.DATABASE_URL,
  };
  process.env.DIRECT_URL = url;
  process.env.DATABASE_URL = url;
  t.after(async () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await client.end();
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
    rmSync(temporary, { recursive: true, force: true });
  });
  await query(
    readFileSync(
      path.resolve('db/exports/langoo-min-full-inserts.sql'),
      'utf8',
    ),
  );
  await applyPendingMigrations(url, 'db3-regression');
  const guard = ['--apply', '--allow-db', name, '--allow-test'];
  let serial = 0;
  const run = async (entry: Entry, args: string[] = []): Promise<string> => {
    const dir = path.join(temporary, `run-${++serial}`);
    await entry([...args, '--manifest-dir', dir]);
    return path.join(
      dir,
      readdirSync(dir).find((file) => file.endsWith('.json'))!,
    );
  };
  const undo = async (entry: Entry, file: string): Promise<void> =>
    entry([...guard, '--rollback', file]);
  const state = async (): Promise<unknown[]> => {
    const queries = [
      'SELECT id,code,name,license,attribution,url,version,sha256,imported_at::text FROM public.source ORDER BY id',
      'SELECT number,character,name_en,name_vi,meaning_vi,stroke_count,variants FROM public.radical ORDER BY number',
      'SELECT id,kind,object_key,mime,bytes,sha256,provider,source_id,created_at::text FROM core.media_asset ORDER BY id',
      'SELECT kanji_literal,asset_id,kind,frame_count FROM core.kanji_media ORDER BY kanji_literal,kind',
      'SELECT id,slug,title,description,language_id,level_label,is_published,item_count,created_at::text FROM core.deck ORDER BY id',
      'SELECT deck_id,anchor_sense_id,concept_id,position FROM core.deck_item ORDER BY deck_id,anchor_sense_id',
    ];
    const result: unknown[] = [];
    for (const sql of queries) result.push((await query(sql)).rows);
    return result;
  };
  const original = await state();

  await t.test(
    'dry-run cả 3 task không thay đổi DB; từ chối rollback dry-run và legacy',
    async () => {
      for (const [entry, args] of [
        [decks, []],
        [radicals, ['--sources', path.join(fixtureDir, 'radicals')]],
        [kanjivg, ['--svg-dir', path.join(fixtureDir, 'kanjivg')]],
      ] as [Entry, string[]][]) {
        const file = await run(entry, args);
        await assert.rejects(entry(['--rollback', file]), /Rollback yêu cầu/);
        await assert.rejects(undo(entry, file));
      }
      const legacy = path.join(temporary, 'legacy.json');
      writeFileSync(
        legacy,
        JSON.stringify({
          task: 'decks',
          applied: true,
          rollback: { kind: 'decks', items: ['jlpt-n5'] },
        }),
      );
      await assert.rejects(undo(decks, legacy));
      assert.deepEqual(await state(), original);
    },
  );

  const lx = (
    await query<{ id: string; sense_id: string; lemma: string }>(
      'SELECT lx.id,s.id AS sense_id,lx.lemma FROM core.lexeme lx JOIN core.sense s ON s.lexeme_id=lx.id AND s.is_primary WHERE lx.language_id=2 ORDER BY lx.id LIMIT 2',
    )
  ).rows;
  const batch = (
    await query<{ id: string }>('SELECT id FROM staging.import_batch LIMIT 1')
  ).rows[0].id;
  const source = (
    await query<{ id: number }>(
      'SELECT id FROM public.source ORDER BY id LIMIT 1',
    )
  ).rows[0].id;
  for (const [level, row, lexeme] of [
    [1, 91001, lx[0]],
    [5, 91001, lx[0]],
    [5, 91002, lx[1]],
  ] as const) {
    await query(
      'INSERT INTO staging.jlpt_entry(level,row_number,expression,batch_id) VALUES($1,$2,$3,$4)',
      [level, row, lexeme.lemma, batch],
    );
    await query(
      "INSERT INTO core.jlpt_link(source_level,source_row_number,expression,lexeme_id,status,source_id,batch_id) VALUES($1,$2,$3,$4,'accepted',$5,$6)",
      [level, row, lexeme.lemma, lexeme.id, source, batch],
    );
  }

  await t.test(
    'N1+N5 chọn N5; 5 deck kể cả cấp rỗng; seed 2 lần/rollback giữ nguyên dữ liệu',
    async () => {
      const first = await run(decks, guard);
      const actual = (
        await query<{ slug: string }>(
          'SELECT d.slug FROM core.deck d JOIN core.deck_item di ON di.deck_id=d.id WHERE di.anchor_sense_id=$1 AND d.slug !~ $2',
          [lx[0].sense_id, 'demo'],
        )
      ).rows;
      assert.deepEqual(actual, [{ slug: 'jlpt-n5' }]);
      assert.equal(
        (
          await query(
            "SELECT count(*)::int n FROM core.deck WHERE slug IN ('jlpt-n1','jlpt-n2','jlpt-n3','jlpt-n4','jlpt-n5')",
          )
        ).rows[0].n,
        5,
      );
      const seeded = await state();
      const second = await run(decks, guard);
      assert.deepEqual(await state(), seeded);
      await undo(decks, second);
      assert.deepEqual(await state(), seeded);
      await undo(decks, first);
      assert.deepEqual(await state(), original);
    },
  );

  await t.test(
    'rollback kiểm tra guard, host/port/DB/task; dữ liệu sửa tiếp phải được giữ',
    async () => {
      const file = await run(decks, guard);
      const seeded = await state();
      await assert.rejects(
        decks([
          '--apply',
          '--allow-db',
          'other_test',
          '--allow-test',
          '--rollback',
          file,
        ]),
        /allow-db/,
      );
      await assert.rejects(
        decks(['--apply', '--allow-db', name, '--rollback', file]),
        /allow-test/,
      );
      const journal = JSON.parse(readFileSync(file, 'utf8')) as Journal;
      for (const modified of [
        { ...journal, target: { ...journal.target, host: 'other-host' } },
        { ...journal, target: { ...journal.target, port: '1' } },
        { ...journal, target: { ...journal.target, database: 'other_test' } },
        { ...journal, task: 'radicals' },
      ]) {
        const wrong = path.join(temporary, 'wrong.json');
        writeFileSync(wrong, JSON.stringify(modified));
        await assert.rejects(undo(decks, wrong), /không khớp/);
      }
      assert.deepEqual(await state(), seeded);
      await query(
        "UPDATE core.deck SET title='edited after seed' WHERE slug='jlpt-n5'",
      );
      const edited = await state();
      await assert.rejects(undo(decks, file), /đã đổi/);
      assert.deepEqual(await state(), edited);
      const title = journal.changes
        .find((change) => change.table === 'core.deck')!
        .after.find((row) => row.slug === 'jlpt-n5')!.title;
      await query('UPDATE core.deck SET title=$1 WHERE slug=$2', [
        title,
        'jlpt-n5',
      ]);
      await undo(decks, file);
    },
  );

  await t.test(
    'đổi cấp/rejected đồng bộ item; rollback giữ deck metadata và item cũ',
    async () => {
      const first = await run(decks, guard);
      await query(
        "UPDATE core.deck SET title='custom title',is_published=true WHERE slug='jlpt-n5'",
      );
      const old = await state();
      await query(
        "UPDATE core.jlpt_link SET status='rejected' WHERE source_level=5",
      );
      const changed = await run(decks, guard);
      const items = (
        await query(
          'SELECT d.slug,di.anchor_sense_id FROM core.deck d JOIN core.deck_item di ON di.deck_id=d.id WHERE d.slug ~ $1 ORDER BY d.slug',
          ['^jlpt-n[1-5]$'],
        )
      ).rows;
      assert.deepEqual(items, [
        { slug: 'jlpt-n1', anchor_sense_id: lx[0].sense_id },
      ]);
      assert.equal(
        (await query("SELECT item_count FROM core.deck WHERE slug='jlpt-n5'"))
          .rows[0].item_count,
        0,
      );
      await undo(decks, changed);
      assert.deepEqual(await state(), old);
      // Restore the after-state of the first run before rolling it back.
      const journal = JSON.parse(readFileSync(first, 'utf8')) as Journal;
      const oldDeck = journal.changes[0].after.find(
        (row) => row.slug === 'jlpt-n5',
      )!;
      await query(
        'UPDATE core.deck SET title=$1,is_published=$2 WHERE slug=$3',
        [oldDeck.title, oldDeck.is_published, 'jlpt-n5'],
      );
      await undo(decks, first);
      await query("UPDATE core.jlpt_link SET status='accepted'");
    },
  );

  await t.test(
    'đổi primary sense loại anchor cũ; thiếu primary phải dừng trước commit',
    async () => {
      const first = await run(decks, guard);
      await query('UPDATE core.sense SET is_primary=false WHERE id=$1', [
        lx[0].sense_id,
      ]);
      const replacement = (
        await query<{ id: string }>(
          'INSERT INTO core.sense(lexeme_id,sense_no,is_primary) VALUES($1,99,true) RETURNING id',
          [lx[0].id],
        )
      ).rows[0].id;
      const second = await run(decks, guard);
      const items = (
        await query(
          'SELECT anchor_sense_id FROM core.deck_item di JOIN core.deck d ON d.id=di.deck_id WHERE d.slug=$1 ORDER BY di.position',
          ['jlpt-n5'],
        )
      ).rows;
      assert.ok(items.some((row) => row.anchor_sense_id === replacement));
      assert.ok(!items.some((row) => row.anchor_sense_id === lx[0].sense_id));
      const seeded = await state();
      await query('UPDATE core.sense SET is_primary=false WHERE id=$1', [
        replacement,
      ]);
      await assert.rejects(run(decks, guard), /thiếu primary/);
      assert.deepEqual(await state(), seeded);
      await undo(decks, second);
      await undo(decks, first);
      await query('DELETE FROM core.sense WHERE id=$1', [replacement]);
      await query('UPDATE core.sense SET is_primary=true WHERE id=$1', [
        lx[0].sense_id,
      ]);
    },
  );

  await t.test(
    '--limit chỉ áp dụng DB test và không thay deck đã có',
    async () => {
      await assert.rejects(
        run(decks, [...guard, '--limit', '0']),
        /nguyên dương/,
      );
      const first = await run(decks, [...guard, '--limit', '1']);
      const seeded = await state();
      await assert.rejects(
        run(decks, [...guard, '--limit', '1']),
        /fixture mới/,
      );
      assert.deepEqual(await state(), seeded);
      await undo(decks, first);
    },
  );

  await t.test(
    'deck đã được user tham chiếu không bị xoá hay làm mất liên kết',
    async () => {
      const file = await run(decks, guard);
      const id = (
        await query<{ id: string }>(
          "SELECT id FROM core.deck WHERE slug='jlpt-n5'",
        )
      ).rows[0].id;
      const collection = (
        await query<{ id: string; cloned_from_deck_id: string | null }>(
          'SELECT id,cloned_from_deck_id FROM app.collection LIMIT 1',
        )
      ).rows[0];
      await query(
        'UPDATE app.collection SET cloned_from_deck_id=$1 WHERE id=$2',
        [id, collection.id],
      );
      const seeded = await state();
      await assert.rejects(undo(decks, file), /clone\/tham chiếu/);
      assert.deepEqual(await state(), seeded);
      assert.equal(
        (
          await query(
            'SELECT cloned_from_deck_id FROM app.collection WHERE id=$1',
            [collection.id],
          )
        ).rows[0].cloned_from_deck_id,
        id,
      );
      await query(
        'UPDATE app.collection SET cloned_from_deck_id=$1 WHERE id=$2',
        [collection.cloned_from_deck_id, collection.id],
      );
      await undo(decks, file);
    },
  );

  const mediaArgs = [
    '--svg-dir',
    path.join(fixtureDir, 'kanjivg'),
    '--version',
    'fixture-v1',
  ];
  await t.test(
    'KanjiVG lần 2 rollback giữ asset/link/source cũ; giữ bigint và timestamp đủ microsecond',
    async () => {
      const sourceId = (
        await query<{ id: number }>(
          "INSERT INTO public.source(id,code,name,license,attribution,version,imported_at) SELECT MAX(id)+1,'kanjivg','old','old license','old attribution','old version','2020-01-01 00:00:00.123456+00' FROM public.source RETURNING id",
        )
      ).rows[0].id;
      const literal = (
        await query<{ literal: string }>(
          "SELECT literal FROM core.kanji WHERE literal IN ('日','一') ORDER BY literal LIMIT 1",
        )
      ).rows[0].literal;
      const key = `kanjivg/${literal.codePointAt(0)!.toString(16).padStart(5, '0')}.svg`;
      await query(
        "INSERT INTO core.media_asset(id,kind,object_key,mime,bytes,sha256,provider,source_id,created_at) VALUES('9007199254740993','stroke_svg',$1,'old mime',7,'old hash','old provider',$2,'2020-01-01 00:00:00.123456+00')",
        [key, sourceId],
      );
      await query(
        "INSERT INTO core.kanji_media(kanji_literal,asset_id,kind,frame_count) VALUES($1,'9007199254740993','stroke_svg',7)",
        [literal],
      );
      const old = await state();
      const first = await run(kanjivg, [...guard, ...mediaArgs]);
      const seeded = await state();
      const card = (
        await query<{ media_kinds: string[] }>(
          'SELECT media_kinds FROM serve.kanji_card WHERE literal=$1',
          [literal],
        )
      ).rows[0];
      assert.ok(card.media_kinds.includes('stroke_svg'));
      const second = await run(kanjivg, [...guard, ...mediaArgs]);
      assert.deepEqual(await state(), seeded);
      await undo(kanjivg, second);
      assert.deepEqual(await state(), seeded);
      await undo(kanjivg, first);
      assert.deepEqual(await state(), old);
      await query('DELETE FROM core.kanji_media WHERE kanji_literal=$1', [
        literal,
      ]);
      await query('DELETE FROM core.media_asset WHERE object_key=$1', [key]);
      await query('DELETE FROM public.source WHERE id=$1', [sourceId]);
    },
  );

  await t.test(
    'thiếu version KanjiVG/nguồn thay đổi không được apply; copy không overwrite',
    async () => {
      const old = await state();
      await assert.rejects(
        run(kanjivg, [...guard, '--svg-dir', path.join(fixtureDir, 'kanjivg')]),
        /cần --version/,
      );
      const dest = path.join(temporary, 'copy');
      mkdirSync(dest);
      for (const file of readdirSync(path.join(fixtureDir, 'kanjivg')))
        writeFileSync(path.join(dest, file), 'old file');
      await assert.rejects(
        run(kanjivg, [...guard, ...mediaArgs, '--copy-to', dest]),
        /khác hash/,
      );
      assert.deepEqual(await state(), old);
      for (const file of readdirSync(dest))
        assert.equal(readFileSync(path.join(dest, file), 'utf8'), 'old file');
    },
  );

  await t.test(
    'radical thiếu 214/tên EN phải dừng; fixture explicit rollback khôi phục cả source',
    async () => {
      const args = ['--sources', path.join(fixtureDir, 'radicals')];
      const old = await state();
      await assert.rejects(run(radicals, [...guard, ...args]), /đủ 214/);
      const file = await run(radicals, [...guard, ...args, '--fixture']);
      const seeded = await state();
      const second = await run(radicals, [...guard, ...args, '--fixture']);
      await undo(radicals, second);
      assert.deepEqual(await state(), seeded);
      await undo(radicals, file);
      assert.deepEqual(await state(), old);
      const fused = loadRadicals(path.join(fixtureDir, 'radicals')).rows;
      assert.throws(
        () =>
          validateRadicals(
            fused.map((row) => ({ ...row, nameEn: null })),
            true,
          ),
        /thiếu field/,
      );
      assert.throws(
        () => validateRadicals([...fused, fused[0]], true),
        /trùng khoá/,
      );
    },
  );

  await t.test(
    'manifest-dir không ghi được: cả 3 task phải giữ nguyên DB',
    async () => {
      const bad = path.join(temporary, 'file-instead-of-dir');
      writeFileSync(bad, 'fixture');
      const old = await state();
      for (const [entry, args] of [
        [decks, []],
        [kanjivg, mediaArgs],
        [
          radicals,
          ['--sources', path.join(fixtureDir, 'radicals'), '--fixture'],
        ],
      ] as [Entry, string[]][]) {
        await assert.rejects(
          entry([...guard, ...args, '--manifest-dir', bad]),
          /EEXIST/,
        );
        assert.deepEqual(await state(), old);
      }
    },
  );

  await t.test(
    'journal prepared ghi lỗi trước COMMIT rollback; sau COMMIT có thể recover an toàn',
    async () => {
      const old = await state();
      const cli = parseCli('radicals', [
        ...guard,
        '--manifest-dir',
        path.join(temporary, 'fault'),
      ]);
      const action = async (db: Client) => {
        const before = [
          await snapshot(db, 'public.source', ['kangxi-radicals']),
          await snapshot(db, 'public.radical', [10]),
        ];
        await db.query(
          "UPDATE public.radical SET name_vi='recovery fixture' WHERE number=10",
        );
        const after = [
          await snapshot(db, 'public.source', ['kangxi-radicals']),
          await snapshot(db, 'public.radical', [10]),
        ];
        return changesOf(before, after);
      };
      for (const failure of [2, 3]) {
        let writes = 0;
        let file = '';
        const baseManifest: RunManifest = {
          task: 'radicals',
          startedAt: new Date().toISOString(),
          applied: false,
          summary: {},
        };
        await assert.rejects(
          applyWithJournal(cli, url, baseManifest, action, (filename, data) => {
            file = filename;
            if (++writes === failure) throw new Error('simulated disk failure');
            saveJournal(filename, data);
          }),
          failure === 2 ? /disk failure/ : /DB đã commit/,
        );
        if (failure === 2) {
          assert.deepEqual(await state(), old);
          await assert.rejects(rollbackWithJournal(cli, url, file));
        } else {
          assert.notDeepEqual(await state(), old);
          assert.equal(
            (JSON.parse(readFileSync(file, 'utf8')) as Journal).status,
            'prepared',
          );
          await assert.rejects(
            rollbackWithJournal(cli, url, file),
            /prepared cần/,
          );
          const recovery = parseCli('radicals', [...guard, '--recover']);
          await rollbackWithJournal(recovery, url, file);
          assert.deepEqual(await state(), old);
        }
      }
    },
  );
  await t.test(
    'rollback filesystem lỗi trước/sau COMMIT có guard và recovery idempotent',
    async () => {
      for (const failure of [1, 2, 3]) {
        const old = await state();
        const file = await run(decks, guard);
        const seeded = await state();
        const cli = parseCli('decks', guard);
        let writes = 0;
        await assert.rejects(
          rollbackWithJournal(cli, url, file, (filename, data) => {
            if (++writes === failure) throw new Error('rollback disk failure');
            saveJournal(filename, data);
          }),
          failure === 3 ? /Rollback đã commit/ : /disk failure/,
        );
        if (failure < 3) {
          assert.deepEqual(await state(), seeded);
          await undo(decks, file);
        } else {
          assert.deepEqual(await state(), old);
          assert.equal(
            (JSON.parse(readFileSync(file, 'utf8')) as Journal).status,
            'rollback-prepared',
          );
          await assert.rejects(undo(decks, file));
          await rollbackWithJournal(
            parseCli('decks', [...guard, '--recover']),
            url,
            file,
          );
        }
        assert.deepEqual(await state(), old);
        await assert.rejects(undo(decks, file));
      }
    },
  );
  const fullSources = process.env.DB3_TEST_RADICAL_SOURCES;
  if (fullSources) {
    await t.test(
      'full raw radical: đủ 214, view hiển thị đúng, apply 2 lần + rollback phục hồi',
      async () => {
        const old = await state();
        const first = await run(radicals, [...guard, '--sources', fullSources]);
        const journal = JSON.parse(readFileSync(first, 'utf8')) as Journal;
        assert.equal(journal.summary.rows, 214);
        assert.equal(
          (
            await query<{ n: number }>(
              'SELECT count(*)::int n FROM public.radical',
            )
          ).rows[0].n,
          214,
        );
        const card = (
          await query<{ radical_char: string; radical_name_vi: string }>(
            "SELECT radical_char,radical_name_vi FROM serve.kanji_card WHERE literal='日'",
          )
        ).rows[0];
        assert.deepEqual(card, { radical_char: '日', radical_name_vi: 'Nhật' });
        const seeded = await state();
        const second = await run(radicals, [
          ...guard,
          '--sources',
          fullSources,
        ]);
        assert.deepEqual(await state(), seeded);
        await undo(radicals, second);
        assert.deepEqual(await state(), seeded);
        await undo(radicals, first);
        assert.deepEqual(await state(), old);
      },
    );
  }
  assert.deepEqual(await state(), original);
});
