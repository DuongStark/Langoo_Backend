import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/auth.types';
import { parseUuidParam } from '../common/ids/postgres-id';
import { ErrorResponseDto } from '../common/swagger/error-response.dto';
import {
  DeletedResponseDto,
  ItemListResponseDto,
  ItemResponseDto,
} from './dto/collection-response.dto';
import { CreateItemDto } from './dto/create-item.dto';
import { ListItemsQueryDto } from './dto/list-items-query.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { ItemsService } from './items.service';
import {
  DeletedResponse,
  ItemListResult,
  ItemResponse,
} from './types/collections.types';

@ApiTags('collections')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('collections/:collectionId/items')
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  @Get()
  @ApiOperation({
    summary: 'Danh sách từ trong bộ (lọc language_id/status, cursor keyset)',
  })
  @ApiParam({ name: 'collectionId' })
  @ApiOkResponse({ type: ItemListResponseDto })
  list(
    @CurrentUser() payload: JwtPayload,
    @Param('collectionId') collectionId: string,
    @Query() query: ListItemsQueryDto,
  ): Promise<ItemListResult> {
    return this.itemsService.list(
      BigInt(payload.sub),
      parseUuidParam(collectionId, 'collection_id'),
      query,
    );
  }

  @Post()
  @ApiOperation({
    summary:
      'Thêm từ (1–2 face, khác ngôn ngữ) — mỗi face sinh 2 srs_state trong transaction',
  })
  @ApiParam({ name: 'collectionId' })
  @ApiCreatedResponse({ type: ItemResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'ITEM_ALREADY_EXISTS khi từ đã có trong bộ',
  })
  add(
    @CurrentUser() payload: JwtPayload,
    @Param('collectionId') collectionId: string,
    @Body() dto: CreateItemDto,
  ): Promise<ItemResponse> {
    return this.itemsService.add(
      BigInt(payload.sub),
      parseUuidParam(collectionId, 'collection_id'),
      dto,
    );
  }

  @Patch(':itemId')
  @ApiOperation({ summary: 'Sửa nghĩa/note/status/position/tag_ids của từ' })
  @ApiParam({ name: 'collectionId' })
  @ApiOkResponse({ type: ItemResponseDto })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'ITEM_NOT_FOUND',
  })
  update(
    @CurrentUser() payload: JwtPayload,
    @Param('collectionId') collectionId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateItemDto,
  ): Promise<ItemResponse> {
    return this.itemsService.update(
      BigInt(payload.sub),
      parseUuidParam(collectionId, 'collection_id'),
      parseUuidParam(itemId, 'item_id'),
      dto,
    );
  }

  @Delete(':itemId')
  @ApiOperation({ summary: 'Xoá từ khỏi bộ (xoá cascade face + srs_state)' })
  @ApiParam({ name: 'collectionId' })
  @ApiOkResponse({ type: DeletedResponseDto })
  remove(
    @CurrentUser() payload: JwtPayload,
    @Param('collectionId') collectionId: string,
    @Param('itemId') itemId: string,
  ): Promise<DeletedResponse> {
    return this.itemsService.remove(
      BigInt(payload.sub),
      parseUuidParam(collectionId, 'collection_id'),
      parseUuidParam(itemId, 'item_id'),
    );
  }
}
