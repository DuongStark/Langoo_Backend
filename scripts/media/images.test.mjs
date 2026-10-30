import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { loadR2Config, loadImages, mappingDecision } from './images.mjs';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);
const hash = createHash('sha256').update(png).digest('hex');
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'm141-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'word-C.png'), png);
  const row = {
    variant: 'C',
    file: 'word-C.png',
    sense_id: '123',
    lemma: 'word',
    definition: 'source definition',
    sha256: hash,
    image_prompt: 'An ordinary phone picture.',
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify([row]));
  return { dir, row };
}
test('rejects group-readable credentials before using them', (t) => {
  const { dir } = fixture(t),
    path = join(dir, 'r2.env');
  writeFileSync(path, 'R2_ACCOUNT_ID=x');
  chmodSync(path, 0o644);
  assert.throws(() => loadR2Config(path), /CONFIG_NOT_PRIVATE/);
});
test('rejects credentials embedded in the public URL', (t) => {
  const { dir } = fixture(t),
    path = join(dir, 'r2.env');
  writeFileSync(
    path,
    `R2_ACCOUNT_ID=${'a'.repeat(32)}\nR2_BUCKET=langoo-image\nR2_ACCESS_KEY_ID=fake\nR2_SECRET_ACCESS_KEY=fake\nR2_PUBLIC_BASE_URL=https://secret@example.com\n`,
    { mode: 0o600 },
  );
  assert.throws(() => loadR2Config(path), /PUBLIC_URL_INVALID/);
});
test('rejects path traversal and tampered image bytes', (t) => {
  const { dir, row } = fixture(t);
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify([{ ...row, file: '../word-C.png' }]),
  );
  assert.throws(
    () => loadImages(join(dir, 'manifest.json')),
    /IMAGE_PATH_INVALID/,
  );
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify([row]));
  writeFileSync(join(dir, row.file), Buffer.from('tampered'));
  assert.throws(
    () => loadImages(join(dir, 'manifest.json')),
    /IMAGE_HASH_MISMATCH/,
  );
});
test('selects C only and derives immutable object key from actual bytes', (t) => {
  const { dir, row } = fixture(t);
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify([{ ...row, variant: 'B' }, row]),
  );
  const result = loadImages(join(dir, 'manifest.json'));
  assert.equal(result.length, 1);
  assert.equal(result[0].key, `illustrations/muse-phone-c-v1/${hash}.png`);
  assert.equal(result[0].width, 1);
});
test('does not infer a concept for absent, uncertain or ambiguous mappings', () => {
  assert.equal(mappingDecision([]).state, 'missing_mapping');
  const link = {
    concept_id: '9',
    status: 'curated',
    relation: 'exact',
    verified: true,
    confidence: 1,
  };
  assert.equal(
    mappingDecision([{ ...link, verified: false }]).state,
    'unverified_mapping',
  );
  assert.equal(
    mappingDecision([link, { ...link, concept_id: '10' }]).state,
    'ambiguous_mapping',
  );
  assert.equal(
    mappingDecision([{ ...link, status: 'draft' }]).state,
    'pending',
  );
  assert.deepEqual(mappingDecision([link]), {
    state: 'approved',
    concept_id: '9',
  });
});
test('explicit pilot profiles preserve the original batch prompt and source IDs', (t) => {
  const { dir, row } = fixture(t);
  writeFileSync(join(dir, 'word.png'), png);
  writeFileSync(join(dir, 'prompt.txt'), 'Original full batch brief.');
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify([
      { ...row, variant: undefined, file: 'word.png', image_prompt: undefined },
    ]),
  );
  assert.throws(
    () => loadImages(join(dir, 'manifest.json')),
    /MANIFEST_DUPLICATE_OR_EMPTY/,
  );
  for (const [profile, version] of [
    ['pilot1', 'muse-illustration-pilot-v1'],
    ['pilot2', 'muse-mixed-pilot-v1'],
  ]) {
    const [image] = loadImages(join(dir, 'manifest.json'), { profile });
    assert.equal(image.prompt, 'Original full batch brief.');
    assert.equal(image.prompt_scope, 'batch_brief');
    assert.equal(image.prompt_version, version);
    assert.equal(image.sense_id, '123');
    assert.equal(image.key, `illustrations/${version}/${hash}.png`);
  }
  assert.throws(
    () => loadImages(join(dir, 'manifest.json'), { profile: 'unknown' }),
    /PROFILE_INVALID/,
  );
});
