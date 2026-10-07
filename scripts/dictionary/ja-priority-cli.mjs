#!/usr/bin/env node
// M4.5 — offline export/apply. No provider calls or writes to lexical content.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import pg from 'pg';
import dotenv from 'dotenv';

export const sha256 = (raw) => createHash('sha256').update(raw).digest('hex');
export function validateArtifact(data) {
  if (
    data.schema_version !== 1 ||
    data.policy !== 'ja-bccwj-v1' ||
    data.source_code !== 'bccwj-suw' ||
    data.source_version !== '1.0' ||
    !/^[a-f0-9]{64}$/.test(data.source_sha256) ||
    typeof data.target_identity !== 'string' ||
    !Array.isArray(data.lexemes) ||
    data.lexemes.length === 0 ||
    !data.summary ||
    typeof data.summary !== 'object' ||
    !Array.isArray(data.senses)
  )
    throw new Error('Invalid artifact contract');
  const lexemes = new Set(),
    senses = new Set(),
    orders = new Set();
  for (const row of data.lexemes) {
    if (
      !/^[1-9]\d*$/.test(row.lexeme_id) ||
      !/^jmdict:\d+$/.test(row.semantic_key) ||
      !/^[a-f0-9]{32}$/.test(row.input_hash) ||
      !Number.isSafeInteger(row.corpus_rank) ||
      row.corpus_rank <= 0 ||
      !Number.isSafeInteger(row.corpus_count) ||
      row.corpus_count <= 0 ||
      !Array.isArray(row.evidence) ||
      row.evidence.length === 0 ||
      lexemes.has(row.lexeme_id)
    )
      throw new Error('Invalid or duplicate lexeme priority');
    lexemes.add(row.lexeme_id);
  }
  for (const row of data.senses) {
    const order = `${row.lexeme_id}:${row.display_order}`;
    if (
      !/^[1-9]\d*$/.test(row.sense_id) ||
      !/^[1-9]\d*$/.test(row.lexeme_id) ||
      !/^jmdict:\d+:\d+$/.test(row.semantic_key) ||
      !/^[a-f0-9]{32}$/.test(row.input_hash) ||
      !Number.isInteger(row.display_order) ||
      row.display_order < 1 ||
      row.display_order > 3 ||
      !['llm', 'source_rule'].includes(row.reviewer_kind) ||
      typeof row.reason !== 'string' ||
      !row.reason ||
      senses.has(row.sense_id) ||
      orders.has(order)
    )
      throw new Error('Invalid or duplicate sense preference');
    senses.add(row.sense_id);
    orders.add(order);
  }
}

const lexemeRecord = `jsonb_to_recordset($1::jsonb) AS x(lexeme_id bigint, semantic_key text,input_hash text,corpus_rank integer,corpus_count bigint,evidence jsonb)`;
const senseRecord = `jsonb_to_recordset($1::jsonb) AS x(sense_id bigint,lexeme_id bigint,semantic_key text,input_hash text,display_order smallint,reason text,reviewer_kind text)`;
export async function applyArtifact(
  db,
  data,
  artifactHash,
  targetIdentity,
  apply = false,
) {
  validateArtifact(data);
  if (data.target_identity !== targetIdentity)
    throw new Error('Artifact target identity mismatch');
  await db.query('BEGIN');
  try {
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtext('m4.5-ja-bccwj-v1'))",
    );
    await db.query(
      "SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='120s'",
    );
    // Lock checked core rows against a simultaneous source reload until commit.
    // Derived VI writes do not touch these columns and remain outside the hash.
    for (let start = 0; start < data.lexemes.length; start += 500) {
      const rows = data.lexemes.slice(start, start + 500);
      await db.query(
        `SELECT l.id FROM ${lexemeRecord} JOIN core.lexeme l ON l.id=x.lexeme_id FOR SHARE OF l`,
        [JSON.stringify(rows)],
      );
      const valid = await db.query(
        `SELECT count(*)::int AS n FROM ${lexemeRecord} JOIN core.lexeme l ON l.id=x.lexeme_id AND l.external_id=x.semantic_key WHERE x.input_hash=core.japanese_priority_input_hash(l.id)`,
        [JSON.stringify(rows)],
      );
      if (valid.rows[0].n !== rows.length)
        throw new Error(
          'Lexeme source drift/missing identity; no data applied',
        );
    }
    for (let start = 0; start < data.senses.length; start += 500) {
      const rows = data.senses.slice(start, start + 500);
      await db.query(
        `SELECT s.id FROM ${senseRecord} JOIN core.sense s ON s.id=x.sense_id FOR SHARE OF s`,
        [JSON.stringify(rows)],
      );
      const valid = await db.query(
        `SELECT count(*)::int AS n FROM ${senseRecord} JOIN core.sense s ON s.id=x.sense_id AND s.lexeme_id=x.lexeme_id AND s.external_id=x.semantic_key WHERE x.input_hash=core.japanese_sense_input_hash(s.id)`,
        [JSON.stringify(rows)],
      );
      if (valid.rows[0].n !== rows.length)
        throw new Error('Sense source drift/missing identity; no data applied');
    }
    if (!apply) {
      await db.query('ROLLBACK');
      return { status: 'dry_run_valid', ...data.summary };
    }
    const duplicate = await db.query(
      'SELECT id,active FROM core.dictionary_priority_run WHERE artifact_sha256=$1 AND target_identity=$2 ORDER BY created_at DESC LIMIT 1',
      [artifactHash, targetIdentity],
    );
    if (duplicate.rows[0]) {
      await db.query('ROLLBACK');
      return {
        status: duplicate.rows[0].active
          ? 'already_active'
          : 'already_imported_inactive',
        run_id: duplicate.rows[0].id,
      };
    }
    await db.query('LOCK TABLE public.source IN SHARE ROW EXCLUSIVE MODE');
    await db.query(
      `INSERT INTO public.source(id,code,name,license,attribution,url,version,sha256,imported_at)
      SELECT coalesce(max(id),0)+1,'bccwj-suw','BCCWJ short-unit word frequency list',
      'NINJAL BCCWJ frequency-list terms: research/education; no raw redistribution; commercial use by consultation',
      'National Institute for Japanese Language and Linguistics (NINJAL), BCCWJ SUW frequency list v1.0',
      'https://doi.org/10.15084/00003218','1.0',$1,now() FROM public.source
      HAVING NOT EXISTS(SELECT 1 FROM public.source WHERE code='bccwj-suw')`,
      [data.source_sha256],
    );
    const run = randomUUID();
    await db.query(
      `INSERT INTO core.dictionary_priority_run(id,policy,language_id,source_code,source_version,source_sha256,artifact_sha256,target_identity,summary)
      SELECT $1,$2,id,$3,$4,$5,$6,$7,$8 FROM public.language WHERE code='ja'`,
      [
        run,
        data.policy,
        data.source_code,
        data.source_version,
        data.source_sha256,
        artifactHash,
        targetIdentity,
        data.summary,
      ],
    );
    for (let start = 0; start < data.lexemes.length; start += 500)
      await db.query(
        `INSERT INTO core.lexeme_learner_priority(run_id,lexeme_id,input_hash,corpus_rank,corpus_count,evidence) SELECT $2,x.lexeme_id,x.input_hash,x.corpus_rank,x.corpus_count,x.evidence FROM ${lexemeRecord}`,
        [JSON.stringify(data.lexemes.slice(start, start + 500)), run],
      );
    for (let start = 0; start < data.senses.length; start += 500)
      await db.query(
        `INSERT INTO core.sense_learner_priority(run_id,sense_id,lexeme_id,input_hash,display_order,reason,reviewer_kind) SELECT $2,x.sense_id,x.lexeme_id,x.input_hash,x.display_order,x.reason,x.reviewer_kind FROM ${senseRecord}`,
        [JSON.stringify(data.senses.slice(start, start + 500)), run],
      );
    await db.query(
      'UPDATE core.dictionary_priority_run SET active=false WHERE policy=$1 AND active',
      [data.policy],
    );
    await db.query(
      'UPDATE core.dictionary_priority_run SET active=true WHERE id=$1',
      [run],
    );
    await db.query(
      'ANALYZE core.lexeme_learner_priority; ANALYZE core.sense_learner_priority; ANALYZE core.dictionary_priority_run',
    );
    await db.query('COMMIT');
    return { status: 'applied', run_id: run, ...data.summary };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2),
    command = args[0];
  const arg = (name) => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args[i + 1];
  };
  const target = arg('--target');
  if (!target || !['export', 'check', 'apply', 'deactivate'].includes(command))
    throw new Error(
      'Usage: export --target LABEL --out PATH | check/apply --target LABEL --file PATH --sha256 HASH [--apply] | deactivate --target LABEL --run UUID [--apply]',
    );
  const env = dotenv.parse(readFileSync(arg('--env-file') ?? '.env'));
  const url = new URL(env.DIRECT_URL || env.DATABASE_URL);
  const database = arg('--test-db');
  if (database) {
    if (!database.endsWith('_test'))
      throw new Error('Test database must end with _test');
    url.pathname = '/' + database;
  }
  const db = new pg.Client({
    connectionString: url.toString(),
    application_name: 'langoo-m45-ja-priority',
  });
  await db.connect();
  try {
    const identity = (
      await db.query(
        "SELECT current_database() AS db,version FROM public.source WHERE code='jmdict'",
      )
    ).rows[0];
    if (!identity) throw new Error('JMdict source missing');
    const targetIdentity = `${target}:${identity.db}:jmdict-${identity.version}`;
    if (command === 'export') {
      if (!arg('--out')) throw new Error('--out required');
      const lexemes = (
        await db.query(
          `SELECT l.id::text, l.external_id,l.lemma,l.reading,l.pos,l.attributes,core.japanese_priority_input_hash(l.id) AS input_hash FROM core.lexeme l JOIN public.source src ON src.id=l.source_id JOIN public.language lg ON lg.id=l.language_id WHERE lg.code='ja' AND src.code='jmdict' ORDER BY l.id`,
        )
      ).rows;
      const rules = JSON.parse(
        readFileSync(
          arg('--preferences') ??
            'scripts/dictionary/ja-sense-preferences.json',
          'utf8',
        ),
      );
      const sensePreferences = [];
      for (const entry of rules.entries) {
        const lexeme = lexemes.find(
          (l) =>
            l.external_id === entry.semantic_key &&
            l.lemma === entry.lemma &&
            l.reading === entry.reading,
        );
        if (!lexeme) {
          if (database) continue;
          throw new Error(
            `Missing preference lexical identity ${entry.semantic_key}`,
          );
        }
        for (let i = 0; i < entry.senses.length; i++) {
          const preference = entry.senses[i];
          const sense = (
            await db.query(
              `SELECT s.id::text AS sense_id,s.external_id AS semantic_key,core.japanese_sense_input_hash(s.id) AS input_hash FROM core.sense s WHERE s.lexeme_id=$1 AND s.sense_no=$2 AND EXISTS(SELECT 1 FROM core.sense_gloss g JOIN public.language lg ON lg.id=g.language_id WHERE g.sense_id=s.id AND lg.code='en' AND strpos(lower(g.text),lower($3))>0)`,
              [lexeme.id, preference.sense_no, preference.contains_gloss],
            )
          ).rows;
          if (sense.length !== 1)
            throw new Error(
              `Preference evidence mismatch ${entry.semantic_key}:${preference.sense_no}`,
            );
          sensePreferences.push({
            ...sense[0],
            lexeme_id: lexeme.id,
            display_order: i + 1,
            reason: preference.reason,
            reviewer_kind: rules.reviewer_kind,
          });
        }
      }
      writeFileSync(
        arg('--out'),
        JSON.stringify({
          target_identity: targetIdentity,
          lexemes,
          sense_preferences: sensePreferences,
        }),
      );
      console.log(
        JSON.stringify({
          status: 'exported',
          lexemes: lexemes.length,
          sense_preferences: sensePreferences.length,
          target_identity: targetIdentity,
        }),
      );
    } else if (command === 'deactivate') {
      const run = arg('--run');
      if (!run || !/^[a-f0-9-]{36}$/.test(run))
        throw new Error('--run UUID required');
      if (!args.includes('--apply')) {
        console.log(
          JSON.stringify({ status: 'dry_run_deactivate', run_id: run }),
        );
        return;
      }
      await db.query('BEGIN');
      await db.query(
        "SELECT pg_advisory_xact_lock(hashtext('m4.5-ja-bccwj-v1'))",
      );
      const result = await db.query(
        "UPDATE core.dictionary_priority_run SET active=false WHERE id=$1 AND target_identity=$2 AND policy='ja-bccwj-v1' RETURNING id",
        [run, targetIdentity],
      );
      if (result.rowCount !== 1) {
        await db.query('ROLLBACK');
        throw new Error('Unknown run or wrong target');
      }
      await db.query('COMMIT');
      console.log(JSON.stringify({ status: 'deactivated', run_id: run }));
    } else {
      const raw = readFileSync(arg('--file')),
        hash = sha256(raw);
      if (hash !== arg('--sha256')) throw new Error('Artifact SHA256 mismatch');
      console.log(
        JSON.stringify(
          await applyArtifact(
            db,
            JSON.parse(raw),
            hash,
            targetIdentity,
            command === 'apply' && args.includes('--apply'),
          ),
        ),
      );
    }
  } finally {
    await db.end();
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
