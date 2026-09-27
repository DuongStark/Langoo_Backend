import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/auth.types';
import { ErrorResponseDto } from '../common/swagger/error-response.dto';
import { CreateProfileDto } from './dto/create-profile.dto';
import {
  DeletedProfileResponseDto,
  ProfileListResponseDto,
  ProfileResponseDto,
} from './dto/profile-response.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileIdDto } from './dto/profile-id.dto';
import { ProfileService } from './profile.service';
import { DeletedProfileResponse, ProfileResponse } from './types/users.types';

@ApiTags('profiles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('profiles')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách hồ sơ học của tôi' })
  @ApiOkResponse({ type: ProfileListResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  async list(
    @CurrentUser() payload: JwtPayload,
  ): Promise<{ data: ProfileResponse[] }> {
    return { data: await this.profileService.list(BigInt(payload.sub)) };
  }

  @Post()
  @ApiOperation({
    summary: 'Tạo hồ sơ học (hồ sơ đầu tiên tự động là mặc định)',
  })
  @ApiCreatedResponse({ type: ProfileResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto })
  create(
    @CurrentUser() payload: JwtPayload,
    @Body() dto: CreateProfileDto,
  ): Promise<ProfileResponse> {
    return this.profileService.create(BigInt(payload.sub), dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết hồ sơ học' })
  @ApiOkResponse({ type: ProfileResponseDto })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'PROFILE_NOT_FOUND',
  })
  get(
    @CurrentUser() payload: JwtPayload,
    @Param() params: ProfileIdDto,
  ): Promise<ProfileResponse> {
    return this.profileService.get(BigInt(payload.sub), params.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Cập nhật hồ sơ học / đặt làm mặc định' })
  @ApiOkResponse({ type: ProfileResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto })
  update(
    @CurrentUser() payload: JwtPayload,
    @Param() params: ProfileIdDto,
    @Body() dto: UpdateProfileDto,
  ): Promise<ProfileResponse> {
    return this.profileService.update(BigInt(payload.sub), params.id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Xoá hồ sơ học (không xoá hồ sơ mặc định/duy nhất)',
  })
  @ApiOkResponse({ type: DeletedProfileResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto })
  remove(
    @CurrentUser() payload: JwtPayload,
    @Param() params: ProfileIdDto,
  ): Promise<DeletedProfileResponse> {
    return this.profileService.remove(BigInt(payload.sub), params.id);
  }
}
