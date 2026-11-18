import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/auth.types';
import { ErrorResponseDto } from '../common/swagger/error-response.dto';
import { ActivityQueryDto, ActivityResponseDto } from './dto/activity.dto';
import { GamificationStatsDto } from './dto/gamification.dto';
import { GamificationService } from './gamification.service';
import {
  ActivityCalendar,
  GamificationStats,
} from './types/gamification.types';

@ApiTags('gamification')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me')
export class GamificationController {
  constructor(private readonly gamification: GamificationService) {}

  @Get('activity')
  @ApiOperation({
    summary: 'Streak và lịch hoạt động theo năm, dùng timezone user',
  })
  @ApiOkResponse({ type: ActivityResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  activity(
    @CurrentUser() payload: JwtPayload,
    @Query() query: ActivityQueryDto,
  ): Promise<ActivityCalendar> {
    return this.gamification.getActivity(BigInt(payload.sub), query.year);
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Streak và thống kê học tập của tôi (ngày theo timezone user)',
  })
  @ApiOkResponse({ type: GamificationStatsDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  stats(@CurrentUser() payload: JwtPayload): Promise<GamificationStats> {
    return this.gamification.getStats(BigInt(payload.sub));
  }
}
