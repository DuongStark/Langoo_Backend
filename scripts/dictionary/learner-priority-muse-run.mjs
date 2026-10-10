/** M4.5: resumable single-browser worker, independent of SSH/local computer. */
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  unlinkSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  hash,
  PROMPT_VERSION,
  splitContexts,
  shortlistContext,
  packTasks,
  batchPrompt,
  validateBatchReply,
} from './learner-priority-muse.mjs';
const directory = resolve(process.argv[2]);
const input = JSON.parse(readFileSync(`${directory}/input.json`, 'utf8'));
const identity = hash({
  input,
  prompt: PROMPT_VERSION,
  helper: readFileSync(
    new URL('./learner-priority-muse.mjs', import.meta.url),
    'utf8',
  ),
  bridge: JSON.parse(readFileSync(`${directory}/bridge-identity.json`, 'utf8')),
});
const atomic = (name, value) => {
  writeFileSync(`${directory}/${name}.tmp`, JSON.stringify(value, null, 2), {
    mode: 0o600,
  });
  renameSync(`${directory}/${name}.tmp`, `${directory}/${name}`);
};
const lock = `${directory}/worker.lock`;
if (existsSync(lock)) {
  const pid = Number(readFileSync(lock, 'utf8'));
  let alive = false;
  if (Number.isSafeInteger(pid) && pid > 0) {
    try {
      process.kill(pid, 0);
      alive = true;
    } catch (e) {
      if (e.code !== 'ESRCH') throw e;
    }
  }
  if (alive) throw new Error('Worker already running');
  unlinkSync(lock);
}
writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 });
process.on('exit', () => {
  if (existsSync(lock) && readFileSync(lock, 'utf8') === String(process.pid))
    unlinkSync(lock);
});
mkdirSync(`${directory}/requests`, { recursive: true, mode: 0o700 });
let state = existsSync(`${directory}/checkpoint.json`)
  ? JSON.parse(readFileSync(`${directory}/checkpoint.json`, 'utf8'))
  : {
      identity,
      started_at: new Date().toISOString(),
      attempts: 0,
      input_tokens_estimated: 0,
      output_tokens_estimated: 0,
      last_started_ms: 0,
      tasks: {},
      failures: [],
    };
if (state.identity !== identity)
  throw new Error('Checkpoint/source/prompt drift');
const save = () => atomic('checkpoint.json', state);
const key = readFileSync('/opt/langoo/storage/muse/api.key', 'utf8').trim();
const requestCap = 150,
  inputTokenCap = 700000,
  outputTokenCap = 50000;
const makeTasks = (record) => {
  const parts = splitContexts(record);
  return parts.map((context, index) => ({
    id: `${record.lemma}:${parts.length > 1 ? 'part' : 'final'}:${index}`,
    context,
    stage: parts.length > 1 ? 'part' : 'final',
  }));
};
const initial = input.records.flatMap(makeTasks);
function report(status) {
  const records = input.records.map((record) => {
    const tasks = makeTasks(record),
      split = tasks[0].stage === 'part';
    const output = state.tasks[`${record.lemma}:final:0`]?.output;
    const coverage = tasks.every((task) => state.tasks[task.id]?.output);
    return {
      lemma: record.lemma,
      status: output ? 'generated_pending_semantic_review' : 'pending',
      source_sense_count: record.senses.length,
      complete_context_processed: Boolean(coverage),
      baseline: record.baseline,
      output: output ?? null,
      selected:
        output?.recommended_sense_ids.map((id) =>
          record.senses.find((sense) => sense.senseId === id),
        ) ?? [],
      part_needs_review:
        split &&
        tasks.some((task) => state.tasks[task.id]?.output?.needs_review),
      errors: state.failures.filter((f) =>
        f.tasks.some((id) => id.startsWith(`${record.lemma}:`)),
      ),
    };
  });
  const generated = records.filter((r) => r.output).length;
  const summary = {
    task: 'M4.5',
    status,
    identity,
    updated_at: new Date().toISOString(),
    started_at: state.started_at,
    words: records.length,
    generated,
    semantic_reviewed: 0,
    attempts: state.attempts,
    usage_estimated: true,
    input_tokens_estimated: state.input_tokens_estimated,
    output_tokens_estimated: state.output_tokens_estimated,
    db_mutations: 0,
    model: 'muse-browser',
    actual_model_revision: 'unknown',
    records,
  };
  atomic('results.json', summary);
  const lines = [
    `# M4.5 — Muse pilot 50 từ`,
    '',
    `Status: ${status}; ${generated}/50 generated; semantic review pending.`,
    `Requests: ${state.attempts}; tokens estimated (not native usage): ${state.input_tokens_estimated} input / ${state.output_tokens_estimated} output.`,
    '',
    'Source snapshot read-only; no ranking applied to DB.',
    '',
  ];
  for (const r of records) {
    lines.push(
      `## ${r.lemma}`,
      '',
      `${r.status}; source senses: ${r.source_sense_count}; full context: ${r.complete_context_processed}`,
      '',
    );
    for (const s of r.selected)
      lines.push(
        `- ${s.senseId} (${s.pos}, ${s.source}): ${s.rawDefinition || s.definition}`,
      );
    if (r.output)
      lines.push(
        '',
        r.output.reason,
        `needs_review=${r.output.needs_review}; part_needs_review=${r.part_needs_review}`,
        '',
      );
  }
  writeFileSync(`${directory}/results.md.tmp`, lines.join('\n'), {
    mode: 0o600,
  });
  renameSync(`${directory}/results.md.tmp`, `${directory}/results.md`);
  console.log(JSON.stringify({ status, generated, attempts: state.attempts }));
}
async function call(tasks) {
  const prompt = batchPrompt(tasks),
    estimated = Math.ceil(prompt.length / 4);
  if (
    state.attempts >= requestCap ||
    state.input_tokens_estimated + estimated > inputTokenCap ||
    state.output_tokens_estimated >= outputTokenCap
  )
    throw new Error('Pilot budget exhausted');
  await sleep(Math.max(0, 30000 - (Date.now() - state.last_started_ms)));
  state.attempts++;
  state.input_tokens_estimated += estimated;
  state.last_started_ms = Date.now();
  save();
  const attempt = state.attempts,
    started = Date.now();
  const raw = {
    attempt,
    tasks: tasks.map((t) => t.id),
    prompt_hash: hash(prompt),
    started_at: new Date().toISOString(),
    usage_estimated: true,
    input_tokens_estimated: estimated,
  };
  atomic(`requests/${String(attempt).padStart(3, '0')}.json`, raw);
  try {
    const response = await fetch('http://127.0.0.1:8787/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        'x-muse-timeout-ms': '120000',
      },
      signal: AbortSignal.timeout(150000),
      body: JSON.stringify({
        model: 'muse-browser',
        stream: false,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    raw.status = response.status;
    const body = await response.json();
    if (!response.ok) throw new Error(`Bridge HTTP ${response.status}`);
    const text = body.choices?.[0]?.message?.content;
    raw.reply = text;
    raw.latency_ms = Date.now() - started;
    state.output_tokens_estimated += Math.ceil((text?.length ?? 0) / 4);
    const outputs = validateBatchReply(text, tasks);
    tasks.forEach((task, i) => {
      state.tasks[task.id] = {
        output: outputs[i],
        attempt,
        prompt_hash: raw.prompt_hash,
      };
    });
    raw.valid = true;
    save();
    atomic(`requests/${String(attempt).padStart(3, '0')}.json`, raw);
    report('running');
    return true;
  } catch (error) {
    raw.latency_ms = Date.now() - started;
    raw.valid = false;
    raw.error =
      error.name === 'TimeoutError'
        ? 'HTTP timeout'
        : String(error.message).slice(0, 200);
    state.failures.push({ attempt, tasks: raw.tasks, error: raw.error });
    save();
    atomic(`requests/${String(attempt).padStart(3, '0')}.json`, raw);
    report('running');
    return false;
  }
}
async function processBatch(tasks) {
  tasks = tasks.filter((task) => !state.tasks[task.id]);
  if (!tasks.length) return;
  if (await call(tasks)) return;
  if (tasks.length > 1) {
    const half = Math.ceil(tasks.length / 2);
    await processBatch(tasks.slice(0, half));
    await processBatch(tasks.slice(half));
  } else {
    await call(tasks);
  }
}
try {
  report('running');
  if (process.argv.includes('--preflight')) {
    await processBatch(
      packTasks(initial.filter((task) => !state.tasks[task.id]))[0] ?? [],
    );
    report('preflight_finished_review_pending');
    process.exit(0);
  }
  for (const batch of packTasks(
    initial.filter((task) => !state.tasks[task.id]),
  ))
    await processBatch(batch);
  const finals = [];
  for (const record of input.records) {
    const tasks = makeTasks(record);
    if (tasks[0].stage !== 'part' || state.tasks[`${record.lemma}:final:0`])
      continue;
    if (!tasks.every((task) => state.tasks[task.id]?.output)) continue;
    const outputs = tasks.map((task) => state.tasks[task.id].output);
    if (!outputs.some((output) => output.recommended_sense_ids.length))
      continue;
    const context = shortlistContext(record, outputs);
    context.part_uncertainty = outputs.some((output) => output.needs_review);
    if (JSON.stringify(context).length > 30000) {
      state.failures.push({
        attempt: null,
        tasks: [`${record.lemma}:final:0`],
        error: 'Final shortlist oversized; pending, no truncation',
      });
      save();
      continue;
    }
    finals.push({ id: `${record.lemma}:final:0`, context, stage: 'final' });
  }
  for (const batch of packTasks(finals)) await processBatch(batch);
  report('generation_finished_review_pending');
} catch (error) {
  state.failures.push({
    attempt: null,
    tasks: [],
    error: String(error.message).slice(0, 200),
  });
  save();
  report('stopped_pending');
  process.exitCode = 1;
}
