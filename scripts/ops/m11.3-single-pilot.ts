/** M11.3: bounded, synthetic provider smoke; no learner DB or ENV writes. */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import {
  QuizBatchEngine,
  ValidatedQuestion,
} from '../../src/ai/quiz/v3/quiz-batch-engine';
import { AiModelDispatch } from '../../src/ai/providers/ai-model-dispatch';
import {
  AiChatRequest,
  AiChatResult,
} from '../../src/ai/providers/ai-chat.provider';
import { planQuiz, QuizSkill } from '../../src/ai/quiz/v3/quiz-blueprint';
import { pilotFixtures } from './m11.3-quiz-fixtures';

async function main() {
  const kanjiReplay = process.argv.includes('--kanji-replay');
  const replay = kanjiReplay
    ? (JSON.parse(
        fs.readFileSync(
          'docs/reviews/m11.3-kanji-distractors-2026-11-17.json',
          'utf8',
        ),
      ) as {
        calls: {
          request: { messages: { content: string }[] };
          response?: { result?: AiChatResult };
        }[];
      })
    : undefined;
  const kanjiRefine = process.argv.includes('--kanji-refine');
  const kanjiOnly =
    process.argv.includes('--kanji') || kanjiRefine || kanjiReplay;
  const callBudget = kanjiRefine ? 3 : 6;
  const output = path.resolve(
    kanjiReplay
      ? 'docs/reviews/m11.3-kanji-distractors-replay-2026-11-17.json'
      : kanjiRefine
        ? 'docs/reviews/m11.3-kanji-distractors-refined-2026-11-17.json'
        : kanjiOnly
          ? 'docs/reviews/m11.3-kanji-distractors-2026-11-17.json'
          : 'docs/reviews/m11.3-single-engine-2026-11-17.json',
  );
  if (fs.existsSync(output)) throw new Error('Refusing to overwrite pilot');
  const bridge = fs.readFileSync(
    path.resolve('scripts/ops/m11.3-quiz-provider-bridge.cjs'),
    'utf8',
  );
  const command =
    'node -e \'eval(Buffer.from(process.argv[1],"base64").toString())\' ' +
    Buffer.from(bridge).toString('base64');
  const calls: {
    request: Omit<AiChatRequest, 'signal' | 'beforeDispatch'>;
    ok: boolean;
    response?: { result?: AiChatResult; name?: string; status?: number };
  }[] = [];
  const cases: {
    name: string;
    count: number;
    wallMs: number;
    questions: ValidatedQuestion[];
  }[] = [];
  const save = () =>
    fs.writeFileSync(
      output,
      JSON.stringify(
        {
          task: 'M11.3',
          date: '2026-11-17',
          policy: `${kanjiReplay ? 'LOCAL REPLAY ZERO EXTERNAL CALLS; ' : ''}${callBudget} generation calls max; public fixtures; actual single engine/parser, read-only SSH bridge; no independent AI review, no production DB/ENV writes`,
          calls,
          cases,
        },
        null,
        2,
      ) + '\n',
    );
  AiModelDispatch.configure('m113-synthetic-pilot', 500);
  const transport = {
    name: 'readonly-ssh',
    chat: async (request: AiChatRequest): Promise<AiChatResult> => {
      const safe = {
        model: request.model,
        timeoutMs: request.timeoutMs,
        maxTokens: request.maxTokens,
        reasoningEffort: request.reasoningEffort,
        messages: request.messages,
      };
      const entry: (typeof calls)[number] = { request: safe, ok: false };
      calls.push(entry);
      save();
      if (calls.length > callBudget)
        throw new Error('Pilot call budget exceeded');

      if (replay) {
        await request.beforeDispatch?.();
        const payload = JSON.parse(request.messages[1].content) as {
          target: string;
          skill: string;
        };
        const prior = replay.calls.find((call) => {
          const p = JSON.parse(call.request.messages[1].content) as {
            target: string;
            skill: string;
          };
          return p.target === payload.target && p.skill === payload.skill;
        });
        if (!prior?.response?.result) throw new Error('Missing replay result');
        entry.ok = true;
        entry.response = prior.response;
        save();
        return prior.response.result;
      }
      return AiModelDispatch.run(
        'm113-synthetic-pilot',
        AbortSignal.timeout(request.timeoutMs),
        request.beforeDispatch,
        async () => {
          // Credential stays remote; stdin only carries the synthetic request.
          const child = execFile(
            'ssh',
            [
              '-T',
              '-o',
              'BatchMode=yes',
              '-o',
              'ConnectTimeout=10',
              'langoo-vps',
              command,
            ],
            { timeout: request.timeoutMs + 15000, maxBuffer: 2000000 },
            () => undefined,
          );
          child.stdin?.end(JSON.stringify({ kind: 'chat', chat: safe }));
          const response = await new Promise<string>((resolve, reject) => {
            let stdout = '';
            child.stdout?.on('data', (s: Buffer) => {
              stdout += s.toString();
            });
            child.on('error', reject);
            child.on('close', (code) =>
              code === 0
                ? resolve(stdout)
                : reject(new Error('SSH_TRANSPORT_ERROR')),
            );
          });
          const parsed = JSON.parse(response) as {
            ok: boolean;
            result: AiChatResult;
            name?: string;
            status?: number;
          };
          entry.ok = parsed.ok;
          entry.response = {
            result: parsed.result,
            name: parsed.name,
            status: parsed.status,
          };
          save();
          if (!parsed.ok) throw new Error('PROVIDER_CALL_FAILED');
          return parsed.result;
        },
      );
    },
  };
  const engine = new QuizBatchEngine({
    transport,
    generatorModel: 'deepseek-ai/deepseek-v4.1-flash',
    singleQuestionMode: true,
    reasoningEffort: 'low',
    callTimeoutMs: 20000,
    maxOutputTokens: 1800,
    randomIndex: () => 0,
  });
  let receipt = 0;
  for (const fixture of pilotFixtures.filter(
    (f) => !kanjiOnly || f.languageId === 2,
  )) {
    const skills: QuizSkill[] = kanjiOnly
      ? ['kanji_reading', 'kanji_orthography']
      : fixture.languageId === 1
        ? ['context_cloze', 'context_meaning', 'usage']
        : ['kanji_reading', 'kanji_orthography', 'context_cloze'];
    const start = Date.now();
    const questions: ValidatedQuestion[] = [];
    await engine.generateProgressively(
      planQuiz(
        fixture.items,
        fixture.languageId,
        skills,
        kanjiOnly ? 6 : 3,
      ).slots.filter(
        (slot) => !kanjiRefine || [3, 5, 6].includes(slot.ordinal),
      ),
      fixture.items,
      () => Promise.resolve(`pilot-${++receipt}`),
      () => Promise.resolve(),
      () => 45000,
      (q) => {
        questions.push(q);
        return Promise.resolve();
      },
    );
    cases.push({
      name: fixture.name,
      count: questions.length,
      wallMs: Date.now() - start,
      questions,
    });
    save();
    console.log(
      JSON.stringify({
        name: fixture.name,
        count: questions.length,
        wallMs: Date.now() - start,
      }),
    );
  }
}
void main().catch(() => {
  console.error('M11.3 pilot failed; inspect safe artifacts');
  process.exitCode = 1;
});
