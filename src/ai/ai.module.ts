import { PrivacyModule } from '../privacy/privacy.module';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { DictionaryModule } from '../dictionary/dictionary.module';
import { SessionsModule } from '../sessions/sessions.module';
import { SrsModule } from '../srs/srs.module';
import { ChatController } from './chat/chat.controller';
import { ChatService } from './chat/chat.service';
import { AI_CHAT_PROVIDER } from './providers/ai-chat.provider';
import { createAiChatProvider } from './providers/ai-chat-provider.factory';
import { AI_QUIZ_PROVIDER } from './providers/ai-quiz.provider';
import { createAiQuizProvider } from './providers/ai-quiz-provider.factory';
import { QuizController } from './quiz/quiz.controller';
import { QuizService } from './quiz/quiz.service';
import { QuizSourceRepository } from './quiz/repositories/quiz-source.repository';
import { QuizBankRepository } from './quiz/bank/quiz-bank.repository';
import {
  createQuizBankGeneratorClient,
  createQuizBankValidatorClient,
  QUIZ_BANK_GENERATOR_CLIENT,
  QUIZ_BANK_VALIDATOR_CLIENT,
  QuizBankWorkerService,
} from './quiz/bank/quiz-bank-worker.service';
import { AiUsageService } from './usage/ai-usage.service';

/**
 * Module AI (M10 chat + M11.5 quiz bank):
 * - Chat giữ OpenAI-compatible provider + SSE.
 * - Quiz M11.5 ghép đồng bộ tức thời từ app.quiz_question_bank (<200ms, 0 gọi AI lúc bấm);
 *   gỡ bỏ QuizJobsController (/v1/quizzes/jobs*) progressive cũ.
 */
@Module({
  imports: [
    PrivacyModule,
    AuthModule,
    DictionaryModule,
    SrsModule,
    SessionsModule,
  ],
  controllers: [ChatController, QuizController],
  providers: [
    ChatService,
    QuizService,
    QuizSourceRepository,
    QuizBankRepository,
    QuizBankWorkerService,
    AiUsageService,
    {
      provide: QUIZ_BANK_GENERATOR_CLIENT,
      inject: [ConfigService],
      useFactory: createQuizBankGeneratorClient,
    },
    {
      provide: QUIZ_BANK_VALIDATOR_CLIENT,
      inject: [ConfigService],
      useFactory: createQuizBankValidatorClient,
    },
    {
      provide: AI_CHAT_PROVIDER,
      inject: [ConfigService],
      useFactory: createAiChatProvider,
    },
    {
      provide: AI_QUIZ_PROVIDER,
      inject: [ConfigService],
      useFactory: createAiQuizProvider,
    },
  ],
  exports: [AiUsageService, QuizBankRepository],
})
export class AiModule {}
