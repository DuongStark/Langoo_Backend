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
import { AiUsageService } from './usage/ai-usage.service';
import { QuizJobsController } from './quiz/v3/quiz-jobs.controller';
import { QuizJobsService } from './quiz/v3/quiz-jobs.service';
import { QuizBatchEngine } from './quiz/v3/quiz-batch-engine';
import { createQuizBatchEngine } from './quiz/v3/quiz-batch.factory';

/**
 * Module AI (M10 chat + M11 quiz): phiên chat/quiz, quota/usage dùng chung.
 * Chat có OpenAI-compatible; quiz dựng từ dữ liệu, model chỉ dùng cho context.
 */
@Module({
  imports: [
    PrivacyModule,
    AuthModule,
    DictionaryModule,
    SrsModule,
    SessionsModule,
  ],
  controllers: [ChatController, QuizController, QuizJobsController],
  providers: [
    ChatService,
    QuizService,
    QuizSourceRepository,
    AiUsageService,
    QuizJobsService,
    {
      provide: QuizBatchEngine,
      inject: [ConfigService],
      useFactory: createQuizBatchEngine,
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
  exports: [AiUsageService],
})
export class AiModule {}
