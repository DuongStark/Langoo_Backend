import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/auth.types';
import { ErrorResponseDto } from '../common/swagger/error-response.dto';
import { CreateReviewDto } from './dto/create-review.dto';
import { DueQueryDto } from './dto/due-query.dto';
import {
  DueResultDto,
  ReviewResultDto,
  StatsResultDto,
} from './dto/srs-response.dto';
import { SrsService } from './srs.service';
import { DueResult, ReviewResult, StatsResult } from './types/srs.types';

@ApiTags('srs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('srs')
export class SrsController {
  constructor(private readonly srsService: SrsService) {}

  @Get('due')
  @ApiOperation({
    summary:
      'Hàng đợi ôn hôm nay (learning → review → new; learn-ahead 20 phút; daily limit theo settings)',
  })
  @ApiOkResponse({ type: DueResultDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'PROFILE_REQUIRED khi chưa có hồ sơ học',
  })
  due(
    @CurrentUser() payload: JwtPayload,
    @Query() query: DueQueryDto,
  ): Promise<DueResult> {
    return this.srsService.getDue(BigInt(payload.sub), query);
  }

  @Post('reviews')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Trả lời 1 thẻ (transaction: log + state + burying + XP)',
  })
  @ApiOkResponse({ type: ReviewResultDto })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'SRS_ITEM_NOT_FOUND',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'SRS_ITEM_SUSPENDED',
  })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'SRS_ITEM_NOT_DUE — thẻ chưa đến hạn',
  })
  review(
    @CurrentUser() payload: JwtPayload,
    @Body() dto: CreateReviewDto,
  ): Promise<ReviewResult> {
    return this.srsService.review(BigInt(payload.sub), dto);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Thống kê SRS của tôi (theo ngày địa phương)' })
  @ApiOkResponse({ type: StatsResultDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  stats(@CurrentUser() payload: JwtPayload): Promise<StatsResult> {
    return this.srsService.stats(BigInt(payload.sub));
  }
}
