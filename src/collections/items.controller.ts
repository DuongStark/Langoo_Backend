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
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
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
import { ImportItemsDto, ImportItemsResponseDto } from './dto/import-items.dto';
import { ListItemsQueryDto } from './dto/list-items-query.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { ItemsImportService } from './items-import.service';
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
  constructor(
    private readonly itemsService: ItemsService,
    private readonly itemsImportService: ItemsImportService,
  ) {}

  @Get()
  @ApiServiceUnavailableResponse({
    type: ErrorResponseDto,
    description: 'COLLECTION_READ_UNAVAILABLE / AUTH_SERVICE_UNAVAILABLE',
  })
  @ApiOperation({
    summary: 'Danh sách từ trong bộ (lọc, order asc/desc, cursor keyset)',
    description:
      'Sắp xếp theo (position, id), mặc định asc; desc trả position lớn nhất trước. Giữ cùng order khi dùng next_cursor, đổi chiều phải tải lại trang đầu.',
  })
  @ApiParam({ name: 'collectionId' })
  @ApiOkResponse({ type: ItemListResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'VALIDATION_FAILED khi order/cursor/limit sai hoặc cursor khác chiều; LANGUAGE_NOT_FOUND khi ngôn ngữ không tồn tại',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'COLLECTION_NOT_FOUND',
  })
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

  @Post('import')
  @ApiOperation({
    summary:
      'M5.3: Tự động import danh sách từ vào bộ có sẵn theo mặt chữ + từ loại',
    description:
      'Tối đa 500 dòng/lần. Tự khớp từ điển theo ngôn ngữ hồ sơ, ưu tiên đúng từ loại (lệch từ loại sẽ fallback theo mặt chữ), tự chọn nghĩa phổ biến nhất (M10.5/M4.5), bỏ qua từ trùng và trả danh sách not_found.',
  })
  @ApiParam({ name: 'collectionId' })
  @ApiCreatedResponse({ type: ImportItemsResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'VALIDATION_FAILED (items rỗng, >500 dòng hoặc word không hợp lệ)',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'COLLECTION_NOT_FOUND',
  })
  importItems(
    @CurrentUser() payload: JwtPayload,
    @Param('collectionId') collectionId: string,
    @Body() dto: ImportItemsDto,
  ): Promise<ImportItemsResponseDto> {
    return this.itemsImportService.importIntoCollection(
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
