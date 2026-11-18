import { ConfigService } from '@nestjs/config';
import { AiQuizProvider } from './ai-quiz.provider';
import { ContextQuizProvider } from './context-quiz.provider';

/**
 * M11.5: Synchronous quiz creation never invokes live third-party HTTP LLMs.
 * ContextQuizProvider runs strictly in local/dictionary/cached mode (transport = undefined).
 */
export function createAiQuizProvider(config: ConfigService): AiQuizProvider {
  const timeout = Number(config.get<number | string>('AI_QUIZ_TIMEOUT_MS'));
  return new ContextQuizProvider({
    transport: undefined,
    timeoutMs:
      Number.isInteger(timeout) && timeout >= 1_000 && timeout <= 300_000
        ? timeout
        : 60_000,
  });
}
