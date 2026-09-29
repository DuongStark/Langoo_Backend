import { ConfigService } from '@nestjs/config';
import { createAiChatProvider } from './ai-chat-provider.factory';
import { StubChatProvider } from './stub-chat.provider';

function configWith(values: Record<string, string | undefined>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('createAiChatProvider', () => {
  it('mặc định trả stub khi chưa cấu hình', () => {
    const provider = createAiChatProvider(configWith({}));
    expect(provider).toBeInstanceOf(StubChatProvider);
  });

  it('thiếu key/model khi AI_PROVIDER=openai → fail-fast', () => {
    expect(() =>
      createAiChatProvider(configWith({ AI_PROVIDER: 'openai' })),
    ).toThrow(/AI_API_KEY/);

    expect(() =>
      createAiChatProvider(
        configWith({ AI_PROVIDER: 'openai', AI_API_KEY: 'k' }),
      ),
    ).toThrow(/AI_CHAT_MODEL/);
  });

  it('AI_PROVIDER=openai đủ cấu hình → dùng AI_BASE_URL (mặc định OpenAI)', () => {
    const provider = createAiChatProvider(
      configWith({
        AI_PROVIDER: 'openai',
        AI_API_KEY: 'k',
        AI_CHAT_MODEL: 'gpt-x',
      }),
    );
    expect(provider.name).toBe('openai');
    expect(provider).toBeDefined();
  });

  it('provider chưa triển khai (gemini) → fail-fast với thông báo rõ', () => {
    expect(() =>
      createAiChatProvider(
        configWith({
          AI_PROVIDER: 'gemini',
          AI_API_KEY: 'k',
          AI_CHAT_MODEL: 'gemini-x',
        }),
      ),
    ).toThrow(/chưa được triển khai/);
  });
});
