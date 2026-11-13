#!/usr/bin/env node
'use strict';
// M12-A19: explicit plan/apply/rollback, never infer user provenance from text.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const req = createRequire(
  path.join(
    process.env.LANGOO_APP_ROOT || path.resolve(__dirname, '../..'),
    'package.json',
  ),
);
const { Client } = req('pg');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const selection = `
 SELECT i.id::text, i.anchor_sense_id::text, i.meaning_vi AS old_meaning,
        i.meaning_source AS old_source, i.created_at::text AS created_at,
        i.updated_at::text AS old_updated_at, sc.gloss_vi AS new_meaning,
        CASE WHEN sc.gloss_vi_machine IS TRUE AND sc.gloss_vi_reviewed IS NOT TRUE
             THEN 'machine' ELSE 'source' END AS new_source
 FROM app.collection_item i
 JOIN serve.sense_card sc ON sc.sense_id=i.anchor_sense_id
 WHERE i.meaning_source='source' AND i.created_at=i.updated_at
   AND i.meaning_vi COLLATE "C"=sc.gloss_en COLLATE "C"
   AND NULLIF(btrim(sc.gloss_vi),'') IS NOT NULL
   AND sc.gloss_vi COLLATE "C"<>i.meaning_vi COLLATE "C"`;
function privateWrite(file, object) {
  const parent = path.dirname(path.resolve(file));
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  if ((fs.statSync(parent).mode & 0o077) !== 0)
    throw new Error('Private output directory must be mode 700');
  const bytes = JSON.stringify(object, null, 2) + '\n';
  const fd = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const directoryFd = fs.openSync(parent, 'r');
  try {
    fs.fsyncSync(directoryFd);
  } finally {
    fs.closeSync(directoryFd);
  }
  return hash(bytes);
}
function readPinned(file, expected) {
  const bytes = fs.readFileSync(file);
  if (!expected || hash(bytes) !== expected)
    throw new Error('Manifest/receipt hash mismatch');
  return JSON.parse(bytes);
}
async function execute(args) {
  const mode = args[0];
  const opt = {};
  for (let i = 1; i < args.length; i += 2) {
    if (!args[i]?.startsWith('--') || args[i + 1] === undefined)
      throw new Error('Invalid CLI arguments');
    opt[args[i].slice(2)] = args[i + 1];
  }
  if (
    !['plan', 'apply', 'rollback'].includes(mode) ||
    !opt.database ||
    !opt.output
  )
    throw new Error(
      'Require plan|apply|rollback --database NAME --output PRIVATE_FILE',
    );
  const root = process.env.LANGOO_APP_ROOT || path.resolve(__dirname, '../..');
  const env = fs.existsSync(path.join(root, '.env'))
    ? req('dotenv').parse(fs.readFileSync(path.join(root, '.env')))
    : {};
  const url = process.env.DATABASE_URL || env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing');
  const db = new Client({
    connectionString: url,
    options: '-c timezone=UTC -c statement_timeout=30000 -c lock_timeout=3000',
  });
  let opened = false;
  try {
    await db.connect();
    await db.query(
      mode === 'plan'
        ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'
        : 'BEGIN ISOLATION LEVEL REPEATABLE READ',
    );
    opened = true;
    const target = (await db.query('SELECT current_database() AS name')).rows[0]
      .name;
    if (target !== opt.database) throw new Error('Wrong target database');
    if (mode === 'plan') {
      const rows = (await db.query(selection + ' ORDER BY i.id')).rows;
      const sha256 = privateWrite(opt.output, {
        task: 'M12-A19',
        kind: 'plan',
        database: target,
        created_at: new Date().toISOString(),
        rows,
      });
      await db.query('COMMIT');
      opened = false;
      return { mode, candidates: rows.length, sha256, read_only: true };
    }
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtext('M12-A19-meaning-vi-backfill'))",
    );
    const manifest = readPinned(opt.manifest, opt.sha256);
    if (
      manifest.database !== target ||
      manifest.task !== 'M12-A19' ||
      !Array.isArray(manifest.rows) ||
      manifest.rows.length !== Number(opt['expected-count']) ||
      new Set(manifest.rows.map((r) => r.id)).size !== manifest.rows.length
    )
      throw new Error('Wrong manifest target/count/duplicate');
    const changed = [];
    for (const row of manifest.rows) {
      if (mode === 'apply') {
        if (manifest.kind !== 'plan') throw new Error('Expected plan');
        // Re-evaluate source policy and dictionary text under lock; any drift aborts ALL rows.
        const current = (
          await db.query(selection + ' AND i.id=$1::uuid FOR UPDATE OF i', [
            row.id,
          ])
        ).rows[0];
        if (!current || JSON.stringify(current) !== JSON.stringify(row))
          throw new Error('Candidate changed; create a new plan');
        const applied = (
          await db.query(
            `UPDATE app.collection_item SET meaning_vi=$2,meaning_source=$3 WHERE id=$1::uuid RETURNING updated_at::text AS applied_updated_at`,
            [row.id, row.new_meaning, row.new_source],
          )
        ).rows[0];
        changed.push({ ...row, ...applied });
      } else {
        if (manifest.kind !== 'apply-backup-before-commit')
          throw new Error('Expected apply receipt');
        const current = (
          await db.query(
            `SELECT id FROM app.collection_item WHERE id=$1::uuid AND anchor_sense_id=$2::bigint AND meaning_vi COLLATE "C"=$3::text COLLATE "C" AND meaning_source=$4 AND updated_at=$5::timestamptz FOR UPDATE`,
            [
              row.id,
              row.anchor_sense_id,
              row.new_meaning,
              row.new_source,
              row.applied_updated_at,
            ],
          )
        ).rows[0];
        if (!current)
          throw new Error(
            'Rollback target changed; abort without overwriting user edits',
          );
        // Restore text/provenance; preserve a new updated_at timestamp for honest audit history.
        await db.query(
          'UPDATE app.collection_item SET meaning_vi=$2,meaning_source=$3 WHERE id=$1::uuid',
          [row.id, row.old_meaning, row.old_source],
        );
        changed.push(row);
      }
    }
    // Durable private backup BEFORE commit; crash/commit failure is resolved using CAS guards.
    const sha256 = privateWrite(opt.output, {
      task: 'M12-A19',
      kind:
        mode === 'apply'
          ? 'apply-backup-before-commit'
          : 'rollback-backup-before-commit',
      database: target,
      created_at: new Date().toISOString(),
      input_sha256: opt.sha256,
      rows: changed,
    });
    await db.query('COMMIT');
    opened = false;
    return {
      mode,
      committed: true,
      rows: changed.length,
      receipt_sha256: sha256,
    };
  } finally {
    if (opened) await db.query('ROLLBACK').catch(() => {});
    await db.end();
  }
}
module.exports = { execute };
if (require.main === module)
  execute(process.argv.slice(2))
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(
        JSON.stringify({
          error: error.message?.includes('postgres')
            ? 'Database operation failed'
            : error.message,
          code: error.code,
        }),
      );
      process.exitCode = 1;
    });
