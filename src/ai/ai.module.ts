import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { DictionaryModule } from '../dictionary/dictionary.module';
import { ChatController } from './chat/chat.controller';
import { ChatService } from './chat/chat.service';
import { AI_CHAT_PROVIDER } from './providers/ai-chat.provider';
import { createAiChatProvider } from './providers/ai-chat-provider.factory';
import { AiUsageService } from './usage/ai-usage.service';

/**
 * Module AI (M10): chatbot + quota/usage dùng chung cho các tính năng AI sau.
 * Provider chọn theo env (stub mặc định; openai = OpenAI-compatible + AI_BASE_URL).
 */
@Module({
  imports: [AuthModule, DictionaryModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    AiUsageService,
    {
      provide: AI_CHAT_PROVIDER,
      inject: [ConfigService],
      useFactory: createAiChatProvider,
    },
  ],
  exports: [AiUsageService],
})
export class AiModule {}
