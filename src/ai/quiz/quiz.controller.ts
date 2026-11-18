import {
  Body,
  Controller,
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
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../../auth/types/auth.types';
import { parseUuidParam } from '../../common/ids/postgres-id';
import { ErrorResponseDto } from '../../common/swagger/error-response.dto';
import { SessionDetailResponse } from '../../sessions/types/sessions.types';
import { CreateQuizDto, QuizListQueryDto, StartQuizDto } from './dto/quiz.dto';
import { QuizService } from './quiz.service';
import {
  CreateQuizResponse,
  QuizDetailResponse,
  QuizListResponse,
} from './types/quiz.types';
import {
  QuizEligibilityDto,
  QuizEligibilityResponse,
  QuizQuestionReportResponse,
  ReportQuizQuestionDto,
} from './dto/quiz-bank.dto';

@ApiTags('quizzes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ApiBadRequestResponse({ type: ErrorResponseDto })
@ApiNotFoundResponse({ type: ErrorResponseDto })
@Controller('quizzes')
export class QuizController {
  constructor(private readonly quizService: QuizService) {}

  @Post('eligibility')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'M11.5: Kiểm tra nhanh khả năng tạo đề theo ngôn ngữ/kỹ năng từ sổ tay; 0 gọi AI, 0 trừ quota',
  })
  @ApiOkResponse({ type: QuizEligibilityResponse })
  eligibility(
    @CurrentUser() payload: JwtPayload,
    @Body() dto: QuizEligibilityDto,
  ): Promise<QuizEligibilityResponse> {
    return this.quizService.eligibility(BigInt(payload.sub), dto);
  }

  @Post()
  @ApiOperation({
    summary:
      'M11.5: Tạo quiz đồng bộ tức thời từ ngân hàng câu hỏi dùng chung (<200ms, 0 gọi AI trực tiếp)',
    description:
      'Khi gửi skills (M11.5): ghép ngay từ app.quiz_question_bank + fallback 0ms, trả đề status=ready ngay lập tức, không trừ ai_usage. ' +
      'Khi chỉ gửi question_types: giữ nhánh tương thích ngược cho client cũ.',
  })
  @ApiCreatedResponse({ description: 'Quiz đã sẵn sàng' })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'QUIZ_NOT_ENOUGH_ITEMS / QUIZ_LANGUAGE_NOT_IN_PROFILE',
  })
  @ApiServiceUnavailableResponse({
    type: ErrorResponseDto,
    description: 'AI_PROVIDER_UNAVAILABLE',
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
    summary:
      'Chi tiết quiz + câu hỏi (có segments, không kèm đáp án) + 5 session gần nhất',
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
    summary:
      'Bắt đầu hoặc làm lại quiz (intent=resume | new_attempt) — tạo phiên học kind=quiz',
  })
  @ApiCreatedResponse({ description: 'Phiên học như /sessions/:id' })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'QUIZ_NOT_READY / QUIZ_EXPIRED / QUIZ_ATTEMPT_IN_PROGRESS',
  })
  start(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
    @Body() dto?: StartQuizDto,
  ): Promise<SessionDetailResponse> {
    return this.quizService.start(
      BigInt(payload.sub),
      parseUuidParam(id, 'ID quiz'),
      dto?.intent,
      dto?.idempotency_key,
    );
  }

  @Post(':quiz_id/questions/:ordinal/report')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'M11.5: Báo lỗi câu hỏi — ẩn ngay với người báo, đủ 2 người khác nhau báo lỗi tự khóa khỏi kho chung',
  })
  @ApiAcceptedResponse({ type: QuizQuestionReportResponse })
  report(
    @CurrentUser() payload: JwtPayload,
    @Param('quiz_id') quizId: string,
    @Param('ordinal', ParseIntPipe) ordinal: number,
    @Body() dto: ReportQuizQuestionDto,
  ): Promise<QuizQuestionReportResponse> {
    return this.quizService.reportQuestion(
      BigInt(payload.sub),
      parseUuidParam(quizId, 'ID quiz'),
      ordinal,
      dto,
    );
  }
}
