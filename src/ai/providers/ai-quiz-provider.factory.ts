import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiQuizProvider } from './ai-quiz.provider';
import { StubQuizProvider } from './stub-quiz.provider';

/**
 * Provider sinh quiz — M11 chỉ có stub (deterministic, không tốn token).
 * Nếu `AI_PROVIDER` đang là provider thật (openai/gemini), quiz vẫn dùng stub
 * và ghi log cảnh báo; adapter thật nằm trong backlog.
 */
export function createAiQuizProvider(config: ConfigService): AiQuizProvider {
  const provider = config.get<string>('AI_PROVIDER') ?? 'stub';
  if (provider !== 'stub') {
    new Logger('AiQuizProviderFactory').warn(
      `AI_PROVIDER=${provider} chưa có adapter quiz — dùng stub cho quiz (backlog M12)`,
    );
  }
  return new StubQuizProvider();
}
