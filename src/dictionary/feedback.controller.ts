import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/auth.types';
import { ErrorResponseDto } from '../common/swagger/error-response.dto';
import { CreateGlossReportDto } from './dto/create-gloss-report.dto';
import { GlossReportResponseDto } from './dto/dictionary-response.dto';
import { FeedbackService } from './feedback.service';
import { GlossReportResponse } from './types/dictionary.types';

@ApiTags('dictionary')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('gloss-reports')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post()
  @ApiOperation({
    summary: 'Báo lỗi gloss/nghĩa (badge chưa kiểm duyệt → user report)',
  })
  @ApiCreatedResponse({ type: GlossReportResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  create(
    @CurrentUser() payload: JwtPayload,
    @Body() dto: CreateGlossReportDto,
  ): Promise<GlossReportResponse> {
    return this.feedbackService.create(BigInt(payload.sub), dto);
  }
}
