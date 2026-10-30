import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateReceipt } from './register.mjs';
const hash = (s) => createHash('sha256').update(s).digest('hex');
test('accepts actual legacy batch provenance and rejects cross-profile keys', () => {
  for (const version of ['muse-illustration-pilot-v1', 'muse-mixed-pilot-v1']) {
    const sha = 'a'.repeat(64),
      prompt = 'long original batch prompt '.repeat(600),
      definition = 'A source definition.';
    const image = {
      sense_id: '1',
      sha256: sha,
      key: `illustrations/${version}/${sha}.png`,
      mime: 'image/png',
      bytes: 100,
      width: 512,
      height: 512,
      state: 'verified',
      s3_verified: true,
      public_verified: true,
      prompt,
      prompt_scope: 'batch_brief',
      prompt_sha256: hash(prompt),
      prompt_version: version,
      source_definition: definition,
      source_definition_sha256: hash(definition),
    };
    const input = {
      mode: 'apply',
      bucket: 'langoo-image',
      public_base: 'https://media.langoo.org',
      assets: [image],
    };
    assert.doesNotThrow(() => validateReceipt(input));
    image.key = `illustrations/muse-phone-c-v1/${sha}.png`;
    assert.throws(() => validateReceipt(input), /RECEIPT_IMAGE_INVALID/);
  }
});
