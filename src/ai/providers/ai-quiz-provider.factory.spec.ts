import { ConfigService } from '@nestjs/config';
import { createAiQuizProvider } from './ai-quiz-provider.factory';
import { OpenAiChatProvider } from './openai-chat.provider';

jest.mock('./openai-chat.provider');

const MockedTransport = OpenAiChatProvider as jest.MockedClass<
  typeof OpenAiChatProvider
>;

function configWith(values: Record<string, string | undefined>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('createAiQuizProvider — M11.5 zero live LLM transport', () => {
  beforeEach(() => MockedTransport.mockClear());

  it('returns local-only stub provider when AI keys are absent', () => {
    const provider = createAiQuizProvider(configWith({}));
    expect(provider.name).toBe('stub');
    expect(MockedTransport).not.toHaveBeenCalled();
  });

  it('never instantiates OpenAiChatProvider even when AI_PROVIDER=openai and AI_QUIZ_API_KEY are set', () => {
    const provider = createAiQuizProvider(
      configWith({
        AI_PROVIDER: 'openai',
        AI_API_KEY: 'shared-key',
        AI_BASE_URL: 'https://shared.example/v1',
        AI_QUIZ_API_KEY: 'groq-key',
        AI_QUIZ_BASE_URL: 'https://api.groq.com/openai/v1',
        AI_QUIZ_MODEL: 'qwen/qwen3.8-27b',
        AI_QUIZ_VALIDATOR_MODEL: 'qwen/qwen3.8-27b',
      }),
    );
    expect(provider.name).toBe('stub');
    expect(MockedTransport).not.toHaveBeenCalled();
  });
});
