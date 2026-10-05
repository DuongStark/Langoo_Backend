import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Client } from 'pg';
import {
  assertTestDatabase,
  databaseUrlWithName,
  loadScriptEnv,
  resolveTestDirectUrl,
} from '../db/_shared';
import { applyPendingMigrations } from '../db/migrations';
import {
  createGlossCandidate,
  createGlossJob,
  hashGlossText,
  parseGlossCandidate,
  parseGlossJob,
  type GlossCandidate,
  type GlossJob,
} from './_gloss-types';
import { readArtifactJson, writeArtifactJson } from './_gloss-artifacts';
import { saveJournal, type Journal } from './_mutations';
import { parseCli } from './_shared';
import {
  applyGlossJob,
  rollbackGlossJob,
  type GlossApplyOptions,
} from './gloss-apply';
import { verifyGloss } from './verify-gloss';

void test('DB3-B apply/rollback uses a new private UUID test database', async (t) => {
  loadScriptEnv();
  const base = resolveTestDirectUrl();
  assertTestDatabase(base);
  const name = `langoo_gloss_${randomUUID().replaceAll('-', '')}_test`;
  const url = databaseUrlWithName(base, name);
  const admin = new Client({
    connectionString: databaseUrlWithName(base, 'postgres'),
  });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  const client = new Client({ connectionString: url });
  await client.connect();
  const root = mkdtempSync(path.join(os.tmpdir(), 'langoo-gloss-'));
  t.after(async () => {
    await client.end();
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
    rmSync(root, { recursive: true, force: true });
  });
  await client.query<Record<string, unknown>>(
    readFileSync(
      path.resolve('db/exports/langoo-min-full-inserts.sql'),
      'utf8',
    ),
  );
  await applyPendingMigrations(url, 'gloss-private-regression');
  await client.query<Record<string, unknown>>("SET TIME ZONE 'UTC'");
  const template = parseGlossCandidate(
    JSON.parse(
      readFileSync(
        path.join(__dirname, 'fixtures/gloss/candidates-v1.jsonl'),
        'utf8',
      ).split('\n')[0],
    ),
  );
  const source = template.sources[0];
  const batch = source.batchIds[0];
  await client.query<Record<string, unknown>>(
    `INSERT INTO public.source(id,code,name,license,attribution,url,version,sha256) VALUES(900,$1,'Synthetic gloss fixture',$2,$3,$4,$5,$6)`,
    [
      source.code,
      source.license,
      source.attribution,
      source.url,
      source.version,
      source.sha256,
    ],
  );
  await client.query<Record<string, unknown>>(
    `INSERT INTO staging.import_batch(id,source_code,file_name,sha256,status) VALUES($1,$2,'fixture.json',$3,'completed')`,
    [batch, source.code, source.sha256],
  );
  const languages = await client.query<{ id: number; code: string }>(
    "SELECT id,code FROM public.language WHERE code IN ('ja','en','vi')",
  );
  const lang = Object.fromEntries(languages.rows.map((r) => [r.code, r.id]));
  const target = template.target!;
  assert.equal(target.targetType, 'sense');
  if (target.targetType !== 'sense') throw new Error('Expected sense fixture');
  await client.query<Record<string, unknown>>(
    `INSERT INTO core.lexeme(id,language_id,lemma,pos,reading,source_id,homograph_no) VALUES($1,$2,$3,$4,$5,900,999)`,
    [target.lexemeId, lang.ja, target.lemma, target.pos, target.reading],
  );
  await client.query(
    'INSERT INTO staging.jlpt_entry(level,expression,reading,row_number,batch_id) VALUES(5,$1,$2,700000,$3)',
    [target.lemma, target.reading, batch],
  );
  await client.query(
    "INSERT INTO core.jlpt_link(source_level,source_row_number,expression,lexeme_id,status,source_id,batch_id) VALUES(5,700000,$1,$2,'accepted',900,$3)",
    [target.lemma, target.lexemeId, batch],
  );
  await client.query<Record<string, unknown>>(
    `INSERT INTO core.sense(id,lexeme_id,sense_no,is_primary,external_id,source_id,batch_id) VALUES($1,$2,$3,true,$4,900,$5)`,
    [
      target.targetId,
      target.lexemeId,
      target.senseNo,
      target.semanticKey,
      batch,
    ],
  );
  const context = template.context!.rows[0];
  if (context.kind !== 'sense_gloss') throw new Error('Expected gloss fixture');
  await client.query<Record<string, unknown>>(
    `INSERT INTO core.sense_gloss(id,sense_id,language_id,text,rank,source_id,batch_id) VALUES($1,$2,$3,$4,1,900,$5)`,
    [context.glossId, target.targetId, lang.en, context.text, batch],
  );
  const candidate = createGlossCandidate({
    ...template,
    sources: [{ ...source, sourceId: 900 }],
  });
  if (candidate.classification !== 'needs_translation')
    throw new Error('Expected translation fixture');
  const candidates = [candidate];
  const provider: GlossJob['provider'] = {
    name: 'stub',
    baseUrl: 'https://example.org/fixture',
    protocol: 'responses',
    model: 'fixture-model',
    promptVersion: 'gloss-v1',
  };
  const parsedUrl = new URL(url);
  const fresh = (
    gloss = 'mèo',
    selected: GlossCandidate[] = candidates,
  ): GlossJob =>
    createGlossJob({
      schemaVersion: 1,
      snapshot: {
        datasetFingerprint: candidate.datasetFingerprint,
        inventory: { path: 'inventory.json', sha256: hashGlossText('fixture') },
        host: parsedUrl.hostname,
        port: Number(parsedUrl.port || 5432),
        database: name,
      },
      provider,
      sessionId: randomUUID(),
      caps: {
        maxRequests: 100,
        maxTokens: null,
        maxCostUsd: 0,
        concurrency: 1,
      },
      usage: { attemptCount: 0, tokens: 0, costUsd: 0 },
      entries: selected.map((c) => ({
        candidateKey: c.candidateKey,
        inputHash: c.inputHash,
        state: 'validated',
        attemptCount: 0,
        attempts: [],
        output: {
          target_type: c.target!.targetType,
          target_id: c.target!.targetId,
          gloss_vi: gloss,
          reason: null,
        },
        validation: 'passed',
        error: null,
        childRunKey: null,
      })),
      children: [],
    });
  const cli = parseCli('gloss', [
    '--apply',
    '--allow-db',
    name,
    '--allow-test',
    '--fixture',
  ]);
  const makeOptions = (job: GlossJob, directory = root): GlossApplyOptions => ({
    url,
    cli,
    artifactDir: directory,
    job,
    candidates,
  });
  const count = async () =>
    (
      await client.query<Record<string, unknown>>(
        'SELECT count(*)::int AS n FROM core.sense_gloss WHERE sense_id=$1 AND language_id=$2',
        [target.targetId, lang.vi],
      )
    ).rows[0].n as number;
  const metadataCount = async () =>
    (
      await client.query<Record<string, unknown>>(
        "SELECT count(*)::int AS n FROM core.mapping_run WHERE task='db3b-gloss'",
      )
    ).rows[0].n as number;

  await t.test(
    'write guards and human gate reject before mutation',
    async () => {
      const job = fresh();
      await assert.rejects(
        applyGlossJob({
          ...makeOptions(job),
          cli: parseCli('gloss', ['--apply', '--allow-db', 'wrong']),
        }),
        /allow-db/,
      );
      await assert.rejects(
        applyGlossJob({
          ...makeOptions(job),
          url: databaseUrlWithName(base, 'langoo'),
        }),
        /allow-db/,
      );
      const production = { ...cli, flags: new Map(cli.flags) };
      production.flags.delete('fixture');
      await assert.rejects(
        applyGlossJob({ ...makeOptions(job), cli: production }),
      );
      assert.equal(await count(), 0);
    },
  );

  await t.test(
    'append after reviewed slot; preserve bigint IDs and microsecond timestamps',
    async () => {
      await client.query<Record<string, unknown>>(
        `INSERT INTO core.sense_gloss(id,sense_id,language_id,text,rank,reviewed_by,reviewed_at,source_id) VALUES(9007199254741007,$1,$2,'mèo đã duyệt',1,9007199254741008,'2026-10-05T01:02:03.123456Z',900)`,
        [target.targetId, lang.vi],
      );
      const original = (
        await client.query<Record<string, unknown>>(
          'SELECT id::text,reviewed_by::text,reviewed_at::text,text FROM core.sense_gloss WHERE id=9007199254741007',
        )
      ).rows[0];
      let job = await applyGlossJob(makeOptions(fresh()));
      assert.equal(await count(), 2);
      const row = (
        await client.query<Record<string, unknown>>(
          'SELECT rank,is_machine,reviewed_by,quality,text FROM core.sense_gloss WHERE batch_id=$1',
          [
            (readArtifactJson(root, job.children[0].journalPath) as Journal)
              .summary.batchId,
          ],
        )
      ).rows[0];
      assert.deepEqual(row, {
        rank: 2,
        is_machine: true,
        reviewed_by: null,
        quality: null,
        text: 'mèo',
      });
      job = await applyGlossJob(makeOptions(job));
      assert.equal(await count(), 2);
      await rollbackGlossJob(makeOptions(job));
      assert.equal(await count(), 1);
      assert.deepEqual(
        (
          await client.query<Record<string, unknown>>(
            'SELECT id::text,reviewed_by::text,reviewed_at::text,text FROM core.sense_gloss WHERE id=9007199254741007',
          )
        ).rows[0],
        original,
      );
      assert.equal(
        (
          await client.query<Record<string, unknown>>(
            "SELECT count(*)::int n FROM core.sense_gloss_history WHERE old_data->>'batch_id' IS NOT NULL",
          )
        ).rows[0].n,
        1,
      );
      assert.equal(await metadataCount(), 1);
      assert.equal(
        (
          await client.query<Record<string, unknown>>(
            'SELECT status FROM core.mapping_run WHERE run_key=$1',
            [job.children[0].runKey],
          )
        ).rows[0].status,
        'rolled_back',
      );
    },
  );

  await t.test(
    'COMMIT then journal failure recovers without allocating a duplicate rank',
    async () => {
      const dir = path.join(root, 'postcommit');
      let fail = true;
      const job = fresh('con mèo');
      const options = makeOptions(job, dir);
      await assert.rejects(
        applyGlossJob({
          ...options,
          persistJournal: (file, data) => {
            if (fail && (data as Journal).status === 'applied') {
              fail = false;
              throw new Error('Injected post-COMMIT fsync failure');
            }
            saveJournal(file, data);
          },
        }),
        /DB đã commit/,
      );
      assert.equal(await count(), 2);
      const checkpoint = parseGlossJob(readArtifactJson(dir, 'job.json'));
      assert.equal(checkpoint.children[0].state, 'registered');
      let restored = await applyGlossJob({ ...options, job: checkpoint });
      assert.equal(restored.children[0].state, 'applied');
      assert.equal(await count(), 2);
      restored = await applyGlossJob({ ...options, job: restored });
      assert.equal(await count(), 2);
      const report = await verifyGloss(client, restored, dir);
      assert.equal(report.valid, true);
      const rollback = await rollbackGlossJob({ ...options, job: restored });
      assert.equal(rollback.children[0].state, 'rolled_back');
      await rollbackGlossJob({ ...options, job: rollback });
      assert.equal(await count(), 1);
    },
  );

  await t.test(
    'second job dedupes same text/input lineage and rollback keeps first job',
    async () => {
      const firstDir = path.join(root, 'first');
      const first = await applyGlossJob(makeOptions(fresh('mèo'), firstDir));
      const secondDir = path.join(root, 'second');
      const second = await applyGlossJob(makeOptions(fresh('mèo'), secondDir));
      assert.equal(await count(), 2);
      await assert.rejects(
        rollbackGlossJob(makeOptions(first, firstDir)),
        /reused by another/,
      );
      await rollbackGlossJob(makeOptions(second, secondDir));
      assert.equal(await count(), 2);
      await rollbackGlossJob(makeOptions(first, firstDir));
      assert.equal(await count(), 1);
    },
  );

  await t.test(
    'curator changes block rollback and retain metadata',
    async () => {
      const dir = path.join(root, 'curation');
      const job = await applyGlossJob(makeOptions(fresh('mèo nhà'), dir));
      const journal = readArtifactJson(
        dir,
        job.children[0].journalPath,
      ) as Journal;
      const id = journal.changes.find((c) => c.table === 'core.sense_gloss')!
        .after[0].id;
      await client.query<Record<string, unknown>>(
        'UPDATE core.sense_gloss SET reviewed_by=9007199254741008, reviewed_at=now() WHERE id=$1',
        [id],
      );
      await assert.rejects(
        rollbackGlossJob(makeOptions(job, dir)),
        /Dữ liệu đã đổi/,
      );
      assert.equal(await count(), 2);
      await client.query<Record<string, unknown>>(
        'UPDATE core.sense_gloss SET reviewed_by=NULL,reviewed_at=NULL WHERE id=$1',
        [id],
      );
      await rollbackGlossJob(makeOptions(job, dir));
      assert.equal(await count(), 1);
    },
  );

  await t.test(
    'changed source context and exhausted rank reject transaction without metadata',
    async () => {
      const before = await metadataCount();
      await client.query<Record<string, unknown>>(
        'UPDATE core.sense_gloss SET text=$1 WHERE id=$2',
        ['changed meaning', context.glossId],
      );
      await assert.rejects(
        applyGlossJob(makeOptions(fresh(), path.join(root, 'context-change'))),
        /Context content/,
      );
      assert.equal(await metadataCount(), before);
      await client.query<Record<string, unknown>>(
        'UPDATE core.sense_gloss SET text=$1 WHERE id=$2',
        [context.text, context.glossId],
      );
      await client.query<Record<string, unknown>>(
        'UPDATE core.sense_gloss SET rank=32767 WHERE id=9007199254741007',
      );
      await assert.rejects(
        applyGlossJob(makeOptions(fresh(), path.join(root, 'rank-full'))),
        /smallint/,
      );
      assert.equal(await metadataCount(), before);
      await client.query<Record<string, unknown>>(
        'UPDATE core.sense_gloss SET rank=1 WHERE id=9007199254741007',
      );
    },
  );
  await t.test(
    'forms and accepted JLPT changes reject before committing metadata',
    async () => {
      const before = await metadataCount();
      await client.query('UPDATE core.lexeme SET attributes=$1 WHERE id=$2', [
        JSON.stringify({ kana: [{ text: '異なる読み' }] }),
        target.lexemeId,
      ]);
      await assert.rejects(
        applyGlossJob(makeOptions(fresh(), path.join(root, 'forms-change'))),
        /Target forms changed/,
      );
      assert.equal(await metadataCount(), before);
      await client.query(
        "UPDATE core.lexeme SET attributes='{}'::jsonb WHERE id=$1",
        [target.lexemeId],
      );
      await client.query(
        "UPDATE core.jlpt_link SET status='rejected' WHERE lexeme_id=$1",
        [target.lexemeId],
      );
      await assert.rejects(
        applyGlossJob(makeOptions(fresh(), path.join(root, 'jlpt-change'))),
        /JLPT level changed/,
      );
      assert.equal(await metadataCount(), before);
      await client.query(
        "UPDATE core.jlpt_link SET status='accepted' WHERE lexeme_id=$1",
        [target.lexemeId],
      );
    },
  );
  await t.test(
    'read-only verification rejects existing machine gloss without provenance',
    async () => {
      assert.equal((await verifyGloss(client)).valid, true);
      const inserted = await client.query<{ id: string }>(
        'INSERT INTO core.sense_gloss(sense_id,language_id,text,rank,is_machine) VALUES($1,$2,$3,2,true) RETURNING id',
        [target.targetId, lang.vi, 'không có lineage'],
      );
      const report = await verifyGloss(client);
      assert.equal(report.valid, false);
      assert.equal(
        (report.anomalies as Record<string, unknown>).machine_missing_lineage,
        '1',
      );
      await client.query('DELETE FROM core.sense_gloss WHERE id=$1', [
        inserted.rows[0].id,
      ]);
    },
  );

  await t.test(
    'job checkpoint failure occurs before mutation and child payload tampering stops resume',
    async () => {
      const before = await metadataCount();
      await assert.rejects(
        applyGlossJob({
          ...makeOptions(fresh(), path.join(root, 'pre-register')),
          persistJob: () => {
            throw new Error('No fsync');
          },
        }),
        /No fsync/,
      );
      assert.equal(await metadataCount(), before);
      const dir = path.join(root, 'tamper');
      const job = await applyGlossJob(makeOptions(fresh('mèo tamper'), dir));
      job.entries[0].output!.gloss_vi = 'payload changed';
      await assert.rejects(
        applyGlossJob(makeOptions(job, dir)),
        /Registered child payload/,
      );
      const real = parseGlossJob(readArtifactJson(dir, 'job.json'));
      await rollbackGlossJob(makeOptions(real, dir));
    },
  );
  await t.test(
    'rollback COMMIT/checkpoint failure recovers retained audit metadata',
    async () => {
      const dir = path.join(root, 'rollback-window');
      const job = await applyGlossJob(makeOptions(fresh('mèo phục hồi'), dir));
      let fail = true;
      await assert.rejects(
        rollbackGlossJob({
          ...makeOptions(job, dir),
          persistJournal: (file, data) => {
            if (fail && (data as Journal).status === 'rolled-back') {
              fail = false;
              throw new Error('Injected rollback final checkpoint failure');
            }
            saveJournal(file, data);
          },
        }),
        /Rollback đã commit/,
      );
      assert.equal(await count(), 1);
      assert.equal(
        (readArtifactJson(dir, job.children[0].journalPath) as Journal).status,
        'rollback-prepared',
      );
      const restored = await rollbackGlossJob(makeOptions(job, dir));
      assert.equal(restored.children[0].state, 'rolled_back');
      assert.equal((await verifyGloss(client, restored, dir)).valid, true);
    },
  );

  await t.test(
    'failed second child keeps first 50 durable and reverse rollback removes only committed rows',
    async () => {
      const many: GlossCandidate[] = [];
      for (let i = 0; i < 51; i++) {
        const senseId = (9007199254742000n + BigInt(i)).toString();
        const glossId = (9007199254743000n + BigInt(i)).toString();
        const semanticKey = `fixture:cat:child-${i}`;
        await client.query<Record<string, unknown>>(
          'INSERT INTO core.sense(id,lexeme_id,sense_no,external_id,source_id,batch_id) VALUES($1,$2,$3,$4,900,$5)',
          [senseId, target.lexemeId, i + 2, semanticKey, batch],
        );
        await client.query<Record<string, unknown>>(
          'INSERT INTO core.sense_gloss(id,sense_id,language_id,text,rank,source_id,batch_id) VALUES($1,$2,$3,$4,1,900,$5)',
          [glossId, senseId, lang.en, context.text, batch],
        );
        many.push(
          createGlossCandidate({
            ...candidate,
            target: {
              ...target,
              targetId: senseId,
              senseNo: i + 2,
              semanticKey,
              isPrimary: false,
            },
            context: {
              ...candidate.context,
              rows: [{ ...context, senseId, glossId }],
            },
          }),
        );
      }
      const dir = path.join(root, 'partial-job');
      const options = {
        ...makeOptions(fresh('mèo phân lô', many), dir),
        candidates: many,
      };
      let fail = true;
      await assert.rejects(
        applyGlossJob({
          ...options,
          persistJournal: (file, data) => {
            const journal = data as Journal;
            if (
              fail &&
              journal.status === 'prepared' &&
              journal.inputs?.runKey.endsWith(':1')
            ) {
              fail = false;
              throw new Error('Second child prepared checkpoint rejected');
            }
            saveJournal(file, data);
          },
        }),
        /Second child/,
      );
      const checkpoint = parseGlossJob(readArtifactJson(dir, 'job.json'));
      assert.equal(checkpoint.children.length, 2);
      assert.equal(checkpoint.children[0].state, 'applied');
      const applied = await client.query<Record<string, unknown>>(
        'SELECT count(*)::int n FROM core.sense_gloss WHERE sense_id=ANY($1::bigint[]) AND language_id=$2',
        [many.map((c) => c.target!.targetId), lang.vi],
      );
      assert.equal(applied.rows[0].n, 50);
      const rolledBack = await rollbackGlossJob({
        ...options,
        job: checkpoint,
      });
      assert.equal(
        rolledBack.children.every((c) => c.state === 'rolled_back'),
        true,
      );
      assert.equal(
        (
          await client.query<Record<string, unknown>>(
            'SELECT count(*)::int n FROM core.sense_gloss WHERE sense_id=ANY($1::bigint[]) AND language_id=$2',
            [many.map((c) => c.target!.targetId), lang.vi],
          )
        ).rows[0].n,
        0,
      );
      assert.equal((await verifyGloss(client, rolledBack, dir)).valid, true);
      assert.equal(await count(), 1);
    },
  );
  await t.test(
    'concept gloss append preserves cache/status and rejects ungrounded synset identity',
    async () => {
      const conceptId = '9007199254745000';
      const ili = 'fixture-ili-cat';
      await client.query(
        "INSERT INTO core.concept(id,ili,pos,gloss_en,gloss_vi,status,source_id,batch_id) VALUES($1,$2,'noun','cat','cache cũ','draft',900,$3)",
        [conceptId, ili, batch],
      );
      await client.query(
        "INSERT INTO core.wordnet_synset(lexicon,synset_id,concept_id,source_id,batch_id) VALUES('fixture-wn','cat-n',$1,900,$2)",
        [conceptId, batch],
      );
      const conceptCandidate = createGlossCandidate({
        ...candidate,
        target: {
          targetType: 'concept',
          targetId: conceptId,
          semanticKey: `ili:${ili}`,
          ili,
          synsetKeys: ['fixture-wn:cat-n'],
        },
        context: {
          context_kind: 'concept_definition',
          context_language: 'en',
          rows: [
            {
              kind: 'concept_definition',
              conceptId,
              text: 'cat',
              textHash: hashGlossText('cat'),
              sourceCode: source.code,
              batchId: batch,
              language: 'en',
            },
          ],
        },
      });
      const dir = path.join(root, 'concept');
      const options = {
        ...makeOptions(fresh('mèo khái niệm', [conceptCandidate]), dir),
        candidates: [conceptCandidate],
      };
      const applied = await applyGlossJob(options);
      assert.deepEqual(
        (
          await client.query<Record<string, unknown>>(
            'SELECT gloss_vi,status FROM core.concept WHERE id=$1',
            [conceptId],
          )
        ).rows[0],
        { gloss_vi: 'cache cũ', status: 'draft' },
      );
      const bad = createGlossCandidate({
        ...conceptCandidate,
        target: {
          targetType: 'concept',
          targetId: conceptId,
          semanticKey: `ili:${ili}`,
          ili,
          synsetKeys: ['fixture-wn:wrong-n'],
        },
      });
      await assert.rejects(
        applyGlossJob({
          ...options,
          job: fresh('mèo', [bad]),
          candidates: [bad],
          artifactDir: path.join(root, 'wrong-concept'),
        }),
        /synset identity/,
      );
      await rollbackGlossJob({ ...options, job: applied });
      assert.equal(
        (
          await client.query<Record<string, unknown>>(
            'SELECT count(*)::int n FROM core.concept_gloss WHERE concept_id=$1 AND language_id=$2',
            [conceptId, lang.vi],
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await client.query<Record<string, unknown>>(
            "SELECT count(*)::int n FROM core.concept_gloss_history WHERE concept_id=$1 AND event='delete'",
            [conceptId],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  writeArtifactJson(root, 'result.json', {
    privateDatabase: name,
    testsFinished: true,
  });
});
