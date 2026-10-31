/** M14.2: bounded Muse -> RAM -> R2 -> PostgreSQL worker. No image files. */
import {
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { loadR2Config } from './images.mjs';
import { registerImages } from './register.mjs';
import { bindExisting } from './bind-existing.mjs';
import {
  normalizeMediaIdentity,
  coveredByLaterRequests,
} from './media-identity.mjs';
import { canRetryLostPlan, submitComposer } from './dispatch-recovery.mjs';
import { hydrateAttachments } from './attachment-recovery.mjs';
import { partitionImageActions } from './inflection-policy.mjs';
import { extraCandidates } from './batch-candidates.mjs';
import {
  digest,
  makePlanPrompt,
  validatePlans,
  makeImagePrompt,
  mediaForItem,
  nextMissing,
  generationRecord,
  existingDeliveryPrompt,
  pendingReceipts,
  validateGeneratedMedia,
} from './batch-policy.mjs';
const run = process.argv[2];
if (!run) throw Error('RUN_DIR_REQUIRED');
const cohort = JSON.parse(readFileSync(resolve(run, 'cohort.json'), 'utf8'));
if (
  cohort.items.length !== 76 ||
  new Set(cohort.items.map((x) => x.sense_id)).size !== 76 ||
  cohort.items.some((x) => !x.candidates.length)
)
  throw Error('COHORT_INVALID');
const statePath = resolve(run, 'state.json');
const state = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, 'utf8'))
  : {
      task: 'M14.2',
      started_at: new Date().toISOString(),
      status: 'running',
      cohort_sha256: digest(JSON.stringify(cohort)),
      items: {},
      requests: {},
      batches: {},
    };
if (state.cohort_sha256 !== digest(JSON.stringify(cohort)))
  throw Error('COHORT_CHANGED');
if (state.status === 'complete') {
  console.log(JSON.stringify({ event: 'already_complete', complete: 76 }));
  process.exit(0);
}
const save = () => {
  writeFileSync(statePath + '.tmp', JSON.stringify(state, null, 2), {
    mode: 0o600,
  });
  renameSync(statePath + '.tmp', statePath);
};
const emit = (event, data = {}) =>
  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      event,
      complete: Object.values(state.items).filter(
        (x) => x.status === 'complete',
      ).length,
      ...data,
    }),
  );
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const app = createRequire('/opt/langoo/app/package.json'),
  env = app('dotenv').parse(readFileSync('/opt/langoo/app/.env')),
  { Client } = app('pg');
const sdk = createRequire(
  resolve('/opt/langoo/services/vocab-images-m142', 'package.json'),
)('@aws-sdk/client-s3');
const { chromium } = createRequire(
  '/opt/langoo/services/muse-bridge/upstream/package.json',
)('playwright-core');
const config = loadR2Config('/run/langoo-m142/r2.env');
if (
  config.bucket !== 'langoo-image' ||
  config.publicBase !== 'https://media.langoo.org'
)
  throw Error('R2_TARGET_INVALID');
const s3 = new sdk.S3Client({
  region: 'auto',
  endpoint: config.endpoint,
  credentials: {
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  },
  maxAttempts: 1,
});
const db = new Client({
  connectionString: env.DIRECT_URL || env.DATABASE_URL,
  application_name: 'langoo-m142-restaurant76',
});
let browser, page;
async function observe(request, minimumRows = 1) {
  if (
    !request.thread_url ||
    new URL(request.thread_url).pathname === '/thread/new'
  )
    throw Error('DISPATCH_UNCERTAIN');
  if (page.url() !== request.thread_url) {
    await page.goto(request.thread_url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
  }
  const started = Date.now();
  let signature = '',
    stable = Date.now(),
    lastProgress = 0;
  while (Date.now() - started < 25 * 60 * 1000) {
    await sleep(2000);
    const url = page.url();
    if (/^https:\/\/muse\.ai\/thread\/[0-9a-f-]+$/i.test(url)) {
      request.thread_url = url;
      save();
    }
    const rows = await page
      .locator('[data-message-item][data-message-role="assistant"]')
      .evaluateAll((els) =>
        els.map((el) => ({
          text: el.innerText,
          media: [...el.querySelectorAll('img[src]')].map((n) => ({
            href: n.currentSrc || n.src,
            label: n.closest('button')?.getAttribute('aria-label') || '',
            width: n.naturalWidth,
            height: n.naturalHeight,
          })),
        })),
      );
    const busy = await page
      .locator('[data-testid="hatch-composer-stop-button"]')
      .count();
    const next = JSON.stringify(rows);
    if (next !== signature) {
      signature = next;
      stable = Date.now();
    }
    if (Date.now() - lastProgress > 20000) {
      emit('muse_wait', {
        kind: request.kind,
        request: request.id,
        elapsed_s: Math.round((Date.now() - started) / 1000),
        busy: !!busy,
        media: rows.reduce((n, r) => n + r.media.length, 0),
      });
      lastProgress = Date.now();
    }
    if (rows.length >= minimumRows && !busy && Date.now() - stable > 16000) {
      request.status = 'observed';
      request.rows = rows;
      request.finished_at = new Date().toISOString();
      save();
      return rows;
    }
  }
  request.status = 'uncertain';
  save();
  throw Error('DISPATCH_UNCERTAIN');
}
async function ensureImageDelivery(request, rows) {
  if (request.kind !== 'generate') return rows;
  const attachmentCount = rows.some((r) =>
    r.media?.some((m) => m.width >= 200 && m.height >= 200),
  )
    ? 0
    : await hydrateAttachments(page);
  emit('attachment_probe', { request: request.id, buttons: attachmentCount });
  if (attachmentCount) {
    rows = await page
      .locator('[data-message-item][data-message-role="assistant"]')
      .evaluateAll((els) =>
        els.map((el) => ({
          text: el.innerText,
          media: [...el.querySelectorAll('img[src]')].map((n) => ({
            href: n.currentSrc || n.src,
            label: n.closest('button')?.getAttribute('aria-label') || '',
            width: n.naturalWidth,
            height: n.naturalHeight,
          })),
        })),
      );
    request.rows = rows;
    save();
  }
  const hasMedia = rows.some((r) =>
    r.media.some((m) => m.width >= 200 && m.height >= 200),
  );
  if (hasMedia) {
    if (request.delivery) {
      request.delivery.status = 'observed';
      save();
    }
    return rows;
  }
  const record = Object.values(state.batches)
    .flatMap((x) => x.generations)
    .find((x) => x.id === request.id);
  if (!record) throw Error('DELIVERY_REQUEST_UNKNOWN');
  await page
    .locator('[data-message-item][data-message-role="user"]')
    .first()
    .waitFor({ state: 'attached', timeout: 60000 });
  let users = await page
    .locator('[data-message-item][data-message-role="user"]')
    .allTextContents();
  if (!users.some((x) => x.includes(request.marker)))
    throw Error('OWNED_THREAD_CHECK_FAILED');
  if (!request.delivery) {
    const marker = 'M142-DELIVER-' + request.id;
    const prompt = `Delivery marker ${marker}. ${existingDeliveryPrompt(record.target_ids)}`;
    const editor = page
      .locator(
        '[data-lexical-editor="true"], textarea[aria-label="Message"], [data-hatch-composer-root] textarea, [data-hatch-composer-root] [contenteditable="true"]',
      )
      .first();
    await editor.waitFor({ state: 'visible', timeout: 60000 });
    request.delivery = {
      marker,
      prompt,
      status: 'intent',
      minimum_rows: rows.length + 1,
      created_at: new Date().toISOString(),
    };
    save();
    await editor.click();
    await page.keyboard.insertText(prompt);
    await submitComposer(page, editor, marker);
    request.delivery.status = 'sent';
    save();
    emit('existing_file_export', { request: request.id });
  } else {
    if (request.delivery.status === 'observed')
      throw Error('DELIVERY_NO_MEDIA');
    users = await page
      .locator('[data-message-item][data-message-role="user"]')
      .allTextContents();
    if (!users.some((x) => x.includes(request.delivery.marker)))
      throw Error('DELIVERY_DISPATCH_UNCERTAIN');
  }
  const delivered = await observe(request, request.delivery.minimum_rows);
  request.delivery.status = 'observed';
  save();
  if (
    !delivered.some((r) =>
      r.media.some((m) => m.width >= 200 && m.height >= 200),
    )
  )
    throw Error('DELIVERY_NO_MEDIA');
  return delivered;
}
async function requestMuse(id, kind, prompt) {
  let request = state.requests[id];
  state.dispatch_recovery ??= {};
  const retries = state.dispatch_recovery[id]?.length || 0;
  if (canRetryLostPlan(request, retries)) {
    state.dispatch_recovery[id] ??= [];
    state.dispatch_recovery[id].push(request);
    delete state.requests[id];
    request = undefined;
    save();
    emit('text_plan_retry', { request: id, attempt: retries + 1 });
  }
  if (request?.status === 'observed') {
    if (kind === 'generate') {
      await page.goto(request.thread_url, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      await page
        .locator('[data-message-item][data-message-role="assistant"]')
        .first()
        .waitFor({ state: 'attached', timeout: 60000 });
      if (request.rows?.some((r) => r.media?.length)) {
        await page
          .locator('button[aria-label^="Open generated image "]')
          .first()
          .waitFor({ state: 'visible', timeout: 60000 });
      }
      await hydrateAttachments(page);
      await sleep(2000);
      request.rows = await page
        .locator('[data-message-item][data-message-role="assistant"]')
        .evaluateAll((els) =>
          els.map((el) => ({
            text: el.innerText,
            media: [...el.querySelectorAll('img[src]')].map((n) => ({
              href: n.currentSrc || n.src,
              label: n.closest('button')?.getAttribute('aria-label') || '',
              width: n.naturalWidth,
              height: n.naturalHeight,
            })),
          })),
        );
      save();
    }
    return ensureImageDelivery(request, request.rows);
  }
  if (request) {
    if (
      !request.thread_url ||
      new URL(request.thread_url).pathname === '/thread/new'
    )
      throw Error('DISPATCH_UNCERTAIN');
    await page.goto(request.thread_url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page.waitForFunction(
      (marker) =>
        [
          ...document.querySelectorAll(
            '[data-message-item][data-message-role="user"]',
          ),
        ].some((el) => el.innerText.includes(marker)),
      request.marker,
      { timeout: 60000 },
    );
    const own = await page
      .locator('[data-message-item][data-message-role="user"]')
      .allTextContents();
    if (!own.some((x) => x.includes(request.marker)))
      throw Error('OWNED_THREAD_CHECK_FAILED');
    return ensureImageDelivery(request, await observe(request));
  }
  await page.goto('https://muse.ai/thread/new', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  const editor = page
    .locator(
      '[data-lexical-editor="true"], textarea[aria-label="Message"], [data-hatch-composer-root] textarea, [data-hatch-composer-root] [contenteditable="true"]',
    )
    .first();
  await editor.waitFor({ state: 'visible', timeout: 60000 });
  if (
    await page.locator('[data-message-item][data-message-role="user"]').count()
  )
    throw Error('NEW_CHAT_NOT_EMPTY');
  const marker = `M142-RESTAURANT76-${id}${retries ? '-dispatch' + retries : ''}`;
  await editor.click();
  await page.keyboard.insertText(`Job marker ${marker}.\n${prompt}`);
  request = {
    id,
    kind,
    marker,
    prompt,
    status: 'intent',
    thread_url: page.url(),
    created_at: new Date().toISOString(),
  };
  state.requests[id] = request;
  save();
  await submitComposer(page, editor, marker);
  request.status = 'sent';
  request.sent_at = new Date().toISOString();
  save();
  emit('muse_dispatched', { kind, request: id });
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    const url = page.url();
    if (/^https:\/\/muse\.ai\/thread\/[0-9a-f-]+$/i.test(url)) {
      request.thread_url = url;
      save();
      return ensureImageDelivery(request, await observe(request));
    }
  }
  throw Error('DISPATCH_UNCERTAIN');
}
async function storeImage(plan, media) {
  const row = state.items[plan.sense_id] || { status: 'planned', plan };
  state.items[plan.sense_id] = row;
  if (row.status === 'complete') return;
  let image = row.receipt;
  if (!image) {
    const received = await page.evaluate(async (url) => {
      const response = await fetch(url, { redirect: 'error' });
      if (!response.ok) throw Error('IMAGE_FETCH_FAILED');
      if (response.headers.get('content-type')?.split(';')[0] !== 'image/png')
        throw Error('IMAGE_MIME_INVALID');
      const blob = await response.blob();
      if (blob.size > 10485760) throw Error('IMAGE_TOO_LARGE');
      const b64 = await new Promise((resolve) => {
        const f = new FileReader();
        f.onload = () => resolve(f.result.split(',')[1]);
        f.readAsDataURL(blob);
      });
      return { b64 };
    }, media.href);
    const data = Buffer.from(received.b64, 'base64');
    if (
      data.length < 24 ||
      data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
    )
      throw Error('IMAGE_FORMAT_INVALID');
    const width = data.readUInt32BE(16),
      height = data.readUInt32BE(20);
    if (width < 256 || height < 256 || width > 2048 || height > 2048)
      throw Error('IMAGE_DIMENSIONS_INVALID');
    const version = plan.prompt_version || 'muse-ordinary-auto-v1';
    const sha256 = digest(data),
      key = `illustrations/${version}/${sha256}.png`;
    image = {
      sense_id: plan.sense_id,
      lemma: plan.lemma,
      file: plan.file,
      sha256,
      key,
      mime: 'image/png',
      bytes: data.length,
      width,
      height,
      prompt: plan.image_prompt,
      prompt_sha256: plan.prompt_sha256,
      prompt_version: version,
      prompt_scope: 'single_image_brief',
      source_definition: plan.source_definition,
      source_definition_sha256: plan.source_definition_sha256,
      state: 'verified',
      s3_verified: true,
      public_verified: true,
    };
    row.status = 'put_intent';
    row.object_key = key;
    row.sha256 = sha256;
    save();
    let exists = true;
    try {
      await s3.send(
        new sdk.HeadObjectCommand({ Bucket: config.bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(30000) },
      );
    } catch (e) {
      if (e.$metadata?.httpStatusCode === 404) exists = false;
      else throw e;
    }
    if (!exists) {
      try {
        await s3.send(
          new sdk.PutObjectCommand({
            Bucket: config.bucket,
            Key: key,
            Body: data,
            ContentType: 'image/png',
            CacheControl: 'public,max-age=31536000,immutable',
            Metadata: { sha256, prompt_version: version },
            IfNoneMatch: '*',
          }),
          { abortSignal: AbortSignal.timeout(30000) },
        );
      } catch (e) {
        if (e.$metadata?.httpStatusCode !== 412) throw e;
      }
    }
    const object = await s3.send(
      new sdk.GetObjectCommand({ Bucket: config.bucket, Key: key }),
      { abortSignal: AbortSignal.timeout(30000) },
    );
    if (
      object.ContentType !== 'image/png' ||
      digest(Buffer.from(await object.Body.transformToByteArray())) !== sha256
    )
      throw Error('R2_HASH_MISMATCH');
    let verified = false;
    for (let n = 0; n < 3; n++) {
      const r = await fetch(`${config.publicBase}/${key}`, {
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      });
      if (
        r.ok &&
        r.headers.get('content-type')?.split(';')[0] === 'image/png' &&
        digest(Buffer.from(await r.arrayBuffer())) === sha256
      ) {
        verified = true;
        break;
      }
      await sleep(2000);
    }
    if (!verified) throw Error('PUBLIC_HASH_MISMATCH');
    row.receipt = image;
    row.status = 'uploaded';
    save();
  }
  const receipt = {
    mode: 'apply',
    bucket: config.bucket,
    public_base: config.publicBase,
    assets: [image],
  };
  const registered = await registerImages(db, receipt, {
    apply: true,
    assetOnly: true,
  });
  const binding = {
    asset_id: registered.assets[0].asset_id,
    source_sense_id: plan.sense_id,
    concept_id: plan.concept_id,
    anchor_sense_id: plan.anchor_sense_id,
    anchor_definition: plan.anchor_definition,
    anchor_definition_sha256: plan.anchor_definition_sha256,
  };
  row.asset_id = binding.asset_id;
  save();
  const result = await bindExisting(db, [binding], { apply: true });
  row.status = 'complete';
  row.binding = result.assets[0];
  row.completed_at = new Date().toISOString();
  save();
  emit('image_registered', {
    sense_id: plan.sense_id,
    lemma: plan.lemma,
    asset_id: row.asset_id,
    concept_id: plan.concept_id,
    bytes: image.bytes,
  });
}
try {
  await db.connect();
  const migrations = (
    await db.query(
      `SELECT name FROM public.schema_migration WHERE name IN('045_concept_images.sql','046_concept_image_default_accept.sql')`,
    )
  ).rows;
  if (migrations.length !== 2) throw Error('IMAGE_SCHEMA_REQUIRED');
  for (const row of pendingReceipts(state.items))
    await storeImage(row.plan, null);
  browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  page = await browser.contexts()[0].newPage();
  state.status = 'running';
  save();
  emit('started', { target: 76 });
  for (let offset = 0; offset < 76; offset += 8) {
    const key = String(offset / 8),
      originalItems = cohort.items.slice(offset, offset + 8);
    state.prepared ??= {};
    if (!state.prepared[key]) {
      const prepared = [];
      for (const item of originalItems) {
        const more = await extraCandidates(db, item);
        const candidates = [...item.candidates];
        for (const c of more)
          if (!candidates.some((x) => x.concept_id === c.concept_id))
            candidates.push(c);
        prepared.push({ ...item, candidates });
      }
      state.prepared[key] = prepared;
      save();
      emit('candidates_ready', { batch: key });
    }
    const { generate: items, deferred } = partitionImageActions(
      state.prepared[key],
    );
    state.deferred = { ...state.deferred, ...deferred };
    save();
    if (!items.length) continue;
    let batch = state.batches[key];
    if (!batch?.plans) {
      const recent = Object.values(state.batches)
        .flatMap((x) => x.plans || [])
        .map((x) => ({
          scene: x.scene,
          camera: x.camera,
          lighting: x.lighting,
        }));
      let plans;
      for (let repair = 0; repair < 3; repair++) {
        const id = 'plan-' + key + (repair ? '-repair' + repair : '');
        const rows = await requestMuse(
          id,
          'plan',
          makePlanPrompt(items, recent) +
            (repair
              ? '\nFORMAT REPAIR: Return only a complete syntactically valid JSON array with exactly one object per source. No prose or extra closing braces.'
              : ''),
        );
        try {
          plans = validatePlans(
            rows
              .map((x) => x.text)
              .join('\n')
              .trim(),
            items,
          );
          break;
        } catch (error) {
          if (!/^PLAN_/.test(error.message) || repair === 2) throw error;
          emit('plan_format_retry', { batch: key, attempt: repair + 1 });
        }
      }
      batch = { plans, generations: [] };
      state.batches[key] = batch;
      save();
      emit('scenes_planned', { batch: key, count: batch.plans.length });
    }
    if (
      batch.plans.every((p) => state.items[p.sense_id]?.status === 'complete')
    )
      continue;
    // The complete request record is persisted before dispatch; uploads reconcile without browser media.
    for (const [recordIndex, record] of batch.generations.entries()) {
      if (
        coveredByLaterRequests(
          record,
          batch.generations
            .slice(recordIndex + 1)
            .filter((r) => state.requests[r.id]),
          state.items,
        )
      )
        continue;
      if (
        record.target_ids.every((id) => state.items[id]?.status === 'complete')
      )
        continue;
      const rows = await requestMuse(record.id, 'generate', record.prompt);
      const targets = batch.plans.filter((p) =>
        record.target_ids.includes(p.sense_id),
      );
      const media = normalizeMediaIdentity(rows, targets);
      validateGeneratedMedia(media, targets);
      for (const plan of targets) {
        const match = mediaForItem(media, plan);
        if (match && state.items[plan.sense_id]?.status !== 'complete')
          await storeImage(plan, match);
      }
    }
    let missing = nextMissing(
      batch.plans.map((x) => x.sense_id),
      state.items,
      'observed',
    );
    for (
      let attempt = batch.generations.length;
      missing.length && attempt < 4;
      attempt++
    ) {
      const plans = batch.plans
        .filter((x) => missing.includes(x.sense_id))
        .slice(0, 8);
      const id = `gen-${key}-${attempt}`;
      const record = generationRecord(plans, id);
      if (!batch.generations.some((x) => x.id === id)) {
        batch.generations.push(record);
        save();
      }
      const rows = await requestMuse(id, 'generate', record.prompt);
      const media = normalizeMediaIdentity(rows, plans);
      validateGeneratedMedia(media, plans);
      let found = 0;
      for (const plan of plans) {
        const match = mediaForItem(media, plan);
        if (match) {
          await storeImage(plan, match);
          found++;
        }
      }
      if (!found) throw Error('NO_CONFIRMED_IMAGE_OUTPUT');
      missing = nextMissing(
        batch.plans.map((x) => x.sense_id),
        state.items,
        state.requests[id].status,
      );
    }
    if (missing.length) throw Error('PARTIAL_DELIVERY_LIMIT');
  }
  state.status = Object.keys(state.deferred || {}).length
    ? 'needs_resolution'
    : 'complete';
  state.finished_at = new Date().toISOString();
  save();
  emit(state.status, {
    target: 76,
    deferred: state.deferred,
    quota: 'unavailable',
  });
  // Ephemeral credentials belong only to this run, and are not retained after success.
  if (state.status === 'complete') unlinkSync('/run/langoo-m142/r2.env');
} catch (e) {
  state.status = 'needs_attention';
  state.error = {
    code: /^[A-Z0-9_]+$/.test(e.message || '') ? e.message : e.name,
    sqlstate: /^[A-Z0-9]{5}$/.test(e.code || '') ? e.code : undefined,
  };
  save();
  emit('stopped', {
    ...state.error,
    diagnostic: String(e.message || '')
      .replace(/https?:\/\/[^\s]+/g, '[URL]')
      .slice(0, 700),
  });
  process.exitCode = 1;
} finally {
  if (page) await page.close().catch(() => {});
  await browser?.close();
  s3.destroy();
  await db.end().catch(() => {});
}
