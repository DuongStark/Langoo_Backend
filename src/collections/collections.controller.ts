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
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/auth.types';
import { ErrorResponseDto } from '../common/swagger/error-response.dto';
import { CollectionsService } from './collections.service';
import { CloneFromDeckDto } from './dto/clone-from-deck.dto';
import {
  ArchivedResponseDto,
  CollectionListResponseDto,
  CollectionResponseDto,
} from './dto/collection-response.dto';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { ListCollectionsQueryDto } from './dto/list-collections-query.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';
import {
  ArchivedResponse,
  CollectionListResult,
  CollectionResponse,
} from './types/collections.types';

@ApiTags('collections')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('collections')
export class CollectionsController {
  constructor(private readonly collectionsService: CollectionsService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách bộ sưu tập của tôi (chưa archive)' })
  @ApiOkResponse({ type: CollectionListResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  list(
    @CurrentUser() payload: JwtPayload,
    @Query() query: ListCollectionsQueryDto,
  ): Promise<CollectionListResult> {
    return this.collectionsService.list(BigInt(payload.sub), query.profile_id);
  }

  @Post()
  @ApiOperation({ summary: 'Tạo bộ sưu tập (profile mặc định nếu không gửi)' })
  @ApiCreatedResponse({ type: CollectionResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'PROFILE_REQUIRED khi chưa có hồ sơ học',
  })
  create(
    @CurrentUser() payload: JwtPayload,
    @Body() dto: CreateCollectionDto,
  ): Promise<CollectionResponse> {
    return this.collectionsService.create(BigInt(payload.sub), dto);
  }

  @Post('from-deck')
  @ApiOperation({
    summary: 'Clone bộ từ hệ thống (core.deck) thành bộ của tôi',
  })
  @ApiCreatedResponse({ type: CollectionResponseDto })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'DECK_NOT_FOUND',
  })
  cloneFromDeck(
    @CurrentUser() payload: JwtPayload,
    @Body() dto: CloneFromDeckDto,
  ): Promise<CollectionResponse> {
    return this.collectionsService.cloneFromDeck(BigInt(payload.sub), dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết bộ sưu tập' })
  @ApiOkResponse({ type: CollectionResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  get(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
  ): Promise<CollectionResponse> {
    return this.collectionsService.get(BigInt(payload.sub), id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Đổi tên/mô tả bộ sưu tập' })
  @ApiOkResponse({ type: CollectionResponseDto })
  update(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateCollectionDto,
  ): Promise<CollectionResponse> {
    return this.collectionsService.update(BigInt(payload.sub), id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Xoá mềm (archive) — giữ lịch sử ôn tập' })
  @ApiOkResponse({ type: ArchivedResponseDto })
  archive(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
  ): Promise<ArchivedResponse> {
    return this.collectionsService.archive(BigInt(payload.sub), id);
  }
}
