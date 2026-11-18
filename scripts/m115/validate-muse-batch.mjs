/**
 * M11.5: Independent Blind Validator using Muse AI via isolated Chrome CDP tabs on VPS.
 * Supports --follow mode to validate gated_candidates.jsonl concurrently while generation runs.
 */
import { spawn } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';
import {
  appendFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { textKey } from './core-gate.mjs';

async function atomicWriteJson(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const tmp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const fh = await open(tmp, 'wx', 0o600);
  try {
    await fh.writeFile(JSON.stringify(value, null, 2) + '\n');
    await fh.sync();
    await fh.close();
    await rename(tmp, filePath);
  } catch (err) {
    await fh.close().catch(() => {});
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

export function buildBlindValidationPack(candidates, drawIndex = (max) => randomInt(max)) {
  const items = [];
  const metaById = new Map();
  for (const c of candidates) {
    if (c.skill === 'kanji_reading' || c.skill === 'kanji_orthography') {
      const expectedIndex = drawIndex(4);
      const options = [...c.fixedDistractors];
      options.splice(expectedIndex, 0, c.canonicalAnswer);
      items.push({
        id: c.candidateId,
        skill: c.skill,
        lang: c.languageCode ?? (c.languageId === 2 ? 'ja' : 'en'),
        targetMeaning: c.meaning ?? '',
        sentence: `${c.sentenceBefore}【${c.targetSurface}】${c.sentenceAfter}`,
        options,
      });
      metaById.set(c.candidateId, { candidate: c, expectedIndex });
    } else {
      items.push({
        id: c.candidateId,
        skill: c.skill,
        lang: c.languageCode ?? (c.languageId === 2 ? 'ja' : 'en'),
        lemma: c.canonicalAnswer,
        posBucket: c.posBucket,
        targetMeaning: c.meaning ?? '',
        sentence:
          c.skill === 'context_cloze'
            ? `${c.sentenceBefore}【___】${c.sentenceAfter}`
            : `${c.sentenceBefore}【${c.targetSurface}】${c.sentenceAfter}`,
        filledWord: c.canonicalAnswer,
      });
      metaById.set(c.candidateId, { candidate: c, expectedIndex: null });
    }
  }
  return { items, metaById };
}

export function reconcileMuseVerdicts(pack, verdicts) {
  const byId = new Map(
    (Array.isArray(verdicts) ? verdicts : []).map((v) => [String(v?.id ?? ''), v]),
  );
  const approved = [];
  for (const [id, entry] of pack.metaById.entries()) {
    const v = byId.get(id);
    if (!v || v.ok !== true) continue;
    const alt = Array.isArray(v.alt) ? v.alt : [];
    const c = structuredClone(entry.candidate);
    if (entry.expectedIndex !== null) {
      if (alt.length > 0 || Number(v.pick) !== entry.expectedIndex) continue;
    } else {
      if (alt.some((x) => typeof x === 'number')) continue;
      if (c.skill === 'context_cloze') {
        const lemmaKey = textKey(c.canonicalAnswer);
        const merged = new Set(c.excludedWords ?? []);
        const extra = [
          ...(Array.isArray(v.extraExcluded) ? v.extraExcluded : []),
          ...alt.filter((x) => typeof x === 'string'),
        ];
        for (const raw of extra) {
          const k = textKey(raw);
          if (k && k.length <= 64 && k !== lemmaKey) merged.add(k);
        }
        c.excludedWords = [...merged].slice(0, 25);
      }
    }
    c.validatorModel = 'muse-ai';
    approved.push(c);
  }
  return approved;
}

function buildMusePrompt(packItems) {
  return (
    `Linguistic dataset QA check for our bilingual vocabulary app. Do NOT use any tools, web, files, or ask any confirmation questions. Reply IMMEDIATELY with raw JSON only: {"results":[...]}\n` +
    `1. Items with "options" (kanji_reading / kanji_orthography): identify which option index (0..3) fits 【...】 for targetMeaning -> {"id":"...","pick":<0..3>,"alt":[<other valid option indices if ambiguous, else []>],"ok":<true iff sentence is natural, matches targetMeaning, and has 1 unambiguous answer>}.\n` +
    `2. Items with "filledWord" (context_cloze / context_meaning): note that context_cloze is a 4-option multiple-choice question where synonyms in "extraExcluded" are blocked from distractors -> {"id":"...","alt":[],"ok":<true iff sentence is natural, grammatically sound in exact filledWord form, matches targetMeaning, and has clear situational context (reject empty shells like This is ___)>,"extraExcluded":["up to 8 other single words of same POS that could also fit ___"]}.\n` +
    `No markdown fences, no commentary.\nINPUT:\n` +
    JSON.stringify(packItems)
  );
}

const REMOTE_MUSE_DAEMON_MJS = `
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
const require = createRequire("/opt/langoo/services/muse-bridge/upstream/package.json");
const { chromium } = require("playwright-core");

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222", { timeout: 30000 });
const ctx = browser.contexts()[0];
let page = null;
for (const p of ctx.pages()) {
  const n = await p.evaluate(() => window.name).catch(() => "");
  if (n === "m115_validator") { page = p; break; }
}
if (!page) page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page).catch(() => null);
if (cdp) await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  const req = JSON.parse(line);
  try {
    await page.goto("https://muse.ai/thread/new", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.evaluate(() => { window.name = "m115_validator"; }).catch(() => {});
    const ta = page.locator("textarea[placeholder=\\"Message\\"], textarea").first();
    await ta.waitFor({ state: "visible", timeout: 35000 });
    await ta.fill(req.prompt);
    await page.waitForTimeout(250);
    const sendBtn = page.locator("button[aria-label=\\"Send\\"], button[aria-label*=\\"Send\\" i]").first();
    if ((await sendBtn.count()) > 0) await sendBtn.click();
    else await ta.press("Enter");

    const t0 = Date.now();
    let sawTyping = false, lastText = "", stableSince = Date.now();
    while (Date.now() - t0 < 240000) {
      const typing = await page.locator("[data-testid=\\"hatch-chat-typing-indicator\\"], button[aria-label*=\\"Stop\\" i], [data-testid=\\"hatch-composer-stop-button\\"]").count();
      if (typing > 0) sawTyping = true;
      const assistant = page.locator("[data-message-role=\\"assistant\\"]");
      if ((await assistant.count()) > 0) {
        const rawTxt = await assistant.last().innerText().catch(() => "");
        const txt = rawTxt.replace(/^Muse:\\s*/i, "").trim();
        if (txt !== lastText) { lastText = txt; stableSince = Date.now(); }
        if (typing === 0 && txt.includes("{") && txt.endsWith("}") && Date.now() - stableSince > 1600) break;
        if (typing === 0 && txt && Date.now() - stableSince > 5000 && (sawTyping || Date.now() - t0 > 15000)) break;
      }
      const err = page.locator("[data-testid=\\"assistant-response-error-notice\\"]");
      if ((await err.count()) > 0) {
        throw new Error("Muse UI error: " + (await err.first().innerText().catch(() => "unknown")));
      }
      await page.waitForTimeout(500);
    }
    if (!lastText.trim()) throw new Error("Empty Muse reply or timeout");
    process.stdout.write(JSON.stringify({ id: req.id, ok: true, text: lastText.trim() }) + "\\n");
  } catch (err) {
    process.stdout.write(JSON.stringify({ id: req.id, ok: false, error: String(err?.message ?? err) }) + "\\n");
  }
}
`;

function parseMuseJsonReply(raw) {
  let s = String(raw ?? '').trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  const parsed = JSON.parse(s);
  return Array.isArray(parsed?.results) ? parsed.results : [];
}

function restartRemoteMuseBrowser(sshTarget = 'langoo-vps') {
  return new Promise((res) => {
    const child = spawn(
      'ssh',
      ['-o', 'BatchMode=yes', sshTarget, 'systemctl restart muse-browser.service && sleep 4'],
      { stdio: 'ignore' },
    );
    const t = setTimeout(() => {
      child.kill('SIGKILL');
      res();
    }, 95_000);
    child.on('close', () => {
      clearTimeout(t);
      res();
    });
    child.on('error', () => {
      clearTimeout(t);
      res();
    });
  });
}

export function createPersistentMuseClient(sshTarget = 'langoo-vps') {
  let child = null;
  let pending = null;
  let buf = '';
  let reqSeq = 0;

  const destroy = () => {
    if (child) {
      child.kill('SIGKILL');
      child = null;
    }
    buf = '';
  };

  const ensureChild = () => {
    if (child) return;
    const b64 = Buffer.from(REMOTE_MUSE_DAEMON_MJS, 'utf8').toString('base64');
    const remoteCmd = `sudo -u langoo node -e 'import("data:text/javascript;base64,${b64}")'`;
    child = spawn('ssh', ['-o', 'BatchMode=yes', sshTarget, remoteCmd], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line || !pending) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === pending.id) {
            const p = pending;
            pending = null;
            clearTimeout(p.timer);
            if (msg.ok) p.resolve(msg.text);
            else p.reject(new Error(msg.error || 'Muse remote error'));
          }
        } catch {
          // ignore non-JSON stdout noise
        }
      }
    });
    let stderrTail = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c) => {
      stderrTail = (stderrTail + c).slice(-400);
    });
    child.on('close', (code) => {
      child = null;
      if (pending) {
        const p = pending;
        pending = null;
        clearTimeout(p.timer);
        p.reject(new Error(`Muse daemon closed (${code}): ${stderrTail}`));
      }
    });
    child.on('error', (err) => {
      child = null;
      if (pending) {
        const p = pending;
        pending = null;
        clearTimeout(p.timer);
        p.reject(err);
      }
    });
  };

  let queue = Promise.resolve();
  const call = (prompt) => {
    const run = queue.then(async () => {
      ensureChild();
      const id = ++reqSeq;
      const raw = await new Promise((resolveOut, rejectOut) => {
        const timer = setTimeout(() => {
          pending = null;
          destroy();
          rejectOut(new Error('Persistent Muse batch timeout'));
        }, 265_000);
        pending = { id, resolve: resolveOut, reject: rejectOut, timer };
        child.stdin.write(JSON.stringify({ id, prompt }) + '\n');
      });
      return parseMuseJsonReply(raw);
    });
    queue = run.catch(() => {});
    return run;
  };

  return { call, reset: destroy };
}

export async function createNativeMuseClient(sshTarget, concurrency) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new RangeError('Native Muse concurrency must be a positive integer');
  }
  const source = await readFile(new URL('./native-muse-worker.py', import.meta.url));
  const launch = `import base64; exec(compile(base64.b64decode("${source.toString('base64')}"), "native-muse-worker.py", "exec"))`;
  const command = `cd /opt/langoo/services/muse-native && sudo -u langoo ./venv/bin/python -B -c '${launch}' ${concurrency}`;
  const pending = new Map();
  let connection;
  let sequence = 0;

  const connect = () => {
    const child = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ServerAliveInterval=15',
      '-o', 'ServerAliveCountMax=3', sshTarget, command], {
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    connection = child;
    const disconnect = () => {
      if (connection !== child) return;
      connection = undefined;
      child.kill();
      for (const item of pending.values()) {
        clearTimeout(item.timer);
        item.reject(new Error('Native Muse connection closed'));
      }
      pending.clear();
    };
    child.on('error', disconnect);
    child.on('close', disconnect);
    child.stdin.on('error', disconnect);
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      let reply;
      try {
        reply = JSON.parse(line);
      } catch {
        return;
      }
      if (connection !== child) return;
      const item = pending.get(reply?.id);
      if (!item) return;
      clearTimeout(item.timer);
      pending.delete(reply.id);
      if (reply.ok) item.resolve(reply.verdicts);
      else {
        const labels = [reply.error_type, reply.error_status, ...(reply.known_error_labels ?? [])].filter(Boolean);
        item.reject(new Error(`Native Muse: ${labels.join(' ')}`));
      }
    });
    return child;
  };

  return {
    call(prompt, candidateIds) {
      const child = connection ?? connect();
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('Native Muse worker response timeout'));
        }, 270_000);
        pending.set(id, { timer, resolve, reject });
        child.stdin.write(JSON.stringify({ id, prompt, candidateIds }) + '\n');
      });
    },
    reset() {
      connection?.stdin.end();
    },
  };
}

export async function runMuseValidator({
  outDir,
  batchSize = 55,
  concurrency = 1,
  checkpointSubdir = 'hydrogen_out',
  follow = false,
  sshTarget = 'langoo-vps',
  native = false,
  signal,
  invokeMuse = null,
  log = () => {},
}) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1
      || !Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new RangeError('Muse batch size and concurrency must be positive integers');
  }
  const nativeClient = native && !invokeMuse
    ? await createNativeMuseClient(sshTarget, concurrency) : null;
  const persistentClient = native || invokeMuse ? null : createPersistentMuseClient(sshTarget);
  const callModel = invokeMuse ?? (nativeClient
    ? (prompt, _workerId, ids) => nativeClient.call(prompt, ids)
    : (prompt) => persistentClient.call(prompt));
  const museDir = join(outDir, checkpointSubdir);
  const gatedPath = join(outDir, 'gated_candidates.jsonl');
  const approvedPath = join(outDir, 'approved_bank.jsonl');
  const genDonePath = join(outDir, 'generation_done.json');
  await mkdir(museDir, { recursive: true, mode: 0o700 });

  const claimedIds = new Set();
  const initialApprovedLines = [];
  let nextBatchNo = 0;
  let completedBatches = 0;

  for (const file of (await readdir(museDir).catch(() => [])).sort()) {
    if (!/^\d{5}\.json$/.test(file)) continue;
    const saved = JSON.parse(await readFile(join(museDir, file), 'utf8'));
    for (const id of saved.candidateIds ?? []) claimedIds.add(id);
    for (const row of saved.approved ?? []) {
      initialApprovedLines.push(JSON.stringify(row));
    }
    nextBatchNo = Math.max(nextBatchNo, Number(saved.batchNo ?? 0) + 1);
    completedBatches += 1;
  }

  await writeFile(
    approvedPath,
    initialApprovedLines.length > 0 ? initialApprovedLines.join('\n') + '\n' : '',
    { mode: 0o600 },
  );

  let approvedTotal = initialApprovedLines.length;
  let processedTotal = claimedIds.size;

  let appendChain = Promise.resolve();
  const appendApproved = (rows) => {
    if (rows.length === 0) return Promise.resolve();
    const text = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
    appendChain = appendChain.then(() => appendFile(approvedPath, text));
    return appendChain;
  };

  let finalizedCandidates;
  const claimNextChunk = async () => {
    if (signal?.aborted) return null;
    const genDone = await stat(genDonePath).then(() => true).catch(() => false);
    const exists = await stat(gatedPath).then(() => true).catch(() => false);
    if (!exists) return null;
    const allCandidates = finalizedCandidates ?? (await readFile(gatedPath, 'utf8'))
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    if (genDone) finalizedCandidates = allCandidates;

    const unvalidated = allCandidates.filter((c) => !claimedIds.has(c.candidateId));
    if (unvalidated.length === 0 || (follow && !genDone && unvalidated.length < batchSize)) {
      return null;
    }
    const chunk = unvalidated.slice(0, batchSize);
    for (const c of chunk) claimedIds.add(c.candidateId);
    const batchNo = nextBatchNo++;
    return { batchNo, chunk };
  };

  let claimLock = Promise.resolve();
  const safeClaim = () => {
    const next = claimLock.then(() => claimNextChunk());
    claimLock = next.catch(() => {});
    return next;
  };

  const runWorker = async (workerId) => {
    // Slight initial stagger so concurrent SSH/CDP tabs don't hit thread/new on the exact same millisecond
    if (workerId > 1 && !invokeMuse) {
      await new Promise((r) => setTimeout(r, (workerId - 1) * (native ? 1500 : 8000)));
    }
    while (!signal?.aborted) {
      const claimed = await safeClaim();
      if (!claimed) {
        if (signal?.aborted || finalizedCandidates) break;
        const genDone = await stat(genDonePath).then(() => true).catch(() => false);
        const raw = await readFile(gatedPath, 'utf8').catch(() => '');
        const remaining = raw
          .split('\n')
          .filter(Boolean)
          .some((l) => {
            try {
              const o = JSON.parse(l);
              return o && !claimedIds.has(o.candidateId);
            } catch {
              return false;
            }
          });
        if (!follow || (genDone && !remaining)) break;
        await new Promise((r) => setTimeout(r, 6000));
        continue;
      }

      const { batchNo, chunk } = claimed;
      const candidateIds = chunk.map((c) => c.candidateId);
      const pack = buildBlindValidationPack(chunk);
      const prompt = buildMusePrompt(pack.items);
      log(JSON.stringify({ event: 'muse_batch_started', workerId, batchNo, inputCount: chunk.length }));
      let verdicts = null;
      for (let attempt = 1; attempt <= 3 && !signal?.aborted; attempt++) {
        try {
          verdicts = await callModel(prompt, workerId, candidateIds);
          break;
        } catch (err) {
          log(
            JSON.stringify({
              event: 'muse_retry',
              workerId,
              batchNo,
              attempt,
              error: String(err?.message ?? err).slice(0, 200),
            }),
          );
          if (persistentClient) {
            persistentClient.reset();
            if (attempt === 2) await restartRemoteMuseBrowser(sshTarget);
          }
          const rateLimited = native && /429|too many|quota/i.test(String(err?.message));
          if (attempt < 3 && !signal?.aborted) {
            await new Promise((r) => setTimeout(r, rateLimited ? attempt * 30_000 : 5000));
          }
        }
      }

      if (verdicts === null) {
        // Never write approvedCount: 0 on a transport error; release items so they retry cleanly
        for (const c of chunk) claimedIds.delete(c.candidateId);
        log(JSON.stringify({ event: 'muse_transport_backoff', workerId, batchNo }));
        if (!signal?.aborted) await new Promise((r) => setTimeout(r, 15000));
        continue;
      }

      const approved = reconcileMuseVerdicts(pack, verdicts);
      const fileName = `${String(batchNo).padStart(5, '0')}.json`;
      await atomicWriteJson(join(museDir, fileName), {
        batchNo,
        model: 'muse-ai',
        ...(native ? { transport: 'native' } : {}),
        createdAt: new Date().toISOString(),
        candidateIds,
        inputCount: chunk.length,
        approvedCount: approved.length,
        approved,
      });
      await appendApproved(approved);
      approvedTotal += approved.length;
      processedTotal += chunk.length;
      completedBatches += 1;
      log(
        JSON.stringify({
          event: 'muse_batch_done',
          workerId,
          batchNo,
          inputCount: chunk.length,
          approvedCount: approved.length,
          approvedTotal,
          processedTotal,
        }),
      );
    }
  };

  try {
    await Promise.all(
      Array.from({ length: Math.max(1, concurrency) }, (_, idx) => runWorker(idx + 1)),
    );
    await appendChain;
  } finally {
    persistentClient?.reset();
    nativeClient?.reset();
  }

  const summary = {
    updatedAt: new Date().toISOString(),
    validatorModel: 'muse-ai',
    processedCandidates: processedTotal,
    approvedTotal,
    batchesCompleted: completedBatches,
    ...(signal?.aborted ? { stopped: true } : {}),
  };
  await atomicWriteJson(join(outDir, 'validation_status.json'), summary);
  return summary;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const outDir = process.argv[2] ? resolve(process.argv[2]) : resolve('uploads/m11.5-deck-bank');
  const follow = process.argv.includes('--follow');
  const native = process.argv.includes('--native');
  const concArg = process.argv.find((a) => a.startsWith('--concurrency='));
  const batchArg = process.argv.find((a) => a.startsWith('--batch-size='));
  const concurrency = concArg ? Number(concArg.split('=')[1]) : 1;
  const batchSize = batchArg ? Number(batchArg.split('=')[1]) : 55;
  const controller = new AbortController();
  for (const name of ['SIGINT', 'SIGTERM']) process.once(name, () => controller.abort());
  const summary = await runMuseValidator({
    outDir,
    follow,
    concurrency,
    batchSize,
    native,
    signal: controller.signal,
    log: (line) => console.log(line),
  });
  console.log(JSON.stringify({ event: 'validation_finished', ...summary }));
}
