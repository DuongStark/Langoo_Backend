import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
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
import { SettingsResponseDto } from './dto/settings-response.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { SettingsService } from './settings.service';
import { SettingsResponse } from './types/users.types';

@ApiTags('settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me/settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @ApiOperation({
    summary: 'Cài đặt của tôi (chưa có row → trả giá trị mặc định)',
  })
  @ApiOkResponse({ type: SettingsResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  get(@CurrentUser() payload: JwtPayload): Promise<SettingsResponse> {
    return this.settingsService.get(BigInt(payload.sub));
  }

  @Patch()
  @ApiOperation({ summary: 'Cập nhật cài đặt (upsert)' })
  @ApiOkResponse({ type: SettingsResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  update(
    @CurrentUser() payload: JwtPayload,
    @Body() dto: UpdateSettingsDto,
  ): Promise<SettingsResponse> {
    return this.settingsService.update(BigInt(payload.sub), dto);
  }
}
