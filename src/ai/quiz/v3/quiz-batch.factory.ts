import { ConfigService } from '@nestjs/config';
import { OpenAiChatProvider } from '../../providers/openai-chat.provider';
import { QuizBatchEngine } from './quiz-batch-engine';

export function createQuizBatchEngine(config: ConfigService): QuizBatchEngine {
  const value = (key: string) => config.get<string>(key)?.trim() || undefined;
  const apiKey = value('AI_QUIZ_API_KEY') ?? value('AI_API_KEY');
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
    generatorModel: value('AI_QUIZ_MODEL'),
    validatorModel: value('AI_QUIZ_VALIDATOR_MODEL'),
    reasoningEffort: value('AI_QUIZ_REASONING_EFFORT'),
  });
}
