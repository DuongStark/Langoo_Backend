import { ConfigService } from '@nestjs/config';
import { AiModelDispatch } from '../../providers/ai-model-dispatch';
import { OpenAiChatProvider } from '../../providers/openai-chat.provider';
import { QuizBatchEngine } from './quiz-batch-engine';

export function createQuizBatchEngine(config: ConfigService): QuizBatchEngine {
  const value = (key: string) => config.get<string>(key)?.trim() || undefined;
  const apiKey = value('AI_QUIZ_API_KEY') ?? value('AI_API_KEY');
  const generatorModel =
    value('AI_QUIZ_V3_MODEL') ?? 'deepseek-ai/deepseek-v4.1-flash';
  const baseUrl =
    value('AI_QUIZ_BASE_URL') ??
    value('AI_BASE_URL') ??
    'https://api.openai.com/v1';
  if (apiKey && config.get<boolean>('AI_QUIZ_V3_ENABLED') === true)
    AiModelDispatch.configure(
      AiModelDispatch.scope(baseUrl, apiKey, generatorModel),
      300,
    );
  const transport =
    value('AI_PROVIDER') === 'openai' && apiKey
      ? new OpenAiChatProvider({
          apiKey,
          baseUrl:
            value('AI_QUIZ_BASE_URL') ??
            value('AI_BASE_URL') ??
            'https://api.openai.com/v1',
        })
      : undefined;
  return new QuizBatchEngine({
    transport,
    generatorModel,
    singleQuestionMode: true,
    callTimeoutMs: config.get<number>('AI_QUIZ_V3_CALL_TIMEOUT_MS') ?? 20_000,
    maxOutputTokens: 1800,
    reasoningEffort: 'low',
  });
}
