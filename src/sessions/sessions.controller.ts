import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/auth.types';
import { ErrorResponseDto } from '../common/swagger/error-response.dto';
import { AnswerSessionDto } from './dto/answer-session.dto';
import { CreateSessionDto } from './dto/create-session.dto';
import { ListSessionItemsQueryDto } from './dto/list-session-items-query.dto';
import {
  AnswerResultResponseDto,
  RemoveSessionWordResponseDto,
  SessionDetailResponseDto,
  SessionItemResponseDto,
  SessionResponseDto,
} from './dto/session-response.dto';
import { SessionsService } from './sessions.service';
import {
  AnswerResultResponse,
  RemoveSessionWordResponse,
  SessionDetailResponse,
  SessionItemResponse,
  SessionResponse,
} from './types/sessions.types';

@ApiTags('sessions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Post()
  @ApiOperation({
    summary:
      'Tạo phiên ôn (snapshot đề bài; đáp án giấu tới khi trả lời; review=due, practice=ôn trước)',
  })
  @ApiCreatedResponse({ type: SessionDetailResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'SESSION_NO_CARDS / PROFILE_REQUIRED',
  })
  create(
    @CurrentUser() payload: JwtPayload,
    @Body() dto: CreateSessionDto,
  ): Promise<SessionDetailResponse> {
    return this.sessionsService.create(BigInt(payload.sub), dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Chi tiết phiên + tiến độ (đáp án chỉ hiện với câu đã trả lời)',
  })
  @ApiOkResponse({ type: SessionDetailResponseDto })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'SESSION_NOT_FOUND',
  })
  get(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
  ): Promise<SessionDetailResponse> {
    return this.sessionsService.get(BigInt(payload.sub), id);
  }

  @Get(':id/items')
  @ApiOperation({
    summary:
      'Danh sách câu đã trả lời (lọc is_correct=false cho màn "câu sai")',
  })
  @ApiOkResponse({ type: [SessionItemResponseDto] })
  items(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
    @Query() query: ListSessionItemsQueryDto,
  ): Promise<SessionItemResponse[]> {
    return this.sessionsService.listItems(BigInt(payload.sub), id, {
      isCorrect: query.is_correct,
    });
  }

  @Post(':id/answers')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Trả lời 1 câu — đáp án chấm ở server (client không gửi is_correct)',
  })
  @ApiOkResponse({ type: AnswerResultResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'SESSION_ANSWER_INVALID; option_index phải có trong prompt.options',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'SESSION_CLOSED / SESSION_IDEMPOTENCY_CONFLICT / SESSION_REPLAY_UNAVAILABLE / SRS_ITEM_UNAVAILABLE / SRS_DAILY_LIMIT_REACHED',
  })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'SRS_ITEM_NOT_DUE khi review chưa đủ điều kiện learn-ahead',
  })
  answer(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
    @Body() dto: AnswerSessionDto,
  ): Promise<AnswerResultResponse> {
    return this.sessionsService.answer(BigInt(payload.sub), id, dto);
  }

  @Delete(':id/items/:ordinal')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Xoá từ khỏi bộ sưu tập và phiên học hiện tại (áp dụng cho flashcard/practice/review)',
  })
  @ApiParam({
    name: 'id',
    description: 'ID phiên học (UUID)',
    example: '01a18014-bdee-72d8-9891-b3fefa8ec160',
  })
  @ApiParam({
    name: 'ordinal',
    description: 'Thứ tự câu hỏi trong phiên cần xoá',
    example: 1,
  })
  @ApiOkResponse({ type: RemoveSessionWordResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'SESSION_ACTION_UNSUPPORTED (không hỗ trợ trong phiên quiz)',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description:
      'SESSION_NOT_FOUND / SESSION_ITEM_NOT_FOUND / COLLECTION_ITEM_NOT_FOUND',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'SESSION_CLOSED',
  })
  removeWord(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
    @Param(
      'ordinal',
      new ParseIntPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }),
    )
    ordinal: number,
  ): Promise<RemoveSessionWordResponse> {
    return this.sessionsService.removeWord(BigInt(payload.sub), id, ordinal);
  }

  @Post(':id/finish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Đóng phiên sớm (đủ câu → completed + score; thiếu → abandoned)',
  })
  @ApiOkResponse({ type: SessionResponseDto })
  finish(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
  ): Promise<SessionResponse> {
    return this.sessionsService.finish(BigInt(payload.sub), id);
  }
}
