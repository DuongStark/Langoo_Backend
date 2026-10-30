import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setup } from './test-db.mjs';
import { registerImages } from './register.mjs';
function receipt(ids = ['11', '12', '13', '14']) {
  return {
    mode: 'apply',
    bucket: 'langoo-image',
    public_base: 'https://media.langoo.org',
    assets: ids.map((id, i) => {
      const sha256 = String(i + 1).repeat(64),
        prompt = 'An ordinary phone photo.';
      return {
        sense_id: id,
        file: `word${i}-C.png`,
        lemma: `word${i}`,
        sha256,
        key: `illustrations/muse-phone-c-v1/${sha256}.png`,
        mime: 'image/png',
        bytes: 100,
        width: 512,
        height: 512,
        prompt,
        prompt_sha256: createHash('sha256').update(prompt).digest('hex'),
        prompt_version: 'muse-phone-c-v1',
        source_definition: `source ${id}`,
        source_definition_sha256: createHash('sha256')
          .update(`source ${id}`)
          .digest('hex'),
        state: 'verified',
        s3_verified: true,
        public_verified: true,
      };
    }),
  };
}
test('registers assets with curated/pending/missing states and is idempotent', async (t) => {
  const db = await setup(t),
    input = receipt();
  const dry = await registerImages(db, input, { apply: false });
  assert.equal(dry.assets[0].state, 'approved');
  assert.equal(
    Number(
      (await db.query('SELECT count(*) n FROM core.media_asset')).rows[0].n,
    ),
    1,
  );
  const result = await registerImages(db, input, { apply: true });
  assert.deepEqual(
    result.assets.map((x) => x.state),
    ['approved', 'pending', 'missing_mapping', 'missing_mapping'],
  );
  assert.equal(
    Number(
      (await db.query('SELECT count(*) n FROM core.media_asset')).rows[0].n,
    ),
    5,
  );
  assert.equal(
    Number(
      (await db.query('SELECT count(*) n FROM core.concept_media')).rows[0].n,
    ),
    2,
  );
  assert.equal(
    Number(
      (await db.query('SELECT count(*) n FROM serve.concept_image')).rows[0].n,
    ),
    1,
  );
  await db.exec(
    `UPDATE core.concept_media SET status='rejected',is_primary=false WHERE concept_id=1`,
  );
  await registerImages(db, input, { apply: true });
  assert.equal(
    (await db.query('SELECT status FROM core.concept_media WHERE concept_id=1'))
      .rows[0].status,
    'rejected',
  );
  assert.equal(
    Number(
      (await db.query('SELECT count(*) n FROM core.media_asset')).rows[0].n,
    ),
    5,
  );
});
test('unknown source sense rolls back all inserted assets', async (t) => {
  const db = await setup(t);
  await assert.rejects(
    registerImages(db, receipt(['11', '999']), { apply: true }),
    /SOURCE_SENSE_MISSING/,
  );
  assert.equal(
    Number(
      (await db.query('SELECT count(*) n FROM core.media_asset')).rows[0].n,
    ),
    1,
  );
});
test('apply requires recorded migration and verified upload receipt', async (t) => {
  const db = await setup(t);
  await db.exec('DELETE FROM public.schema_migration');
  await assert.rejects(
    registerImages(db, receipt(), { apply: true }),
    /MIGRATION_045_REQUIRED/,
  );
  const input = receipt();
  input.assets[0].public_verified = false;
  await assert.rejects(
    registerImages(db, input, { apply: false }),
    /RECEIPT_NOT_VERIFIED/,
  );
});

test('changed source definition cannot import an image generated for an old meaning', async (t) => {
  const db = await setup(t),
    input = receipt(['11']);
  input.assets[0].source_definition = 'different archived definition';
  input.assets[0].source_definition_sha256 = createHash('sha256')
    .update(input.assets[0].source_definition)
    .digest('hex');
  await assert.rejects(
    registerImages(db, input, { apply: true }),
    /SOURCE_DEFINITION_CHANGED/,
  );
  assert.equal(
    Number(
      (await db.query('SELECT count(*) n FROM core.media_asset')).rows[0].n,
    ),
    1,
  );
});
test('registers both legacy prompt profiles without relabeling them as C', async (t) => {
  const db = await setup(t);
  for (const version of ['muse-illustration-pilot-v1', 'muse-mixed-pilot-v1']) {
    const input = receipt(['11']),
      image = input.assets[0];
    image.prompt_version = version;
    image.prompt_scope = 'batch_brief';
    image.prompt =
      'Original batch prompt including all requested source IDs. '.repeat(250);
    image.prompt_sha256 = createHash('sha256')
      .update(image.prompt)
      .digest('hex');
    image.key = `illustrations/${version}/${image.sha256}.png`;
    await registerImages(db, input, { apply: true });
    const again = await registerImages(db, input, { apply: true });
    assert.equal(again.assets[0].created_asset, false);
    const meta = (
      await db.query(
        'SELECT metadata FROM core.media_asset WHERE object_key=$1',
        [image.key],
      )
    ).rows[0].metadata;
    assert.equal(meta.prompt_version, version);
    assert.equal(meta.prompt_scope, 'batch_brief');
    assert.equal(meta.prompt_text, image.prompt);
  }
  assert.equal(
    Number(
      (await db.query('SELECT count(*) n FROM core.media_asset')).rows[0].n,
    ),
    3,
  );
});
test('automatic worker can stage an asset without creating an unintended source binding', async (t) => {
  const db = await setup(t),
    input = receipt(['11']);
  const image = input.assets[0];
  image.prompt_version = 'muse-ordinary-auto-v1';
  image.prompt_scope = 'single_image_brief';
  image.key = `illustrations/${image.prompt_version}/${image.sha256}.png`;
  const result = await registerImages(db, input, {
    apply: true,
    assetOnly: true,
  });
  assert.equal(result.assets[0].state, 'asset_only');
  assert.equal(
    Number(
      (await db.query('SELECT count(*) n FROM core.concept_media')).rows[0].n,
    ),
    0,
  );
});
