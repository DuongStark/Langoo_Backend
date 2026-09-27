import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DictionaryService } from './dictionary.service';
import {
  KanjiController,
  SearchController,
  SenseController,
} from './dictionary.controller';
import { FeedbackController } from './feedback.controller';
import { SearchHistoryController } from './search-history.controller';
import { SearchHistoryService } from './search-history.service';
import { FeedbackService } from './feedback.service';
import { DictionarySearchRepository } from './repositories/dictionary-search.repository';
import { KanjiRepository } from './repositories/kanji.repository';
import { SearchHistoryRepository } from './repositories/search-history.repository';
import { SenseCardRepository } from './repositories/sense-card.repository';
import { SenseContentRepository } from './repositories/sense-content.repository';
import { SensePairRepository } from './repositories/sense-pair.repository';

/**
 * Module từ điển: tra từ, chi tiết nghĩa/kanji, cặp song ngữ, lịch sử, báo lỗi gloss.
 * Chỉ đọc core/serve; ghi app.search_history + app.gloss_report.
 */
@Module({
  imports: [AuthModule],
  controllers: [
    SearchController,
    SenseController,
    KanjiController,
    SearchHistoryController,
    FeedbackController,
  ],
  providers: [
    DictionaryService,
    SearchHistoryService,
    FeedbackService,
    SenseCardRepository,
    DictionarySearchRepository,
    SenseContentRepository,
    SensePairRepository,
    KanjiRepository,
    SearchHistoryRepository,
  ],
  exports: [DictionaryService, SenseCardRepository],
})
export class DictionaryModule {}
