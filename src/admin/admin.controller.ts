import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdminGuard } from '../auth/guards/admin.guard';
import { JwtPayload } from '../auth/types/auth.types';
import { parsePositivePostgresBigInt } from '../common/ids/postgres-id';
import { AdminAuditService } from './admin-audit.service';
import { AdminGlossReportsService } from './admin-gloss-reports.service';
import { AdminStatsService } from './admin-stats.service';
import { AdminUsersService } from './admin-users.service';
import {
  AdminGlossReportQueryDto,
  AdminListQueryDto,
  TimeseriesQueryDto,
  UpdateGlossReportDto,
  UpdateUserStatusDto,
} from './dto/admin.dto';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/stats')
export class AdminStatsController {
  constructor(private readonly statsService: AdminStatsService) {}

  @Get()
  @ApiOperation({
    summary: 'Thống kê vận hành tổng hợp (user/học tập/nội dung/AI)',
    description:
      'CHỈ số liệu tổng hợp — không chứa nội dung collection/item/chat cá nhân.',
  })
  @ApiOkResponse({ description: 'Snapshot 7/30 ngày theo UTC' })
  overview() {
    return this.statsService.overview();
  }

  @Get('timeseries')
  @ApiOperation({
    summary: 'Chuỗi theo ngày cho metric: signups|reviews|xp|ai_requests',
  })
  timeseries(@Query() query: TimeseriesQueryDto) {
    return this.statsService.timeseries(query.metric, query.days ?? 30);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/gloss-reports')
export class AdminGlossReportsController {
  constructor(private readonly glossReports: AdminGlossReportsService) {}

  @Get()
  @ApiOperation({
    summary: 'Hàng chờ báo lỗi gloss (dữ liệu user chủ động gửi)',
  })
  list(@Query() query: AdminGlossReportQueryDto) {
    return this.glossReports.list(query);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Xử lý báo lỗi: triaged|fixed|rejected (audit cùng transaction)',
  })
  update(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateGlossReportDto,
  ) {
    return this.glossReports.update(
      BigInt(payload.sub),
      parsePositivePostgresBigInt(id, 'ID báo lỗi').toString(),
      dto,
    );
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Patch(':id')
  @ApiOperation({
    summary: 'Khoá/mở tài khoản người học (active|locked) — có audit',
  })
  updateStatus(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.users.updateStatus(BigInt(payload.sub), id, dto);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/audit-log')
export class AdminAuditController {
  constructor(private readonly audit: AdminAuditService) {}

  @Get()
  @ApiOperation({ summary: 'Nhật ký thao tác admin (mới nhất trước)' })
  list(@Query() query: AdminListQueryDto) {
    return this.audit.list(query);
  }
}
