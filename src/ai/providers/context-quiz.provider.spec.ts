import { DomainException } from '../../common/errors/domain.exception';
import { HttpStatus } from '@nestjs/common';
import { kanjiInput } from '../../../test/fixtures/quiz-kanji';
import { buildQuizQuestions } from '../quiz/quiz-generator';
import { fingerprint } from '../quiz/quiz-contract';
import { AiChatRequest, AiProviderError } from './ai-chat.provider';
import { ContextQuizProvider } from './context-quiz.provider';
import { ConfigService } from '@nestjs/config';
import { createAiQuizProvider } from './ai-quiz-provider.factory';
import { OpenAiChatProvider } from './openai-chat.provider';

function setup(options: { timeoutMs?: number; reasoningEffort?: string } = {}) {
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
    reasoningEffort: options.reasoningEffort,
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
            (option) =>
              option.text === targetReading ||
              option.text === input.target.written,
          )!.index,
        ],
      }),
    );
  });
  return { chat, provider, response };
}

/**
 * Với `questionCount: 2`, slot MC thứ hai mang style `kanji_reading`
 * (rotation meaning → kanji_reading) và nhắm item thứ hai của fixture (銀行).
 */
const KANJI_SLOT = 1;

describe('ContextQuizProvider routing and quality', () => {
  it('checks privacy before every external call and does not swallow withdrawal', async () => {
    const { provider, chat } = setup();
    let count = 0;
    const input = {
      ...kanjiInput({ questionCount: 2 }),
      beforeExternalCall: () => {
        if (++count > 1)
          throw new DomainException(
            'PRIVACY_CONSENT_REQUIRED',
            'withdrawn',
            HttpStatus.FORBIDDEN,
          );
        return Promise.resolve();
      },
    };
    await expect(provider.generate(input)).rejects.toMatchObject({
      code: 'PRIVACY_CONSENT_REQUIRED',
    });
    expect(chat).toHaveBeenCalledTimes(1);
  });
  it('does not request privacy consent for a quiz without external calls', async () => {
    const { provider, chat } = setup();
    const beforeExternalCall = jest
      .fn()
      .mockRejectedValue(new Error('must not call'));
    const result = await provider.generate({
      ...kanjiInput({ questionCount: 1 }),
      beforeExternalCall,
    });
    expect(result).toHaveLength(1);
    expect(beforeExternalCall).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
  });
  it('reuses validated context when models and key are absent', async () => {
    const { provider } = setup();
    const first = await provider.generate(kanjiInput({ questionCount: 2 }));
    const evidence = first[KANJI_SLOT].evidence!;

    const offline = new ContextQuizProvider({ timeoutMs: 1000 });
    const input = kanjiInput({ questionCount: 2, contextEvidence: [evidence] });
    const result = await offline.generate(input);
    expect(result).toHaveLength(2);
    expect(result[KANJI_SLOT].context?.sentence).toContain('銀行');
    expect(result[KANJI_SLOT].evidence).toEqual(evidence);
    expect(input.usage).toMatchObject({
      calls: 0,
      reused: 1,
      local: 1,
    });
  });

  it.each([
    [['fill_blank'], 3, 3],
    [['matching'], 1, 1],
  ] as const)(
    '%j data-only makes zero AI calls with AI enabled',
    async (questionTypes, questionCount, expectedLocal) => {
      const { provider, chat } = setup();
      const input = kanjiInput({
        questionTypes: [...questionTypes],
        questionCount,
      });
      await provider.generate(input);
      expect(chat).not.toHaveBeenCalled();
      expect(input.usage).toMatchObject({
        tokensIn: 0,
        tokensOut: 0,
        calls: 0,
        local: expectedLocal,
      });
    },
  );

  it('MC không có dữ liệu Kanji → câu nghĩa local, zero AI calls', async () => {
    const { provider, chat } = setup();
    const plainItems = [1, 2, 3, 4].map((index) => ({
      itemId: `word-${index}`,
      senseId: `${index}`,
      conceptId: `${index}`,
      languageId: 1,
      lemma: `word ${index}`,
      reading: null,
      romanization: null,
      meaningVi: `nghĩa ${index}`,
    }));
    const input = kanjiInput({
      items: plainItems,
      questionCount: 3,
      languageId: 1,
    });
    await provider.generate(input);
    expect(chat).not.toHaveBeenCalled();
    expect(input.usage).toMatchObject({ calls: 0, local: 3 });
  });

  it('Kanji without configured provider falls back to word-only, no throw', async () => {
    const provider = new ContextQuizProvider({ timeoutMs: 1000 });
    const input = kanjiInput({ questionCount: 2 });
    const result = await provider.generate(input);
    expect(result).toHaveLength(2);
    expect(result[KANJI_SLOT].kanjiTarget).toBeDefined();
    expect(result[KANJI_SLOT].context ?? null).toBeNull();
    expect(input.usage).toMatchObject({ local: 2, calls: 0 });
  });

  it('generates and validates only missing context, keeping source answer', async () => {
    const { provider, chat } = setup();
    const input = kanjiInput({ questionCount: 2 });
    const result = await provider.generate(input);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(result[KANJI_SLOT].context?.sentence).toBe(
      '毎日、【銀行】へ行きます。',
    );
    expect(result[KANJI_SLOT].evidence?.accepted).toBe(true);
    expect(input.usage).toMatchObject({
      tokensIn: 24,
      tokensOut: 12,
      local: 1,
    });
  });

  it('source example is verified without invoking generation', async () => {
    const { provider, chat } = setup();
    const input = kanjiInput({ questionCount: 2 });
    input.items[KANJI_SLOT].examples = [
      {
        id: '1',
        sentence: '毎日、銀行へ行きます。',
        attribution: 'Source CC BY',
        sourceHash: fingerprint('source-v1'),
      },
    ];
    const result = await provider.generate(input);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat.mock.calls[0][0].model).toBe('validator');
    expect(result[KANJI_SLOT].context?.origin).toBe('dictionary');
  });

  it('reuses accepted evidence across option shuffles without tokens; source changes invalidate it', async () => {
    const { provider, chat } = setup();
    const input = kanjiInput({ questionCount: 2 });
    const first = (await provider.generate(input))[KANJI_SLOT];
    chat.mockClear();
    const reused = kanjiInput({
      questionCount: 2,
      rng: { next: () => 0.1 },
      contextEvidence: [first.evidence!],
    });
    const second = await provider.generate(reused);
    expect(chat).not.toHaveBeenCalled();
    expect(second[KANJI_SLOT].evidence).toEqual(first.evidence);
    expect(reused.usage).toMatchObject({ reused: 1, calls: 0 });

    reused.items[KANJI_SLOT].glossEn = ['different sense'];
    await provider.generate({ ...reused, usage: undefined });
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('masks Kanji in orthography and preserves Unicode code point span', async () => {
    const { provider } = setup();
    const input = kanjiInput({ questionCount: 3 });
    input.items[2].examples = [
      {
        id: '1',
        sentence: '🌸電話へ行きます。',
        attribution: 'CC BY source',
        sourceHash: fingerprint('source'),
      },
    ];
    const result = await provider.generate(input);
    const q = result[2];
    expect(q.questionStyle).toBe('kanji_orthography');
    expect(q.prompt).not.toContain('電話');
    // JLPT style: chỉ câu, không có dòng chỉ dẫn; từ mục tiêu bọc 【 】.
    expect(q.prompt).toBe('🌸【でんわ】へ行きます。');
    expect(q.context?.target).toEqual({ start: 2, end: 5, text: 'でんわ' });
    expect(q.evidence?.sentence).toContain('電話'); // private only
  });

  it('rejects two correct answers and falls back to word-only after two generated candidates', async () => {
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
    const input = kanjiInput({ questionCount: 2 });
    const result = await provider.generate(input);
    expect(result[KANJI_SLOT].context ?? null).toBeNull();
    expect(result[KANJI_SLOT].questionStyle).toBe('kanji_reading');
    expect(result[KANJI_SLOT].questionType).toBe('multiple_choice');
    expect(chat).toHaveBeenCalledTimes(4); // 2 candidate × (gen + verify)
    expect(input.usage).toMatchObject({ local: 2, calls: 4 });
  });

  it('malformed or answer-leaking sentences never reach semantic validator and fall back', async () => {
    const { provider, chat, response } = setup();
    chat.mockResolvedValue(
      response({
        sentence: '銀行（ぎんこう）へ行きます。',
        target: { text: '銀行', start: 0, end: 2 },
      }),
    );
    const result = await provider.generate(kanjiInput({ questionCount: 2 }));
    expect(result[KANJI_SLOT].context ?? null).toBeNull();
    expect(chat).toHaveBeenCalledTimes(2);
    expect(
      chat.mock.calls.every(([request]) => request.model === 'generator'),
    ).toBe(true);
  });

  it('provider error không retryable → fallback, quiz không fail', async () => {
    const { provider, chat } = setup();
    chat.mockRejectedValue(new AiProviderError('provider HTTP 400', 400));
    const input = kanjiInput({ questionCount: 2 });
    const result = await provider.generate(input);
    expect(result).toHaveLength(2);
    expect(result[KANJI_SLOT].context ?? null).toBeNull();
    expect(chat).toHaveBeenCalledTimes(1);
    expect(input.usage).toMatchObject({ local: 2 });
  });

  it('chấp nhận câu đúng dù model trả offset sai (tự tính lại vị trí)', async () => {
    const { provider, chat, response } = setup();
    const original = chat.getMockImplementation()!;
    chat.mockImplementation((request) =>
      request.model === 'generator'
        ? Promise.resolve(
            response({
              sentence: '明日、銀行へ行きます。',
              target: { text: '銀行', start: 99, end: 101 },
            }),
          )
        : original(request),
    );
    const result = await provider.generate(kanjiInput({ questionCount: 2 }));
    expect(result[KANJI_SLOT].context?.target).toEqual({
      start: 4,
      end: 6,
      text: '銀行',
    });
  });

  it('chấp nhận JSON bọc trong code fence từ model', async () => {
    const { provider, chat } = setup();
    const original = chat.getMockImplementation()!;
    chat.mockImplementation(async (request) => {
      const result = await original(request);
      return { ...result, content: `\`\`\`json\n${result.content}\n\`\`\`` };
    });
    const result = await provider.generate(kanjiInput({ questionCount: 2 }));
    expect(result[KANJI_SLOT].context?.sentence).toContain('銀行');
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
    const result = await provider.generate(kanjiInput({ questionCount: 2 }));
    expect(result[KANJI_SLOT].context?.sentence).toContain('銀行');
  });

  it('blank quiz timeout leaves production generation in local mode', async () => {
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
      await expect(
        provider.generate(kanjiInput({ questionCount: 2 })),
      ).resolves.toHaveLength(2);
      expect(chat).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('mixed only sends Kanji context slots to the model', async () => {
    const { provider, chat } = setup();
    const input = kanjiInput({
      questionTypes: ['multiple_choice', 'fill_blank'],
      questionCount: 3,
    });
    input.baseQuestions = buildQuizQuestions(input);
    const result = await provider.generate(input);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(input.usage?.local).toBe(2);
    expect(result[0].context ?? null).toBeNull();
    expect(result[1].questionStyle).toBe('fill_blank');
    expect(result[KANJI_SLOT + 1].context?.sentence).toContain('電話');
    expect(
      chat.mock.calls.every(([request]) => {
        const payload = JSON.parse(request.messages[1].content) as {
          target?: unknown;
        };
        return payload.target !== undefined;
      }),
    ).toBe(true);
  });
  it('forwards thinking-off to an injected transport for generation, validation and retry', async () => {
    const { provider, chat } = setup({
      timeoutMs: 60_000,
      reasoningEffort: 'none',
    });
    const original = chat.getMockImplementation()!;
    let failedOnce = false;
    chat.mockImplementation((request) => {
      if (request.model === 'validator' && !failedOnce) {
        failedOnce = true;
        return Promise.reject(new AiProviderError('temporary rate limit', 429));
      }
      return original(request);
    });
    await provider.generate(kanjiInput({ questionCount: 2 }));
    expect(chat.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(
      chat.mock.calls.every(([request]) => request.reasoningEffort === 'none'),
    ).toBe(true);
  });
});
