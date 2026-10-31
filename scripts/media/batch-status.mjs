/** M14.2 metadata-only status; never returns image bytes, auth or thread URLs. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const dir =
  process.argv[2] ||
  '/opt/langoo/storage/vocab-images/m142-restaurant-20261030';
const cohort = JSON.parse(readFileSync(resolve(dir, 'cohort.json')));
const state = JSON.parse(readFileSync(resolve(dir, 'state.json')));
const done = Object.values(state.items).filter((x) => x.status === 'complete');
console.log(
  JSON.stringify(
    {
      task: 'M14.2',
      status: state.status,
      target: cohort.items.length,
      complete: done.length,
      bytes: done.reduce((n, x) => n + x.receipt.bytes, 0),
      started_at: state.started_at,
      finished_at: state.finished_at,
      generation_requests: Object.values(state.requests).filter(
        (x) => x.kind === 'generate',
      ).length,
      planning_requests: Object.values(state.requests).filter(
        (x) => x.kind === 'plan',
      ).length,
      error: state.status === 'needs_attention' ? state.error : undefined,
      missing: cohort.items
        .filter((x) => state.items[x.sense_id]?.status !== 'complete')
        .map((x) => ({ sense_id: x.sense_id, lemma: x.lemma })),
      deferred: state.deferred || {},
      quota: 'unavailable',
    },
    null,
    2,
  ),
);
