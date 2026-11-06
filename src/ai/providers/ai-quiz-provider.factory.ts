import { ConfigService } from '@nestjs/config';
import { AiQuizProvider } from './ai-quiz.provider';
import { ContextQuizProvider } from './context-quiz.provider';
import { OpenAiChatProvider } from './openai-chat.provider';

/**
 * Hybrid router: data questions are local even with AI enabled. Missing model
 * configuration is checked per context request, not for data-only quizzes.
 */
export function createAiQuizProvider(config: ConfigService): AiQuizProvider {
  const get = (key: string): string | undefined =>
    config.get<string>(key)?.trim() || undefined;
  // Quiz ngữ cảnh có thể dùng transport riêng (AI_QUIZ_*); thiếu thì fallback
  // về AI_API_KEY/AI_BASE_URL dùng chung với chat.
  const apiKey = get('AI_QUIZ_API_KEY') ?? get('AI_API_KEY');
  const baseUrl =
    get('AI_QUIZ_BASE_URL') ??
    get('AI_BASE_URL') ??
    'https://api.openai.com/v1';
  const enabled = get('AI_PROVIDER') === 'openai' && !!apiKey;
  const timeout = Number(config.get<number | string>('AI_QUIZ_TIMEOUT_MS'));
  return new ContextQuizProvider({
    transport: enabled
      ? new OpenAiChatProvider({
          apiKey: apiKey,
          baseUrl: baseUrl,
        })
      : undefined,
    generatorModel: get('AI_QUIZ_MODEL'),
    validatorModel: get('AI_QUIZ_VALIDATOR_MODEL'),
    reasoningEffort: get('AI_QUIZ_REASONING_EFFORT'),
    timeoutMs:
      Number.isInteger(timeout) && timeout >= 1_000 && timeout <= 300_000
        ? timeout
        : 60_000,
  });
}
