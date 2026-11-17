import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { JwtPayload } from '../../../auth/types/auth.types';
import { parseUuidParam } from '../../../common/ids/postgres-id';
import { ErrorResponseDto } from '../../../common/swagger/error-response.dto';
import {
  CreateQuizJobDto,
  QuizEligibilityDto,
  QuizEligibilityResponse,
  QuizJobActionDto,
  QuizJobResponse,
  ReportQuizQuestionDto,
  QuizQuestionReportResponse,
} from './quiz-v3.dto';
import { QuizJobsService } from './quiz-jobs.service';

@ApiTags('Quizzes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ApiBadRequestResponse({ type: ErrorResponseDto })
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiForbiddenResponse({ type: ErrorResponseDto })
@ApiNotFoundResponse({ type: ErrorResponseDto })
@ApiConflictResponse({ type: ErrorResponseDto })
@ApiTooManyRequestsResponse({ type: ErrorResponseDto })
@ApiServiceUnavailableResponse({ type: ErrorResponseDto })
@Controller('quizzes')
export class QuizJobsController {
  constructor(private readonly jobs: QuizJobsService) {}
  @Post(':quiz_id/questions/:ordinal/report')
  @HttpCode(202)
  @ApiOperation({
    summary: 'V3: lưu báo câu sai và cách ly cache trong scope; không gọi AI',
  })
  @ApiAcceptedResponse({ type: QuizQuestionReportResponse })
  report(
    @CurrentUser() user: JwtPayload,
    @Param('quiz_id') id: string,
    @Param('ordinal', ParseIntPipe) ordinal: number,
    @Body() dto: ReportQuizQuestionDto,
  ): Promise<QuizQuestionReportResponse> {
    return this.jobs.report(BigInt(user.sub), parseUuidParam(id), ordinal, dto);
  }

  @Post('eligibility')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'V3: kiểm khả năng tạo đề theo ngôn ngữ/kỹ năng; không gọi model hoặc giữ quota',
  })
  @ApiOkResponse({ type: QuizEligibilityResponse })
  eligibility(
    @CurrentUser() user: JwtPayload,
    @Body() dto: QuizEligibilityDto,
  ): Promise<QuizEligibilityResponse> {
    return this.jobs.eligibility(BigInt(user.sub), dto);
  }

  @Post('jobs')
  @HttpCode(202)
  @ApiOperation({
    summary:
      'V3: tạo/replay tác vụ bền vững theo idempotency key; flag mặc định tắt',
  })
  @ApiAcceptedResponse({ type: QuizJobResponse })
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateQuizJobDto,
  ): Promise<QuizJobResponse> {
    return this.jobs.create(BigInt(user.sub), dto);
  }

  @Get('jobs/:quiz_id')
  @ApiOperation({
    summary:
      'V3: tiến độ thật; không trả source, câu hỏi hoặc đáp án chưa công bố',
  })
  @ApiOkResponse({ type: QuizJobResponse })
  get(
    @CurrentUser() user: JwtPayload,
    @Param('quiz_id') id: string,
  ): Promise<QuizJobResponse> {
    return this.jobs.get(BigInt(user.sub), parseUuidParam(id));
  }

  @Post('jobs/:quiz_id/actions')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'V3: thử tiếp, nhận đề ngắn đã qua audit hoặc hủy; thực hiện theo allowed_actions',
  })
  @ApiOkResponse({ type: QuizJobResponse })
  action(
    @CurrentUser() user: JwtPayload,
    @Param('quiz_id') id: string,
    @Body() dto: QuizJobActionDto,
  ): Promise<QuizJobResponse> {
    return this.jobs.action(BigInt(user.sub), parseUuidParam(id), dto.action);
  }
}
