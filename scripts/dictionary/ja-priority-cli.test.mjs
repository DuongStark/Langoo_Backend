import test from 'node:test';
import assert from 'node:assert/strict';
import { validateArtifact } from './ja-priority-cli.mjs';
const artifact = () => ({
  schema_version: 1,
  policy: 'ja-bccwj-v1',
  source_code: 'bccwj-suw',
  source_version: '1.0',
  source_sha256: 'a'.repeat(64),
  target_identity: 'test:db:jmdict-3.6.2',
  summary: {},
  lexemes: [
    {
      lexeme_id: '1',
      semantic_key: 'jmdict:123',
      input_hash: 'b'.repeat(32),
      corpus_rank: 8,
      corpus_count: 100,
      evidence: [{ rank: 8 }],
    },
  ],
  senses: [],
});
test('accepts target-bound lexical metadata contract', () =>
  assert.doesNotThrow(() => validateArtifact(artifact())));
test('rejects repeated identities and invalid corpus counts', () => {
  const data = artifact();
  data.lexemes.push(data.lexemes[0]);
  assert.throws(() => validateArtifact(data));
  data.lexemes.pop();
  data.lexemes[0].corpus_count = -1;
  assert.throws(() => validateArtifact(data));
});
test('rejects guessed numeric/foreign semantic keys', () => {
  const data = artifact();
  data.lexemes[0].semantic_key = 'wordnet:123';
  assert.throws(() => validateArtifact(data));
});
test('rejects conflicting display orders', () => {
  const data = artifact();
  const row = {
    sense_id: '1',
    lexeme_id: '1',
    semantic_key: 'jmdict:123:1',
    input_hash: 'c'.repeat(32),
    display_order: 1,
    reason: 'basic',
    reviewer_kind: 'llm',
  };
  data.senses = [row, { ...row, sense_id: '2', semantic_key: 'jmdict:123:2' }];
  assert.throws(() => validateArtifact(data));
});
