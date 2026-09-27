import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
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
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/auth.types';
import { parsePositivePostgresBigInt } from '../common/ids/postgres-id';
import { ErrorResponseDto } from '../common/swagger/error-response.dto';
import {
  DeletedResponseDto,
  TagListResponseDto,
  TagResponseDto,
} from './dto/collection-response.dto';
import { CreateTagDto } from './dto/create-tag.dto';
import { ListTagsQueryDto } from './dto/list-tags-query.dto';
import { TagsService } from './tags.service';
import {
  DeletedResponse,
  TagListResult,
  TagResponse,
} from './types/collections.types';

@ApiTags('tags')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tags')
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách tag của tôi' })
  @ApiOkResponse({ type: TagListResponseDto })
  list(
    @CurrentUser() payload: JwtPayload,
    @Query() query: ListTagsQueryDto,
  ): Promise<TagListResult> {
    return this.tagsService.list(BigInt(payload.sub), query);
  }

  @Post()
  @ApiOperation({ summary: 'Tạo tag (không phân biệt hoa thường)' })
  @ApiCreatedResponse({ type: TagResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'TAG_ALREADY_EXISTS',
  })
  create(
    @CurrentUser() payload: JwtPayload,
    @Body() dto: CreateTagDto,
  ): Promise<TagResponse> {
    return this.tagsService.create(BigInt(payload.sub), dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Xoá tag (gỡ khỏi mọi item)' })
  @ApiOkResponse({ type: DeletedResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  remove(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
  ): Promise<DeletedResponse> {
    return this.tagsService.remove(
      BigInt(payload.sub),
      parsePositivePostgresBigInt(id, 'tag_id').toString(),
    );
  }
}
