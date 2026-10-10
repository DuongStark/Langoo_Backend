import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../../auth/types/auth.types';
import { parseUuidParam } from '../../common/ids/postgres-id';
import { ErrorResponseDto } from '../../common/swagger/error-response.dto';
import { SessionDetailResponse } from '../../sessions/types/sessions.types';
import { CreateQuizDto, QuizListQueryDto } from './dto/quiz.dto';
import { QuizService } from './quiz.service';
import {
  CreateQuizResponse,
  QuizDetailResponse,
  QuizListResponse,
} from './types/quiz.types';

@ApiTags('quizzes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('quizzes')
export class QuizController {
  constructor(private readonly quizService: QuizService) {}

  @Post()
  @ApiOperation({
    summary: 'Sinh quiz từ bộ sưu tập (dữ liệu + ngữ cảnh Kanji tùy chọn)',
    description:
      'Nguồn từ vựng: item có srs_state (ưu tiên review → relearning → learning → new). ' +
      'question_styles: meaning/kanji_reading/kanji_orthography cho multiple_choice/mixed. ' +
      'context_mode: none/source/source_or_generated. Câu dữ liệu không gọi AI. ' +
      'Quota riêng 15/ngày (AI_QUIZ_DAILY_LIMIT); cooldown 15s chống spam — bấm đúp cùng ' +
      'tham số trả lại quiz cũ (reused=true). Ví dụ curl: docs/api/quizzes.md',
  })
  @ApiCreatedResponse({ description: 'Quiz đã sẵn sàng' })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'QUIZ_NOT_ENOUGH_ITEMS',
  })
  create(
    @CurrentUser() payload: JwtPayload,
    @Body() dto: CreateQuizDto,
  ): Promise<CreateQuizResponse> {
    return this.quizService.create(BigInt(payload.sub), dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lịch sử quiz (kèm session gần nhất)' })
  @ApiOkResponse({ description: '{ data, next_cursor }' })
  list(
    @CurrentUser() payload: JwtPayload,
    @Query() query: QuizListQueryDto,
  ): Promise<QuizListResponse> {
    return this.quizService.list(BigInt(payload.sub), query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Chi tiết quiz + câu hỏi (không kèm đáp án) + 5 session gần nhất',
  })
  get(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
  ): Promise<QuizDetailResponse> {
    return this.quizService.get(
      BigInt(payload.sub),
      parseUuidParam(id, 'ID quiz'),
    );
  }

  @Post(':id/start')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Bắt đầu làm quiz — tạo phiên học kind=quiz (snapshot câu hỏi)',
  })
  @ApiCreatedResponse({ description: 'Phiên học như /sessions/:id' })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'QUIZ_NOT_READY / QUIZ_EXPIRED',
  })
  start(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
  ): Promise<SessionDetailResponse> {
    return this.quizService.start(
      BigInt(payload.sub),
      parseUuidParam(id, 'ID quiz'),
    );
  }
}
