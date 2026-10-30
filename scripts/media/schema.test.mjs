import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, asset } from './test-db.mjs';
test('migration preserves old media and rejects nonobject provenance', async (t) => {
  const db = await setup(t);
  assert.equal(
    (await db.query('SELECT kind FROM core.media_asset WHERE id=1')).rows[0]
      .kind,
    'stroke_svg',
  );
  await asset(db);
  await assert.rejects(
    db.exec(`UPDATE core.media_asset SET metadata='[]' WHERE id=1`),
    (e) => e.code === '23514',
  );
});
test('only one approved primary per concept; pending cannot become primary', async (t) => {
  const db = await setup(t),
    a = await asset(db),
    b = await asset(db, 'second.png');
  await db.query(
    `INSERT INTO core.concept_media(concept_id,asset_id,anchor_sense_id,status,is_primary,reviewed_at,reviewed_by_label) VALUES(1,$1,11,'approved',true,now(),'owner-approved-C')`,
    [a],
  );
  await assert.rejects(
    db.query(
      `INSERT INTO core.concept_media(concept_id,asset_id,anchor_sense_id,status,is_primary,reviewed_at,reviewed_by_label) VALUES(1,$1,11,'approved',true,now(),'owner-approved-C')`,
      [b],
    ),
    (e) => e.code === '23505',
  );
  await assert.rejects(
    db.query(
      `INSERT INTO core.concept_media(concept_id,asset_id,anchor_sense_id,is_primary) VALUES(2,$1,12,true)`,
      [b],
    ),
    (e) => e.code === '23514',
  );
});
test('read view hides draft, low-confidence, nonexact, unverified or removed mapping', async (t) => {
  const db = await setup(t),
    a = await asset(db);
  await db.query(
    `INSERT INTO core.concept_media(concept_id,asset_id,anchor_sense_id,status,is_primary,reviewed_at,reviewed_by_label) VALUES(1,$1,11,'approved',true,now(),'owner-approved-C')`,
    [a],
  );
  const count = async () =>
    Number(
      (await db.query('SELECT count(*) n FROM serve.concept_image')).rows[0].n,
    );
  assert.equal(await count(), 1);
  await db.exec(`UPDATE core.concept SET status='draft' WHERE id=1`);
  assert.equal(await count(), 0);
  await db.exec(
    `UPDATE core.concept SET status='curated' WHERE id=1;UPDATE core.sense_concept SET verified=false WHERE concept_id=1`,
  );
  assert.equal(await count(), 0);
  await db.exec(
    `UPDATE core.sense_concept SET verified=true,relation='broader' WHERE concept_id=1`,
  );
  assert.equal(await count(), 0);
  await db.exec(
    `UPDATE core.sense_concept SET relation='exact',confidence=0.1 WHERE concept_id=1`,
  );
  assert.equal(await count(), 0);
  await db.exec(
    `UPDATE core.sense_concept SET confidence=1 WHERE concept_id=1`,
  );
  assert.equal(await count(), 1);
  await db.exec(`DELETE FROM core.sense_concept WHERE concept_id=1`);
  assert.equal(await count(), 0);
});
test('approved link requires review provenance and existing concept/sense', async (t) => {
  const db = await setup(t),
    a = await asset(db);
  await assert.rejects(
    db.query(
      `INSERT INTO core.concept_media(concept_id,asset_id,anchor_sense_id,status) VALUES(1,$1,11,'approved')`,
      [a],
    ),
    (e) => e.code === '23514',
  );
  await assert.rejects(
    db.query(
      `INSERT INTO core.concept_media(concept_id,asset_id,anchor_sense_id) VALUES(999,$1,11)`,
      [a],
    ),
    (e) => e.code === '23503',
  );
});
