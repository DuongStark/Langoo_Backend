import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/auth.types';
import { ErrorResponseDto } from '../common/swagger/error-response.dto';
import { MAX_ATTACHMENTS } from '../storage/storage.service';
import {
  CreateFeedbackDto,
  FEEDBACK_CATEGORIES,
  MyFeedbackQueryDto,
} from './dto/feedback.dto';
import { FeedbackService } from './feedback.service';
import { FeedbackResponse } from './types/feedback.types';
import { FeedbackRateLimitGuard } from './feedback-rate-limit.guard';
import { FeedbackUploadInterceptor } from './feedback-upload.interceptor';

@ApiTags('feedback')
@ApiBearerAuth()
@UseGuards(FeedbackRateLimitGuard)
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FeedbackUploadInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['category', 'content'],
      properties: {
        category: { type: 'string', enum: [...FEEDBACK_CATEGORIES] },
        content: { type: 'string', minLength: 10, maxLength: 4000 },
        files: {
          type: 'array',
          maxItems: MAX_ATTACHMENTS,
          items: { type: 'string', format: 'binary' },
        },
      },
    },
  })
  @ApiOperation({
    summary: 'Gửi feedback (text + tối đa 3 ảnh ≤5MB, JPEG/PNG/WebP)',
    description:
      'Ảnh kiểm magic bytes; lưu qua StorageService (local dev/VPS). ' +
      'Giới hạn 10 lần/giờ/user.',
  })
  @ApiCreatedResponse({ description: 'Feedback đã ghi nhận' })
  @ApiTooManyRequestsResponse({ type: ErrorResponseDto })
  create(
    @CurrentUser() payload: JwtPayload,
    @Body() dto: CreateFeedbackDto,
    @UploadedFiles() files: Express.Multer.File[] = [],
  ): Promise<FeedbackResponse> {
    return this.feedbackService.create(BigInt(payload.sub), dto, files);
  }
}

@ApiTags('feedback')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me/feedback')
export class MeFeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Get()
  @ApiOperation({
    summary: 'Feedback của tôi (kèm trạng thái + ghi chú admin)',
  })
  @ApiOkResponse({ description: '{ data, next_cursor }' })
  list(@CurrentUser() payload: JwtPayload, @Query() query: MyFeedbackQueryDto) {
    return this.feedbackService.listMine(BigInt(payload.sub), query);
  }
}
