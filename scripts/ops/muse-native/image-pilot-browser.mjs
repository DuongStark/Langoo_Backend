/** DOCS3: authorized throwaway web image pilots; run on VPS, stream files to local. */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const require = createRequire(
  '/opt/langoo/services/muse-bridge/upstream/package.json',
);
const { chromium } = require('playwright-core');
const { driver } =
  await import('/opt/langoo/services/muse-bridge/upstream/muse-driver.mjs');
const cohort = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const stateFile = process.argv[3];
if (
  cohort.length < 1 ||
  cohort.length > 20 ||
  (!process.argv[4] && cohort.length !== 20) ||
  new Set(
    cohort.map((x) =>
      process.argv[4] ? x.sample_id || x.sense_id : x.sense_id,
    ),
  ).size !== cohort.length
)
  throw Error('Invalid cohort');
if (!stateFile || existsSync(stateFile))
  throw Error('Fresh checkpoint required; do not resend');
const emit = (type, value) =>
  process.stdout.write(JSON.stringify({ type, ...value }) + '\n');
const save = (value) =>
  writeFileSync(stateFile, JSON.stringify(value), { mode: 0o600 });
const marker = process.argv[5] || 'DOCS3-IMAGES-20261030';
if (!/^DOCS3-IMAGES-[A-Z0-9-]+$/.test(marker))
  throw Error('Invalid job marker');
const prompt = process.argv[4]
  ? readFileSync(process.argv[4], 'utf8')
  : `Please EXECUTE this authorized image-generation pilot now; do not just explain it.
Job ${marker}. Create exactly 20 separate ORIGINAL raster illustrations, ONE per vocabulary sense in DATA.
Use your built-in image generation tool on this Muse account. No paid external services, API purchases,
stock-image search, scraping, SVG/drawing/code substitutes, or collage/contact sheet as a replacement.
Use a consistent clean colorful educational illustration style, plain light background, square composition,
clear subject/action, no captions/text/logos/brands/watermarks. Illustrate the DEFINITION supplied, not a different meaning.
Use the smallest practical image size suitable for a 512px flashcard. Exactly one generation per sense,
no rerolls or extra variations; hard cap 20 generated images in this pilot. Process sequentially if possible.
Save each image as its lemma (e.g. restaurant.png) in one dedicated folder for this job; deliver all 20
downloadable files and optionally one zip. Do not publish, send messages, change account settings, or install anything.
If unable to use real image generation, report that clearly and stop; do not make fake placeholders.
On completion give a short list of filenames with their sense IDs. No need to estimate token usage.
DATA:\n${JSON.stringify(cohort.map(({ lemma, sense_id, definition, gloss_vi }) => ({ lemma, sense_id, definition, gloss_vi })))}`;
if (
  !prompt.includes(marker) ||
  !cohort.every((row) => prompt.includes(row.sense_id))
)
  throw Error('Prompt does not match job/cohort');
let browser;
const start = performance.now();
const state = {
  marker,
  status: 'preparing',
  started_at: new Date().toISOString(),
  prompt,
  planned_images: cohort.length,
};
try {
  browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser
    .contexts()[0]
    .pages()
    .find((p) => p.url().startsWith('https://muse.ai/'));
  if (!page) throw Error('No Muse page');
  await page.keyboard.press('Escape');
  driver.browser = browser;
  driver.ctx = browser.contexts()[0];
  driver.page = page;
  await page.goto('https://muse.ai/thread/new', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await driver.waitForComposer();
  if (!new URL(page.url()).pathname.startsWith('/thread/'))
    throw Error('Not a side-chat');
  if (
    await page.locator('[data-message-item][data-message-role="user"]').count()
  )
    throw Error('New chat not empty');
  const editor = page
    .locator(
      '[data-lexical-editor="true"], textarea[aria-label="Message"], [data-hatch-composer-root] textarea, [data-hatch-composer-root] [contenteditable="true"]',
    )
    .first();
  await editor.click();
  await page.keyboard.insertText(prompt);
  state.status = 'dispatch_intent';
  state.thread_url = page.url();
  save(state);
  emit('dispatch', {
    started_at: state.started_at,
    prompt,
    planned_images: cohort.length,
  });
  const sent = performance.now();
  await page.keyboard.press('Enter');
  state.sent_at = new Date().toISOString();
  state.status = 'sent';
  save(state);
  let lastSignature = '',
    stableSince = performance.now(),
    lastProgress = 0;
  let messages = [];
  while (performance.now() - sent < 30 * 60 * 1000) {
    await page.waitForTimeout(2000);
    const rows = await page
      .locator('[data-message-item][data-message-role="assistant"]')
      .evaluateAll((els) =>
        els.map((el) => ({
          text: el.innerText,
          media: [...el.querySelectorAll('a[href],img[src]')].map((n) => ({
            tag: n.tagName,
            href: n.href || n.currentSrc || n.src,
            alt: n.alt || '',
            label: n.closest('button')?.getAttribute('aria-label') || '',
            width: n.naturalWidth || 0,
            height: n.naturalHeight || 0,
          })),
        })),
      );
    messages = rows;
    const stop = await page
      .locator('[data-testid="hatch-composer-stop-button"]')
      .count();
    const signature = JSON.stringify(rows);
    if (signature !== lastSignature) {
      lastSignature = signature;
      stableSince = performance.now();
    }
    if (performance.now() - lastProgress > 15000) {
      emit('progress', {
        elapsed_seconds: Math.round((performance.now() - sent) / 1000),
        assistant_messages: rows.length,
        media_elements: rows.reduce((s, x) => s + x.media.length, 0),
        busy: !!stop,
        text_tail: rows.at(-1)?.text.slice(-500),
      });
      lastProgress = performance.now();
    }
    if (rows.length && !stop && performance.now() - stableSince > 12000) break;
  }
  state.status = 'observed';
  state.thread_url = page.url();
  state.finished_at = new Date().toISOString();
  state.elapsed_seconds = (performance.now() - sent) / 1000;
  state.messages = messages;
  save(state);
  emit('result', { elapsed_seconds: state.elapsed_seconds, messages });
  const unique = new Map();
  for (const row of messages)
    for (const media of row.media) {
      if (!media.href || !/^(https:\/\/|blob:)/.test(media.href)) continue;
      if (media.tag === 'IMG' && (media.width < 200 || media.height < 200))
        continue;
      const u = new URL(media.href);
      if (
        media.tag === 'A' &&
        !/\.(png|jpe?g|webp|zip)(?:$|\?)/i.test(u.pathname) &&
        !/\/fs\/|\/files\/|\/artifacts\//.test(u.pathname)
      )
        continue;
      if (
        u.protocol === 'https:' &&
        !['muse.ai', 'metaaivm.com', 'fbcdn.net'].some(
          (h) => u.hostname === h || u.hostname.endsWith('.' + h),
        )
      )
        continue;
      unique.set(media.href, media);
    }
  let count = 0;
  for (const media of unique.values()) {
    if (count >= 24) break;
    const data = await page.evaluate(async (url) => {
      const r = await fetch(url);
      if (!r.ok) return { ok: false, status: r.status };
      const mime = r.headers.get('content-type') || '';
      if (!/image\/(png|jpeg|webp)|application\/(zip|octet-stream)/.test(mime))
        return { ok: false, status: 'mime', mime };
      const blob = await r.blob();
      if (blob.size > 60 * 1024 * 1024) return { ok: false, status: 'size' };
      const b64 = await new Promise((resolve) => {
        const f = new FileReader();
        f.onload = () => resolve(f.result.split(',')[1]);
        f.readAsDataURL(blob);
      });
      return { ok: true, mime, bytes: blob.size, b64 };
    }, media.href);
    if (data.ok) {
      const sha256 = createHash('sha256')
        .update(Buffer.from(data.b64, 'base64'))
        .digest('hex');
      emit('file', {
        index: ++count,
        alt: media.alt,
        label: media.label,
        name_hint: new URL(media.href).pathname.split('/').at(-1),
        sha256,
        ...data,
      });
    } else emit('download_error', { status: data.status, mime: data.mime });
  }
  emit('done', {
    downloaded_objects: count,
    total_seconds: (performance.now() - start) / 1000,
  });
} catch (e) {
  state.status = 'error';
  state.error_type = e.name;
  save(state);
  emit('error', {
    error_type: e.name,
    stage: state.sent_at ? 'after_dispatch_do_not_retry' : 'before_dispatch',
  });
  process.exitCode = 1;
} finally {
  await browser?.close();
}
