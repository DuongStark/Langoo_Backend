import { SavedSensesController } from './saved-senses.controller';
import { SavedSensesService } from './saved-senses.service';
import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { CollectionsController } from './collections.controller';
import { CollectionsService } from './collections.service';
import { ItemsController } from './items.controller';
import { ItemsImportService } from './items-import.service';
import { ItemsService } from './items.service';
import { DeckRepository } from './repositories/deck.repository';
import { ItemImportLookupRepository } from './repositories/item-import-lookup.repository';
import { SenseLookupRepository } from './repositories/sense-lookup.repository';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';

/**
 * Module sổ tay: collection + item (face/srs_state) + tag + clone deck + auto import list.
 * Ghi app.* qua Prisma; đọc core.deck/core.sense chỉ để tra cứu.
 */
@Module({
  imports: [AuthModule, AiModule],
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
    ItemsImportService,
    TagsService,
    SenseLookupRepository,
    ItemImportLookupRepository,
    DeckRepository,
  ],
  exports: [CollectionsService, ItemsService, ItemsImportService],
})
export class CollectionsModule {}
