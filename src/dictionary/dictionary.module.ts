import { Module } from '@nestjs/common';
import { SenseCardRepository } from './repositories/sense-card.repository';

/**
 * Module tra từ điển (M1 mới có tầng dữ liệu; controller/service thuộc M4).
 */
@Module({
  providers: [SenseCardRepository],
  exports: [SenseCardRepository],
})
export class DictionaryModule {}
