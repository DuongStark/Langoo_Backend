import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const require = createRequire('/opt/langoo/app/package.json');
const dotenv = require('dotenv');
const { Client } = require('pg');
const env = dotenv.parse(readFileSync('/opt/langoo/app/.env'));
const { loadR2Config } = await import('file:///opt/langoo/services/vocab-images-m142/images.mjs');
const sdk = createRequire('/opt/langoo/services/vocab-images-m142/package.json')('@aws-sdk/client-s3');
const config = loadR2Config('/run/langoo-m142/r2.env');
const s3 = new sdk.S3Client({
  region: 'auto',
  endpoint: config.endpoint,
  credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  maxAttempts: 1,
});
const db = new Client({ connectionString: env.DIRECT_URL || env.DATABASE_URL });
const sha = (data) => createHash('sha256').update(data).digest('hex');
const IMAGE_DIR = '/tmp/sense-batch-images';
const PROMPT_VERSION = 'vocab-square-512-webp75-style-v4';
const SOURCE = process.argv.includes('--validation') ? 'validation-2026-11-09' : 'vocab-batch-2026-11-09';
const REVIEW = process.argv.includes('--validation') ? 'project-owner:validation-2026-11-09' : 'project-owner:batch-2026-11-09';
const APPLY = process.argv.includes('--apply');

const items = JSON.parse(readFileSync('/tmp/sense-batch-items.json', 'utf8'));
const prompts = Object.fromEntries(
  readFileSync('/tmp/sense-batch-prompts.jsonl', 'utf8').split('\n').filter(Boolean).map((line) => {
    const row = JSON.parse(line);
    return [row.prompt_id, row];
  }),
);
const ids = [...new Set(items.map((x) => String(x.sense_id)))];
const results = [];

try {
  await db.connect();
  const senseRows = (await db.query(`
    SELECT s.id::text AS sense_id, s.definition, l.lemma, l.language_id, l.pos,
      (SELECT sg.text FROM core.sense_gloss sg WHERE sg.sense_id=s.id AND sg.language_id=1 ORDER BY sg.rank NULLS LAST, sg.id LIMIT 1) AS en_gloss,
      (SELECT sg.text FROM core.sense_gloss sg WHERE sg.sense_id=s.id AND sg.language_id=3 ORDER BY sg.rank NULLS LAST, sg.id LIMIT 1) AS vi_gloss
    FROM core.sense s JOIN core.lexeme l ON l.id=s.lexeme_id
    WHERE s.id = ANY($1::bigint[])
  `, [ids])).rows;
  const sense = Object.fromEntries(senseRows.map((x) => [x.sense_id, x]));
  for (const item of items) {
    const row = sense[String(item.sense_id)];
    if (!row) { results.push({ ...item, error: 'SENSE_MISSING' }); continue; }
    const path = join(IMAGE_DIR, item.file);
    let data;
    try { data = readFileSync(path); } catch (error) { results.push({ ...item, error: 'IMAGE_MISSING' }); continue; }
    const digest = sha(data);
    const key = `illustrations/${PROMPT_VERSION}/${digest}.webp`;
    const url = `${config.publicBase}/${key}`;
    const prompt = prompts[item.prompt_id]?.prompt || '';
    const promptSha = sha(prompt);
    const sourceDefinition = (row.definition || '').trim() || (row.en_gloss || '').trim() || (row.vi_gloss || '').trim() || item.gloss;
    const sourceKind = (row.definition || '').trim() ? 'sense_definition' : (row.en_gloss || '').trim() ? 'sense_gloss_en' : (row.vi_gloss || '').trim() ? 'sense_gloss_vi' : 'prompt_gloss';
    const sourceSha = sha(sourceDefinition);
    let assetId = null;
    let bound = false;
    try {
      let exists = true;
      try { await s3.send(new sdk.HeadObjectCommand({ Bucket: config.bucket, Key: key }), { abortSignal: AbortSignal.timeout(30000) }); }
      catch (error) { if (error.$metadata?.httpStatusCode === 404) exists = false; else throw error; }
      if (!exists) {
        try {
          await s3.send(new sdk.PutObjectCommand({
            Bucket: config.bucket, Key: key, Body: data, ContentType: 'image/webp',
            CacheControl: 'public,max-age=31536000,immutable',
            Metadata: { sha256: digest, prompt_version: PROMPT_VERSION, style: item.style || '' },
            IfNoneMatch: '*',
          }), { abortSignal: AbortSignal.timeout(30000) });
        } catch (error) { if (error.$metadata?.httpStatusCode !== 412) throw error; }
      }
      let verified = false;
      for (let n = 0; n < 3; n++) {
        const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
        if (response.ok && response.headers.get('content-type')?.split(';')[0] === 'image/webp') {
          const body = Buffer.from(await response.arrayBuffer());
          if (sha(body) === digest && body.length === data.length) { verified = true; break; }
        }
        await new Promise((r) => setTimeout(r, 1200));
      }
      if (!verified) throw Error('PUBLIC_VERIFY_FAILED');
      const metadata = {
        bucket: config.bucket, generator: 'muse-native', model_revision: null,
        prompt_version: PROMPT_VERSION, prompt_scope: 'batch_brief_shared_8',
        prompt_sha256: promptSha, prompt_text: prompt,
        source_sense_id: String(item.sense_id), source_lemma: item.lemma,
        source_language_id: item.lang === 'en' ? 1 : 2, source_pos: item.pos,
        source_definition: sourceDefinition, source_definition_kind: sourceKind, source_definition_sha256: sourceSha,
        width: 512, height: 512, source_file: item.file, prompt_id: item.prompt_id,
        image_index: String(item.index), style: item.style || null,
        [APPLY ? 'batch' : 'validation']: true,
        rights_policy: 'provider_terms_not_CC0',
      };
      await db.query('BEGIN');
      const inserted = await db.query(
        `INSERT INTO core.media_asset(kind,object_key,mime,bytes,sha256,provider,metadata)
         VALUES('concept_image',$1,'image/webp',$2,$3,'r2',$4::jsonb)
         ON CONFLICT(object_key) DO NOTHING RETURNING id`,
        [key, data.length, digest, JSON.stringify(metadata)],
      );
      if (inserted.rows.length) assetId = String(inserted.rows[0].id);
      else {
        const existing = await db.query('SELECT id FROM core.media_asset WHERE object_key=$1', [key]);
        assetId = String(existing.rows[0].id);
      }
      if (APPLY) {
        const primary = await db.query("SELECT 1 FROM core.sense_media WHERE sense_id=$1 AND status='approved' AND is_primary", [item.sense_id]);
        await db.query(
          `INSERT INTO core.sense_media(sense_id,asset_id,status,is_primary,style_id,source,reviewed_at,reviewed_by_label)
           VALUES($1,$2,'approved',$3,$4,$5,now(),$6)
           ON CONFLICT (sense_id,asset_id) DO NOTHING`,
          [item.sense_id, assetId, primary.rows.length === 0, item.style || null, SOURCE, REVIEW],
        );
        bound = true;
      }
      await db.query('COMMIT');
      results.push({ ...item, key, url, asset_id: assetId, bound, bytes: data.length });
      console.log('OK', item.sense_id, item.lemma, bound ? 'sense-bound' : 'dry-run', data.length);
    } catch (error) {
      try { await db.query('ROLLBACK'); } catch {}
      results.push({ ...item, key, url, error: String(error.message || error).slice(0, 300) });
      console.error('FAIL', item.sense_id, item.lemma, String(error.message || error).slice(0, 200));
    }
  }
  writeFileSync('/tmp/sense-batch-upload.json', JSON.stringify(results, null, 2));
  const summary = {
    total: results.length,
    uploaded: results.filter((x) => x.asset_id).length,
    bound: results.filter((x) => x.bound).length,
    failed: results.filter((x) => x.error).length,
    bytes: results.reduce((n, x) => n + (x.bytes || 0), 0),
    apply: APPLY,
  };
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  console.error('FATAL', error.message);
  process.exitCode = 1;
} finally {
  await db.end();
  s3.destroy();
}
