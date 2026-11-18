/**
 * M11.5: Multi-worker parallel Blind Validator using Gemini 4 Hydrogen via agy CLI.
 * Runs concurrently alongside Claude Sonnet 4.6 generation (--follow mode),
 * using separate 5h quota pools (Anthropic pool generates -> Gemini pool blind-checks).
 */
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
import { pathToFileURL } from 'node:url';
import { textKey } from './core-gate.mjs';
import { callAgyCli } from './generate-agy-batch.mjs';
import { buildBlindValidationPack } from './validate-muse-batch.mjs';

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

function isQuotaError(err) {
  const msg = String(err?.message ?? '');
  return (
    err?.code === 'QUOTA' ||
    /quota|resource_exhausted|rate.limit|\b429\b|too many requests|usage limit/i.test(msg)
  );
}

export function extractVerdictArray(raw) {
  const trimmed = String(raw ?? '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const sObj = trimmed.indexOf('{');
  const eObj = trimmed.lastIndexOf('}');
  if (sObj !== -1 && eObj > sObj) {
    const parsed = JSON.parse(trimmed.slice(sObj, eObj + 1));
    if (Array.isArray(parsed.results)) return parsed.results;
  }
  const sArr = trimmed.indexOf('[');
  const eArr = trimmed.lastIndexOf(']');
  if (sArr !== -1 && eArr > sArr) {
    return JSON.parse(trimmed.slice(sArr, eArr + 1));
  }
  throw new Error('validator output is not valid JSON');
}

export function buildValidatorPrompt(packItems) {
  return (
    `Independent blind quiz validator. Do NOT use any tools, files, terminal, or web. Reply ONLY with compact JSON: {"results":[...]}\n` +
    `1. Items with "options" (kanji_reading / kanji_orthography): solve blindly without knowing the answer -> {"id":"...","pick":<0..3>,"alt":[<other valid option indices if >=2 options are valid, else []>],"ok":<true iff sentence is natural, matches targetMeaning, and has a single unambiguous correct option>}.\n` +
    `2. Items with "filledWord" (context_cloze / context_meaning): note that context_cloze is presented as a 4-option multiple-choice question where any synonym listed in "extraExcluded" is automatically blocked from the 3 distractors! Therefore set "ok": true whenever the sentence is natural, grammatically sound with filledWord in its exact given form, matches targetMeaning, and has clear situational context (ONLY set "ok": false for generic empty shells like "This is ___" / "これは___です", wrong sense, conjugation mismatch, or unnatural phrasing). Return -> {"id":"...","alt":[],"ok":<boolean>,"extraExcluded":["up to 8 other single words of same POS that could also fit ___"]}.\n` +
    `Output raw JSON only, no markdown fences.\n\nINPUT:\n` +
    JSON.stringify(packItems)
  );
}

export function reconcileValidatorVerdicts(
  pack,
  verdicts,
  validatorModel = 'gemini-4-hydrogen-medium',
) {
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
    c.validatorModel = validatorModel;
    approved.push(c);
  }
  return approved;
}

function modelFamily(modelName) {
  const m = String(modelName ?? '').toLowerCase();
  if (m.includes('claude')) return 'anthropic';
  if (m.includes('gemini') || m.includes('hydrogen') || m.includes('carbon') || m.includes('argon')) {
    return 'gemini';
  }
  return m || 'other';
}

export async function runHydrogenValidator({
  outDir,
  follow = false,
  batchSize = 40,
  concurrency = 6,
  model = 'gemini-4-hydrogen-medium',
  validatorPools = null,
  invokeValidator = (m, packItems) =>
    callAgyCli(m, buildValidatorPrompt(packItems), 240_000),
  log = () => {},
}) {
  const pools =
    Array.isArray(validatorPools) && validatorPools.length > 0
      ? validatorPools
      : [{ model, concurrency }];
  const crossFamilyOnly = pools.length >= 2;
  const valDir = join(outDir, 'hydrogen_out');
  const gatedPath = join(outDir, 'gated_candidates.jsonl');
  const approvedPath = join(outDir, 'approved_bank.jsonl');
  const genDonePath = join(outDir, 'generation_done.json');
  await mkdir(valDir, { recursive: true, mode: 0o700 });

  const existingFiles = (await readdir(valDir).catch(() => []))
    .filter((f) => /^\d{5}\.json$/.test(f))
    .sort();

  const claimedIds = new Set();
  const initialApprovedLines = [];
  let approvedTotal = 0;
  let nextBatchNo = 0;

  for (const file of existingFiles) {
    const saved = JSON.parse(await readFile(join(valDir, file), 'utf8'));
    for (const id of saved.candidateIds ?? []) claimedIds.add(id);
    for (const row of saved.approved ?? []) {
      initialApprovedLines.push(JSON.stringify(row));
      approvedTotal += 1;
    }
    nextBatchNo = Math.max(nextBatchNo, Number(saved.batchNo ?? 0) + 1);
  }

  await writeFile(
    approvedPath,
    initialApprovedLines.length > 0 ? initialApprovedLines.join('\n') + '\n' : '',
    { mode: 0o600 },
  );

  let appendChain = Promise.resolve();
  const appendApproved = (rows) => {
    if (rows.length === 0) return Promise.resolve();
    const text = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
    appendChain = appendChain.then(() => appendFile(approvedPath, text));
    return appendChain;
  };

  const poolQuotaStopped = Object.fromEntries(pools.map((p) => [p.model, false]));
  let processedTotal = claimedIds.size;

  const claimNextChunk = async (validatorModel) => {
    const valFamily = modelFamily(validatorModel);
    const raw = await readFile(gatedPath, 'utf8').catch(() => '');
    const all = raw
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

    const chunk = [];
    for (const c of all) {
      if (claimedIds.has(c.candidateId)) continue;
      if (crossFamilyOnly && modelFamily(c.generatorModel) === valFamily) {
        continue;
      }
      claimedIds.add(c.candidateId);
      chunk.push(c);
      if (chunk.length >= batchSize) break;
    }
    if (chunk.length === 0) return null;
    const batchNo = nextBatchNo++;
    return { batchNo, chunk };
  };

  // Serialize claimNextChunk calls so workers never race on reading/claiming
  let claimLock = Promise.resolve();
  const safeClaim = (validatorModel) => {
    const next = claimLock.then(() => claimNextChunk(validatorModel));
    claimLock = next.catch(() => {});
    return next;
  };

  const runWorker = async (validatorModel, workerId) => {
    while (!poolQuotaStopped[validatorModel]) {
      const claimed = await safeClaim(validatorModel);
      if (!claimed) {
        const genDone = await stat(genDonePath).then(() => true, () => false);
        if (!follow || genDone) break;
        await new Promise((r) => setTimeout(r, 4000));
        continue;
      }

      const { batchNo, chunk } = claimed;
      const pack = buildBlindValidationPack(chunk, (max) => randomInt(max));
      let verdicts = null;

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const envelope = await invokeValidator(validatorModel, pack.items);
          verdicts = extractVerdictArray(envelope.response);
          break;
        } catch (err) {
          if (isQuotaError(err)) {
            poolQuotaStopped[validatorModel] = true;
            for (const c of chunk) claimedIds.delete(c.candidateId);
            log(
              JSON.stringify({
                event: 'validator_quota_stopped',
                workerId,
                model: validatorModel,
                batchNo,
              }),
            );
            return;
          }
          log(
            JSON.stringify({
              event: 'validator_retry',
              workerId,
              model: validatorModel,
              batchNo,
              attempt,
              error: String(err?.message ?? err).slice(0, 200),
            }),
          );
          if (attempt === 2) {
            verdicts = [];
          } else {
            await new Promise((r) => setTimeout(r, 2500));
          }
        }
      }

      if (!verdicts) continue;

      const approved = reconcileValidatorVerdicts(pack, verdicts, validatorModel);
      const fileName = `${String(batchNo).padStart(5, '0')}.json`;
      await atomicWriteJson(join(valDir, fileName), {
        batchNo,
        model: validatorModel,
        createdAt: new Date().toISOString(),
        candidateIds: chunk.map((c) => c.candidateId),
        inputCount: chunk.length,
        approvedCount: approved.length,
        approved,
      });
      await appendApproved(approved);
      approvedTotal += approved.length;
      processedTotal += chunk.length;
      log(
        JSON.stringify({
          event: 'cross_val_done',
          workerId,
          model: validatorModel,
          batchNo,
          inputCount: chunk.length,
          approvedCount: approved.length,
          approvedTotal,
          processedTotal,
        }),
      );
    }
  };

  await Promise.all(
    pools.flatMap((pool) =>
      Array.from({ length: Math.max(1, pool.concurrency) }, (_, idx) =>
        runWorker(pool.model, idx + 1),
      ),
    ),
  );
  await appendChain;

  const summary = {
    updatedAt: new Date().toISOString(),
    validatorPools: pools.map((p) => p.model),
    processedCandidates: processedTotal,
    approvedTotal,
    poolQuotaStopped,
  };
  await atomicWriteJson(join(outDir, 'validation_status.json'), summary);
  return summary;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const outDir = process.argv[2] ? resolve(process.argv[2]) : resolve('uploads/m11.5-deck-bank');
  const follow = process.argv.includes('--follow');
  const concArg = process.argv.find((a) => a.startsWith('--concurrency='));
  const batchArg = process.argv.find((a) => a.startsWith('--batch-size='));
  const crossFamily = process.argv.includes('--cross-family');
  const concurrency = concArg ? Number(concArg.split('=')[1]) : 4;
  const batchSize = batchArg ? Number(batchArg.split('=')[1]) : 40;

  const summary = await runHydrogenValidator({
    outDir,
    follow,
    concurrency,
    batchSize,
    ...(crossFamily
      ? {
          validatorPools: [
            { model: 'gemini-4-hydrogen-medium', concurrency },
            { model: 'claude-sonnet-4-6', concurrency },
          ],
        }
      : {}),
    log: (line) => console.log(line),
  });
  console.log(JSON.stringify({ event: 'validation_finished', ...summary }));
}
