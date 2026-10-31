import test from 'node:test';
import assert from 'node:assert/strict';
import { canRetryLostPlan } from './dispatch-recovery.mjs';
test('lost text plan can retry within a bounded budget', () => {
  assert.equal(
    canRetryLostPlan({
      kind: 'plan',
      status: 'sent',
      thread_url: 'https://muse.ai/thread/new',
    }),
    true,
  );
  assert.equal(canRetryLostPlan({ kind: 'plan', status: 'sent' }, 2), false);
});
test('never retry lost image generation or a known planning thread', () => {
  assert.equal(canRetryLostPlan({ kind: 'generate', status: 'sent' }), false);
  assert.equal(
    canRetryLostPlan({
      kind: 'plan',
      status: 'sent',
      thread_url: 'https://muse.ai/thread/abc',
    }),
    false,
  );
  assert.equal(canRetryLostPlan({ kind: 'plan', status: 'observed' }), false);
});

test('falls back to send button only when marker remains in composer', async () => {
  const { submitComposer } = await import('./dispatch-recovery.mjs');
  const actions = [];
  const page = {
    waitForTimeout: async () => {},
    keyboard: { press: async (key) => actions.push(key) },
    locator: (selector) =>
      selector.includes('message-item')
        ? { allTextContents: async () => [] }
        : selector.includes('stop-button')
          ? { count: async () => 0 }
          : {
              last: () => ({
                count: async () => 1,
                isEnabled: async () => true,
                click: async () => actions.push('send'),
              }),
            },
  };
  await submitComposer(
    page,
    { evaluate: async () => 'Job marker TEST' },
    'TEST',
  );
  assert.deepEqual(actions, ['Enter', 'send']);
});
test('does not click again after Muse acknowledges marker', async () => {
  const { submitComposer } = await import('./dispatch-recovery.mjs');
  const actions = [];
  const page = {
    waitForTimeout: async () => {},
    keyboard: { press: async (key) => actions.push(key) },
    locator: () => ({ allTextContents: async () => ['Job marker TEST'] }),
  };
  await submitComposer(page, {}, 'TEST');
  assert.deepEqual(actions, ['Enter']);
});
