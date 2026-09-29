import { ConfigService } from '@nestjs/config';
import { AiChatProvider } from './ai-chat.provider';
import { OpenAiChatProvider } from './openai-chat.provider';
import { StubChatProvider } from './stub-chat.provider';

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

/**
 * Chọn provider theo `AI_PROVIDER` (stub mặc định).
 * Cấu hình thiếu với provider thật → throw lúc khởi động (fail-fast, không đợi request đầu).
 */
export function createAiChatProvider(config: ConfigService): AiChatProvider {
  const provider = config.get<string>('AI_PROVIDER') ?? 'stub';

  if (provider === 'stub') {
    return new StubChatProvider();
  }

  if (provider === 'openai') {
    const apiKey = config.get<string>('AI_API_KEY');
    const model = config.get<string>('AI_CHAT_MODEL');
    if (!apiKey || !model) {
      throw new Error(
        'AI_PROVIDER=openai cần AI_API_KEY và AI_CHAT_MODEL (xem .env.example)',
      );
    }
    const baseUrl =
      config.get<string>('AI_BASE_URL') ?? DEFAULT_OPENAI_BASE_URL;
    return new OpenAiChatProvider({ baseUrl, apiKey });
  }

  throw new Error(
    `AI_PROVIDER=${provider} chưa được triển khai — dùng "stub" hoặc "openai" (OpenAI-compatible, cấu hình AI_BASE_URL)`,
  );
}

/** Model mặc định ghi vào phiên khi client không chỉ định. */
export function aiChatModel(config: ConfigService): string {
  return config.get<string>('AI_CHAT_MODEL') ?? 'stub-v1';
}
