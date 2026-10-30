import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { setup, asset } from './test-db.mjs';
import { bindExisting } from './bind-existing.mjs';
const hash = (s) => createHash('sha256').update(s).digest('hex');
async function fixture(t) {
  const db = await setup(t),
    id = await asset(db);
  await db.query(`UPDATE core.media_asset SET metadata=$1::jsonb WHERE id=$2`, [
    JSON.stringify({
      source_sense_id: '13',
      source_definition_sha256: hash('source 13'),
    }),
    id,
  ]);
  await db.exec(
    `INSERT INTO core.concept_media(concept_id,asset_id,anchor_sense_id) VALUES(2,${id},12)`,
  );
  const bindings = [
    {
      asset_id: String(id),
      source_sense_id: '13',
      anchor_sense_id: '12',
      concept_id: '2',
      anchor_definition: 'source 12',
      anchor_definition_sha256: hash('source 12'),
    },
  ];
  return { db, id, bindings };
}
test('default accept shows draft images but hides review and rejected concepts', async (t) => {
  const { db, bindings } = await fixture(t);
  await db.exec(
    readFileSync('db/migrations/046_concept_image_default_accept.sql', 'utf8'),
  );
  await bindExisting(db, bindings, { apply: true });
  const count = async () =>
    Number(
      (await db.query('SELECT count(*) n FROM serve.concept_image')).rows[0].n,
    );
  assert.equal(await count(), 1);
  for (const status of ['review', 'rejected']) {
    await db.query('UPDATE core.concept SET status=$1 WHERE id=2', [status]);
    assert.equal(await count(), 0);
  }
  await db.exec("UPDATE core.concept SET status='draft' WHERE id=2");
  for (const change of [
    'verified=false',
    "relation='broader'",
    'confidence=0.1',
  ]) {
    await db.exec(
      `UPDATE core.sense_concept SET verified=true,relation='exact',confidence=1 WHERE concept_id=2; UPDATE core.sense_concept SET ${change} WHERE concept_id=2`,
    );
    assert.equal(await count(), 0);
  }
  await db.exec(
    "UPDATE core.sense_concept SET verified=true,relation='exact',confidence=1 WHERE concept_id=2",
  );
  assert.equal(await count(), 1);
  await db.exec('DELETE FROM core.sense_concept WHERE concept_id=2');
  assert.equal(await count(), 0);
});
test('bindings support dry run, idempotence and do not replace rejected/primary decisions', async (t) => {
  const { db, id, bindings } = await fixture(t);
  const dry = await bindExisting(db, bindings);
  assert.equal(dry.mode, 'dry-run');
  assert.equal(
    (
      await db.query(
        'SELECT status FROM core.concept_media WHERE asset_id=$1',
        [id],
      )
    ).rows[0].status,
    'pending',
  );
  await bindExisting(db, bindings, { apply: true });
  await bindExisting(db, bindings, { apply: true });
  assert.equal(
    Number(
      (await db.query('SELECT count(*) n FROM core.concept_media')).rows[0].n,
    ),
    1,
  );
  assert.equal(
    (await db.query('SELECT status FROM core.concept WHERE id=2')).rows[0]
      .status,
    'draft',
  );
  await db.query(
    `UPDATE core.concept_media SET status='rejected',is_primary=false WHERE asset_id=$1`,
    [id],
  );
  await assert.rejects(
    bindExisting(db, bindings, { apply: true }),
    /EXISTING_BINDING_REJECTED/,
  );
});
test('source and anchor definition changes roll back binding', async (t) => {
  const { db, id, bindings } = await fixture(t);
  await db.exec(`UPDATE core.sense SET definition='changed' WHERE id=12`);
  await assert.rejects(
    bindExisting(db, bindings, { apply: true }),
    /ANCHOR_DEFINITION_CHANGED/,
  );
  await db.exec(
    `UPDATE core.sense SET definition='source 12' WHERE id=12;UPDATE core.sense SET definition='changed' WHERE id=13`,
  );
  await assert.rejects(
    bindExisting(db, bindings, { apply: true }),
    /SOURCE_DEFINITION_CHANGED/,
  );
  assert.equal(
    (
      await db.query(
        'SELECT status FROM core.concept_media WHERE asset_id=$1',
        [id],
      )
    ).rows[0].status,
    'pending',
  );
});
test('another primary stays primary and a later failure rolls back earlier promotion', async (t) => {
  const { db, id, bindings } = await fixture(t),
    other = await asset(db, 'other.png');
  await db.query(
    `INSERT INTO core.concept_media(concept_id,asset_id,anchor_sense_id,status,is_primary,reviewed_at,reviewed_by_label) VALUES(2,$1,12,'approved',true,now(),'previous')`,
    [other],
  );
  await assert.rejects(
    bindExisting(db, [...bindings, { ...bindings[0], asset_id: '999' }], {
      apply: true,
    }),
    /BINDING_ASSET_MISMATCH/,
  );
  assert.equal(
    (
      await db.query(
        'SELECT status FROM core.concept_media WHERE asset_id=$1',
        [id],
      )
    ).rows[0].status,
    'pending',
  );
  const result = await bindExisting(db, bindings, { apply: true });
  assert.equal(result.assets[0].is_primary, false);
  assert.equal(
    (
      await db.query(
        'SELECT is_primary FROM core.concept_media WHERE asset_id=$1',
        [other],
      )
    ).rows[0].is_primary,
    true,
  );
});
