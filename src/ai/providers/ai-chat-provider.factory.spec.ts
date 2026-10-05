import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { validateEnv } from '../../config/env.schema';
import { aiChatModel, createAiChatProvider } from './ai-chat-provider.factory';
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

  it('key/model chỉ có khoảng trắng → fail-fast', () => {
    expect(() =>
      createAiChatProvider(
        configWith({
          AI_PROVIDER: 'openai',
          AI_API_KEY: ' ',
          AI_CHAT_MODEL: 'space-bunny-free',
        }),
      ),
    ).toThrow(/AI_API_KEY/);
    expect(() =>
      createAiChatProvider(
        configWith({
          AI_PROVIDER: 'openai',
          AI_API_KEY: 'test-key',
          AI_CHAT_MODEL: ' ',
        }),
      ),
    ).toThrow(/AI_CHAT_MODEL/);
  });

  it('ConfigModule thật: biến env trống vẫn dùng default model/base URL', async () => {
    const savedEnv = { ...process.env };
    const savedFetch = global.fetch;
    process.env.AI_PROVIDER = 'stub';
    process.env.AI_CHAT_MODEL = '';
    process.env.AI_BASE_URL = '';
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          validate: (env: Record<string, unknown>) =>
            validateEnv({
              ...env,
              DATABASE_URL:
                'postgresql://postgres:pw@127.0.0.1:5432/langoo_test',
              DIRECT_URL: 'postgresql://postgres:pw@127.0.0.1:5432/langoo_test',
              JWT_ACCESS_SECRET: 'test-secret-0123456789abcdef0123456789',
            }),
        }),
      ],
    }).compile();
    try {
      const config = moduleRef.get(ConfigService);
      expect(aiChatModel(config)).toBe('stub-v1');
      config.set('AI_PROVIDER', 'openai');
      config.set('AI_API_KEY', 'test-key');
      config.set('AI_CHAT_MODEL', 'space-bunny-free');
      const fetchMock = jest
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ choices: [{ message: { content: 'hello' } }] }),
          ),
        );
      global.fetch = fetchMock;
      await createAiChatProvider(config).chat({
        model: aiChatModel(config),
        messages: [{ role: 'user', content: 'hi' }],
        timeoutMs: 1000,
      });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.any(Object),
      );
    } finally {
      global.fetch = savedFetch;
      process.env = savedEnv;
      await moduleRef.close();
    }
  });
});
