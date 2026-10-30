import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mappingDecision, IMAGE_PROFILES } from './images.mjs';

export function validateReceipt(receipt) {
  if (
    receipt?.mode !== 'apply' ||
    !Array.isArray(receipt.assets) ||
    !receipt.assets.length ||
    receipt.assets.length > 20
  )
    throw Error('RECEIPT_INVALID');
  if (
    receipt.bucket !== 'langoo-image' ||
    receipt.public_base !== 'https://media.langoo.org'
  )
    throw Error('RECEIPT_STORAGE_INVALID');
  const ids = new Set();
  for (const row of receipt.assets) {
    if (
      row.state !== 'verified' ||
      row.s3_verified !== true ||
      row.public_verified !== true
    )
      throw Error('RECEIPT_NOT_VERIFIED');
    if (!/^[1-9][0-9]*$/.test(row.sense_id) || ids.has(row.sense_id))
      throw Error('RECEIPT_SENSE_INVALID');
    ids.add(row.sense_id);
    if (
      typeof row.source_definition !== 'string' ||
      !row.source_definition.trim() ||
      row.source_definition.length > 10000 ||
      createHash('sha256').update(row.source_definition).digest('hex') !==
        row.source_definition_sha256
    )
      throw Error('RECEIPT_SOURCE_INVALID');
    if (
      !/^[0-9a-f]{64}$/.test(row.sha256) ||
      !Object.values(IMAGE_PROFILES).some(
        (p) => p.version === row.prompt_version,
      ) ||
      row.key !== `illustrations/${row.prompt_version}/${row.sha256}.png` ||
      row.mime !== 'image/png'
    )
      throw Error('RECEIPT_IMAGE_INVALID');
    if (
      ![row.bytes, row.width, row.height].every(Number.isInteger) ||
      row.bytes < 1 ||
      row.bytes > 10485760 ||
      row.width < 1 ||
      row.height < 1 ||
      row.width > 4096 ||
      row.height > 4096
    )
      throw Error('RECEIPT_SIZE_INVALID');
    if (
      typeof row.prompt !== 'string' ||
      !row.prompt.trim() ||
      row.prompt.length > 32768 ||
      createHash('sha256').update(row.prompt).digest('hex') !==
        row.prompt_sha256 ||
      !Object.values(IMAGE_PROFILES).some(
        (p) =>
          p.version === row.prompt_version &&
          (p.scope === 'single_image_brief'
            ? !row.prompt_scope || row.prompt_scope === p.scope
            : row.prompt_scope === p.scope),
      )
    )
      throw Error('RECEIPT_PROMPT_INVALID');
  }
}

export async function verifyPublicReceipt(receipt) {
  validateReceipt(receipt);
  for (const row of receipt.assets) {
    const response = await fetch(`${receipt.public_base}/${row.key}`, {
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
    if (
      !response.ok ||
      response.headers.get('content-type')?.split(';')[0] !== row.mime ||
      Number(response.headers.get('content-length')) !== row.bytes
    )
      throw Error('PUBLIC_RECEIPT_READ_FAILED');
    const data = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(data).digest('hex') !== row.sha256)
      throw Error('PUBLIC_RECEIPT_HASH_FAILED');
  }
}

export async function registerImages(
  client,
  receipt,
  { apply = false, assetOnly = false } = {},
) {
  validateReceipt(receipt);
  if (apply) {
    const ledger = await client.query(
      `SELECT name FROM public.schema_migration WHERE name=$1`,
      ['045_concept_images.sql'],
    );
    if (!ledger.rows.length) throw Error('MIGRATION_045_REQUIRED');
  }
  const result = {
    task: 'M14.1',
    mode: apply ? 'apply' : 'dry-run',
    assets: [],
  };
  await client.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
  try {
    await client.query(`SET LOCAL statement_timeout='30s'`);
    await client.query(`SET LOCAL lock_timeout='5s'`);
    if (apply)
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        'm14.1:images',
      ]);
    for (const image of receipt.assets) {
      const sense = await client.query(
        `SELECT id,definition FROM core.sense WHERE id=$1${apply ? ' FOR SHARE' : ''}`,
        [image.sense_id],
      );
      if (!sense.rows.length) throw Error('SOURCE_SENSE_MISSING');
      if (
        typeof sense.rows[0].definition !== 'string' ||
        createHash('sha256').update(sense.rows[0].definition).digest('hex') !==
          image.source_definition_sha256
      )
        throw Error('SOURCE_DEFINITION_CHANGED');
      const links = await client.query(
        `SELECT sc.concept_id::text,sc.relation,sc.confidence,sc.verified,c.status
        FROM core.sense_concept sc JOIN core.concept c ON c.id=sc.concept_id
        WHERE sc.sense_id=$1${apply ? ' FOR SHARE OF sc,c' : ''}`,
        [image.sense_id],
      );
      const decision = assetOnly
        ? { state: 'asset_only' }
        : mappingDecision(links.rows);
      const row = {
        sense_id: image.sense_id,
        file: image.file,
        object_key: image.key,
        ...decision,
      };
      if (apply) {
        const metadata = {
          bucket: receipt.bucket,
          generator: 'muse-web',
          model_revision: null,
          prompt_version: image.prompt_version,
          prompt_scope: image.prompt_scope || 'single_image_brief',
          prompt_sha256: image.prompt_sha256,
          prompt_text: image.prompt,
          source_sense_id: image.sense_id,
          source_definition: image.source_definition,
          source_definition_sha256: image.source_definition_sha256,
          width: image.width,
          height: image.height,
          source_file: image.file,
          rights_policy: 'provider_terms_not_CC0',
        };
        const inserted = await client.query(
          `INSERT INTO core.media_asset(kind,object_key,mime,bytes,sha256,provider,metadata)
          VALUES('concept_image',$1,$2,$3,$4,'r2',$5::jsonb) ON CONFLICT(object_key) DO NOTHING RETURNING id`,
          [
            image.key,
            image.mime,
            image.bytes,
            image.sha256,
            JSON.stringify(metadata),
          ],
        );
        const asset = (
          await client.query(
            `SELECT id,kind,mime,bytes,sha256,provider,metadata FROM core.media_asset WHERE object_key=$1`,
            [image.key],
          )
        ).rows[0];
        if (
          !asset ||
          asset.kind !== 'concept_image' ||
          asset.mime !== image.mime ||
          asset.bytes !== image.bytes ||
          asset.sha256 !== image.sha256 ||
          asset.provider !== 'r2' ||
          asset.metadata.bucket !== receipt.bucket ||
          asset.metadata.prompt_sha256 !== image.prompt_sha256 ||
          asset.metadata.source_sense_id !== image.sense_id ||
          asset.metadata.source_definition_sha256 !==
            image.source_definition_sha256
        )
          throw Error('EXISTING_ASSET_CONFLICT');
        row.asset_id = String(asset.id);
        row.created_asset = inserted.rows.length > 0;
        if (decision.concept_id) {
          const primary = await client.query(
            `SELECT asset_id FROM core.concept_media WHERE concept_id=$1 AND is_primary AND status='approved'`,
            [decision.concept_id],
          );
          const approved = decision.state === 'approved';
          await client.query(
            `INSERT INTO core.concept_media(concept_id,asset_id,anchor_sense_id,status,is_primary,reviewed_at,reviewed_by_label)
            VALUES($1,$2,$3,$4,$5,CASE WHEN $6 THEN now() ELSE NULL END,$7)
            ON CONFLICT(concept_id,asset_id) DO NOTHING`,
            [
              decision.concept_id,
              asset.id,
              image.sense_id,
              approved ? 'approved' : 'pending',
              approved && !primary.rows.length,
              approved,
              approved
                ? image.prompt_version === 'muse-phone-c-v1'
                  ? 'project-owner:C-selection:2026-10-30'
                  : 'project-owner:all-existing-images:2026-10-30'
                : null,
            ],
          );
          const stored = (
            await client.query(
              `SELECT status,is_primary FROM core.concept_media WHERE concept_id=$1 AND asset_id=$2`,
              [decision.concept_id, asset.id],
            )
          ).rows[0];
          row.state = stored.status;
          row.is_primary = stored.is_primary;
        }
      }
      result.assets.push(row);
    }
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  if (process.argv.slice(2).some((x) => x !== '--apply'))
    throw Error('INVALID_ARGUMENT');
  const receipt = JSON.parse(readFileSync(0, 'utf8'));
  await verifyPublicReceipt(receipt);
  const root = process.env.M141_APP_ROOT || process.cwd(),
    requireApp = createRequire(resolve(root, 'package.json'));
  const env = requireApp('dotenv').parse(readFileSync(resolve(root, '.env'))),
    { Client } = requireApp('pg');
  const db = new Client({
    connectionString: env.DIRECT_URL || env.DATABASE_URL,
    application_name: 'langoo-m141-image-register',
  });
  try {
    await db.connect();
    console.log(
      JSON.stringify(
        await registerImages(db, receipt, {
          apply: process.argv.includes('--apply'),
        }),
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
          : 'DB_REGISTER_FAILED',
        sqlstate:
          error.code && /^[A-Z0-9]{5}$/.test(error.code)
            ? error.code
            : undefined,
      }),
    );
    process.exitCode = 1;
  });
