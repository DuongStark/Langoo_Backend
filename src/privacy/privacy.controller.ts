import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
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
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdminGuard } from '../auth/guards/admin.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/auth.types';
import { ErrorResponseDto } from '../common/swagger/error-response.dto';
import {
  AdminPrivacyRequestListResponse,
  LegalManifestResponse,
  PrivacyEventInput,
  PrivacyEventResponse,
  PrivacyListQuery,
  PrivacyRequestInput,
  PrivacyRequestListResponse,
  PrivacyRequestResponse,
  PrivacyStateResponse,
  UpdatePrivacyRequestInput,
} from './privacy.dto';
import { PrivacyService } from './privacy.service';

@ApiTags('privacy')
@Controller('legal')
export class LegalController {
  constructor(private readonly privacy: PrivacyService) {}
  @Get('manifest')
  @ApiOperation({
    summary: 'M12.1 — Phiên bản thông báo và mục đích xử lý',
    description:
      'Không giới hạn tuổi; không chứng nhận xác minh người đại diện.',
  })
  @ApiOkResponse({ type: LegalManifestResponse })
  manifest(): LegalManifestResponse {
    return this.privacy.manifest();
  }
}

@ApiTags('privacy')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiBadRequestResponse({ type: ErrorResponseDto })
@ApiConflictResponse({ type: ErrorResponseDto })
@ApiNotFoundResponse({ type: ErrorResponseDto })
@ApiServiceUnavailableResponse({ type: ErrorResponseDto })
@Controller('me/privacy')
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}
  @Get()
  @ApiOperation({
    summary: 'Lựa chọn riêng tư của tôi',
    description: 'Không có bằng chứng trả needs_action, không mặc định đồng ý.',
  })
  @ApiOkResponse({ type: PrivacyStateResponse })
  state(@CurrentUser() user: JwtPayload): Promise<PrivacyStateResponse> {
    return this.privacy.state(BigInt(user.sub));
  }
  @Post('events')
  @ApiOperation({
    summary: 'Ghi grant/withdraw có phiên bản',
    description: 'request_id idempotent theo user, retry khác body trả409.',
  })
  @ApiCreatedResponse({ type: PrivacyEventResponse })
  event(
    @CurrentUser() user: JwtPayload,
    @Body() input: PrivacyEventInput,
  ): Promise<PrivacyEventResponse> {
    return this.privacy.recordEvent(BigInt(user.sub), input);
  }
  @Post('requests')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Tiếp nhận yêu cầu quyền dữ liệu',
    description:
      '202 là đã nhận/ghi ticket, không phải đã xuất hoặc xóa dữ liệu. Xử lý thủ công theo runbook.',
  })
  @ApiAcceptedResponse({ type: PrivacyRequestResponse })
  create(
    @CurrentUser() user: JwtPayload,
    @Body() input: PrivacyRequestInput,
  ): Promise<PrivacyRequestResponse> {
    return this.privacy.createRequest(BigInt(user.sub), input);
  }
  @Get('requests')
  @ApiOperation({
    summary: 'Danh sách yêu cầu của tôi',
    description: 'Tối đa50, cursor ID opaque.',
  })
  @ApiOkResponse({ type: PrivacyRequestListResponse })
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: PrivacyListQuery,
  ): Promise<PrivacyRequestListResponse> {
    return this.privacy.listRequests(BigInt(user.sub), query.cursor);
  }
  @Get('requests/:id')
  @ApiOperation({
    summary: 'Theo dõi yêu cầu của tôi',
    description: 'Yêu cầu của user khác trả404.',
  })
  @ApiOkResponse({ type: PrivacyRequestResponse })
  get(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<PrivacyRequestResponse> {
    return this.privacy.getRequest(BigInt(user.sub), id);
  }
}

@ApiTags('privacy-admin')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiForbiddenResponse({ type: ErrorResponseDto })
@ApiBadRequestResponse({ type: ErrorResponseDto })
@ApiConflictResponse({ type: ErrorResponseDto })
@ApiNotFoundResponse({ type: ErrorResponseDto })
@ApiServiceUnavailableResponse({ type: ErrorResponseDto })
@Controller('admin/privacy/requests')
export class AdminPrivacyController {
  constructor(private readonly privacy: PrivacyService) {}
  @Get()
  @ApiOperation({
    summary: 'Hàng đợi quyền dữ liệu',
    description: 'Chỉ admin, tối đa50, cursor ID opaque.',
  })
  @ApiOkResponse({ type: AdminPrivacyRequestListResponse })
  list(
    @Query() query: PrivacyListQuery,
  ): Promise<AdminPrivacyRequestListResponse> {
    return this.privacy.listAdminRequests(query.cursor);
  }
  @Patch(':id')
  @ApiOperation({
    summary: 'Xử lý yêu cầu quyền dữ liệu',
    description:
      'Ghi admin audit; chỉ received/in_progress/rejected. Hoàn tất thực tế theo hồ sơ thủ công, chưa có API completed.',
  })
  @ApiOkResponse({ type: PrivacyRequestResponse })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdatePrivacyRequestInput,
  ): Promise<PrivacyRequestResponse> {
    return this.privacy.updateRequest(BigInt(user.sub), id, input);
  }
}
