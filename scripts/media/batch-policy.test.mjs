import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePlans,
  makePlanPrompt,
  makeImagePrompt,
  mediaForItem,
  nextMissing,
  inflectionBase,
  generationRecord,
  existingDeliveryPrompt,
  pendingReceipts,
  validateGeneratedMedia,
} from './batch-policy.mjs';
const items = [
  {
    sense_id: '12',
    lemma: 'grill',
    pos: 'noun',
    definition: 'A cooking device.',
    definition_sha256: 'x',
    candidates: [
      {
        concept_id: '3',
        anchor_sense_id: '4',
        definition: 'A rack for outdoor cooking.',
      },
    ],
  },
];
const plan = [
  {
    sense_id: '12',
    concept_id: '3',
    anchor_sense_id: '4',
    scene: 'A small charcoal grill being used in a garden.',
    lighting: 'Overcast daylight.',
    camera: 'Standing eye-level view.',
  },
];
test('scene plans preserve exact source identity and restrict concept/anchor IDs', () => {
  const [p] = validatePlans(JSON.stringify(plan), items);
  assert.equal(p.sense_id, '12');
  assert.match(p.image_prompt, /A cooking device/);
  for (const change of [
    { sense_id: '99' },
    { concept_id: '99' },
    { anchor_sense_id: '99' },
  ])
    assert.throws(
      () => validatePlans(JSON.stringify([{ ...plan[0], ...change }]), items),
      /PLAN_/,
    );
  assert.throws(
    () => validatePlans(JSON.stringify([...plan, ...plan]), items),
    /PLAN_/,
  );
});
test('universal prompts use supplied meanings and never ask for the common meaning', () => {
  assert.match(makePlanPrompt(items, []), /Do not generate images/);
  assert.match(makePlanPrompt(items, []), /A cooking device/);
  const p = validatePlans(JSON.stringify(plan), items)[0];
  assert.match(makeImagePrompt([p], 'JOB-1'), /m142-12.png/);
  assert.match(p.image_prompt, /ordinary/);
  assert.doesNotMatch(p.image_prompt, /older phone|cinematic portrait/);
});
test('media matching requires exact job filenames and approved origins', () => {
  const p = validatePlans(JSON.stringify(plan), items)[0];
  const media = [
    {
      label: 'Open generated image m142-12.png',
      href: 'blob:https://muse.ai/abc',
      width: 512,
      height: 512,
    },
  ];
  assert.equal(mediaForItem(media, p).href, media[0].href);
  for (const href of [
    'file:///etc/passwd',
    'http://127.0.0.1/x',
    'https://evil.example/image.png',
    'blob:https://evil.example/x',
  ])
    assert.throws(() => mediaForItem([{ ...media[0], href }], p), /MEDIA_/);
  assert.equal(
    mediaForItem(
      [{ ...media[0], label: 'Open generated image m142-99.png' }],
      p,
    ),
    null,
  );
});
test('completed or uncertain generations cannot be blindly resubmitted', () => {
  assert.deepEqual(
    nextMissing(['12', '13'], { 12: { status: 'complete' } }, 'observed'),
    ['13'],
  );
  assert.throws(() => nextMissing(['12'], {}, 'sent'), /DISPATCH_UNCERTAIN/);
  assert.throws(() => nextMissing(['12'], {}, 'intent'), /DISPATCH_UNCERTAIN/);
});

test('inflected forms resolve to a base lemma without per-word prompt rules', () => {
  assert.equal(
    inflectionBase('simple past and past participle of cook'),
    'cook',
  );
  assert.equal(inflectionBase('An evening meal.'), null);
});
test('resume has the original generation prompt before any dispatch intent exists', () => {
  const plans = validatePlans(JSON.stringify(plan), items),
    record = generationRecord(plans, 'gen-1');
  assert.deepEqual(record.target_ids, ['12']);
  assert.match(record.prompt, /m142-12.png/);
  const requests = {};
  assert.equal(requests[record.id], undefined);
  assert.equal(record.prompt, makeImagePrompt(plans, record.id));
});
test('verified uploads reconcile independently of media, and pending uploads block regeneration', () => {
  const states = {
    12: {
      status: 'uploaded',
      plan: { sense_id: '12' },
      receipt: { key: 'already-uploaded' },
    },
  };
  assert.equal(pendingReceipts(states).length, 1);
  assert.throws(
    () => nextMissing(['12'], states, 'observed'),
    /ITEM_RECONCILE_REQUIRED/,
  );
  states['12'].status = 'complete';
  assert.deepEqual(nextMissing(['12'], states, 'observed'), []);
});
test('unknown filenames stay blocked on replay using original request targets', () => {
  const p = validatePlans(JSON.stringify(plan), items)[0];
  const media = [
    {
      label: 'Open generated image wrong.png',
      href: 'blob:https://muse.ai/x',
      width: 512,
      height: 512,
    },
  ];
  assert.throws(
    () => validateGeneratedMedia(media, [p]),
    /UNATTRIBUTED_GENERATED_MEDIA/,
  );
  assert.throws(
    () => validateGeneratedMedia(media, [p]),
    /UNATTRIBUTED_GENERATED_MEDIA/,
  );
});
test('harmless extra closing delimiters are repaired without changing JSON values', () => {
  const broken = JSON.stringify(plan).slice(0, -1) + '}]';
  const [p] = validatePlans(broken, items);
  assert.equal(p.concept_id, '3');
  assert.equal(p.scene, plan[0].scene);
});
test('Muse numeric image labels may omit only the .png extension', () => {
  const p = validatePlans(JSON.stringify(plan), items)[0],
    media = [
      {
        label: 'Open generated image m142-12',
        href: 'blob:https://muse.ai/x',
        width: 512,
        height: 512,
      },
    ];
  assert.equal(mediaForItem(media, p)?.label, media[0].label);
  assert.doesNotThrow(() => validateGeneratedMedia(media, [p]));
  assert.equal(
    mediaForItem([{ ...media[0], label: 'Open generated image m142-123' }], p),
    null,
  );
});
test('zero-image observed replies remain blocked on replay instead of resending', () => {
  const p = validatePlans(JSON.stringify(plan), items)[0];
  assert.throws(
    () => validateGeneratedMedia([], [p]),
    /NO_CONFIRMED_IMAGE_OUTPUT/,
  );
});
test('delivery recovery requests existing attachments only, never a new generation', () => {
  const prompt = existingDeliveryPrompt(['12', '13']);
  assert.match(prompt, /Do NOT create, generate, edit, reroll/);
  assert.match(prompt, /m142-12.png/);
  assert.match(prompt, /m142-13.png/);
  assert.throws(
    () => existingDeliveryPrompt(['../private']),
    /DELIVERY_IDS_INVALID/,
  );
});
