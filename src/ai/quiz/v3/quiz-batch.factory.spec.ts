import { ConfigService } from '@nestjs/config';
import { createQuizBatchEngine } from './quiz-batch.factory';
import { planQuiz } from './quiz-blueprint';

describe('M11.3 V3 model isolation', () => {
  it('uses DeepSeek single mode without a validator, preserving legacy model configuration', async () => {
    const config = new ConfigService({
      AI_PROVIDER: 'openai',
      AI_API_KEY: 'test-factory-key',
      AI_QUIZ_MODEL: 'legacy-glm',
    });
    const engine = createQuizBatchEngine(config);
    expect(engine.singleQuestionMode()).toBe(true);
    expect(engine.available()).toBe(true);
    const original = global.fetch;
    const fetchMock = jest.fn((_input: unknown, init?: RequestInit) =>
      Promise.resolve().then(() => {
        const body = JSON.parse(
          typeof init?.body === 'string' ? init.body : '{}',
        ) as {
          model: string;
          messages: { content: string }[];
        };
        expect(body.model).toBe('deepseek-ai/deepseek-v4.1-flash');
        const { target } = JSON.parse(body.messages[1].content) as {
          target: string;
        };
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    sentence: `Some 【${target}】 here.`,
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
        );
      }),
    );
    global.fetch = fetchMock;
    try {
      const items = Array.from({ length: 4 }, (_, i) => ({
        itemId: `i${i}`,
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
      const before = jest.fn(() => Promise.resolve('call-receipt'));
      const usage = jest.fn(() => Promise.resolve(undefined));
      const accept = jest.fn(() => Promise.resolve(undefined));
      await engine.generateProgressively(
        planQuiz(items, 1, ['context_cloze'], 1).slots,
        items,
        before,
        usage,
        () => 30000,
        accept,
      );
      expect(before).toHaveBeenCalledTimes(1);
      expect(accept).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(usage.mock.calls[0]).toEqual([
        expect.objectContaining({ tokensOut: 1 }),
        'call-receipt',
      ]);
      expect(config.get('AI_QUIZ_MODEL')).toBe('legacy-glm');
    } finally {
      global.fetch = original;
    }
  });
});
