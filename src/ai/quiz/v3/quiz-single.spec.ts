import { QuizBatchEngine } from './quiz-batch-engine';
import type { ValidatedQuestion } from './quiz-batch-engine';
import type {
  AiChatRequest,
  AiChatResult,
} from '../../providers/ai-chat.provider';
import { planQuiz } from './quiz-blueprint';

const items = Array.from({ length: 6 }, (_, i) => ({
  itemId: `item-${i}`,
  senseId: `${i}`,
  conceptId: null,
  languageId: 1,
  languageCode: 'en',
  lemma: `word${i}`,
  reading: null,
  romanization: null,
  meaningVi: `nghĩa${i}`,
  pos: 'noun',
}));
const result = (content: string, tokensOut = 1): AiChatResult => ({
  content,
  tokensIn: 1,
  tokensOut,
  costUsd: 0,
  model: 'single',
});
const setup = (handler: (request: AiChatRequest) => Promise<AiChatResult>) => {
  const chat = jest.fn(async (request: AiChatRequest) => {
    await request.beforeDispatch?.();
    return handler(request);
  });
  return {
    chat,
    engine: new QuizBatchEngine({
      transport: { name: 'test', chat },
      generatorModel: 'single',
      singleQuestionMode: true,
      randomIndex: () => 2,
    }),
  };
};
const payload = (request: AiChatRequest) =>
  JSON.parse(request.messages[1].content) as { target: string };

describe('M11.3 single question generation', () => {
  it('publishes a fast sibling before the slow request, with usage tied to each dispatch', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let published!: () => void;
    const firstPublished = new Promise<void>((resolve) => {
      published = resolve;
    });
    const { engine, chat } = setup(async (request) => {
      const { target } = payload(request);
      if (target === 'word0') await held;
      return result(
        JSON.stringify({
          sentence: `A ${target === 'word0' ? 'first' : 'second'} clue about 【${target}】 today.`,
          correctIndex: 0,
          id: 'wrong-id',
        }),
        target === 'word0' ? 11 : 22,
      );
    });
    let sequence = 0;
    const before = jest.fn(() => Promise.resolve(`receipt-${++sequence}`));
    const usage = jest
      .fn<Promise<void>, [AiChatResult, string?]>()
      .mockResolvedValue(undefined);
    const content: ValidatedQuestion[] = [];
    const running = engine.generateProgressively(
      planQuiz(items, 1, ['context_cloze'], 2).slots,
      items,
      before,
      usage,
      () => 30000,
      (q) =>
        Promise.resolve().then(() => {
          content.push(q);
          published();
        }),
    );
    await firstPublished;
    expect(content.map((q) => q.ordinal)).toEqual([2]);
    expect(usage.mock.calls[0][1]).toBe('receipt-2');
    release();
    await running;
    expect(chat).toHaveBeenCalledTimes(2); // no AI validator or whole-quiz call
    expect(
      usage.mock.calls.map(([r, receipt]) => [r.tokensOut, receipt]),
    ).toEqual([
      [22, 'receipt-2'],
      [11, 'receipt-1'],
    ]);
    expect(content[0].question.correctAnswer.index).toBe(2);
    expect(content[0].verification).toBe('generated_self_checked');
    expect(content[0].question.prompt).not.toContain('word1');
    expect(content[0].context).toBeNull();
    const hook = jest.fn();
    expect(await engine.audit(content, hook)).toEqual([]);
    expect(hook).not.toHaveBeenCalled();
  });

  it.each([
    { sentence: 'No marker word0' },
    { sentence: '【word0】 and 【word0】' },
    { sentence: '【word0】 leaks word0' },
    { sentence: 'Bad� 【word0】' },
  ])(
    'rejects malformed, leaking or corrupted content: %j',
    async (response) => {
      const { engine } = setup(() =>
        Promise.resolve(result(JSON.stringify(response))),
      );
      const accept = jest.fn();
      await engine.generateProgressively(
        planQuiz(items, 1, ['context_cloze'], 1).slots,
        items,
        () => Promise.resolve('receipt'),
        () => Promise.resolve(undefined),
        () => 30000,
        accept,
      );
      expect(accept).not.toHaveBeenCalled();
    },
  );

  it('aborts on privacy/source hooks instead of silently retrying them', async () => {
    const { engine, chat } = setup(() =>
      Promise.resolve(result('{"sentence":"【word0】."}')),
    );
    await expect(
      engine.generateProgressively(
        planQuiz(items, 1, ['context_cloze'], 1).slots,
        items,
        () => Promise.reject(new Error('privacy revoked')),
        () => Promise.resolve(undefined),
        () => 30000,
        jest.fn(),
      ),
    ).rejects.toThrow('privacy revoked');
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('does not lose a usage checkpoint failure or publish unpaid content', async () => {
    const { engine } = setup(() =>
      Promise.resolve(result('{"sentence":"【word0】."}')),
    );
    const accept = jest.fn();
    await expect(
      engine.generateProgressively(
        planQuiz(items, 1, ['context_cloze'], 1).slots,
        items,
        () => Promise.resolve('receipt'),
        () => Promise.reject(new Error('checkpoint')),
        () => 30000,
        accept,
      ),
    ).rejects.toThrow('checkpoint');
    expect(accept).not.toHaveBeenCalled();
  });

  it('constructs marked Kanji spans from server-owned source and hides the written answer for orthography', async () => {
    const ja = ['学校', '病院', '電車', '図書館'].map((lemma, i) => ({
      ...items[i],
      languageId: 2,
      languageCode: 'ja',
      lemma,
      reading: ['がっこう', 'びょういん', 'でんしゃ', 'としょかん'][i],
      kanjiPairs: [
        {
          written: lemma,
          reading: ['がっこう', 'びょういん', 'でんしゃ', 'としょかん'][i],
          eligible: true,
        },
      ],
    }));
    const { engine } = setup((request) =>
      Promise.resolve(
        result(
          JSON.stringify({
            sentence: `毎日【${payload(request).target}】へ行きます。`,
            distractors: ['学枚', '学枝', '学杖'],
          }),
        ),
      ),
    );
    const content: ValidatedQuestion[] = [];
    await engine.generateProgressively(
      planQuiz(ja, 2, ['kanji_orthography'], 1).slots,
      ja,
      () => Promise.resolve('receipt'),
      () => Promise.resolve(undefined),
      () => 30000,
      (q) =>
        Promise.resolve().then(() => {
          content.push(q);
        }),
    );
    expect(content).toHaveLength(1);
    expect(content[0].context?.target.text).toBe('がっこう');
    expect(content[0].context?.sentence).not.toContain('学校');
    expect(content[0].question.correctAnswer.text).toBe('学校');
  });
});
