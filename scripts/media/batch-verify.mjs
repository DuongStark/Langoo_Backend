/** M14.2 final metadata/DB verification only; never downloads image bytes to local. */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const dir =
  process.argv[2] ||
  '/opt/langoo/storage/vocab-images/m142-restaurant-20261030';
const state = JSON.parse(readFileSync(resolve(dir, 'state.json'))),
  cohort = JSON.parse(readFileSync(resolve(dir, 'cohort.json')));
const req = createRequire('/opt/langoo/app/package.json'),
  env = req('dotenv').parse(readFileSync('/opt/langoo/app/.env')),
  { Client } = req('pg');
const db = new Client({
  connectionString: env.DIRECT_URL || env.DATABASE_URL,
  application_name: 'langoo-m142-final-verify',
});
try {
  await db.connect();
  await db.query('BEGIN READ ONLY');
  const coverage = (
    await db.query(
      `WITH items AS(SELECT di.anchor_sense_id,EXISTS(SELECT 1 FROM core.concept_media cm JOIN core.media_asset ma ON ma.id=cm.asset_id JOIN serve.concept_image ci ON ci.concept_id=cm.concept_id WHERE cm.status='approved' AND ma.kind='concept_image' AND (cm.concept_id=di.concept_id OR cm.anchor_sense_id=di.anchor_sense_id OR ma.metadata->>'source_sense_id'=di.anchor_sense_id::text)) has_image FROM core.deck d JOIN core.deck_item di ON di.deck_id=d.id WHERE d.slug='en-restaurant-dining') SELECT count(*)::int total,count(*) FILTER(WHERE has_image)::int with_image,count(*) FILTER(WHERE NOT has_image)::int missing FROM items`,
    )
  ).rows[0];
  const counts = (
    await db.query(
      `SELECT (SELECT count(*) FROM core.media_asset)::int media_assets,(SELECT count(*) FROM core.media_asset WHERE kind='concept_image')::int image_assets,(SELECT count(*) FROM core.concept_media)::int image_links,(SELECT count(*) FROM serve.concept_image)::int primary_images,(SELECT count(*) FROM core.kanji_media)::int kanji_media,(SELECT count(*) FROM core.concept)::int concepts`,
    )
  ).rows[0];
  const assets = (
    await db.query(
      `SELECT id::text,kind,object_key,bytes,sha256,metadata FROM core.media_asset WHERE kind='concept_image' ORDER BY id`,
    )
  ).rows;
  const links = (
    await db.query(
      `SELECT concept_id::text,asset_id::text,anchor_sense_id::text,status,is_primary,reviewed_by_label FROM core.concept_media ORDER BY asset_id`,
    )
  ).rows;
  const complete = Object.values(state.items).filter(
    (x) => x.status === 'complete',
  );
  if (state.status !== 'complete' || complete.length !== 76)
    throw Error('JOB_NOT_COMPLETE');
  if (coverage.total !== 116 || coverage.missing !== 0)
    throw Error('DECK_COVERAGE_INCOMPLETE');
  for (const row of complete) {
    const asset = assets.find((a) => a.id === row.asset_id),
      link = links.find(
        (l) =>
          l.asset_id === row.asset_id && l.concept_id === row.plan.concept_id,
      );
    if (
      !asset ||
      asset.sha256 !== row.receipt.sha256 ||
      asset.object_key !== row.receipt.key ||
      asset.metadata.source_sense_id !== row.plan.sense_id ||
      !link ||
      link.status !== 'approved' ||
      link.anchor_sense_id !== row.plan.anchor_sense_id
    )
      throw Error('REGISTERED_IMAGE_MISMATCH');
  }
  const unique = new Set(complete.map((x) => x.asset_id));
  if (
    unique.size !== 76 ||
    new Set(complete.map((x) => x.receipt.sha256)).size !== 76
  )
    throw Error('IMAGE_DUPLICATE');
  if (readdirSync(dir).some((x) => /\.(png|jpe?g|webp|zip)$/i.test(x)))
    throw Error('UNEXPECTED_IMAGE_FILE');
  const source_ids = cohort.items.map((x) => x.sense_id);
  const sources = (
    await db.query(
      'SELECT id::text,definition FROM core.sense WHERE id=ANY($1::bigint[])',
      [source_ids],
    )
  ).rows;
  if (
    sources.some(
      (s) =>
        s.definition !==
        cohort.items.find((i) => i.sense_id === s.id).definition,
    )
  )
    throw Error('SOURCE_DEFINITION_CHANGED');
  await db.query('ROLLBACK');
  const result = {
    task: 'M14.2',
    verified_at: new Date().toISOString(),
    coverage,
    counts,
    new_images: complete.length,
    total_new_bytes: complete.reduce((n, x) => n + x.receipt.bytes, 0),
    started_at: state.started_at,
    finished_at: state.finished_at,
    quota: 'unavailable',
    old_assets: assets.filter(
      (a) => a.metadata.prompt_version !== 'muse-ordinary-auto-v1',
    ),
    old_links: links.filter((l) => !unique.has(l.asset_id)),
    assets: complete.map((r) => ({
      sense_id: r.plan.sense_id,
      lemma: r.plan.lemma,
      asset_id: r.asset_id,
      concept_id: r.plan.concept_id,
      anchor_sense_id: r.plan.anchor_sense_id,
      key: r.receipt.key,
      sha256: r.receipt.sha256,
      bytes: r.receipt.bytes,
      is_primary: r.binding.is_primary,
      prompt: r.plan.image_prompt,
    })),
  };
  writeFileSync(
    resolve(dir, 'verification.json'),
    JSON.stringify(result, null, 2),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      coverage,
      counts,
      new_images: result.new_images,
      total_new_bytes: result.total_new_bytes,
      unique_images: 76,
      no_image_files_in_job_dir: true,
    }),
  );
} catch (e) {
  console.error(
    JSON.stringify({
      error_code: /^[A-Z0-9_]+$/.test(e.message) ? e.message : 'VERIFY_FAILED',
    }),
  );
  process.exitCode = 1;
} finally {
  await db.end();
}
