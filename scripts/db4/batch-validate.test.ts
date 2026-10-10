import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BatchEvent } from './_batch-types';
import { assertLedgerEventPhaseBindings } from './batch-validate';

const jobKey = 'a'.repeat(64);
const phases = new Map([[jobKey, 'r1' as const]]);

function event(
  type: BatchEvent['type'],
  details: BatchEvent['details'],
): Pick<BatchEvent, 'jobKey' | 'type' | 'details'> {
  return { jobKey, type, details };
}

void test('legacy dispatch acknowledgement without phase remains valid', () => {
  assert.doesNotThrow(() =>
    assertLedgerEventPhaseBindings(
      [event('dispatch_acknowledged', { acknowledged: true })],
      phases,
    ),
  );
});

void test('explicit acknowledgement phase must match its scheduled job', () => {
  assert.doesNotThrow(() =>
    assertLedgerEventPhaseBindings(
      [event('dispatch_acknowledged', { phase: 'r1', acknowledged: true })],
      phases,
    ),
  );
  assert.throws(
    () =>
      assertLedgerEventPhaseBindings(
        [event('dispatch_acknowledged', { phase: 'r2', acknowledged: true })],
        phases,
      ),
    /phase mismatch/,
  );
});

void test('other lifecycle events still require a matching phase', () => {
  assert.throws(
    () =>
      assertLedgerEventPhaseBindings(
        [event('job_planned', { generation: 1, attempt: 1 })],
        phases,
      ),
    /phase mismatch/,
  );
});
