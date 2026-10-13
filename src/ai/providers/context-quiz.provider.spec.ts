import { kanjiInput } from '../../../test/fixtures/quiz-kanji';
import { buildQuizQuestions } from '../quiz/quiz-generator';
import { fingerprint } from '../quiz/quiz-contract';
import { AiChatRequest, AiProviderError } from './ai-chat.provider';
import { ContextQuizProvider } from './context-quiz.provider';
import { ConfigService } from '@nestjs/config';
import { createAiQuizProvider } from './ai-quiz-provider.factory';
import { OpenAiChatProvider } from './openai-chat.provider';

function setup(options: { timeoutMs?: number } = {}) {
  const chat = jest.fn<
    Promise<{
      content: string;
      model: string;
      tokensIn: number;
      tokensOut: number;
      costUsd: number;
    }>,
    [AiChatRequest]
  >();
  const provider = new ContextQuizProvider({
    transport: { name: 'mock', chat },
    generatorModel: 'generator',
    validatorModel: 'validator',
    timeoutMs: options.timeoutMs ?? 1000,
  });
  const response = (content: unknown) => ({
    content: JSON.stringify(content),
    model: 'mock',
    tokensIn: 12,
    tokensOut: 6,
    costUsd: 0,
  });
  chat.mockImplementation((request) => {
    const input = JSON.parse(request.messages[1].content) as {
      target: { written: string };
      options?: { index: number; text: string }[];
    };
    if (request.model === 'generator')
      return Promise.resolve(
        response({
          sentence: `毎日、${input.target.written}へ行きます。`,
          target: {
            text: input.target.written,
            start: 3,
            end: 3 + Array.from(input.target.written).length,
          },
        }),
      );
    const targetReading = (
      JSON.parse(request.messages[1].content) as { target: { reading: string } }
    ).target.reading;
    return Promise.resolve(
      response({
        natural: true,
        correctSense: true,
        correctTarget: true,
        noAnswerLeak: true,
        correctOptionIndices: [
          input.options!.find(
            (o) => o.text === targetReading || o.text === input.target.written,
          )!.index,
        ],
      }),
    );
  });
  return { chat, provider, response };
}

describe('ContextQuizProvider routing and quality', () => {
  it('reuses validated context when models and key are absent', async () => {
    const { provider } = setup();
    const [first] = await provider.generate(
      kanjiInput({ contextMode: 'source_or_generated' }),
    );
    const offline = new ContextQuizProvider({ timeoutMs: 1000 });
    const input = kanjiInput({
      contextMode: 'source_or_generated',
      contextEvidence: [first.evidence!],
    });
    await expect(offline.generate(input)).resolves.toHaveLength(1);
    expect(input.usage?.calls).toBe(0);
  });
  it('blank timeout uses a real deadline rather than failing immediately', async () => {
    const { chat } = setup();
    const spy = jest
      .spyOn(OpenAiChatProvider.prototype, 'chat')
      .mockImplementation(chat);
    try {
      const provider = createAiQuizProvider(
        new ConfigService({
          AI_PROVIDER: 'openai',
          AI_API_KEY: 'fixture',
          AI_QUIZ_MODEL: 'generator',
          AI_QUIZ_VALIDATOR_MODEL: 'validator',
          AI_QUIZ_TIMEOUT_MS: '',
        }),
      );
      await provider.generate(
        kanjiInput({ contextMode: 'source_or_generated' }),
      );
      expect(chat.mock.calls[0][0].timeoutMs).toBeGreaterThan(1000);
    } finally {
      spy.mockRestore();
    }
  });
  it.each(['multiple_choice', 'matching', 'fill_blank', 'mixed'] as const)(
    '%s data-only makes zero AI calls with AI enabled',
    async (quizType) => {
      const { provider, chat } = setup();
      const input = kanjiInput({
        quizType,
        questionCount: 3,
        questionStyles:
          quizType === 'multiple_choice' || quizType === 'mixed'
            ? ['meaning']
            : undefined,
      });
      await provider.generate(input);
      expect(chat).not.toHaveBeenCalled();
      expect(input.usage).toMatchObject({
        tokensIn: 0,
        tokensOut: 0,
        calls: 0,
        local: 3,
      });
    },
  );
  it('Kanji without context requires no configured provider', async () => {
    const provider = new ContextQuizProvider({ timeoutMs: 1000 });
    await expect(provider.generate(kanjiInput())).resolves.toHaveLength(1);
    expect(() =>
      provider.preflight(kanjiInput({ contextMode: 'source_or_generated' })),
    ).toThrow();
  });
  it('generates and validates only missing context, keeping source answer', async () => {
    const { provider, chat } = setup();
    const input = kanjiInput({ contextMode: 'source_or_generated' });
    const result = await provider.generate(input);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(result[0].context?.sentence).toBe('毎日、学校へ行きます。');
    expect(result[0].evidence?.accepted).toBe(true);
    expect(input.usage).toMatchObject({ tokensIn: 24, tokensOut: 12 });
  });
  it('source mode verifies dictionary context without invoking generation', async () => {
    const { provider, chat } = setup();
    const input = kanjiInput({ contextMode: 'source' });
    input.items[0].examples = [
      {
        id: '1',
        sentence: '毎日、学校へ行きます。',
        attribution: 'Source CC BY',
        sourceHash: fingerprint('source-v1'),
      },
    ];
    const [q] = await provider.generate(input);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat.mock.calls[0][0].model).toBe('validator');
    expect(q.context?.origin).toBe('dictionary');
  });
  it('reuses accepted evidence across option shuffles without tokens; source changes invalidate it', async () => {
    const { provider, chat } = setup();
    const input = kanjiInput({ contextMode: 'source_or_generated' });
    const [first] = await provider.generate(input);
    chat.mockClear();
    const reused = kanjiInput({
      contextMode: 'source_or_generated',
      rng: { next: () => 0.1 },
      contextEvidence: [first.evidence!],
    });
    const [second] = await provider.generate(reused);
    expect(chat).not.toHaveBeenCalled();
    expect(second.evidence).toEqual(first.evidence);
    expect(reused.usage).toMatchObject({ reused: 1, calls: 0 });
    reused.items[0].glossEn = ['different sense'];
    await provider.generate({ ...reused, usage: undefined });
    expect(chat).toHaveBeenCalledTimes(2);
  });
  it('masks Kanji in orthography and preserves Unicode code point span', async () => {
    const { provider } = setup();
    const input = kanjiInput({
      contextMode: 'source',
      questionStyles: ['kanji_orthography'],
    });
    input.items[0].examples = [
      {
        id: '1',
        sentence: '🌸学校へ行きます。',
        attribution: 'CC BY source',
        sourceHash: fingerprint('source'),
      },
    ];
    const [q] = await provider.generate(input);
    expect(q.prompt).not.toContain('学校');
    expect(q.context?.target).toEqual({ start: 1, end: 5, text: 'がっこう' });
    expect(q.evidence?.sentence).toContain('学校'); // private only
  });
  it('rejects two correct answers and stops after two generated candidates', async () => {
    const { provider, chat, response } = setup();
    const original = chat.getMockImplementation()!;
    chat.mockImplementation((request) =>
      request.model === 'generator'
        ? original(request)
        : Promise.resolve(
            response({
              natural: true,
              correctSense: true,
              correctTarget: true,
              noAnswerLeak: true,
              correctOptionIndices: [0, 1],
            }),
          ),
    );
    await expect(
      provider.generate(kanjiInput({ contextMode: 'source_or_generated' })),
    ).rejects.toMatchObject({ code: 'QUIZ_CONTEXT_INVALID' });
    expect(chat).toHaveBeenCalledTimes(4);
  });
  it('chấp nhận câu đúng dù model trả offset sai (tự tính lại vị trí)', async () => {
    const { provider, chat, response } = setup();
    const original = chat.getMockImplementation()!;
    chat.mockImplementation((request) =>
      request.model === 'generator'
        ? Promise.resolve(
            response({
              sentence: '明日、学校へ行きます。',
              target: { text: '学校', start: 99, end: 101 },
            }),
          )
        : original(request),
    );
    const [q] = await provider.generate(
      kanjiInput({ contextMode: 'source_or_generated' }),
    );
    expect(q.context?.target).toEqual({ start: 3, end: 5, text: '学校' });
  });
  it('chấp nhận JSON bọc trong code fence từ model', async () => {
    const { provider, chat } = setup();
    const original = chat.getMockImplementation()!;
    chat.mockImplementation(async (request) => {
      const result = await original(request);
      return { ...result, content: `\`\`\`json\n${result.content}\n\`\`\`` };
    });
    const [q] = await provider.generate(
      kanjiInput({ contextMode: 'source_or_generated' }),
    );
    expect(q.context?.sentence).toContain('学校');
  });
  it('tự thử lại khi provider trả 429 (rate limit)', async () => {
    const { provider, chat } = setup({ timeoutMs: 60_000 });
    const original = chat.getMockImplementation()!;
    let thrown = false;
    chat.mockImplementation(async (request) => {
      if (request.model === 'validator' && !thrown) {
        thrown = true;
        throw new AiProviderError('provider HTTP 429', 429);
      }
      return original(request);
    });
    const [q] = await provider.generate(
      kanjiInput({ contextMode: 'source_or_generated' }),
    );
    expect(q.context?.sentence).toContain('学校');
  });
  it('malformed or answer-leaking sentences never reach semantic validator', async () => {
    const { provider, chat, response } = setup();
    chat.mockResolvedValue(
      response({
        sentence: '学校（がっこう）へ行きます。',
        target: { text: '学校', start: 0, end: 2 },
      }),
    );
    await expect(
      provider.generate(kanjiInput({ contextMode: 'source_or_generated' })),
    ).rejects.toMatchObject({ code: 'QUIZ_CONTEXT_INVALID' });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls.every(([r]) => r.model === 'generator')).toBe(true);
  });
  it('mixed only sends Kanji context slots to the model', async () => {
    const { provider, chat } = setup();
    const input = kanjiInput({
      quizType: 'mixed',
      questionCount: 6,
      questionStyles: ['meaning', 'kanji_reading'],
      contextMode: 'source_or_generated',
    });
    input.baseQuestions = buildQuizQuestions(input);
    await provider.generate(input);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(input.usage?.local).toBe(5);
    expect(
      chat.mock.calls.every(
        ([r]) => !r.messages[1].content.includes('mapping'),
      ),
    ).toBe(true);
  });
});
