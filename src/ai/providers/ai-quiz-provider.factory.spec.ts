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

describe('createAiQuizProvider — transport riêng cho quiz', () => {
  beforeEach(() => MockedTransport.mockClear());

  it('thiếu key AI → provider stub, không tạo transport', () => {
    const provider = createAiQuizProvider(configWith({}));
    expect(provider.name).toBe('stub');
    expect(MockedTransport).not.toHaveBeenCalled();
  });

  it('fallback AI_API_KEY/AI_BASE_URL khi không có AI_QUIZ_*', () => {
    const provider = createAiQuizProvider(
      configWith({
        AI_PROVIDER: 'openai',
        AI_API_KEY: 'shared-key',
        AI_BASE_URL: 'https://shared.example/v1',
        AI_QUIZ_MODEL: 'm1',
      }),
    );
    expect(provider.name).toBe('hybrid-context');
    expect(MockedTransport).toHaveBeenCalledWith({
      apiKey: 'shared-key',
      baseUrl: 'https://shared.example/v1',
    });
  });

  it('AI_QUIZ_API_KEY/AI_QUIZ_BASE_URL được ưu tiên hơn AI_*', () => {
    const provider = createAiQuizProvider(
      configWith({
        AI_PROVIDER: 'openai',
        AI_API_KEY: 'shared-key',
        AI_BASE_URL: 'https://shared.example/v1',
        AI_QUIZ_API_KEY: 'groq-key',
        AI_QUIZ_BASE_URL: 'https://api.groq.com/openai/v1',
        AI_QUIZ_MODEL: 'qwen/qwen3.8-27b',
      }),
    );
    expect(provider.name).toBe('hybrid-context');
    expect(MockedTransport).toHaveBeenCalledWith({
      apiKey: 'groq-key',
      baseUrl: 'https://api.groq.com/openai/v1',
    });
  });

  it('AI_QUIZ_* chỉ khoảng trắng → fallback AI_*', () => {
    const provider = createAiQuizProvider(
      configWith({
        AI_PROVIDER: 'openai',
        AI_API_KEY: 'shared-key',
        AI_BASE_URL: 'https://shared.example/v1',
        AI_QUIZ_API_KEY: ' ',
        AI_QUIZ_BASE_URL: ' ',
        AI_QUIZ_MODEL: 'm1',
      }),
    );
    expect(provider.name).toBe('hybrid-context');
    expect(MockedTransport).toHaveBeenCalledWith({
      apiKey: 'shared-key',
      baseUrl: 'https://shared.example/v1',
    });
  });
});
