import { Injectable } from '@nestjs/common';
import {
  AiQuizGenerateInput,
  AiQuizProvider,
  GeneratedQuizQuestion,
} from './ai-quiz.provider';
import { buildQuizQuestions } from '../quiz/quiz-generator';

/**
 * Provider sinh quiz mặc định: chạy hoàn toàn từ dữ liệu người học (không gọi mạng,
 * không tốn token), deterministic theo RNG injectable — đủ để FE dựng màn chơi.
 * Adapter LLM thật để backlog (JSON mode + prompt tuning).
 */
@Injectable()
export class StubQuizProvider implements AiQuizProvider {
  readonly name = 'stub';

  generate(input: AiQuizGenerateInput): Promise<GeneratedQuizQuestion[]> {
    return Promise.resolve(
      input.baseQuestions ??
        buildQuizQuestions({
          questionTypes: input.questionTypes,
          questionCount: input.questionCount,
          languageId: input.languageId,
          items: input.items,
          rng: input.rng,
        }),
    );
  }
}
