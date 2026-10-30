/** M14.1: explicit owner-approved bindings for assets already uploaded. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyPublicReceipt } from './register.mjs';
const hash = (s) => createHash('sha256').update(s).digest('hex');
export async function bindExisting(client, bindings, { apply = false } = {}) {
  if (
    !Array.isArray(bindings) ||
    !bindings.length ||
    bindings.length > 20 ||
    new Set(bindings.map((x) => x.asset_id)).size !== bindings.length
  )
    throw Error('BINDINGS_INVALID');
  for (const b of bindings) {
    if (
      ![b.asset_id, b.source_sense_id, b.anchor_sense_id, b.concept_id].every(
        (x) => typeof x === 'string' && /^[1-9][0-9]*$/.test(x),
      )
    )
      throw Error('BINDING_ID_INVALID');
    if (
      typeof b.anchor_definition !== 'string' ||
      !b.anchor_definition.trim() ||
      b.anchor_definition.length > 10000 ||
      hash(b.anchor_definition) !== b.anchor_definition_sha256
    )
      throw Error('BINDING_DEFINITION_INVALID');
  }
  const out = { task: 'M14.1', mode: apply ? 'apply' : 'dry-run', assets: [] };
  await client.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
  try {
    await client.query(`SET LOCAL statement_timeout='30s'`);
    await client.query(`SET LOCAL lock_timeout='5s'`);
    if (apply)
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'm14.1:images',
      ]);
    for (const b of bindings) {
      const asset = (
        await client.query(
          `SELECT id,kind,metadata FROM core.media_asset WHERE id=$1${apply ? ' FOR SHARE' : ''}`,
          [b.asset_id],
        )
      ).rows[0];
      if (
        !asset ||
        asset.kind !== 'concept_image' ||
        asset.metadata.source_sense_id !== b.source_sense_id
      )
        throw Error('BINDING_ASSET_MISMATCH');
      const source = (
        await client.query(
          `SELECT definition FROM core.sense WHERE id=$1${apply ? ' FOR SHARE' : ''}`,
          [b.source_sense_id],
        )
      ).rows[0];
      if (
        typeof source?.definition !== 'string' ||
        hash(source.definition) !== asset.metadata.source_definition_sha256
      )
        throw Error('SOURCE_DEFINITION_CHANGED');
      const anchor = (
        await client.query(
          `SELECT definition FROM core.sense WHERE id=$1${apply ? ' FOR SHARE' : ''}`,
          [b.anchor_sense_id],
        )
      ).rows[0];
      if (
        typeof anchor?.definition !== 'string' ||
        hash(anchor.definition) !== b.anchor_definition_sha256
      )
        throw Error('ANCHOR_DEFINITION_CHANGED');
      const mapping = await client.query(
        `SELECT sc.concept_id FROM core.sense_concept sc JOIN core.concept c ON c.id=sc.concept_id
     WHERE sc.sense_id=$1 AND sc.concept_id=$2 AND sc.relation='exact' AND sc.verified AND sc.confidence>=0.7 AND c.status IN('draft','curated')${apply ? ' FOR SHARE OF sc,c' : ''}`,
        [b.anchor_sense_id, b.concept_id],
      );
      if (mapping.rows.length !== 1) throw Error('BINDING_MAPPING_INVALID');
      const existing = (
        await client.query(
          `SELECT status,is_primary,anchor_sense_id::text FROM core.concept_media WHERE concept_id=$1 AND asset_id=$2${apply ? ' FOR UPDATE' : ''}`,
          [b.concept_id, b.asset_id],
        )
      ).rows[0];
      if (existing?.status === 'rejected')
        throw Error('EXISTING_BINDING_REJECTED');
      if (existing && existing.anchor_sense_id !== b.anchor_sense_id)
        throw Error('EXISTING_ANCHOR_CONFLICT');
      const primary = (
        await client.query(
          `SELECT asset_id FROM core.concept_media WHERE concept_id=$1 AND is_primary AND status='approved'${apply ? ' FOR SHARE' : ''}`,
          [b.concept_id],
        )
      ).rows;
      const isPrimary =
        existing?.status === 'approved' ? existing.is_primary : !primary.length;
      if (apply) {
        await client.query(
          `INSERT INTO core.concept_media(concept_id,asset_id,anchor_sense_id,status,is_primary,reviewed_at,reviewed_by_label)
      VALUES($1,$2,$3,'approved',$4,now(),'project-owner:default-accept-images:2026-10-30')
      ON CONFLICT(concept_id,asset_id) DO UPDATE SET status='approved',is_primary=EXCLUDED.is_primary,reviewed_at=EXCLUDED.reviewed_at,reviewed_by_label=EXCLUDED.reviewed_by_label
      WHERE core.concept_media.status='pending'`,
          [b.concept_id, b.asset_id, b.anchor_sense_id, isPrimary],
        );
      }
      out.assets.push({
        asset_id: b.asset_id,
        source_sense_id: b.source_sense_id,
        anchor_sense_id: b.anchor_sense_id,
        concept_id: b.concept_id,
        status: 'approved',
        is_primary: isPrimary,
      });
    }
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    return out;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
async function main() {
  const [file, ...flags] = process.argv.slice(2);
  if (!file || flags.some((x) => x !== '--apply'))
    throw Error('BINDING_USAGE_INVALID');
  const bindings = JSON.parse(readFileSync(file, 'utf8')),
    receipt = JSON.parse(readFileSync(0, 'utf8'));
  await verifyPublicReceipt(receipt);
  for (const b of bindings)
    if (!receipt.assets.some((x) => x.sense_id === b.source_sense_id))
      throw Error('BINDING_RECEIPT_MISMATCH');
  const root = process.env.M141_APP_ROOT || process.cwd(),
    req = createRequire(resolve(root, 'package.json'));
  const env = req('dotenv').parse(readFileSync(resolve(root, '.env'))),
    { Client } = req('pg');
  const db = new Client({
    connectionString: env.DIRECT_URL || env.DATABASE_URL,
    application_name: 'langoo-m141-bind-existing',
  });
  try {
    await db.connect();
    if (
      flags.includes('--apply') &&
      !(
        await db.query(
          `SELECT name FROM public.schema_migration WHERE name='046_concept_image_default_accept.sql'`,
        )
      ).rows.length
    )
      throw Error('MIGRATION_046_REQUIRED');
    for (const b of bindings) {
      const row = (
        await db.query(
          'SELECT object_key,sha256 FROM core.media_asset WHERE id=$1',
          [b.asset_id],
        )
      ).rows[0];
      if (
        !row ||
        !receipt.assets.some(
          (x) =>
            x.sense_id === b.source_sense_id &&
            x.key === row.object_key &&
            x.sha256 === row.sha256,
        )
      )
        throw Error('BINDING_RECEIPT_MISMATCH');
    }
    console.log(
      JSON.stringify(
        await bindExisting(db, bindings, { apply: flags.includes('--apply') }),
      ),
    );
  } finally {
    await db.end();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(
      JSON.stringify({
        error_code: /^[A-Z0-9_]+$/.test(error.message || '')
          ? error.message
          : 'BINDING_FAILED',
      }),
    );
    process.exitCode = 1;
  });
