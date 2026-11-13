import { SavedSensesController } from './saved-senses.controller';
import { SavedSensesService } from './saved-senses.service';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CollectionsController } from './collections.controller';
import { CollectionsService } from './collections.service';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';
import { DeckRepository } from './repositories/deck.repository';
import { SenseLookupRepository } from './repositories/sense-lookup.repository';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';

/**
 * Module sổ tay: collection + item (face/srs_state) + tag + clone deck.
 * Ghi app.* qua Prisma; đọc core.deck/core.sense chỉ để tra cứu.
 */
@Module({
  imports: [AuthModule],
  controllers: [
    SavedSensesController,
    CollectionsController,
    ItemsController,
    TagsController,
  ],
  providers: [
    SavedSensesService,
    CollectionsService,
    ItemsService,
    TagsService,
    SenseLookupRepository,
    DeckRepository,
  ],
  exports: [CollectionsService, ItemsService],
})
export class CollectionsModule {}
