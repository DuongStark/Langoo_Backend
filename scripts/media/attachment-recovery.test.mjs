import test from 'node:test';
import assert from 'node:assert/strict';
import { hydrateAttachments } from './attachment-recovery.mjs';
test('loads lazy existing thumbnails before observing and does not send messages', async () => {
  const calls = [];
  const page = {
    locator: () => ({
      count: async () => 2,
      nth: (i) => ({
        scrollIntoViewIfNeeded: async () => calls.push(`scroll${i}`),
        locator: () => ({
          first: () => ({ waitFor: async () => calls.push(`attach${i}`) }),
        }),
      }),
    }),
    waitForFunction: async () => calls.push('loaded'),
  };
  assert.equal(await hydrateAttachments(page), 2);
  assert.deepEqual(calls, [
    'scroll0',
    'attach0',
    'scroll1',
    'attach1',
    'loaded',
  ]);
});
test('no generated attachments does not wait indefinitely', async () => {
  assert.equal(
    await hydrateAttachments({ locator: () => ({ count: async () => 0 }) }),
    0,
  );
});
