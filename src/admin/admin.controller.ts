import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
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
import { AdminCurationService } from './admin-curation.service';
import { AdminGlossReportsService } from './admin-gloss-reports.service';
import { AdminStatsService } from './admin-stats.service';
import { AdminUsersService } from './admin-users.service';
import {
  AdminCurationConceptQueryDto,
  AdminCurationSearchQueryDto,
  CreateCurationGlossDto,
  CreateCurationMappingDto,
  UpdateCurationConceptDto,
  UpdateCurationGlossDto,
} from './dto/admin-curation.dto';
import {
  AdminGlossReportQueryDto,
  AdminListQueryDto,
  AdminUserListResponseDto,
  AdminUserQueryDto,
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

  @Get()
  @ApiOperation({
    summary:
      'Danh sách/tìm người học — filter status/role, q email/tên, cursor (chỉ metadata tài khoản)',
  })
  @ApiOkResponse({ type: AdminUserListResponseDto })
  list(@Query() query: AdminUserQueryDto): Promise<AdminUserListResponseDto> {
    return this.users.list(query);
  }

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

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/curation')
export class AdminCurationController {
  constructor(private readonly curation: AdminCurationService) {}

  @Get('senses')
  @ApiOperation({
    summary: 'Tìm sense để sửa (lemma/kana/romaji hoặc external_id)',
  })
  search(@Query() query: AdminCurationSearchQueryDto) {
    return this.curation.searchSenses(query);
  }

  @Get('senses/:id')
  @ApiOperation({
    summary: 'Chi tiết sense: gloss VI/EN, nối nghĩa, report gần đây',
  })
  detail(@Param('id') id: string) {
    return this.curation.getSense(parsePositivePostgresBigInt(id, 'ID sense'));
  }

  @Get('concepts')
  @ApiOperation({
    summary: 'Tìm concept (gloss_en/vi hoặc id) — dùng khi thêm nối nghĩa đúng',
  })
  searchConcepts(@Query() query: AdminCurationConceptQueryDto) {
    return this.curation.searchConcepts(query);
  }

  @Get('glosses/:id')
  @ApiOperation({
    summary: 'Tra gloss theo id + sense chứa nó (nối từ hàng chờ report)',
  })
  getGloss(@Param('id') id: string) {
    return this.curation.getGloss(parsePositivePostgresBigInt(id, 'ID gloss'));
  }

  @Patch('glosses/:id')
  @ApiOperation({
    summary: 'Sửa gloss: text/reviewed/quality (audit cùng transaction)',
  })
  updateGloss(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateCurationGlossDto,
  ) {
    return this.curation.updateGloss(
      BigInt(payload.sub),
      parsePositivePostgresBigInt(id, 'ID gloss'),
      dto,
    );
  }

  @Post('senses/:id/glosses')
  @ApiOperation({
    summary: 'Thêm gloss VI do admin nhập (đánh dấu đã duyệt)',
  })
  createGloss(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CreateCurationGlossDto,
  ) {
    return this.curation.createGloss(
      BigInt(payload.sub),
      parsePositivePostgresBigInt(id, 'ID sense'),
      dto,
    );
  }

  @Delete('glosses/:id')
  @ApiOperation({ summary: 'Xoá gloss (audit giữ nguyên nội dung đã xoá)' })
  deleteGloss(@CurrentUser() payload: JwtPayload, @Param('id') id: string) {
    return this.curation.deleteGloss(
      BigInt(payload.sub),
      parsePositivePostgresBigInt(id, 'ID gloss'),
    );
  }

  @Post('senses/:id/mappings')
  @ApiOperation({
    summary:
      'Thêm nối nghĩa sense→concept (admin, verified; refresh serve chạy nền)',
  })
  addMapping(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CreateCurationMappingDto,
  ) {
    return this.curation.addMapping(
      BigInt(payload.sub),
      parsePositivePostgresBigInt(id, 'ID sense'),
      dto,
    );
  }

  @Delete('senses/:id/mappings/:conceptId')
  @ApiOperation({ summary: 'Xoá nối nghĩa sai (refresh serve chạy nền)' })
  deleteMapping(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
    @Param('conceptId') conceptId: string,
  ) {
    return this.curation.deleteMapping(
      BigInt(payload.sub),
      parsePositivePostgresBigInt(id, 'ID sense'),
      parsePositivePostgresBigInt(conceptId, 'ID concept'),
    );
  }

  @Patch('concepts/:id')
  @ApiOperation({
    summary: 'Đổi trạng thái concept (draft|review|curated|rejected)',
  })
  updateConcept(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateCurationConceptDto,
  ) {
    return this.curation.updateConceptStatus(
      BigInt(payload.sub),
      parsePositivePostgresBigInt(id, 'ID concept'),
      dto,
    );
  }

  @Post('serve/refresh')
  @ApiOperation({
    summary:
      'Refresh serve.sense_pair ngay (thường đã tự chạy nền sau mutation)',
  })
  refresh() {
    return this.curation.triggerServeRefresh();
  }
}
